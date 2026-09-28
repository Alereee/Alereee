import '../../../__tests__/helpers/clearDatabaseUrl';

import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { type Response as ExpressResponse } from 'express';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as yazl from 'yazl';

import { EnEntry } from '../../../entities/en_entry.entity';
import { EnChange } from '../../../entities/en_change.entity';
import { DICTIONARY_ENTITIES } from '../../../entities/dictionary-entities';
import { EnWord } from '../../../entities/en_word.entity';
import { EnMeaning } from '../../../entities/en_meaning.entity';
import { EnMeaningTranslation } from '../../../entities/en_meaning_translation.entity';
import { EnShortTranslation } from '../../../entities/en_short_translation.entity';
import { EnImportDictionaryService } from '../enImportDictionary.service';
import { WordRowsService } from '../../../word-rows.service';
import { SettingsService } from '../../../../SettingsModule/settings.service';
import { DATASET_VERSION_SETTINGS_FIELD, EnDictionaryImportPhasesE } from '../constants';
import { ErrorCodes } from '../../../../../../core/constants/error_codes';
import {
  AvailableTranslationLanguagesE,
  ChangeActionE,
  ChangeEntityE,
  ChangeOriginE,
  EnEntryTypesE,
  EnAreaVariantsE,
  EnPartOfSpeechE,
  EnWordFormsE,
  ImportSourceKindE,
} from '../../../../../../types';
import { mapWordFromSetToDB } from '../utils';
import { DataSetWordT } from '../../../../../../types/dictionaries/en/EnDataSetTypes';

type ProgressChunk = {
  percent: number;
  stage: EnDictionaryImportPhasesE;
  downloaded?: number;
  total?: number;
  datasetVersion?: string;
};

class FakeProgressRes {
  chunks: string[] = [];
  ended = false;
  setHeader = jest.fn();
  write = (chunk: string) => {
    this.chunks.push(chunk);
    return true;
  };
  end = () => {
    this.ended = true;
  };
}

// Minimal shape of a dataset word line consumed by mapWordFromSetToDB
const makeSetWord = (word: string, extra: Record<string, unknown> = {}) => ({
  word,
  part_of_speech: EnPartOfSpeechE.verb,
  area_variant: '',
  generated_by_model: '',
  generated: false,
  verb___phrasal_object_pattern: '',
  verb___transitivity: '',
  language_register: '',
  categories: [],
  verb___is_phrasal: false,
  verb___is_irregular: false,
  noun___is_proper: false,
  word_level: '',
  description: '',
  transcription: '',
  is_obsolete: false,
  version: '1.0.0',
  is_abbreviation: false,
  noun___uncountable: false,
  noun___irregular_plural: false,
  noun___always_plural: false,
  base_phrasal: '',
  phrasal_variants: [],
  forms: [],
  short_translations: [],
  meanings: [],
  ...extra,
});

const makeSetPhrase = (phrase: string, extra: Record<string, unknown> = {}) => ({
  phrase,
  area_variant: '',
  generated_by_model: '',
  generated: false,
  language_register: '',
  categories: [],
  level: '',
  description: '',
  transcription: '',
  is_obsolete: false,
  version: '1.0.0',
  short_translations: [],
  meanings: [],
  ...extra,
});

const toNdjson = (lines: unknown[]) => lines.map((l) => JSON.stringify(l)).join('\n') + '\n';

const mockDatasetFiles = (files: Record<string, string>) => {
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    const fileName = url.split('/').pop() as string;
    const body = files[fileName];
    if (body === undefined) {
      return new Response('not found', { status: 404 });
    }
    return new Response(body, {
      status: 200,
      headers: { 'content-length': String(Buffer.byteLength(body)) },
    });
  });
};

const mockUpsert = jest.fn<(field: string, value: string) => Promise<{ success: boolean }>>(async () => ({
  success: true,
}));
const mockSettingsService = { upsert: mockUpsert } as unknown as SettingsService;

