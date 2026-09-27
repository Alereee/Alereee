import * as yazl from 'yazl';
import { createWriteStream } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { gzipSync } from 'node:zlib';

// The fixtures as their sources pack them: a test asks for the archive it
// needs, none is committed

export type PackedFileT = { name: string; content: Buffer };

export const filesOf = async (dir: string, prefix = ''): Promise<PackedFileT[]> =>
  Promise.all(
    (await readdir(dir)).sort().map(async (name) => ({
      name: `${prefix}${name}`,
      content: await readFile(path.join(dir, name)),
    })),
  );

export const writeZip = async (file: string, files: PackedFileT[]): Promise<string> => {
  const zip = new yazl.ZipFile();
  for (const { name, content } of files) zip.addBuffer(content, name);
  zip.end();
  await pipeline(zip.outputStream, createWriteStream(file));
  return file;
};

const TAR_BLOCK = 512;

const tarHeader = (name: string, size: number, type: '0' | '5'): Buffer => {
  const header = Buffer.alloc(TAR_BLOCK);
  header.write(name, 0, 100, 'utf-8');
  header.write('0000644\0', 100, 8, 'ascii');
  header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii');
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  header.write(`${Math.floor(Date.UTC(2026, 8, 27) / 1000).toString(8)}\0`, 136, 12, 'ascii');
  // the checksum counts its own field as spaces
  header.write('        ', 148, 8, 'ascii');
  header.write(type, 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  const sum = header.reduce((total, byte) => total + byte, 0);
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return header;
};

export const tarOf = (files: PackedFileT[], folders: string[] = []): Buffer =>
  Buffer.concat([
    ...folders.map((folder) => tarHeader(folder, 0, '5')),
    ...files.flatMap(({ name, content }) => [
      tarHeader(name, content.length, '0'),
      content,
      Buffer.alloc((TAR_BLOCK - (content.length % TAR_BLOCK)) % TAR_BLOCK),
    ]),
    Buffer.alloc(TAR_BLOCK * 2),
  ]);

export const writeTarGz = async (
  file: string,
  files: PackedFileT[],
  folders: string[] = [],
): Promise<string> => {
  await writeFile(file, gzipSync(tarOf(files, folders)));
  return file;
};
