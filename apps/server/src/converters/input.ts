import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import { createGunzip } from 'node:zlib';
import { packingOf } from './unpack';

/** How far into a file the reader is, in the bytes of the file as it lies on the disk */
export type ReadProgressT = (read: number, total: number) => void;

/**
 * The lines of a text file, one at a time, however large it is; a gzipped
 * file is read through gunzip — told by its first bytes, an uploaded file
 * has no extension. The chunks of the stream are split by hand: the async
 * iterator of `readline` fails with "readline was closed" when its consumer
 * is slower than the file (every line here is awaited into the writer), a
 * stream iterated by chunks waits for its consumer
 */
export async function* readLines(file: string, onProgress?: ReadProgressT): AsyncGenerator<string> {
  const gzipped = (await packingOf(file)) === 'gzip';
  const total = onProgress ? (await stat(file)).size : 0;
  const raw = createReadStream(file);
  let read = 0;
  if (onProgress) {
    raw.on('data', (chunk) => {
      read += chunk.length;
      onProgress(read, total);
    });
  }
  const input = gzipped ? raw.pipe(createGunzip()) : raw;
  const decoder = new StringDecoder('utf8');
  let rest = '';
  try {
    for await (const chunk of input) {
      const text = rest + decoder.write(chunk as Buffer);
      const lines = text.split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) yield line.endsWith('\r') ? line.slice(0, -1) : line;
    }
    rest += decoder.end();
    if (rest) yield rest.endsWith('\r') ? rest.slice(0, -1) : rest;
  } finally {
    raw.destroy();
  }
}
