import '../../../__tests__/helpers/clearDatabaseUrl';
import { WordRowsService } from '../../../word-rows.service';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { DataSource } from 'typeorm';
import { readdirSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { type Response } from 'express';

// The export flow unlinks the intermediate jsonl files right after zipping them.
// Keep them on disk so the test can compare the NDJSON content of two exports.
jest.mock('node:fs/promises', () => {
  const actual = jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises');
  return { ...actual, unlink: jest.fn(async () => undefined) };
});

import { DICTIONARY_ENTITIES } from '../../../entities/dictionary-entities';
import { EnWord } from '../../../entities/en_word.entity';
import { EnMeaning } from '../../../entities/en_meaning.entity';
import { EnMeaningTranslation } from '../../../entities/en_meaning_translation.entity';
import { EnShortTranslation } from '../../../entities/en_short_translation.entity';
import { EnService } from '../../../en.service';
import { EnShortTranslationService } from '../../EnShortTranslation/enShortTranslation.service';
import { EnMeaningService } from '../../EnMeaning/enMeaning.service';
import { EnMeaningTranslationService } from '../../EnMeaningTranslation/enMeaningTranslation.service';
import { EnImportDictionaryService } from '../enImportDictionary.service';
import { SettingsService } from '../../../../SettingsModule/settings.service';
import { DATASET_FILE_NAMES, translationFileName } from '../constants';
import {
  AvailableTranslationLanguagesE,
  CategoryE,
  EnAreaVariantsE,
  EnMeaningT,
  EnPartOfSpeechE,
  EnShortTranslationT,
  EnWordFormsE,
  EnWordT,
} from '../../../../../../types';

class FakeProgressRes {
  chunks: string[] = [];
  setHeader = jest.fn();
  write = (chunk: string) => {
    this.chunks.push(chunk);
    return true;
  };
  end = jest.fn();
}

type ExportRun = {
  ds: DataSource;
  service: EnImportDictionaryService;
  runDir: string;
  zipPath: string;
};

const meaning = (title: string, sort_order: number, translations: string[]): EnMeaningT =>
  ({
    title,
    definition: `definition of ${title}`,
    sort_order,
    examples: [`${title} example 2`, `${title} example 1`],
    translations: translations.map((t) => ({
      title: t,
      definition: `перевод ${t}`,
      language: AvailableTranslationLanguagesE.ru,
    })),
  }) as unknown as EnMeaningT;

const shortTranslation = (description: string): EnShortTranslationT =>
  ({
    language: AvailableTranslationLanguagesE.ru,
    description,
    // authored order, must be preserved as-is
    variants_of_words: ['я', 'а'],
  }) as unknown as EnShortTranslationT;

const word = (
  text: string,
  extra: Partial<EnWordT> & { meanings?: EnMeaningT[]; short_translations?: EnShortTranslationT[] } = {},
): EnWordT =>
  ({
    word: text,
    part_of_speech: EnPartOfSpeechE.verb,
    form_of_word: EnWordFormsE.base_form,
    categories: [CategoryE.sport, CategoryE.business],
    forms: [
      { word: `${text}s`, form_of_word: EnWordFormsE.third_person_singular },
      { word: `${text}ed`, form_of_word: EnWordFormsE.past_simple },
      { word: `${text}ing`, form_of_word: EnWordFormsE.present_participle },
    ] as EnWordT['forms'],
    meanings: [meaning('second', 2, ['второй', 'другой']), meaning('first', 1, ['первый'])],
    short_translations: [shortTranslation('второй'), shortTranslation('первый')],
    ...extra,
  }) as EnWordT;

// The same dictionary described twice: once "in order" and once with every
// collection reversed. Both must export identically.
const reverse = <T>(items: T[]): T[] => [...items].reverse();
const reverseWord = (w: EnWordT): EnWordT => ({
  ...w,
  categories: reverse(w.categories || []),
  forms: reverse(w.forms || []),
  short_translations: reverse(w.short_translations || []),
  meanings: reverse(w.meanings || []).map((m) => ({ ...m, translations: reverse(m.translations || []) })),
});

const DICTIONARY: EnWordT[] = [
  word('run'),
  word('run', { part_of_speech: EnPartOfSpeechE.noun, forms: [] }),
  word('give', { forms: [] }),
  word('give up', { forms: [], verb___is_phrasal: true, base_phrasal: 'give' } as unknown as Partial<EnWordT>),
  word('give in', { forms: [], verb___is_phrasal: true, base_phrasal: 'give' } as unknown as Partial<EnWordT>),
  word('in the long run', { part_of_speech: EnPartOfSpeechE.phrase, forms: [] }),
  word('would rather + verb', {
    part_of_speech: EnPartOfSpeechE.grammar_pattern,
    pattern: ['would rather', 'verb'],
    forms: [],
  }),
  word('colour', { area_variant: EnAreaVariantsE.british, part_of_speech: EnPartOfSpeechE.noun, forms: [] }),
];

const runExport = async (words: EnWordT[]): Promise<ExportRun> => {
  const ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: DICTIONARY_ENTITIES,
    synchronize: true,
  });
  await ds.initialize();

  const shortTranslationService = new EnShortTranslationService(
    ds.getRepository(EnWord),
    ds.getRepository(EnShortTranslation),
  );
  const meaningTranslationService = new EnMeaningTranslationService(
    ds.getRepository(EnMeaning),
    ds.getRepository(EnMeaningTranslation),
  );
  const meaningService = new EnMeaningService(
    ds.getRepository(EnWord),
    ds.getRepository(EnMeaning),
    meaningTranslationService,
  );
  const enService = new EnService(
    ds.getRepository(EnWord),
    ds,
    shortTranslationService,
    meaningService,
    new WordRowsService(ds),
  );
  for (const w of words) await enService.addWord(w);

  const settingsService = { upsert: jest.fn() } as unknown as SettingsService;
  const service = new EnImportDictionaryService(
    ds.getRepository(EnWord),
    new WordRowsService(ds),
    settingsService,
  );

  const progressRes = new FakeProgressRes();
  await service.exportDictionary(progressRes as unknown as Response);
  const finalChunk = JSON.parse(progressRes.chunks[progressRes.chunks.length - 1]) as { exportId: string };

  return {
    ds,
    service,
    runDir: path.join(os.tmpdir(), 'vocab-bloom-export', finalChunk.exportId),
    zipPath: path.join(os.tmpdir(), 'vocab-bloom-export', `${finalChunk.exportId}.zip`),
  };
};

