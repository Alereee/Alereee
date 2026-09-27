import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { gzipSync } from 'node:zlib';
import { readLines } from '../input';
import { firstLineOf, NotASourceError, packingOf, unpackFiles, WORDNET_FILES } from '../unpack';
import { filesOf, writeTarGz, writeZip } from './pack';

// What a source distributes arrives packed, and an uploaded file has no
// name to tell its format by (issue #527)

const FIXTURES = path.join(__dirname, 'fixtures');

describe('packed sources', () => {
  let dir: string;
  const at = (name: string): string => path.join(dir, name);

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'vocab-bloom-unpack-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('tells a zip, a gzip and a plain file by their first bytes', async () => {
    await writeZip(at('upload-1'), [{ name: 'a.txt', content: Buffer.from('a') }]);
    await writeFile(at('upload-2'), gzipSync('a'));
    await writeFile(at('upload-3'), '{"word":"lamp"}\n');
    await writeFile(at('upload-4'), '');

    expect(await packingOf(at('upload-1'))).toBe('zip');
    expect(await packingOf(at('upload-2'))).toBe('gzip');
    expect(await packingOf(at('upload-3'))).toBe('plain');
    expect(await packingOf(at('upload-4'))).toBe('plain');
  });

  it('reads the lines of a gzipped file whatever it is called, and says how far it is', async () => {
    const text = 'first\r\nsecond\nthird';
    await writeFile(at('upload'), gzipSync(text));
    const seen: Array<[number, number]> = [];
    const lines: string[] = [];

    for await (const line of readLines(at('upload'), (read, total) => seen.push([read, total]))) {
      lines.push(line);
    }

    expect(lines).toEqual(['first', 'second', 'third']);
    const size = gzipSync(text).length;
    expect(seen.at(-1)).toEqual([size, size]);
    expect(await firstLineOf(at('upload'))).toBe('first\r');
  });

  it('takes the database files out of a zip, from the folder the release keeps them in', async () => {
    const zip = await writeZip(at('release'), [
      ...(await filesOf(path.join(FIXTURES, 'wordnet'), 'oewn2025/')),
      { name: 'oewn2025/index.sense', content: Buffer.from('not read') },
      { name: '__MACOSX/oewn2025/._data.noun', content: Buffer.from('junk') },
    ]);

    const found = await unpackFiles(zip, at('out'), WORDNET_FILES);

    expect(found.sort()).toEqual([...WORDNET_FILES].sort());
    expect((await readdir(at('out'))).sort()).toEqual([...WORDNET_FILES].sort());
    expect(await readFile(at('out/data.noun'))).toEqual(
      await readFile(path.join(FIXTURES, 'wordnet', 'data.noun')),
    );
  });

  it('takes them out of a tar.gz, past the folders and the files of the same beginning', async () => {
    const tar = await writeTarGz(
      at('release'),
      [
        { name: 'dict/sents.vrb', content: Buffer.from('x'.repeat(700)) },
        ...(await filesOf(path.join(FIXTURES, 'wordnet'), 'dict/')),
        { name: 'dict/cousin.exc', content: Buffer.alloc(0) },
        { name: 'dict/dbfiles/noun.person', content: Buffer.from('y'.repeat(1024)) },
      ],
      ['dict/', 'dict/dbfiles/'],
    );

    const found = await unpackFiles(tar, at('out'), WORDNET_FILES);

    expect(found.sort()).toEqual([...WORDNET_FILES].sort());
    expect((await readdir(at('out'))).sort()).toEqual([...WORDNET_FILES].sort());
    for (const name of WORDNET_FILES) {
      expect(await readFile(at(`out/${name}`))).toEqual(await readFile(path.join(FIXTURES, 'wordnet', name)));
    }
  });

  it('writes under the names it was asked for, never under what an archive says', async () => {
    const tar = await writeTarGz(at('release'), [
      { name: '../../escape/data.noun', content: Buffer.from('x') },
      { name: '/etc/index.noun', content: Buffer.from('y') },
    ]);

    expect(await unpackFiles(tar, at('out'), WORDNET_FILES)).toEqual(['data.noun', 'index.noun']);
    expect((await readdir(at('out'))).sort()).toEqual(['data.noun', 'index.noun']);
    expect((await readdir(dir)).sort()).toEqual(['out', 'release']);
  });

  it('answers nothing found for an archive of something else, and refuses what is no archive', async () => {
    const zip = await writeZip(at('other'), [{ name: 'readme.txt', content: Buffer.from('hello') }]);
    expect(await unpackFiles(zip, at('out'), WORDNET_FILES)).toEqual([]);

    await writeFile(at('plain'), 'lamp L AE1 M P\n');
    await expect(unpackFiles(at('plain'), at('out'), WORDNET_FILES)).rejects.toThrow(NotASourceError);

    // a gzip that is not a tar: the extract of Wiktionary attached to WordNet
    await writeFile(at('gz'), gzipSync('{"word":"lamp","pos":"noun"}\n'.repeat(100)));
    expect(await unpackFiles(at('gz'), at('out2'), WORDNET_FILES).catch(() => [])).toEqual([]);
  });
});
