import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { gzipSync } from 'node:zlib';
import { wiktionary } from '../sources/wiktionary';
import { wordnet } from '../sources/wordnet';
import { archiveEntries, gzipModifiedAt, NotASourceError } from '../unpack';
import {
  asVersion,
  editionOfOpenEnglishWordnet,
  releaseEntries,
  versionOfDay,
  versionOfExtract,
  versionOfPrincetonWordnet,
} from '../version';
import { filesOf, writeTarGz, writeZip } from './pack';

// The version of a dataset of a public source (issue #530): read from the
// file the source distributes, never asked of the source

const FIXTURES = path.join(__dirname, 'fixtures');

/** A gzip as a source packs it: with the instant it was made in its header */
const gzipMadeAt = (content: string, madeAt: Date | null): Buffer => {
  const packed = gzipSync(content);
  packed.writeUInt32LE(madeAt ? Math.floor(madeAt.getTime() / 1000) : 0, 4);
  return packed;
};

describe('the version a file of a source says', () => {
  let dir: string;
  const at = (name: string): string => path.join(dir, name);

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'vocab-bloom-version-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads the day an extract was made from the header of its gzip', async () => {
    const madeAt = new Date('2026-09-25T10:02:34Z');
    await writeFile(at('upload'), gzipMadeAt('{"word":"lamp","pos":"noun"}\n', madeAt));

    expect(await gzipModifiedAt(at('upload'))).toEqual(madeAt);
    expect(await versionOfExtract(at('upload'), new Date('2026-09-28T00:00:00Z'))).toBe('2026.09.25');
    // the adapter says the same, whatever the file is called
    expect(await wiktionary.versionOf(at('upload'), {})).toBe('2026.09.25');
  });

  it('does not take a date the source could not have written', async () => {
    const now = new Date('2026-09-28T00:00:00Z');
    // packed again by a tool that writes no date, as zlib does
    await writeFile(at('no-date'), gzipMadeAt('{}\n', null));
    // not packed at all
    await writeFile(at('plain'), '{"word":"lamp","pos":"noun"}\n');
    await writeFile(at('empty'), '');
    // a clock that was wrong where the file was packed
    await writeFile(at('future'), gzipMadeAt('{}\n', new Date('2031-01-01T00:00:00Z')));
    await writeFile(at('ancient'), gzipMadeAt('{}\n', new Date('1999-01-01T00:00:00Z')));
    // made late in the day of another time zone: the day of the instant, in UTC
    await writeFile(at('tomorrow'), gzipMadeAt('{}\n', new Date('2026-09-28T09:00:00Z')));

    expect(await gzipModifiedAt(at('no-date'))).toBeNull();
    for (const name of ['no-date', 'plain', 'empty', 'future', 'ancient']) {
      expect(await versionOfExtract(at(name), now)).toBeNull();
    }
    expect(await versionOfExtract(at('tomorrow'), now)).toBe('2026.09.28');
  });

  it('reads the edition of the Open English WordNet from the folder of its archive', async () => {
    const files = await filesOf(path.join(FIXTURES, 'wordnet'), 'oewn2025/');
    await writeZip(at('upload'), files);

    expect(await archiveEntries(at('upload'))).toEqual(files.map((file) => file.name));
    expect(await wordnet.versionOf(at('upload'), {})).toBe('2025');
    // a release packed without its folder does not say which one it is
    await writeZip(at('flat'), await filesOf(path.join(FIXTURES, 'wordnet')));
    expect(await wordnet.versionOf(at('flat'), {})).toBeNull();
  });

  it('reads the version of a Princeton WordNet from the name of its build log', async () => {
    const files = [
      ...(await filesOf(path.join(FIXTURES, 'wordnet'), 'dict/')),
      { name: 'dict/log.grind.3.1', content: Buffer.from('grind\n') },
    ];
    await writeTarGz(at('upload'), files, ['dict/']);

    expect(await archiveEntries(at('upload'))).toEqual(['dict/', ...files.map((file) => file.name)]);
    expect(await wordnet.versionOf(at('upload'), { edition: 'princeton' })).toBe('3.1');
    // the edition decides what is looked for: the same archive is no Open English WordNet
    expect(await wordnet.versionOf(at('upload'), {})).toBeNull();
  });

  it('reads an unpacked release by its folder', async () => {
    await mkdir(at('oewn2026'));
    await writeFile(at('oewn2026/data.noun'), '');
    await mkdir(at('dict'));
    await writeFile(at('dict/log.grind.3.0'), '');

    expect(await releaseEntries(at('oewn2026'))).toEqual(['oewn2026/data.noun']);
    expect(await wordnet.versionOf(at('oewn2026'), {})).toBe('2026');
    expect(await wordnet.versionOf(at('dict'), { edition: 'princeton' })).toBe('3.0');
  });

  it('finds no version in what is no release', async () => {
    await writeFile(at('plain'), 'not an archive');
    expect(await releaseEntries(at('plain'))).toEqual([]);
    expect(await wordnet.versionOf(at('plain'), {})).toBeNull();
    await expect(archiveEntries(at('plain'))).rejects.toThrow(NotASourceError);

    expect(editionOfOpenEnglishWordnet(['oewn/data.noun', 'oewn20255/x', 'myoewn2025/x'])).toBeNull();
    expect(editionOfOpenEnglishWordnet(['release/oewn2024/data.noun'])).toBe('2024');
    expect(versionOfPrincetonWordnet(['dict/log.grind', 'dict/log.grind.x', 'dict/data.noun'])).toBeNull();
  });

  it('writes a day as a version and takes for a version only what looks like one', () => {
    expect(versionOfDay(new Date('2026-01-05T23:59:59Z'))).toBe('2026.01.05');
    expect(asVersion('2025')).toBe('2025');
    expect(asVersion('3.1')).toBe('3.1');
    expect(asVersion('')).toBeNull();
    expect(asVersion(null)).toBeNull();
    expect(asVersion('the latest')).toBeNull();
    expect(asVersion('v'.repeat(65))).toBeNull();
  });
});