describe('EnImportDictionaryService export ordering (issue #247)', () => {
  let ordered: ExportRun;
  let shuffled: ExportRun;

  beforeAll(async () => {
    // base verbs must exist before their phrasal variants, so the reversed
    // dictionary keeps "give" ahead of "give up"/"give in" but flips everything else
    const reversedDictionary = reverse(DICTIONARY).map(reverseWord);
    const giveIndex = reversedDictionary.findIndex((w) => w.word === 'give');
    const [give] = reversedDictionary.splice(giveIndex, 1);
    reversedDictionary.unshift(give);

    ordered = await runExport(DICTIONARY);
    shuffled = await runExport(reversedDictionary);
  });

  afterAll(async () => {
    for (const run of [ordered, shuffled]) {
      const pending = (run.service as unknown as { pendingExports: Map<string, { timeout: NodeJS.Timeout }> })
        .pendingExports;
      for (const entry of pending.values()) clearTimeout(entry.timeout);
      await rm(run.runDir, { recursive: true, force: true });
      await rm(run.zipPath, { force: true });
      await run.ds.destroy();
    }
  });

  const readFile = (run: ExportRun, fileName: string): string =>
    readFileSync(path.join(run.runDir, fileName), 'utf-8');
  const readLines = (run: ExportRun, fileName: string): Record<string, unknown>[] =>
    readFile(run, fileName)
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Record<string, unknown>);

  it('produces byte-identical jsonl files regardless of the insertion order', () => {
    // the data, that is: the history of edits (issue #531) says when and in
    // which order the entries were made, and two dictionaries built in
    // another order have another history
    const isData = (name: string) => name.endsWith('.jsonl') && name !== DATASET_FILE_NAMES.changes;
    const written = readdirSync(ordered.runDir).filter(isData).sort();
    expect(readdirSync(shuffled.runDir).filter(isData).sort()).toEqual(written);
    expect(readdirSync(ordered.runDir)).toContain(DATASET_FILE_NAMES.changes);
    expect(written).toContain(translationFileName('meaningTranslations', AvailableTranslationLanguagesE.ru));
    for (const fileName of written) {
      expect(readFile(shuffled, fileName)).toBe(readFile(ordered, fileName));
    }
  });

  it('orders the lines by word, then part of speech (area variant tie-break is unit-tested)', () => {
    const words = readLines(ordered, DATASET_FILE_NAMES.words).map((l) => [
      l.word,
      l.part_of_speech,
      l.area_variant,
    ]);
    expect(words).toEqual([
      ['colour', EnPartOfSpeechE.noun, EnAreaVariantsE.british],
      ['give', EnPartOfSpeechE.verb, ''],
      ['give in', EnPartOfSpeechE.verb, ''],
      ['give up', EnPartOfSpeechE.verb, ''],
      ['run', EnPartOfSpeechE.noun, ''],
      ['run', EnPartOfSpeechE.verb, ''],
    ]);
  });

  it('sorts every nested collection by its natural keys and keeps authored arrays as-is', () => {
    const run = readLines(ordered, DATASET_FILE_NAMES.words).find(
      (l) => l.word === 'run' && l.part_of_speech === EnPartOfSpeechE.verb,
    ) as {
      categories: string[];
      forms: { form_of_word: string; word: string }[];
    };

    expect(run.categories).toEqual([CategoryE.business, CategoryE.sport]);
    expect(run.forms.map((f) => f.form_of_word)).toEqual([
      EnWordFormsE.past_simple,
      EnWordFormsE.present_participle,
      EnWordFormsE.third_person_singular,
    ]);
  });

  it('orders the collection files by the entry key, then by the natural keys of the rows (issue #442)', () => {
    const isRunVerb = (l: Record<string, unknown>) =>
      l.word === 'run' && l.part_of_speech === EnPartOfSpeechE.verb;

    // the lines of every collection file follow the entry order of the entry files
    const meaningWords = readLines(ordered, DATASET_FILE_NAMES.meanings).map((l) => [l.word, l.part_of_speech]);
    expect(meaningWords.slice(0, 4)).toEqual([
      ['colour', EnPartOfSpeechE.noun],
      ['colour', EnPartOfSpeechE.noun],
      ['give', EnPartOfSpeechE.verb],
      ['give', EnPartOfSpeechE.verb],
    ]);

    const meanings = readLines(ordered, DATASET_FILE_NAMES.meanings).filter(isRunVerb) as unknown as {
      title: string;
      sort_order: number;
      examples: string[];
    }[];
    expect(meanings.map((m) => m.title)).toEqual(['first', 'second']);
    // authored arrays are exported as stored
    expect(meanings[0].examples).toEqual(['first example 2', 'first example 1']);

    const translations = readLines(
      ordered,
      translationFileName('meaningTranslations', AvailableTranslationLanguagesE.ru),
    ).filter(isRunVerb) as unknown as { meaning_title: string; meaning_sort_order: number; title: string }[];
    expect(translations.map((t) => [t.meaning_sort_order, t.meaning_title, t.title])).toEqual([
      [1, 'first', 'первый'],
      [2, 'second', 'второй'],
      [2, 'second', 'другой'],
    ]);

    const shorts = readLines(
      ordered,
      translationFileName('shortTranslations', AvailableTranslationLanguagesE.ru),
    ).filter(isRunVerb) as unknown as {
      description: string;
      variants_of_words: string[];
    }[];
    expect(shorts.map((t) => t.description)).toEqual(['второй', 'первый']);
    expect(shorts[0].variants_of_words).toEqual(['я', 'а']);
  });

  it('sorts phrasal variants in the word line and in the phrasal-verbs linking file', () => {
    const give = readLines(ordered, DATASET_FILE_NAMES.words).find((l) => l.word === 'give') as {
      phrasal_variants: string[];
    };
    expect(give.phrasal_variants).toEqual(['give in', 'give up']);

    expect(readLines(ordered, DATASET_FILE_NAMES.phrasalVerbs)).toEqual([
      { word: 'give', phrasal_variants: ['give in', 'give up'] },
    ]);
  });
});
