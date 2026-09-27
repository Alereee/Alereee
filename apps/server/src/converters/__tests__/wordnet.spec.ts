import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseManifest } from '../../modules/EnModule/modules/EnImportDictionary/utils/parseManifest';
import { DATASET_KNOWN_FILE_NAMES } from '../../modules/EnModule/modules/EnImportDictionary/constants';
import { convert } from '../convert';
import { findSource } from '../sources';
import { parseSynset } from '../sources/wordnet';
import { filesOf, writeTarGz, writeZip } from './pack';

const FIXTURES = path.join(__dirname, 'fixtures');

type LineT = Record<string, unknown>;

const readJsonl = async (dir: string, file: string): Promise<LineT[]> =>
  (await readFile(path.join(dir, file), 'utf-8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as LineT);

// what the import reads: a manifest it accepts, the files it knows, the line counts the manifest names
const expectImportable = async (dir: string): Promise<void> => {
  const files = await readdir(dir);
  for (const file of files) expect(DATASET_KNOWN_FILE_NAMES).toContain(file);
  const manifest = parseManifest(JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf-8')));
  expect(manifest).not.toBeNull();
  expect(Object.keys(manifest!.files).sort()).toEqual(files.filter((file) => file !== 'manifest.json').sort());
  for (const [file, { lines }] of Object.entries(manifest!.files)) {
    expect((await readJsonl(dir, file)).length).toBe(lines);
  }
};

// WordNet in its database format (issue #527). The fixture is written for the test in the
// format of wndb(5): no text of WordNet is copied into the repository.

describe('wordnet: the terms of the data', () => {
  it('follow the edition and are the ones of the catalog', () => {
    const wordnet = findSource('wordnet');
    expect(wordnet?.provenance({})).toEqual(
      expect.objectContaining({ source: 'wordnet', license: 'CC-BY-4.0' }),
    );
    expect(wordnet?.provenance({ edition: 'princeton' })).toEqual(
      expect.objectContaining({ source: 'princeton-wordnet', license: 'WordNet' }),
    );
    // the pronunciations are named whether or not a run had the file: the terms do not depend on a run
    expect(wordnet?.provenance({}).attribution).toContain('CMU Pronouncing Dictionary');
    expect(wordnet?.provenance({ cmudict: 'cmudict.dict' })).toEqual(wordnet?.provenance({}));
  });
});

describe('wordnet: one line of a data file', () => {
  it('reads the words, the pointers and the gloss', () => {
    const parsed = parseSynset(
      '00005000 30 v 02 run 0 give_up 0 002 ! 00005100 v 0101 ;u 00009100 n 0000 01 + 02 00 | move fast; "he ran"; "run!"  ',
      'verb',
    );

    expect(parsed?.key).toBe('verb 00005000');
    expect(parsed?.synset).toEqual({
      words: ['run', 'give up'],
      definition: 'move fast',
      examples: ['he ran', 'run!'],
      pointers: [
        { symbol: '!', target: 'verb 00005100', source: 1, targetWord: 1 },
        { symbol: ';u', target: 'noun 00009100', source: 0, targetWord: 0 },
      ],
    });
  });

  it('skips the license text and a line without a definition', () => {
    expect(parseSynset('  1 This software and database is being provided to you', 'noun')).toBeNull();
    expect(parseSynset('00001000 03 n 01 lamp 0 000 |   ', 'noun')).toBeNull();
    expect(parseSynset('', 'noun')).toBeNull();
    expect(parseSynset('00001000 03 n zz lamp', 'noun')).toBeNull();
  });
});

describe('wordnet: the dataset', () => {
  let outDir: string;

  beforeEach(async () => {
    outDir = await mkdtemp(path.join(os.tmpdir(), 'vocab-bloom-convert-'));
  });

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it('wordnet: a synset is a meaning, its words are synonyms, the pointers name the rest', async () => {
    const source = findSource('wordnet')!;
    const summary = await convert({
      source,
      input: path.join(FIXTURES, 'wordnet'),
      outDir,
      version: '2025',
      sourceOptions: { cmudict: path.join(FIXTURES, 'cmudict.dict') },
    });

    // "ghost" is in the index and in no data file
    expect(summary.skipped).toEqual({ no_definition: 1 });
    const words = await readJsonl(outDir, 'vocab-bloom-hub-en-words.jsonl');
    const byKey = (word: string, partOfSpeech: string): LineT =>
      words.find((line) => line.word === word && line.part_of_speech === partOfSpeech) as LineT;

    expect(byKey('lamp', 'noun')).toEqual(
      expect.objectContaining({ transcription: '/læmp/', categories: ['technical'], generated: false }),
    );
    expect(byKey('mouse', 'noun')).toEqual(
      expect.objectContaining({
        noun___irregular_plural: true,
        forms: [expect.objectContaining({ word: 'mice', form_of_word: 'plural_form' })],
      }),
    );
    // the index folds the case, the synset knows the spelling
    expect(byKey('Paris', 'noun')).toEqual(expect.objectContaining({ noun___is_proper: true }));
    expect(byKey('City of Light', 'noun')).toEqual(expect.objectContaining({ transcription: '' }));
    // irregular, and the forms are not guessed from a list that does not name them
    expect(byKey('run', 'verb')).toEqual(
      expect.objectContaining({ verb___is_irregular: true, forms: [], transcription: '/ɹʌn/' }),
    );
    expect(byKey('give up', 'verb')).toEqual(
      expect.objectContaining({ verb___is_phrasal: true, base_phrasal: 'give' }),
    );
    expect((byKey('good', 'adjective').forms as LineT[]).map((form) => [form.word, form.form_of_word])).toEqual(
      [
        ['better', 'comparative_form'],
        ['best', 'superlative_form'],
      ],
    );
    // "worse" does not say by its ending which degree it is
    expect(byKey('bad', 'adjective').forms).toEqual([]);

    const meanings = await readJsonl(outDir, 'vocab-bloom-hub-en-meanings.jsonl');
    const run = meanings.find((line) => line.word === 'run') as LineT;
    expect(run).toEqual(
      expect.objectContaining({
        definition: 'move fast on foot',
        examples: ['he ran to the door'],
        synonyms: [{ word: 'sprint', part_of_speech: 'verb' }],
        // the pointer is between two words, not two synsets
        antonyms: [{ word: 'walk', part_of_speech: 'verb' }],
        language_register: 'slang',
      }),
    );
    // "sprint" shares the synset and not the antonym, which is the pointer of "run"
    expect(meanings.find((line) => line.word === 'sprint')).toEqual(
      expect.objectContaining({ synonyms: [{ word: 'run', part_of_speech: 'verb' }], antonyms: [] }),
    );
    // the syntactic marker of an adjective is not a part of its spelling
    expect(meanings.find((line) => line.word === 'good')?.synonyms).toEqual([
      { word: 'well', part_of_speech: 'adjective' },
    ]);

    expect(await readJsonl(outDir, 'vocab-bloom-hub-en-phrasal-verbs.jsonl')).toEqual([
      { word: 'give', part_of_speech: 'verb', phrasal_variants: ['give up'] },
    ]);
    expect(summary.manifest).toEqual(
      expect.objectContaining({ source: 'wordnet', license: 'CC-BY-4.0', translations: {}, antonym_links: 4 }),
    );
    expect(summary.manifest.attribution).toContain('CMU Pronouncing Dictionary');
  });

  it('writes what the import reads', async () => {
    await convert({ source: findSource('wordnet')!, input: path.join(FIXTURES, 'wordnet'), outDir });
    await expectImportable(outDir);
  });

  it('reads a release as it is downloaded: the zip of Open English WordNet, the tar.gz of Princeton', async () => {
    const source = findSource('wordnet')!;
    const files = await filesOf(path.join(FIXTURES, 'wordnet'), 'dict/');
    const zip = await writeZip(path.join(outDir, 'release.zip'), files);
    const tar = await writeTarGz(path.join(outDir, 'release.tar.gz'), files, ['dict/']);

    const unpacked = await convert({
      source,
      input: path.join(FIXTURES, 'wordnet'),
      outDir: path.join(outDir, 'a'),
      version: '1',
    });
    const zipped = await convert({ source, input: zip, outDir: path.join(outDir, 'b'), version: '1' });
    const tarred = await convert({
      source,
      input: tar,
      outDir: path.join(outDir, 'c'),
      version: '1',
      sourceOptions: { edition: 'princeton' },
    });

    expect(zipped.entries).toBe(unpacked.entries);
    expect(tarred.entries).toBe(unpacked.entries);
    expect(await readJsonl(path.join(outDir, 'b'), 'vocab-bloom-hub-en-meanings.jsonl')).toEqual(
      await readJsonl(path.join(outDir, 'a'), 'vocab-bloom-hub-en-meanings.jsonl'),
    );
    expect(tarred.manifest).toEqual(
      expect.objectContaining({ source: 'princeton-wordnet', license: 'WordNet' }),
    );
    // what was unpacked to be read is gone
    expect((await readdir(os.tmpdir())).filter((name) => name.startsWith('vocab-bloom-wordnet-'))).toEqual([]);
  });

  it('refuses an input that is not a release', async () => {
    const source = findSource('wordnet')!;
    await expect(convert({ source, input: path.join(FIXTURES, 'kaikki.jsonl'), outDir })).rejects.toThrow(
      'neither a zip nor a tar.gz',
    );
    await expect(convert({ source, input: FIXTURES, outDir })).rejects.toThrow('has no data.noun');
    await expect(convert({ source, input: path.join(FIXTURES, 'nope'), outDir })).rejects.toThrow(
      'does not exist',
    );
    const other = await writeZip(path.join(outDir, 'other.zip'), [
      { name: 'readme.txt', content: Buffer.from('hello') },
    ]);
    await expect(convert({ source, input: other, outDir })).rejects.toThrow('not a release');
  });
});
