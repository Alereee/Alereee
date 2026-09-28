import * as yauzl from 'yauzl';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { once } from 'node:events';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

// What the sources distribute is packed: the WordNet releases are a zip
// (Open English WordNet) or a tar.gz (Princeton), the extract of Wiktionary
// a gzip. An uploaded file has lost its name on the way, so the format is
// read from its first bytes, never from an extension.

export type PackingT = 'zip' | 'gzip' | 'plain';

export const packingOf = async (file: string): Promise<PackingT> => {
  const handle = await open(file, 'r');
  try {
    const head = Buffer.alloc(4);
    const { bytesRead } = await handle.read(head, 0, 4, 0);
    if (bytesRead >= 2 && head[0] === 0x1f && head[1] === 0x8b) return 'gzip';
    if (bytesRead >= 4 && head.readUInt32LE(0) === 0x04034b50) return 'zip';
    return 'plain';
  } finally {
    await handle.close();
  }
};

/** The files of a WordNet database a converter reads (wndb(5)); everything else in a release stays packed */
export const WORDNET_FILES: readonly string[] = ['noun', 'verb', 'adj', 'adv'].flatMap((pos) => [
  `data.${pos}`,
  `index.${pos}`,
  `${pos}.exc`,
]);

// one file of a release is a few megabytes; a packed file that expands past this is not a release
const MAX_UNPACKED_FILE_BYTES = 256 * 1024 * 1024;

export class NotASourceError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'NotASourceError';
  }
}

/** Called with the name of every entry of an archive, folders included, as the archive spells it */
export type ArchiveEntryListenerT = (name: string) => void;

const unpackZip = async (
  file: string,
  outDir: string,
  wanted: readonly string[],
  onEntry?: ArchiveEntryListenerT,
): Promise<string[]> => {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (error, opened) => (error ? reject(error) : resolve(opened)));
  });
  const found: string[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', (entry: yauzl.Entry) => {
        void (async () => {
          onEntry?.(entry.fileName);
          const name = path.posix.basename(entry.fileName);
          if (!entry.fileName.endsWith('/') && wanted.includes(name) && !found.includes(name)) {
            if (entry.uncompressedSize > MAX_UNPACKED_FILE_BYTES) {
              throw new NotASourceError(`"${entry.fileName}" is too large`);
            }
            const stream = await new Promise<NodeJS.ReadableStream>((opened, failed) => {
              zip.openReadStream(entry, (error, readable) => (error ? failed(error) : opened(readable)));
            });
            // the name written is one of the wanted ones, never what the archive says
            await pipeline(stream, createWriteStream(path.join(outDir, name)));
            found.push(name);
          }
          zip.readEntry();
        })().catch(reject);
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
  return found;
};

const TAR_BLOCK = 512;

const tarString = (block: Buffer, start: number, length: number): string => {
  const end = block.indexOf(0, start);
  return block.toString('utf-8', start, end === -1 || end > start + length ? start + length : end);
};

