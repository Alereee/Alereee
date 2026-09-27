import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { AvailableTranslationLanguagesE, EnAreaVariantsE, EnPartOfSpeechE } from '../../../types';
import { convert, versionOfToday } from '../convert';
import { emptyEntry } from '../normalize';
import { ConvertedEntryT, ConvertedMeaningT, SourceAdapterT } from '../types';
import { DatasetWriter } from '../writer';

// The dataset an adapter's entries become (issue #527): the files of the
// project's format and the manifest with the terms of the source

const PROVENANCE = {
  source: 'fixture',
  license: 'CC0-1.0',
  license_url: 'https://creativecommons.org/publicdomain/zero/1.0/',
  attribution: 'A fixture',
  attribution_url: '',
  notice: '',
};

const meaning = (definition: string, extra: Partial<ConvertedMeaningT> = {}): ConvertedMeaningT => ({
  definition,
  examples: [],
  is_obsolete: false,
  area_variant: EnAreaVariantsE.common,
  language_register: '',
  categories: [],
  synonyms: [],
  antonyms: [],
  translations: [],
  ...extra,
});

const entry = (
  word: string,
  partOfSpeech: EnPartOfSpeechE,
  extra: Partial<ConvertedEntryT> = {},
): ConvertedEntryT => ({
  ...emptyEntry(word, partOfSpeech),
  meanings: [meaning(`The meaning of ${word}.`)],
  ...extra,
});