describe('EnImportDictionaryService NDJSON import (issue #87)', () => {
  let ds: DataSource;
  let service: EnImportDictionaryService;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: DICTIONARY_ENTITIES,
      synchronize: true,
    });
    await ds.initialize();

    service = new EnImportDictionaryService(
      ds.getRepository(EnWord),
      new WordRowsService(ds),
      mockSettingsService,
    );
  });

  afterAll(async () => {
    await ds.destroy();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    mockUpsert.mockClear();
    (service as unknown as { manifestCache: unknown }).manifestCache = null;
    await ds.synchronize(true);
  });

  describe('full import flow', () => {
    const makeManifest = () =>
      JSON.stringify({
        version: '0.2.0',
        generatedAt: '2026-08-16T00:00:00Z',
        // 3 for "to hand over" + 1 for "eventually" (issue #259)
        synonym_links: 4,
        // 2 for "to hand over" (issue #266)
        antonym_links: 2,
        files: {
          'vocab-bloom-hub-en-words.jsonl': { lines: 3 },
          'vocab-bloom-hub-en-phrasal-verbs.jsonl': { lines: 2 },
          'vocab-bloom-hub-en-grammar-patterns.jsonl': { lines: 1 },
          'vocab-bloom-hub-en-phrases.jsonl': { lines: 1 },
        },
      });

    const runImport = async (withManifest = true): Promise<FakeProgressRes> => {
      mockDatasetFiles({
        ...(withManifest && { 'manifest.json': makeManifest() }),
        'vocab-bloom-hub-en-words.jsonl':
          toNdjson([
            makeSetWord('give', {
              meanings: [
                {
                  title: 'to hand over',
                  definition: 'to pass something to someone',
                  sort_order: 1,
                  is_obsolete: false,
                  examples: ['give me the book'],
                  // the headword, a phrase from the last dataset file and an
                  // unknown word: only the phrase becomes a link (issue #259)
                  synonyms: [
                    { word: 'Give', part_of_speech: EnPartOfSpeechE.verb },
                    { word: 'in the long run', part_of_speech: EnPartOfSpeechE.phrase },
                    { word: 'hand over', part_of_speech: EnPartOfSpeechE.verb },
                    // a spelling variant of the phrasal verb from the same file
                    { word: 'give-up', part_of_speech: EnPartOfSpeechE.verb },
                  ],
                  // an antonym is resolved the same way; a word already linked
                  // as a synonym is skipped rather than stored twice (issue #266)
                  antonyms: [
                    { word: 'would rather + verb', part_of_speech: EnPartOfSpeechE.grammar_pattern },
                    { word: 'in the long run', part_of_speech: EnPartOfSpeechE.phrase },
                  ],
                  area_variant: '',
                  language_register: '',
                  meaning_level: '',
                  categories: [],
                  translations: [
                    {
                      language: AvailableTranslationLanguagesE.ru,
                      title: 'давать',
                      definition: 'передавать',
                      variants_of_words: ['давать'],
                    },
                  ],
                },
              ],
              short_translations: [
                {
                  language: AvailableTranslationLanguagesE.ru,
                  description: 'давать',
                  variants_of_words: ['давать'],
                },
              ],
            }),
            // a duplicate line: the importer must swallow word_already_exists and continue
            makeSetWord('give'),
            makeSetWord('give up', { verb___is_phrasal: true }),
          ]) + '\n\n', // trailing blank lines must be skipped
        'vocab-bloom-hub-en-phrasal-verbs.jsonl': toNdjson([
          makeSetWord('give', { phrasal_variants: ['give up', 'vanish away'] }),
          // base verb missing in the dataset — the whole line is skipped
          makeSetWord('missing', { phrasal_variants: ['give up'] }),
        ]),
        'vocab-bloom-hub-en-grammar-patterns.jsonl': toNdjson([
          makeSetPhrase('would rather + verb', { pattern: ['would rather', 'verb'] }),
        ]),
        'vocab-bloom-hub-en-phrases.jsonl': toNdjson([
          makeSetPhrase('in the long run', {
            meanings: [
              {
                title: 'eventually',
                definition: 'over a long period of time',
                sort_order: 1,
                is_obsolete: false,
                examples: [],
                // the plain-string form of files exported before the part of speech was added
                synonyms: ['give up'],
                area_variant: '',
                language_register: '',
                meaning_level: '',
                categories: [],
                translations: [],
              },
              // a dataset line written before synonyms existed must still import
              {
                title: 'legacy meaning',
                definition: 'without a synonyms field',
                sort_order: 2,
                is_obsolete: false,
                examples: [],
                area_variant: '',
                language_register: '',
                meaning_level: '',
                categories: [],
                translations: [],
              },
            ],
          }),
        ]),
      });

      const res = new FakeProgressRes();
      await service.importDictionary({}, res as unknown as ExpressResponse);
      return res;
    };

    it('saves words, phrases and grammar patterns from the dataset files', async () => {
      await runImport();

      const words = await ds.getRepository(EnWord).find({ relations: { word: true } });
      expect(words).toHaveLength(4);
      const byWord = new Map(words.map((w) => [w.word.word, w]));
      expect(byWord.get('give')?.part_of_speech).toBe(EnPartOfSpeechE.verb);
      expect(byWord.get('give up')?.verb___is_phrasal).toBe(true);
      expect(byWord.get('in the long run')?.part_of_speech).toBe(EnPartOfSpeechE.phrase);
      expect(byWord.get('would rather + verb')?.part_of_speech).toBe(EnPartOfSpeechE.grammar_pattern);
      expect(byWord.get('would rather + verb')?.pattern).toEqual(['would rather', 'verb']);

      // entry types follow the dataset file the record came from
      const entries = await ds.getRepository(EnEntry).find();
      const entryTypes = new Map(entries.map((e) => [e.word, e.type]));
      expect(entryTypes.get('in the long run')).toBe(EnEntryTypesE.phrase);
      expect(entryTypes.get('would rather + verb')).toBe(EnEntryTypesE.grammar_pattern);

      // nested structures came through EnService.addWord
      expect(await ds.getRepository(EnMeaning).count()).toBe(3);
      expect(await ds.getRepository(EnMeaningTranslation).count()).toBe(1);
      expect(await ds.getRepository(EnShortTranslation).count()).toBe(1);
    });

    it('links phrasal variants to their base verb and skips unknown words', async () => {
      await runImport();

      const giveUp = await ds
        .getRepository(EnWord)
        .createQueryBuilder('w')
        .innerJoin('w.word', 'entry')
        .leftJoinAndSelect('w.base_phrasal', 'bp')
        .leftJoinAndSelect('bp.word', 'bpEntry')
        .where('entry.word = :word', { word: 'give up' })
        .getOneOrFail();

      expect(giveUp.base_phrasal?.word.word).toBe('give');
      // neither the missing base verb nor the unknown variant created rows
      expect(await ds.getRepository(EnWord).count()).toBe(4);
    });

    it('links meaning synonyms once every file is in and skips unknown words (issue #259)', async () => {
      const res = await runImport();

      const meanings = await ds.getRepository(EnMeaning).find({ relations: { synonyms: true } });
      const byTitle = new Map(meanings.map((m) => [m.title, m.synonyms.map((e) => e.word).sort()]));
      // "in the long run" is imported after "give", yet the link resolves; the
      // headword and the unknown word are dropped
      expect(byTitle.get('to hand over')).toEqual(['give up', 'in the long run']);
      expect(byTitle.get('eventually')).toEqual(['give up']);
      expect(byTitle.get('legacy meaning')).toEqual([]);
      // no stub entries were created for unknown synonyms
      expect(await ds.getRepository(EnEntry).findOneBy({ word: 'hand over' })).toBeNull();
      const stages = res.chunks.map((c) => (JSON.parse(c) as ProgressChunk).stage);
      expect(stages).toContain(EnDictionaryImportPhasesE.linking_synonyms);
      // the linking stage counts into the progress total: its chunks stay
      // within 100% and its batch report lands exactly where the antonym
      // stage (the last one, issue #266) starts
      const chunks = res.chunks.map((c) => JSON.parse(c) as ProgressChunk);
      const linking = chunks.filter((c) => c.stage === EnDictionaryImportPhasesE.linking_synonyms);
      expect(linking.length).toBeGreaterThanOrEqual(2);
      const lines = 3 + 2 + 1 + 1;
      expect(Math.max(...linking.map((c) => c.percent))).toBeCloseTo(((lines + 4) / (lines + 4 + 2)) * 100);
      expect(linking.every((c) => c.percent <= 100)).toBe(true);
      expect(chunks.find((c) => c.stage === EnDictionaryImportPhasesE.linking_antonyms)?.percent).toBeCloseTo(
        ((lines + 4) / (lines + 4 + 2)) * 100,
      );
    });

    it('links meaning antonyms after the synonyms and never stores a word as both (issue #266)', async () => {
      const res = await runImport();

      const meanings = await ds.getRepository(EnMeaning).find({ relations: { antonyms: true } });
      const byTitle = new Map(meanings.map((m) => [m.title, m.antonyms.map((e) => e.word).sort()]));
      expect(byTitle.get('to hand over')).toEqual(['would rather + verb']);
      // lines without an antonyms key (older datasets) import with none
      expect(byTitle.get('eventually')).toEqual([]);
      expect(byTitle.get('legacy meaning')).toEqual([]);

      const stages = res.chunks.map((c) => (JSON.parse(c) as ProgressChunk).stage);
      expect(stages.lastIndexOf(EnDictionaryImportPhasesE.linking_synonyms)).toBeLessThan(
        stages.indexOf(EnDictionaryImportPhasesE.linking_antonyms),
      );
      const linking = res.chunks
        .map((c) => JSON.parse(c) as ProgressChunk)
        .filter((c) => c.stage === EnDictionaryImportPhasesE.linking_antonyms);
      expect(Math.max(...linking.map((c) => c.percent))).toBe(100);
    });

    it('tolerates duplicate lines instead of aborting the import', async () => {
      await runImport();

      const giveRows = await ds
        .getRepository(EnWord)
        .createQueryBuilder('w')
        .innerJoin('w.word', 'entry')
        .where('entry.word = :word', { word: 'give' })
        .getCount();
      expect(giveRows).toBe(1);
    });

    it('streams NDJSON progress and finishes the response with a completed chunk', async () => {
      const res = await runImport();

      expect(res.ended).toBe(true);
      for (const chunk of res.chunks) {
        expect(chunk.endsWith('\n')).toBe(true);
        expect(() => JSON.parse(chunk)).not.toThrow();
      }

      const parsed = res.chunks.map((c) => JSON.parse(c) as ProgressChunk);
      const stages = new Set(parsed.map((c) => c.stage));
      expect(stages).toContain(EnDictionaryImportPhasesE.downloading_database);
      expect(stages).toContain(EnDictionaryImportPhasesE.completed);

      const finalChunk = parsed[parsed.length - 1];
      expect(finalChunk).toEqual({
        percent: 100,
        stage: EnDictionaryImportPhasesE.completed,
        datasetVersion: '0.2.0',
      });

      // download progress carries byte counters
      const downloadChunk = parsed.find((c) => c.downloaded !== undefined);
      expect(downloadChunk?.total).toBeGreaterThan(0);
    });

    it('reports the manifest dataset version and stores it after a successful import', async () => {
      const res = await runImport();

      const firstChunk = JSON.parse(res.chunks[0]) as ProgressChunk;
      expect(firstChunk.datasetVersion).toBe('0.2.0');

      expect(mockUpsert).toHaveBeenCalledWith(DATASET_VERSION_SETTINGS_FIELD, '0.2.0');
    });

    it('falls back to the legacy totals when the manifest is missing', async () => {
      const res = await runImport(false);

      // the import still completes on the legacy line counts
      expect(await ds.getRepository(EnWord).count()).toBe(4);
      const parsed = res.chunks.map((c) => JSON.parse(c) as ProgressChunk);
      expect(parsed[parsed.length - 1].stage).toBe(EnDictionaryImportPhasesE.completed);

      // no manifest — no version to report or persist
      expect(parsed.every((c) => c.datasetVersion === undefined)).toBe(true);
      expect(mockUpsert).not.toHaveBeenCalled();
    });
  });

  describe('update mode (issue #328)', () => {
    const makeMeaning = (title: string, extra: Record<string, unknown> = {}) => ({
      title,
      definition: title,
      sort_order: 1,
      is_obsolete: false,
      examples: [],
      area_variant: '',
      language_register: '',
      meaning_level: '',
      categories: [],
      translations: [],
      ...extra,
    });

    const updateManifest = (version: string) =>
      JSON.stringify({
        version,
        files: {
          'vocab-bloom-hub-en-words.jsonl': { lines: 3 },
          'vocab-bloom-hub-en-phrasal-verbs.jsonl': { lines: 0 },
          'vocab-bloom-hub-en-grammar-patterns.jsonl': { lines: 0 },
          'vocab-bloom-hub-en-phrases.jsonl': { lines: 0 },
        },
      });

    const mockWordsDataset = (version: string, words: unknown[]) => {
      mockDatasetFiles({
        'manifest.json': updateManifest(version),
        'vocab-bloom-hub-en-words.jsonl': toNdjson(words),
        'vocab-bloom-hub-en-phrasal-verbs.jsonl': '',
        'vocab-bloom-hub-en-grammar-patterns.jsonl': '',
        'vocab-bloom-hub-en-phrases.jsonl': '',
      });
    };

    const wordRowsOf = (headword: string) =>
      ds
        .getRepository(EnWord)
        .createQueryBuilder('w')
        .innerJoin('w.word', 'entry')
        .where('entry.word = :word', { word: headword })
        .getMany();

    // issue #531: the history says which edits still show in what is served
    describe('the history of edits', () => {
      const change = (headword: string, extra: Partial<EnChange> = {}) =>
        ds.getRepository(EnChange).save(
          ds.getRepository(EnChange).create({
            headword,
            part_of_speech: 'verb',
            entity: ChangeEntityE.word,
            action: ChangeActionE.update,
            record: null,
            diff: { description: { before: 'v1', after: 'mine' } },
            origin: ChangeOriginE.admin,
            suggestion_id: null,
            author: null,
            superseded_at: null,
            ...extra,
          }),
        );
      const active = async () =>
        (await ds.getRepository(EnChange).find({ order: { id: 'ASC' } }))
          .filter((row) => row.superseded_at === null)
          .map((row) => [row.headword, row.part_of_speech, row.action]);

      it('an update supersedes the edits of the entries it replaces and leaves the ones it keeps', async () => {
        mockWordsDataset('0.5.0', [makeSetWord('give', { description: 'v1' }), makeSetWord('take')]);
        await service.importDictionary({}, new FakeProgressRes() as unknown as ExpressResponse);
        jest.restoreAllMocks();

        // "give" was edited and then returned to the official version; "take" is still the admin's
        await change('give');
        await change('give', { part_of_speech: null });
        await change('take');
        await ds.getRepository(EnEntry).update({ word: 'take' }, { user_modified: true });

        mockWordsDataset('0.6.0', [makeSetWord('give', { description: 'v2' }), makeSetWord('take')]);
        await service.importDictionary({ update: true }, new FakeProgressRes() as unknown as ExpressResponse);

        expect(await active()).toEqual([['take', 'verb', 'update']]);
        // the rows stay: the history is never erased
        expect(await ds.getRepository(EnChange).count()).toBe(3);
        const superseded = await ds.getRepository(EnChange).findOneByOrFail({ headword: 'give' });
        expect(superseded.superseded_at).toBeInstanceOf(Date);
        expect(superseded.diff).toEqual({ description: { before: 'v1', after: 'mine' } });
      });

      it('an article the dataset brings back takes the place of the one that was deleted', async () => {
        // the admin deleted "give" as a verb, and edited "give" as a noun, which the dataset does not have
        await change('give', { action: ChangeActionE.delete });
        await change('give', { part_of_speech: 'noun' });
        await change('run', { action: ChangeActionE.delete });

        mockWordsDataset('0.5.0', [makeSetWord('give'), makeSetWord('take')]);
        await service.importDictionary({}, new FakeProgressRes() as unknown as ExpressResponse);

        expect(await active()).toEqual([
          ['give', 'noun', 'update'],
          ['run', 'verb', 'delete'],
        ]);
      });

      it('reads the history a copy was exported with, once, and the entries it names say they were edited', async () => {
        const line = (extra: Record<string, unknown> = {}) => ({
          created_at: '2026-09-27T10:00:00.000Z',
          headword: 'give',
          part_of_speech: 'verb',
          entity: 'meaning',
          action: 'update',
          record: { title: 'to hand over', sort_order: 1 },
          diff: { definition: { before: 'v1', after: 'corrected' } },
          origin: 'suggestion',
          author: 'Ada',
          superseded_at: null,
          ...extra,
        });
        const dataset = () =>
          mockDatasetFiles({
            'manifest.json': JSON.stringify({
              version: '0.5.0',
              files: {
                'vocab-bloom-hub-en-words.jsonl': { lines: 1 },
                'vocab-bloom-hub-en-changes.jsonl': { lines: 4 },
              },
            }),
            'vocab-bloom-hub-en-words.jsonl': toNdjson([makeSetWord('give')]),
            'vocab-bloom-hub-en-changes.jsonl': toNdjson([
              line(),
              line({ created_at: '2026-09-20T10:00:00.000Z', superseded_at: '2026-09-25T10:00:00.000Z' }),
              // what is not an edit is left out: an action the history does not know, no headword
              line({ action: 'rename' }),
              line({ headword: '' }),
            ]),
          });

        dataset();
        const res = new FakeProgressRes();
        await service.importDictionary({}, res as unknown as ExpressResponse);
        jest.restoreAllMocks();

        const rows = await ds.getRepository(EnChange).find({ order: { created_at: 'ASC' } });
        expect(rows).toHaveLength(2);
        expect(rows[1]).toEqual(
          expect.objectContaining({
            headword: 'give',
            part_of_speech: 'verb',
            entity: 'meaning',
            action: 'update',
            record: { title: 'to hand over', sort_order: 1 },
            diff: { definition: { before: 'v1', after: 'corrected' } },
            origin: 'suggestion',
            author: 'Ada',
            // the id of a suggestion is known to the instance it was made on only
            suggestion_id: null,
            superseded_at: null,
          }),
        );
        expect(new Date(rows[1].created_at).toISOString()).toBe('2026-09-27T10:00:00.000Z');
        expect(rows[0].superseded_at).toBeInstanceOf(Date);
        // the entry came from the copy, and the copy says it was edited
        expect(await active()).toEqual([['give', 'verb', 'update']]);
        const last = JSON.parse(res.chunks[res.chunks.length - 1]) as { percent: number; stage: number };
        expect(last).toEqual(expect.objectContaining({ percent: 100 }));

        // the same copy again: nothing is added twice
        dataset();
        await service.importDictionary({}, new FakeProgressRes() as unknown as ExpressResponse);
        expect(await ds.getRepository(EnChange).count()).toBe(2);
      });

      it('keeps the history of a copy as past where the instance has the entry already', async () => {
        // "give" is here, from the source; the copy of another instance has it edited
        mockWordsDataset('0.5.0', [makeSetWord('give', { description: 'v1' })]);
        await service.importDictionary({}, new FakeProgressRes() as unknown as ExpressResponse);
        jest.restoreAllMocks();

        const copy = () =>
          mockDatasetFiles({
            'manifest.json': JSON.stringify({
              version: '0.5.0',
              files: {
                'vocab-bloom-hub-en-words.jsonl': { lines: 2 },
                'vocab-bloom-hub-en-changes.jsonl': { lines: 2 },
              },
            }),
            'vocab-bloom-hub-en-words.jsonl': toNdjson([
              makeSetWord('give', { description: 'edited elsewhere' }),
              makeSetWord('take', { description: 'edited elsewhere' }),
            ]),
            'vocab-bloom-hub-en-changes.jsonl': toNdjson(
              ['give', 'take'].map((headword) => ({
                created_at: '2026-09-27T10:00:00.000Z',
                headword,
                part_of_speech: 'verb',
                entity: 'word',
                action: 'update',
                record: null,
                diff: { description: { before: 'v1', after: 'edited elsewhere' } },
                origin: 'admin',
                author: null,
                superseded_at: null,
              })),
            ),
          });

        // added to what is there: "give" stays as it was, "take" comes from the copy
        copy();
        await service.importDictionary({}, new FakeProgressRes() as unknown as ExpressResponse);
        jest.restoreAllMocks();
        expect(await active()).toEqual([['take', 'verb', 'update']]);
        expect(await ds.getRepository(EnChange).count()).toBe(2);

        // taken over what is there: "give" is the edited text of the copy now, and says so
        copy();
        await service.importDictionary({ update: true }, new FakeProgressRes() as unknown as ExpressResponse);
        expect((await wordRowsOf('give'))[0].description).toBe('edited elsewhere');
        expect(await active()).toEqual([
          ['give', 'verb', 'update'],
          ['take', 'verb', 'update'],
        ]);
        expect(await ds.getRepository(EnChange).count()).toBe(2);
      });

      it('an import that adds nothing new touches no edit', async () => {
        mockWordsDataset('0.5.0', [makeSetWord('give')]);
        await service.importDictionary({}, new FakeProgressRes() as unknown as ExpressResponse);
        jest.restoreAllMocks();
        await change('give');

        mockWordsDataset('0.5.0', [makeSetWord('give')]);
        await service.importDictionary({}, new FakeProgressRes() as unknown as ExpressResponse);

        expect(await active()).toEqual([['give', 'verb', 'update']]);
      });
    });

    it('replaces existing entries, keeps user-modified ones and reports the summary', async () => {
      mockWordsDataset('0.5.0', [
        makeSetWord('give', {
          description: 'v1',
          forms: [
            {
              word: 'gave',
              form_of_word: EnWordFormsE.past_simple,
              transcription: 'v1',
              area_variant: EnAreaVariantsE.common,
            },
          ],
          meanings: [makeMeaning('to hand over v1')],
        }),
        makeSetWord('take', { description: 'v1', meanings: [makeMeaning('to grab', { synonyms: ['give'] })] }),
      ]);
      await service.importDictionary({}, new FakeProgressRes() as unknown as ExpressResponse);
      jest.restoreAllMocks();

      // the admin edits "take": the entry is flagged, its content is theirs now
      await ds.getRepository(EnEntry).update({ word: 'take' }, { user_modified: true });

      mockWordsDataset('0.6.0', [
        makeSetWord('give', {
          description: 'v2',
          forms: [
            {
              word: 'gave',
              form_of_word: EnWordFormsE.past_simple,
              transcription: 'v2',
              area_variant: EnAreaVariantsE.common,
            },
          ],
          meanings: [makeMeaning('to hand over v2')],
        }),
        makeSetWord('take', { description: 'v2' }),
        makeSetWord('run', { description: 'new in v2' }),
      ]);
      const res = new FakeProgressRes();
      await service.importDictionary({ update: true }, res as unknown as ExpressResponse);

      // "give" is replaced with the new dataset content, forms included
      const give = await wordRowsOf('give');
      expect(give).toHaveLength(1);
      expect(give[0].description).toBe('v2');
      const gaveForms = await wordRowsOf('gave');
      expect(gaveForms.map((f) => f.transcription)).toEqual(['v2']);
      const meanings = await ds.getRepository(EnMeaning).find({ relations: { synonyms: true } });
      const titles = meanings.map((m) => m.title).sort();
      expect(titles).toContain('to hand over v2');
      expect(titles).not.toContain('to hand over v1');

      // "take" keeps the admin's content — and its link to the replaced
      // "give" survives, because the entry row itself is never deleted
      const take = await wordRowsOf('take');
      expect(take[0].description).toBe('v1');
      expect(meanings.find((m) => m.title === 'to grab')?.synonyms.map((e) => e.word)).toEqual(['give']);

      // "run" is new
      expect(await wordRowsOf('run')).toHaveLength(1);

      const finalChunk = JSON.parse(res.chunks[res.chunks.length - 1]) as ProgressChunk &
        Record<string, number>;
      expect(finalChunk.stage).toBe(EnDictionaryImportPhasesE.completed);
      expect(finalChunk.updated_entries).toBe(1);
      expect(finalChunk.added_entries).toBe(1);
      expect(finalChunk.kept_user_modified).toBe(1);
      expect(mockUpsert).toHaveBeenCalledWith(DATASET_VERSION_SETTINGS_FIELD, '0.6.0');
    });

    it('replaces an entry at most once per run: a later chunk adds to it instead of wiping it', async () => {
      mockWordsDataset('0.5.0', [makeSetWord('lead', { description: 'old' })]);
      await service.importDictionary({}, new FakeProgressRes() as unknown as ExpressResponse);
      jest.restoreAllMocks();

      // two chunks of one update run carry the same headword with different
      // parts of speech (in a real dataset they may land 500 lines apart)
      const ctx = { replaced: new Set<string>(), added: new Set<string>(), kept: new Set<string>() };
      const svc = service as unknown as {
        bulkSaveWords(lines: unknown[], links?: unknown, ctx?: unknown): Promise<void>;
      };
      // makeSetWord builds the loose JSON shape of a dataset line; the real
      // pipeline parses it from NDJSON, so the cast mirrors runtime behavior
      const toDbLines = (lines: unknown[]) => (lines as DataSetWordT[]).map(mapWordFromSetToDB);
      await svc.bulkSaveWords(toDbLines([makeSetWord('lead', { description: 'verb v2' })]), undefined, ctx);
      await svc.bulkSaveWords(
        toDbLines([makeSetWord('lead', { part_of_speech: EnPartOfSpeechE.noun, description: 'noun v2' })]),
        undefined,
        ctx,
      );

      const rows = await wordRowsOf('lead');
      expect(rows.map((r) => r.description).sort()).toEqual(['noun v2', 'verb v2']);
      expect([...ctx.replaced]).toEqual(['lead']);
    });

    it('keeps the historical add-only behavior without the update flag', async () => {
      mockWordsDataset('0.5.0', [makeSetWord('walk', { description: 'v1' })]);
      await service.importDictionary({}, new FakeProgressRes() as unknown as ExpressResponse);
      jest.restoreAllMocks();

      mockWordsDataset('0.6.0', [makeSetWord('walk', { description: 'v2' })]);
      await service.importDictionary({}, new FakeProgressRes() as unknown as ExpressResponse);

      const rows = await wordRowsOf('walk');
      expect(rows.map((r) => r.description)).toEqual(['v1']);
    });
  });

  describe('collection files (issue #442)', () => {
    const meaningLine = (
      word: string,
      part_of_speech: EnPartOfSpeechE,
      title: string,
      extra: Record<string, unknown> = {},
    ) => ({
      word,
      part_of_speech,
      title,
      definition: `definition of ${title}`,
      sort_order: 1,
      is_obsolete: false,
      examples: [],
      area_variant: '',
      language_register: '',
      meaning_level: '',
      categories: [],
      synonyms: [],
      antonyms: [],
      ...extra,
    });
    const translationLine = (
      word: string,
      meaning_title: string,
      language: AvailableTranslationLanguagesE,
      title: string,
      extra: Record<string, unknown> = {},
    ) => ({
      word,
      part_of_speech: EnPartOfSpeechE.verb,
      meaning_sort_order: 1,
      meaning_title,
      language,
      title,
      definition: `${title} (def)`,
      variants_of_words: [title],
      ...extra,
    });
    const shortLine = (word: string, language: AvailableTranslationLanguagesE, description: string) => ({
      word,
      part_of_speech: EnPartOfSpeechE.verb,
      language,
      description,
      variants_of_words: [description],
    });
    const manifestOf = (files: Record<string, string>) =>
      JSON.stringify({
        version: '0.6.0',
        files: Object.fromEntries(
          Object.entries(files).map(([name, body]) => [
            name,
            { lines: body.split('\n').filter(Boolean).length },
          ]),
        ),
      });
    const mockSplitDataset = (files: Record<string, string>) =>
      mockDatasetFiles({ 'manifest.json': manifestOf(files), ...files });

    // the entry files carry no collections; every collection is a file of its own
    const splitDataset = () => ({
      'vocab-bloom-hub-en-words.jsonl': toNdjson([
        makeSetWord('give'),
        makeSetWord('give up', { verb___is_phrasal: true }),
      ]),
      'vocab-bloom-hub-en-phrases.jsonl': toNdjson([makeSetPhrase('in the long run')]),
      'vocab-bloom-hub-en-meanings.jsonl': toNdjson([
        meaningLine('give', EnPartOfSpeechE.verb, 'to hand over', {
          synonyms: [{ word: 'in the long run', part_of_speech: EnPartOfSpeechE.phrase }],
          antonyms: [{ word: 'give up', part_of_speech: EnPartOfSpeechE.verb }],
        }),
        meaningLine('give', EnPartOfSpeechE.verb, 'to yield', { sort_order: 2 }),
        meaningLine('in the long run', EnPartOfSpeechE.phrase, 'eventually'),
        // an entry the dictionary does not have: the line is skipped
        meaningLine('ghost', EnPartOfSpeechE.noun, 'nowhere'),
        // the same meaning twice: the second line is a duplicate
        meaningLine('give', EnPartOfSpeechE.verb, 'to hand over'),
      ]),
      // the translations: one file per language
      'vocab-bloom-hub-en-meaning-translations.ru.jsonl': toNdjson([
        translationLine('give', 'to hand over', AvailableTranslationLanguagesE.ru, 'давать'),
        translationLine('give', 'to yield', AvailableTranslationLanguagesE.ru, 'уступать', {
          meaning_sort_order: 2,
        }),
        // a meaning the dictionary does not have (wrong title): skipped
        translationLine('give', 'to give away', AvailableTranslationLanguagesE.ru, 'отдавать'),
      ]),
      'vocab-bloom-hub-en-meaning-translations.es.jsonl': toNdjson([
        translationLine('give', 'to hand over', AvailableTranslationLanguagesE.es, 'dar'),
      ]),
      'vocab-bloom-hub-en-short-translations.ru.jsonl': toNdjson([
        shortLine('give', AvailableTranslationLanguagesE.ru, 'давать'),
        shortLine('ghost', AvailableTranslationLanguagesE.ru, 'призрак'),
      ]),
      'vocab-bloom-hub-en-short-translations.es.jsonl': toNdjson([
        shortLine('give', AvailableTranslationLanguagesE.es, 'dar'),
      ]),
    });

    const counts = async () => ({
      meanings: await ds.getRepository(EnMeaning).count(),
      translations: await ds.getRepository(EnMeaningTranslation).count(),
      shorts: await ds.getRepository(EnShortTranslation).count(),
    });

    it('imports the meanings, their translations and the short translations from their own files', async () => {
      mockSplitDataset(splitDataset());
      const res = new FakeProgressRes();
      await service.importDictionary({}, res as unknown as ExpressResponse);

      expect(await counts()).toEqual({ meanings: 3, translations: 3, shorts: 2 });

      const give = await ds
        .getRepository(EnWord)
        .createQueryBuilder('w')
        .innerJoin('w.word', 'entry')
        .leftJoinAndSelect('w.meanings', 'm')
        .leftJoinAndSelect('m.translations', 't')
        .leftJoinAndSelect('m.synonyms', 's')
        .leftJoinAndSelect('m.antonyms', 'a')
        .leftJoinAndSelect('w.short_translations', 'st')
        .where('entry.word = :word', { word: 'give' })
        .getOneOrFail();
      const handOver = give.meanings.find((m) => m.title === 'to hand over');
      // the links of a meaning line are resolved once every entry file is in
      expect(handOver?.synonyms.map((e) => e.word)).toEqual(['in the long run']);
      expect(handOver?.antonyms.map((e) => e.word)).toEqual(['give up']);
      expect(handOver?.translations.map((t) => [t.language, t.title]).sort()).toEqual([
        [AvailableTranslationLanguagesE.es, 'dar'],
        [AvailableTranslationLanguagesE.ru, 'давать'],
      ]);
      expect(give.meanings.find((m) => m.title === 'to yield')?.translations.map((t) => t.title)).toEqual([
        'уступать',
      ]);
      expect(give.short_translations.map((t) => [t.language, t.description]).sort()).toEqual([
        [AvailableTranslationLanguagesE.es, 'dar'],
        [AvailableTranslationLanguagesE.ru, 'давать'],
      ]);

      // every collection file is a stage of its own in the progress stream
      const stages = new Set(res.chunks.map((c) => (JSON.parse(c) as ProgressChunk).stage));
      expect(stages).toContain(EnDictionaryImportPhasesE.saving_meanings);
      expect(stages).toContain(EnDictionaryImportPhasesE.saving_meaning_translations);
      expect(stages).toContain(EnDictionaryImportPhasesE.saving_short_translations);
    });

    it('skips the rows the dictionary already has: a re-import adds nothing, a translations-only dataset adds its language', async () => {
      mockSplitDataset(splitDataset());
      await service.importDictionary({}, new FakeProgressRes() as unknown as ExpressResponse);
      const before = await counts();

      mockSplitDataset(splitDataset());
      await service.importDictionary({}, new FakeProgressRes() as unknown as ExpressResponse);
      expect(await counts()).toEqual(before);

      // a dataset of translations only, for entries and meanings that exist
      mockSplitDataset({
        'vocab-bloom-hub-en-meaning-translations.es.jsonl': toNdjson([
          translationLine('give', 'to yield', AvailableTranslationLanguagesE.es, 'ceder', {
            meaning_sort_order: 2,
          }),
          // already there
          translationLine('give', 'to hand over', AvailableTranslationLanguagesE.es, 'dar'),
        ]),
        'vocab-bloom-hub-en-short-translations.es.jsonl': toNdjson([
          shortLine('give up', AvailableTranslationLanguagesE.es, 'rendirse'),
          shortLine('give', AvailableTranslationLanguagesE.es, 'dar'),
        ]),
      });
      await service.importDictionary({}, new FakeProgressRes() as unknown as ExpressResponse);
      expect(await counts()).toEqual({
        ...before,
        translations: before.translations + 1,
        shorts: before.shorts + 1,
      });
      const es = await ds
        .getRepository(EnMeaningTranslation)
        .findBy({ language: AvailableTranslationLanguagesE.es });
      expect(es.map((t) => t.title).sort()).toEqual(['ceder', 'dar']);
    });

    it('still reads the combined translation files of exports before the per-language split', async () => {
      mockSplitDataset({
        'vocab-bloom-hub-en-words.jsonl': toNdjson([makeSetWord('give')]),
        'vocab-bloom-hub-en-meanings.jsonl': toNdjson([
          meaningLine('give', EnPartOfSpeechE.verb, 'to hand over'),
        ]),
        // every language in one file, the way exports between #442 and the split wrote it
        'vocab-bloom-hub-en-meaning-translations.jsonl': toNdjson([
          translationLine('give', 'to hand over', AvailableTranslationLanguagesE.ru, 'давать'),
          translationLine('give', 'to hand over', AvailableTranslationLanguagesE.es, 'dar'),
        ]),
        'vocab-bloom-hub-en-short-translations.jsonl': toNdjson([
          shortLine('give', AvailableTranslationLanguagesE.ru, 'давать'),
          shortLine('give', AvailableTranslationLanguagesE.es, 'dar'),
        ]),
        // and a per-language file next to it, read as well
        'vocab-bloom-hub-en-short-translations.fr.jsonl': toNdjson([
          shortLine('give', AvailableTranslationLanguagesE.fr, 'donner'),
        ]),
      });
      await service.importDictionary({}, new FakeProgressRes() as unknown as ExpressResponse);
      expect(await counts()).toEqual({ meanings: 1, translations: 2, shorts: 3 });
    });

    it('keeps the collections of user-modified entries in update mode and counts them as kept', async () => {
      mockSplitDataset(splitDataset());
      await service.importDictionary({}, new FakeProgressRes() as unknown as ExpressResponse);
      await ds.getRepository(EnEntry).update({ word: 'give up' }, { user_modified: true });

      mockSplitDataset({
        'vocab-bloom-hub-en-words.jsonl': toNdjson([
          makeSetWord('give'),
          makeSetWord('give up', { verb___is_phrasal: true }),
        ]),
        'vocab-bloom-hub-en-meanings.jsonl': toNdjson([
          meaningLine('give', EnPartOfSpeechE.verb, 'to donate'),
          meaningLine('give up', EnPartOfSpeechE.verb, 'to stop trying'),
        ]),
        'vocab-bloom-hub-en-short-translations.ru.jsonl': toNdjson([
          shortLine('give', AvailableTranslationLanguagesE.ru, 'дарить'),
          shortLine('give up', AvailableTranslationLanguagesE.ru, 'сдаваться'),
        ]),
      });
      const res = new FakeProgressRes();
      await service.importDictionary({ update: true }, res as unknown as ExpressResponse);

      const titlesOf = async (headword: string) =>
        (
          await ds
            .getRepository(EnMeaning)
            .createQueryBuilder('m')
            .innerJoin('m.word', 'w')
            .innerJoin('w.word', 'entry')
            .where('entry.word = :word', { word: headword })
            .getMany()
        )
          .map((m) => m.title)
          .sort();
      // "give" was replaced by the dataset: its meanings are the new file's
      expect(await titlesOf('give')).toEqual(['to donate']);
      // "give up" was edited by the admin: nothing from the files touched it
      expect(await titlesOf('give up')).toEqual([]);
      const shorts = await ds.getRepository(EnShortTranslation).find();
      expect(shorts.map((t) => t.description).sort()).toEqual(['дарить']);

      const finalChunk = JSON.parse(res.chunks[res.chunks.length - 1]) as ProgressChunk & {
        kept_user_modified?: number;
        updated_entries?: number;
      };
      expect(finalChunk.updated_entries).toBe(1);
      expect(finalChunk.kept_user_modified).toBe(1);
    });
  });

  describe('getManifest (issue #197)', () => {
    const manifestBody = () =>
      JSON.stringify({
        version: '0.3.0',
        files: { 'vocab-bloom-hub-en-words.jsonl': { lines: 10 } },
      });

    it('returns the published manifest', async () => {
      mockDatasetFiles({ 'manifest.json': manifestBody() });

      const manifest = await service.getManifest();

      expect(manifest.version).toBe('0.3.0');
      expect(manifest.files['vocab-bloom-hub-en-words.jsonl']).toEqual({ lines: 10 });
    });

    it('caches the manifest instead of re-fetching it on every call', async () => {
      mockDatasetFiles({ 'manifest.json': manifestBody() });

      await service.getManifest();
      await service.getManifest();

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException when no manifest is published', async () => {
      mockDatasetFiles({}); // manifest responds with 404

      await expect(service.getManifest()).rejects.toThrow(NotFoundException);
    });
  });

  describe('failure paths', () => {
    it('throws InternalServerErrorException when the dataset download fails', async () => {
      mockDatasetFiles({}); // every file responds with 404

      await expect(
        service.importDictionary({}, new FakeProgressRes() as unknown as ExpressResponse),
      ).rejects.toThrow(InternalServerErrorException);

      expect(await ds.getRepository(EnWord).count()).toBe(0);
    });

    it('aborts on a non-duplicate save error instead of swallowing it', async () => {
      mockDatasetFiles({
        'vocab-bloom-hub-en-words.jsonl': toNdjson([
          // sort_order is NOT NULL — the meaning save fails mid-import
          makeSetWord('broken', {
            meanings: [
              {
                title: 'broken meaning',
                definition: 'no sort order',
                sort_order: null,
                is_obsolete: false,
                examples: [],
                area_variant: '',
                language_register: '',
                meaning_level: '',
                categories: [],
                translations: [],
              },
            ],
          }),
        ]),
      });

      await expect(
        service.importDictionary({}, new FakeProgressRes() as unknown as ExpressResponse),
      ).rejects.toThrow(InternalServerErrorException);

      // the failed word rolled back entirely
      expect(await ds.getRepository(EnWord).count()).toBe(0);
      expect(await ds.getRepository(EnMeaning).count()).toBe(0);
    });
  });

  describe('local sources (issue #269)', () => {
    let root: string;
    const originalImportDir = process.env.DICTIONARY_IMPORT_DIR;

    const datasetFiles = (): Record<string, string> => ({
      'manifest.json': JSON.stringify({
        version: '0.4.0',
        files: {
          'vocab-bloom-hub-en-words.jsonl': { lines: 2 },
          'vocab-bloom-hub-en-phrasal-verbs.jsonl': { lines: 1 },
          'vocab-bloom-hub-en-grammar-patterns.jsonl': { lines: 0 },
          'vocab-bloom-hub-en-phrases.jsonl': { lines: 1 },
        },
        synonym_links: 1,
      }),
      'vocab-bloom-hub-en-words.jsonl': toNdjson([
        makeSetWord('give', {
          meanings: [
            {
              title: 'to hand over',
              definition: 'to pass something to someone',
              sort_order: 1,
              is_obsolete: false,
              examples: [],
              synonyms: ['in the long run'],
              area_variant: '',
              language_register: '',
              meaning_level: '',
              categories: [],
              translations: [],
            },
          ],
        }),
        makeSetWord('give up', { verb___is_phrasal: true }),
      ]),
      'vocab-bloom-hub-en-phrasal-verbs.jsonl': toNdjson([
        makeSetWord('give', { phrasal_variants: ['give up'] }),
      ]),
      'vocab-bloom-hub-en-grammar-patterns.jsonl': '',
      'vocab-bloom-hub-en-phrases.jsonl': toNdjson([makeSetPhrase('in the long run')]),
    });

    const writeDataset = async (dir: string): Promise<void> => {
      await mkdir(dir, { recursive: true });
      for (const [name, body] of Object.entries(datasetFiles())) await writeFile(path.join(dir, name), body);
    };

    const zipDataset = (zipPath: string, prefix = ''): Promise<void> =>
      new Promise((resolve, reject) => {
        const zip = new yazl.ZipFile();
        for (const [name, body] of Object.entries(datasetFiles()))
          zip.addBuffer(Buffer.from(body), prefix + name);
        const out = createWriteStream(zipPath);
        out.on('close', resolve);
        out.on('error', reject);
        zip.outputStream.pipe(out);
        zip.end();
      });

    const expectImported = async (res: FakeProgressRes): Promise<void> => {
      const words = await ds.getRepository(EnWord).find({ relations: { word: true } });
      expect(words.map((w) => w.word.word).sort()).toEqual(['give', 'give up', 'in the long run']);
      const meanings = await ds.getRepository(EnMeaning).find({ relations: { synonyms: true } });
      expect(meanings.map((m) => m.synonyms.map((e) => e.word))).toEqual([['in the long run']]);
      expect(mockUpsert).toHaveBeenCalledWith(DATASET_VERSION_SETTINGS_FIELD, '0.4.0');

      const chunks = res.chunks.map((c) => JSON.parse(c) as ProgressChunk);
      // nothing is downloaded: the stream opens straight on the words stage
      expect(chunks[0]).toEqual({
        percent: 0,
        stage: EnDictionaryImportPhasesE.saving_words,
        datasetVersion: '0.4.0',
      });
      expect(chunks.some((c) => c.stage === EnDictionaryImportPhasesE.downloading_database)).toBe(false);
      expect(chunks[chunks.length - 1]).toEqual({
        percent: 100,
        stage: EnDictionaryImportPhasesE.completed,
        datasetVersion: '0.4.0',
      });
      expect(res.ended).toBe(true);
    };

    beforeAll(async () => {
      root = await mkdtemp(path.join(os.tmpdir(), 'vocab-bloom-import-spec-'));
      process.env.DICTIONARY_IMPORT_DIR = root;
    });

    afterAll(async () => {
      if (originalImportDir === undefined) delete process.env.DICTIONARY_IMPORT_DIR;
      else process.env.DICTIONARY_IMPORT_DIR = originalImportDir;
      await rm(root, { recursive: true, force: true });
    });

    it('imports a dataset directory from DICTIONARY_IMPORT_DIR without touching the network or the files', async () => {
      await writeDataset(path.join(root, 'dataset'));
      const fetchSpy = jest.spyOn(globalThis, 'fetch');

      const res = new FakeProgressRes();
      await service.importDictionary(
        { source: { kind: ImportSourceKindE.file, path: 'dataset' } },
        res as unknown as ExpressResponse,
      );

      await expectImported(res);
      expect(fetchSpy).not.toHaveBeenCalled();
      // the user's files are still there after the import
      expect((await readdir(path.join(root, 'dataset'))).sort()).toEqual(Object.keys(datasetFiles()).sort());
    });

    it('imports a zip archive from DICTIONARY_IMPORT_DIR and removes the extracted copy', async () => {
      await zipDataset(path.join(root, 'export.zip'), 'vocab-bloom-hub-en-export/');

      const res = new FakeProgressRes();
      await service.importDictionary(
        { source: { kind: ImportSourceKindE.file, path: 'export.zip' } },
        res as unknown as ExpressResponse,
      );

      await expectImported(res);
      // the archive itself stays; the extracted copy is removed by the
      // source (verified in the sources spec, whose tmp dir is private)
      expect(existsSync(path.join(root, 'export.zip'))).toBe(true);
    });

    it('rejects a bad path before the stream opens, so the client gets a plain 4xx', async () => {
      const res = new FakeProgressRes();
      await expect(
        service.importDictionary(
          { source: { kind: ImportSourceKindE.file, path: '../etc' } },
          res as unknown as ExpressResponse,
        ),
      ).rejects.toThrow(new BadRequestException(ErrorCodes.dataset_file_not_found));
      expect(res.setHeader).not.toHaveBeenCalled();
      expect(res.chunks).toEqual([]);

      delete process.env.DICTIONARY_IMPORT_DIR;
      await expect(
        service.importDictionary(
          { source: { kind: ImportSourceKindE.file, path: 'dataset' } },
          res as unknown as ExpressResponse,
        ),
      ).rejects.toThrow(new BadRequestException(ErrorCodes.import_dir_not_configured));
      process.env.DICTIONARY_IMPORT_DIR = root;
    });

    it('imports an uploaded archive and deletes the upload afterwards, also when it is rejected', async () => {
      const upload = path.join(root, 'upload-1');
      await zipDataset(upload);

      const res = new FakeProgressRes();
      await service.importUploadedDictionary(
        { archive: [{ path: upload, originalname: 'export.zip' }] },
        {},
        res as unknown as ExpressResponse,
      );

      await expectImported(res);
      expect(existsSync(upload)).toBe(false);

      const bad = path.join(root, 'upload-2');
      await writeFile(bad, 'not a zip');
      const badRes = new FakeProgressRes();
      await expect(
        service.importUploadedDictionary(
          { archive: [{ path: bad, originalname: 'notes.txt' }] },
          {},
          badRes as unknown as ExpressResponse,
        ),
      ).rejects.toThrow(new BadRequestException(ErrorCodes.dataset_invalid));
      expect(badRes.setHeader).not.toHaveBeenCalled();
      expect(existsSync(bad)).toBe(false);
    });

    it('imports the dataset files from their own slots; the manifest and the extra files are optional', async () => {
      // only the words slot, under whatever name the admin's file had: no
      // manifest, so no version is reported or stored, and the progress total
      // comes from the counted lines
      const words = path.join(root, 'upload-words');
      await writeFile(words, datasetFiles()['vocab-bloom-hub-en-words.jsonl']);

      const res = new FakeProgressRes();
      await service.importUploadedDictionary(
        { words: [{ path: words, originalname: 'my-words.jsonl' }] },
        {},
        res as unknown as ExpressResponse,
      );

      const saved = await ds.getRepository(EnWord).find({ relations: { word: true } });
      expect(saved.map((w) => w.word.word).sort()).toEqual(['give', 'give up']);
      expect(mockUpsert).not.toHaveBeenCalled();
      const chunks = res.chunks.map((c) => JSON.parse(c) as ProgressChunk);
      expect(chunks[0]).toEqual({ percent: 0, stage: EnDictionaryImportPhasesE.saving_words });
      expect(chunks[chunks.length - 1]).toEqual({ percent: 100, stage: EnDictionaryImportPhasesE.completed });
      expect(existsSync(words)).toBe(false);

      // a second upload with the manifest and a phrases file on top links the
      // synonym that the words-only import could not resolve
      await ds.synchronize(true);
      const slots: Record<string, string> = {
        manifest: 'manifest.json',
        words: 'vocab-bloom-hub-en-words.jsonl',
        phrasal_verbs: 'vocab-bloom-hub-en-phrasal-verbs.jsonl',
        phrases: 'vocab-bloom-hub-en-phrases.jsonl',
      };
      const files: Record<string, Array<{ path: string; originalname: string }>> = {};
      for (const [slot, name] of Object.entries(slots)) {
        const filePath = path.join(root, `upload-${slot}`);
        await writeFile(filePath, datasetFiles()[name]);
        files[slot] = [{ path: filePath, originalname: `${slot}.bin` }];
      }
      const fullRes = new FakeProgressRes();
      await service.importUploadedDictionary(files, {}, fullRes as unknown as ExpressResponse);
      await expectImported(fullRes);
      expect(Object.values(files).some((f) => existsSync(f[0].path))).toBe(false);

      // an archive next to a slot, two files in one slot, or nothing at all
      const stray = path.join(root, 'upload-stray');
      await writeFile(stray, '');
      const strayZip = path.join(root, 'upload-stray.zip');
      await zipDataset(strayZip);
      await expect(
        service.importUploadedDictionary(
          {
            archive: [{ path: strayZip, originalname: 'export.zip' }],
            words: [{ path: stray, originalname: 'words.jsonl' }],
          },
          {},
          new FakeProgressRes() as unknown as ExpressResponse,
        ),
      ).rejects.toThrow(new BadRequestException(ErrorCodes.dataset_invalid));
      expect(existsSync(stray)).toBe(false);
      expect(existsSync(strayZip)).toBe(false);
      await expect(
        service.importUploadedDictionary({}, {}, new FakeProgressRes() as unknown as ExpressResponse),
      ).rejects.toThrow(new BadRequestException(ErrorCodes.dataset_upload_missing));
    });

    it('takes the manifest values typed by hand, which win over an uploaded manifest.json', async () => {
      const words = path.join(root, 'upload-words-manual');
      await writeFile(words, datasetFiles()['vocab-bloom-hub-en-words.jsonl']);

      const res = new FakeProgressRes();
      await service.importUploadedDictionary(
        { words: [{ path: words, originalname: 'words.jsonl' }] },
        { version: '9.9.9', synonym_links: 1 },
        res as unknown as ExpressResponse,
      );
      const chunks = res.chunks.map((c) => JSON.parse(c) as ProgressChunk);
      expect(chunks[0]).toEqual({
        percent: 0,
        stage: EnDictionaryImportPhasesE.saving_words,
        datasetVersion: '9.9.9',
      });
      expect(mockUpsert).toHaveBeenCalledWith(DATASET_VERSION_SETTINGS_FIELD, '9.9.9');

      await ds.synchronize(true);
      mockUpsert.mockClear();
      const archive = path.join(root, 'upload-manual.zip');
      await zipDataset(archive);
      await service.importUploadedDictionary(
        { archive: [{ path: archive, originalname: 'export.zip' }] },
        { version: '1.2.3' },
        new FakeProgressRes() as unknown as ExpressResponse,
      );
      // the archive's manifest says 0.4.0; the explicit value wins
      expect(mockUpsert).toHaveBeenCalledWith(DATASET_VERSION_SETTINGS_FIELD, '1.2.3');
    });

    it('reports what the import directory offers', async () => {
      await writeDataset(path.join(root, 'dataset'));
      await zipDataset(path.join(root, 'export.zip'));

      // the revisions come from the HF refs API — never from the network in a test
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify({ tags: [{ name: 'v0.1.0' }] }), { status: 200 }));

      const sources = await service.getImportSources();
      expect(sources.import_dir_configured).toBe(true);
      expect(sources.revisions).toEqual(['v0.1.0']);
      expect(sources.files.map((f) => [f.path, f.kind])).toEqual([
        ['dataset', 'directory'],
        ['export.zip', 'zip'],
      ]);

      delete process.env.DICTIONARY_IMPORT_DIR;
      await expect(service.getImportSources()).resolves.toEqual({
        import_dir_configured: false,
        files: [],
        // served from the cache: the refs API is not asked again within the TTL
        revisions: ['v0.1.0'],
      });
      process.env.DICTIONARY_IMPORT_DIR = root;
    });
  });
});