/** A tar read as it streams out of gunzip: a header block, the file in blocks of 512, the next header */
const unpackTarGz = async (
  file: string,
  outDir: string,
  wanted: readonly string[],
  onEntry?: ArchiveEntryListenerT,
): Promise<string[]> => {
  const found: string[] = [];
  const input = createReadStream(file).pipe(createGunzip());
  let pending: Buffer = Buffer.alloc(0);
  // what is left of the entry being read: its bytes, then the padding of its last block
  let remaining = 0;
  let padding = 0;
  let output: ReturnType<typeof createWriteStream> | null = null;

  const close = async (): Promise<void> => {
    if (!output) return;
    const stream = output;
    output = null;
    stream.end();
    await once(stream, 'finish');
  };

  try {
    for await (const chunk of input) {
      pending = pending.length ? Buffer.concat([pending, chunk as Buffer]) : (chunk as Buffer);
      for (;;) {
        if (remaining > 0) {
          if (pending.length === 0) break;
          const part = pending.subarray(0, Math.min(remaining, pending.length));
          pending = pending.subarray(part.length);
          remaining -= part.length;
          if (output && !output.write(part)) await once(output, 'drain');
          if (remaining === 0) await close();
          continue;
        }
        if (padding > 0) {
          if (pending.length === 0) break;
          const skipped = Math.min(padding, pending.length);
          pending = pending.subarray(skipped);
          padding -= skipped;
          continue;
        }
        if (pending.length < TAR_BLOCK) break;
        const header = pending.subarray(0, TAR_BLOCK);
        pending = pending.subarray(TAR_BLOCK);
        // two empty blocks end the archive
        if (header.every((byte) => byte === 0)) continue;
        const size = parseInt(tarString(header, 124, 12).trim() || '0', 8);
        if (!Number.isFinite(size) || size < 0) throw new NotASourceError('not a tar archive');
        const type = String.fromCharCode(header[156] || 0x30);
        onEntry?.(tarString(header, 0, 100));
        const name = path.posix.basename(tarString(header, 0, 100));
        remaining = size;
        padding = (TAR_BLOCK - (size % TAR_BLOCK)) % TAR_BLOCK;
        if ((type === '0' || type === '\0') && wanted.includes(name) && !found.includes(name)) {
          if (size > MAX_UNPACKED_FILE_BYTES) throw new NotASourceError(`"${name}" is too large`);
          output = createWriteStream(path.join(outDir, name));
          found.push(name);
          if (size === 0) await close();
        }
      }
    }
  } finally {
    await close();
    input.destroy();
  }
  return found;
};

/**
 * Takes the named files out of a packed release — a zip or a tar.gz — into
 * `outDir`, wherever in the archive they sit. Answers the names it found.
 */
export const unpackFiles = async (
  file: string,
  outDir: string,
  wanted: readonly string[],
  onEntry?: ArchiveEntryListenerT,
): Promise<string[]> => {
  const packing = await packingOf(file);
  if (packing === 'plain') throw new NotASourceError('neither a zip nor a tar.gz archive');
  await mkdir(outDir, { recursive: true });
  try {
    return packing === 'zip'
      ? await unpackZip(file, outDir, wanted, onEntry)
      : await unpackTarGz(file, outDir, wanted, onEntry);
  } catch (error) {
    if (error instanceof NotASourceError) throw error;
    throw new NotASourceError(error instanceof Error ? error.message : String(error));
  }
};

/** The names of the entries of a packed release, a zip or a tar.gz; nothing is written */
export const archiveEntries = async (file: string): Promise<string[]> => {
  const packing = await packingOf(file);
  if (packing === 'plain') throw new NotASourceError('neither a zip nor a tar.gz archive');
  const names: string[] = [];
  const listen: ArchiveEntryListenerT = (name) => names.push(name);
  try {
    // nothing is wanted, so nothing is unpacked and the folder is never made
    await (packing === 'zip' ? unpackZip(file, '', [], listen) : unpackTarGz(file, '', [], listen));
  } catch (error) {
    if (error instanceof NotASourceError) throw error;
    throw new NotASourceError(error instanceof Error ? error.message : String(error));
  }
  return names;
};

/**
 * When a gzipped file was made, as its header says (RFC 1952, MTIME): the
 * instant the source packed it. Null for a file that is not gzipped and for
 * one packed without a date.
 */
export const gzipModifiedAt = async (file: string): Promise<Date | null> => {
  const handle = await open(file, 'r');
  try {
    const head = Buffer.alloc(8);
    const { bytesRead } = await handle.read(head, 0, 8, 0);
    if (bytesRead < 8 || head[0] !== 0x1f || head[1] !== 0x8b) return null;
    const seconds = head.readUInt32LE(4);
    return seconds > 0 ? new Date(seconds * 1000) : null;
  } finally {
    await handle.close();
  }
};

/** The first line of a text file, plain or gzipped, read without reading the file */
export const firstLineOf = async (file: string, limit = 4 * 1024 * 1024): Promise<string> => {
  const raw = createReadStream(file);
  const input = (await packingOf(file)) === 'gzip' ? raw.pipe(createGunzip()) : raw;
  let text = '';
  try {
    for await (const chunk of input) {
      text += (chunk as Buffer).toString('utf-8');
      if (text.includes('\n') || text.length > limit) break;
    }
  } finally {
    raw.destroy();
  }
  return text.split('\n')[0];
};