describe('DatasetWriter', () => {
  let outDir: string;
  const lines = async (file: string): Promise<Array<Record<string, unknown>>> =>
    (await readFile(path.join(outDir, file), 'utf-8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);

  beforeEach(async () => {
    outDir = await mkdtemp(path.join(os.tmpdir(), 'vocab-bloom-writer-'));
  });

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it('merges the records of a headword that follow each other and leaves a late one out', async () => {
    const writer = new DatasetWriter({ outDir, version: '1', provenance: PROVENANCE });
    await writer.add(entry('lamp', EnPartOfSpeechE.noun));
    await writer.add(entry('lamp', EnPartOfSpeechE.verb));
    await writer.add(entry('lamp', EnPartOfSpeechE.noun, { meanings: [meaning('A heavy blow.')] }));
    await writer.add(entry('mouse', EnPartOfSpeechE.noun));
    // the headword changed in between: its entry is written, this record has nothing to merge into
    await writer.add(entry('lamp', EnPartOfSpeechE.noun, { meanings: [meaning('A third meaning.')] }));
    // an entry without a meaning or with a headword the column cannot take is not an entry
    await writer.add(entry('empty', EnPartOfSpeechE.noun, { meanings: [] }));
    await writer.add(entry('a'.repeat(129), EnPartOfSpeechE.noun));

    const summary = await writer.close();

    expect(summary).toEqual(expect.objectContaining({ entries: 3, meanings: 4, late_duplicates: 1 }));
    expect(
      (await lines('vocab-bloom-hub-en-words.jsonl')).map((line) => [line.word, line.part_of_speech]),
    ).toEqual([
      ['lamp', 'noun'],
      ['lamp', 'verb'],
      ['mouse', 'noun'],
    ]);
    expect(
      (await lines('vocab-bloom-hub-en-meanings.jsonl'))
        .filter((line) => line.word === 'lamp' && line.part_of_speech === 'noun')
        .map((line) => [line.sort_order, line.definition]),
    ).toEqual([
      [1, 'The meaning of lamp.'],
      [2, 'A heavy blow.'],
    ]);
  });

  it('writes a phrase into the phrases file and the variants of a base verb into the link map', async () => {
    const writer = new DatasetWriter({ outDir, version: '1', provenance: PROVENANCE });
    await writer.add(entry('give', EnPartOfSpeechE.verb));
    await writer.add(entry('give up', EnPartOfSpeechE.verb, { verb___is_phrasal: true, base_phrasal: 'give' }));
    await writer.add(entry('give in', EnPartOfSpeechE.verb, { verb___is_phrasal: true, base_phrasal: 'give' }));
    // the source has no entry for "hold": its variant is a phrasal verb without a link
    await writer.add(entry('hold on', EnPartOfSpeechE.verb, { verb___is_phrasal: true, base_phrasal: 'hold' }));
    await writer.add(entry('better late than never', EnPartOfSpeechE.phrase));

    await writer.close();

    expect(await lines('vocab-bloom-hub-en-phrasal-verbs.jsonl')).toEqual([
      { word: 'give', part_of_speech: 'verb', phrasal_variants: ['give in', 'give up'] },
    ]);
    expect(await lines('vocab-bloom-hub-en-phrases.jsonl')).toEqual([
      expect.objectContaining({ phrase: 'better late than never', generated: false, level: '' }),
    ]);
  });

  it('files the translations by language and counts them, the links and the lines into the manifest', async () => {
    const writer = new DatasetWriter({ outDir, version: '2026.09', provenance: PROVENANCE });
    await writer.add(
      entry('lamp', EnPartOfSpeechE.noun, {
        meanings: [
          meaning('A device that gives light.', {
            synonyms: ['light', 'lantern'],
            antonyms: ['shade'],
            translations: [
              { language: AvailableTranslationLanguagesE.ru, words: ['лампа', 'светильник'] },
              { language: AvailableTranslationLanguagesE.de, words: ['Lampe'] },
              { language: AvailableTranslationLanguagesE.es, words: [] },
            ],
          }),
          meaning('A heavy blow.', {
            translations: [{ language: AvailableTranslationLanguagesE.ru, words: ['удар'] }],
          }),
        ],
      }),
    );

    const { manifest } = await writer.close();

    expect(await lines('vocab-bloom-hub-en-meaning-translations.ru.jsonl')).toEqual([
      expect.objectContaining({
        word: 'lamp',
        part_of_speech: 'noun',
        meaning_sort_order: 1,
        meaning_title: 'A device that gives light',
        title: 'лампа',
        definition: '',
        variants_of_words: ['лампа', 'светильник'],
      }),
      expect.objectContaining({ meaning_sort_order: 2, title: 'удар' }),
    ]);
    // the translation of the entry: the main words of its meanings, in their order
    expect(await lines('vocab-bloom-hub-en-short-translations.ru.jsonl')).toEqual([
      {
        word: 'lamp',
        part_of_speech: 'noun',
        language: 'ru',
        description: 'лампа, удар',
        variants_of_words: ['лампа', 'удар'],
      },
    ]);
    expect(manifest).toEqual({
      version: '2026.09',
      generatedAt: expect.any(String),
      ...PROVENANCE,
      synonym_links: 2,
      antonym_links: 1,
      translations: {
        de: { meaning_translations: 1, short_translations: 1 },
        ru: { meaning_translations: 2, short_translations: 1 },
      },
      files: {
        'vocab-bloom-hub-en-meaning-translations.de.jsonl': { lines: 1 },
        'vocab-bloom-hub-en-meaning-translations.ru.jsonl': { lines: 2 },
        'vocab-bloom-hub-en-meanings.jsonl': { lines: 2 },
        'vocab-bloom-hub-en-short-translations.de.jsonl': { lines: 1 },
        'vocab-bloom-hub-en-short-translations.ru.jsonl': { lines: 1 },
        'vocab-bloom-hub-en-words.jsonl': { lines: 1 },
      },
    });
    expect(JSON.parse(await readFile(path.join(outDir, 'manifest.json'), 'utf-8'))).toEqual(manifest);
  });

  it('writes a manifest for a source that had nothing to say', async () => {
    const { manifest, entries } = await new DatasetWriter({
      outDir,
      version: '1',
      provenance: PROVENANCE,
    }).close();

    expect(entries).toBe(0);
    expect(manifest.files).toEqual({});
  });
});

describe('convert', () => {
  let outDir: string;

  beforeEach(async () => {
    outDir = await mkdtemp(path.join(os.tmpdir(), 'vocab-bloom-convert-'));
  });

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it('runs an adapter into a dataset, counts what it left out and hands its options on', async () => {
    const seen: Array<Record<string, string>> = [];
    const source: SourceAdapterT = {
      name: 'fixture',
      description: 'a fixture',
      provenance: (options) => ({
        ...PROVENANCE,
        attribution: `A fixture${options.extra ? ` with ${options.extra}` : ''}`,
      }),
      convert: async (_input, options, context) => {
        seen.push(options);
        await context.emit(entry('lamp', EnPartOfSpeechE.noun));
        context.skip('no_definition');
        context.skip('no_definition');
        context.skip('other_language');
        expect(context.limit).toBe(10);
      },
    };

    const summary = await convert({
      source,
      input: 'anywhere',
      outDir,
      limit: 10,
      sourceOptions: { extra: 'more' },
    });

    expect(seen).toEqual([{ extra: 'more' }]);
    expect(summary.entries).toBe(1);
    expect(summary.skipped).toEqual({ no_definition: 2, other_language: 1 });
    expect(summary.manifest.attribution).toBe('A fixture with more');
    expect(summary.manifest.version).toBe(versionOfToday());
  });

  it('versions a dataset by the day of its conversion when none is given', () => {
    expect(versionOfToday(new Date('2026-09-27T10:00:00Z'))).toBe('2026.09.27');
  });
});
