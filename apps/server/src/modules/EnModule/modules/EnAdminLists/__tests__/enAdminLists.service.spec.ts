import '../../../__tests__/helpers/clearDatabaseUrl';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { DataSource, Repository } from 'typeorm';

import { EnEntry } from '../../../entities/en_entry.entity';
import { DICTIONARY_ENTITIES } from '../../../entities/dictionary-entities';
import { EnWord } from '../../../entities/en_word.entity';
import { EnMeaning } from '../../../entities/en_meaning.entity';
import { EnMeaningTranslation } from '../../../entities/en_meaning_translation.entity';
import { EnShortTranslation } from '../../../entities/en_short_translation.entity';
import { EnAdminListsService } from '../enAdminLists.service';
import {
  AvailableTranslationLanguagesE,
  EnAreaVariantsE,
  EnEntryTypesE,
  EnPartOfSpeechE,
  EnWordFormsE,
  LanguageRegisterE,
  WordLevelE,
} from '../../../../../../types';

type SeedWord = {
  word: string;
  part_of_speech?: EnPartOfSpeechE;
  form_of_word?: EnWordFormsE;
  area_variant?: EnAreaVariantsE;
  word_level?: WordLevelE | null;
  language_register?: LanguageRegisterE;
  generated?: boolean;
  generated_by_model?: string | null;
  version?: string;
  is_obsolete?: boolean;
  meanings?: number;
  // one ru translation per seeded meaning
  meaning_translations?: boolean;
  short_translations?: number;
  base_form?: EnWord;
};

describe('EnAdminListsService (issue #249)', () => {
  let ds: DataSource;
  let service: EnAdminListsService;
  let wordsRep: Repository<EnWord>;
  let entriesRep: Repository<EnEntry>;
  let meaningsRep: Repository<EnMeaning>;
  let meaningTranslationsRep: Repository<EnMeaningTranslation>;
  let shortTranslationsRep: Repository<EnShortTranslation>;

  const seed = async ({
    word,
    part_of_speech = EnPartOfSpeechE.noun,
    form_of_word = EnWordFormsE.base_form,
    area_variant = EnAreaVariantsE.common,
    word_level = null,
    language_register = LanguageRegisterE.formal,
    generated = false,
    generated_by_model = null,
    version = '1.0.0',
    is_obsolete = false,
    meanings = 0,
    meaning_translations = false,
    short_translations = 0,
    base_form,
  }: SeedWord): Promise<EnWord> => {
    const entry =
      (await entriesRep.findOneBy({ word })) ?? (await entriesRep.save({ word, type: EnEntryTypesE.word }));
    const row = await wordsRep.save({
      word: entry,
      part_of_speech,
      form_of_word,
      area_variant,
      word_level,
      language_register,
      generated,
      generated_by_model,
      version,
      is_obsolete,
      ...(base_form && { base_form }),
    });
    for (let i = 0; i < meanings; i++) {
      const meaning = await meaningsRep.save({ word: row, title: `m${i}`, definition: `d${i}`, sort_order: i });
      if (meaning_translations) {
        await meaningTranslationsRep.save({
          meaning,
          language: AvailableTranslationLanguagesE.ru,
          title: `${word}-${part_of_speech}-m${i}-ru`,
          definition: `ru definition ${i}`,
          variants_of_words: [`v${i}`],
        });
      }
    }
    for (let i = 0; i < short_translations; i++) {
      await shortTranslationsRep.save({
        word: row,
        language: AvailableTranslationLanguagesE.ru,
        description: `t${i}`,
        variants_of_words: [],
      });
    }
    return row;
  };

  beforeAll(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: DICTIONARY_ENTITIES,
      synchronize: true,
    });
    await ds.initialize();
    wordsRep = ds.getRepository(EnWord);
    entriesRep = ds.getRepository(EnEntry);
    meaningsRep = ds.getRepository(EnMeaning);
    meaningTranslationsRep = ds.getRepository(EnMeaningTranslation);
    shortTranslationsRep = ds.getRepository(EnShortTranslation);
    service = new EnAdminListsService(wordsRep, meaningsRep, meaningTranslationsRep, shortTranslationsRep);

    const run = await seed({
      word: 'run',
      part_of_speech: EnPartOfSpeechE.verb,
      generated: true,
      generated_by_model: 'model-a',
      meanings: 2,
      meaning_translations: true,
      short_translations: 1,
      word_level: WordLevelE.A1,
    });
    // an inflected form must never be listed
    await seed({
      word: 'runs',
      part_of_speech: EnPartOfSpeechE.verb,
      form_of_word: EnWordFormsE.third_person_singular,
      base_form: run,
    });
    const runNoun = await seed({ word: 'run', part_of_speech: EnPartOfSpeechE.noun, meanings: 1 });
    // a second, fully described meaning of the noun for the meanings listing filters
    await meaningsRep.save({
      word: runNoun,
      title: 'm1',
      definition: 'd1',
      sort_order: 1,
      area_variant: EnAreaVariantsE.british,
      meaning_level: WordLevelE.B2,
      language_register: LanguageRegisterE.informal,
      is_obsolete: true,
      examples: ['a run of luck'],
      // synonyms are links to other entries (issue #259)
      synonyms: [
        await entriesRep.save({ word: 'streak', type: EnEntryTypesE.word }),
        await entriesRep.save({ word: 'series', type: EnEntryTypesE.word }),
      ],
      antonyms: [await entriesRep.save({ word: 'halt', type: EnEntryTypesE.word })],
    });
    await seed({ word: 'abandon', part_of_speech: EnPartOfSpeechE.verb, version: '2.0.0', is_obsolete: true });
    await seed({
      word: 'colour',
      area_variant: EnAreaVariantsE.british,
      language_register: LanguageRegisterE.informal,
    });
    await seed({ word: 'quickly', part_of_speech: EnPartOfSpeechE.adverb, generated: true });
    await seed({ word: 'in the long run', part_of_speech: EnPartOfSpeechE.phrase, short_translations: 2 });
  });

  afterAll(async () => {
    await ds.destroy();
  });

  const words = async (query: Parameters<EnAdminListsService['listWords']>[0]) =>
    (await service.listWords(query)).items.map((i) => `${i.word}:${i.part_of_speech}`);
  const meanings = async (query: Parameters<EnAdminListsService['listMeanings']>[0]) =>
    (await service.listMeanings(query)).items.map((i) => `${i.word}:${i.part_of_speech}:${i.title}`);
  const translations = async (query: Parameters<EnAdminListsService['listMeaningTranslations']>[0]) =>
    (await service.listMeaningTranslations(query)).items.map((i) => i.title);

  it('lists only base forms, ordered by word then part of speech, with pagination metadata', async () => {
    const res = await service.listWords({ page: 1, limit: 50 });

    expect(res.items.map((i) => `${i.word}:${i.part_of_speech}`)).toEqual([
      'abandon:verb',
      'colour:noun',
      'in the long run:phrase',
      'quickly:adverb',
      'run:noun',
      'run:verb',
    ]);
    expect(res).toMatchObject({ page: 1, limit: 50, total: 6, has_more: false });
  });

  it('paginates with a stable order and reports has_more', async () => {
    const first = await service.listWords({ page: 1, limit: 4 });
    const second = await service.listWords({ page: 2, limit: 4 });

    expect(first.items.map((i) => i.word)).toEqual(['abandon', 'colour', 'in the long run', 'quickly']);
    expect(first.has_more).toBe(true);
    expect(second.items.map((i) => `${i.word}:${i.part_of_speech}`)).toEqual(['run:noun', 'run:verb']);
    expect(second).toMatchObject({ page: 2, total: 6, has_more: false });
  });

  it('walks every listing by `after` (an id range, no OFFSET) over every row of the numbered pages', async () => {
    const listings = [
      { name: 'words', list: (q: { page?: number; limit: number; after?: number }) => service.listWords(q) },
      {
        name: 'meanings',
        list: (q: { page?: number; limit: number; after?: number }) => service.listMeanings(q),
      },
      {
        name: 'meaning translations',
        list: (q: { page?: number; limit: number; after?: number }) => service.listMeaningTranslations(q),
      },
      {
        name: 'short translations',
        list: (q: { page?: number; limit: number; after?: number }) => service.listShortTranslations(q),
      },
    ];
    for (const { name, list } of listings) {
      const all = await list({ page: 1, limit: 200 });
      expect(all.has_more).toBe(false);
      expect(all.next_after).toBeNull();

      // page by page after the last row of the previous page: every row once, in id order
      const walked: number[] = [];
      let after: number | undefined = 0;
      for (let i = 0; i < 10; i++) {
        const page = await list({ limit: 2, after });
        expect(page).toMatchObject({ page: 1, limit: 2, total: all.total });
        walked.push(...page.items.map((item) => item.id));
        if (!page.has_more) {
          expect(page.next_after).toBeNull();
          break;
        }
        expect(page.next_after).toBe(page.items[page.items.length - 1]?.id);
        after = page.next_after as number;
      }
      const ascending = [...walked].sort((a, b) => a - b);
      expect({ name, ids: walked }).toEqual({ name, ids: ascending });
      expect({ name, ids: ascending }).toEqual({
        name,
        ids: all.items.map((item) => item.id).sort((a, b) => a - b),
      });
    }
  });

  it('answers an empty last page for an `after` past every row', async () => {
    expect(await service.listWords({ limit: 2, after: 999_999 })).toMatchObject({
      items: [],
      has_more: false,
      next_after: null,
    });
  });

  it('maps every column plus the meanings / short translations counters', async () => {
    const res = await service.listWords({ part_of_speech: [EnPartOfSpeechE.verb], search: 'run' });

    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      word: 'run',
      part_of_speech: EnPartOfSpeechE.verb,
      area_variant: EnAreaVariantsE.common,
      word_level: WordLevelE.A1,
      language_register: LanguageRegisterE.formal,
      generated: true,
      generated_by_model: 'model-a',
      version: '1.0.0',
      is_obsolete: false,
      transcription: null,
      description: null,
      categories: [],
      meanings_count: 2,
      short_translations_count: 1,
    });
    expect(typeof res.items[0].id).toBe('number');
  });

  it('filters by word prefix, case-insensitively and with LIKE wildcards escaped', async () => {
    expect(await words({ search: 'RU' })).toEqual(['run:noun', 'run:verb']);
    expect(await words({ search: 'in the' })).toEqual(['in the long run:phrase']);
    expect(await words({ search: '%' })).toEqual([]);
  });

  it('filters by the enum columns', async () => {
    expect(await words({ part_of_speech: [EnPartOfSpeechE.adverb, EnPartOfSpeechE.phrase] })).toEqual([
      'in the long run:phrase',
      'quickly:adverb',
    ]);
    expect(await words({ area_variant: [EnAreaVariantsE.british] })).toEqual(['colour:noun']);
    expect(await words({ word_level: [WordLevelE.A1] })).toEqual(['run:verb']);
    expect(await words({ language_register: [LanguageRegisterE.informal] })).toEqual(['colour:noun']);
  });

  it('filters by generated, generated_by_model and version', async () => {
    expect(await words({ generated: true })).toEqual(['quickly:adverb', 'run:verb']);
    expect(await words({ generated: false })).toEqual([
      'abandon:verb',
      'colour:noun',
      'in the long run:phrase',
      'run:noun',
    ]);
    expect(await words({ generated_by_model: 'model-a' })).toEqual(['run:verb']);
    expect(await words({ version: '2.0.0' })).toEqual(['abandon:verb']);
  });

  it('filters by is_obsolete', async () => {
    expect(await words({ is_obsolete: true })).toEqual(['abandon:verb']);
    expect(await words({ is_obsolete: false })).toEqual([
      'colour:noun',
      'in the long run:phrase',
      'quickly:adverb',
      'run:noun',
      'run:verb',
    ]);
  });

  it('filters by the presence of meanings and short translations without duplicating rows', async () => {
    expect(await words({ has_meanings: true })).toEqual(['run:noun', 'run:verb']);
    expect(await words({ has_meanings: false })).toEqual([
      'abandon:verb',
      'colour:noun',
      'in the long run:phrase',
      'quickly:adverb',
    ]);
    expect(await words({ has_short_translations: true })).toEqual(['in the long run:phrase', 'run:verb']);
    expect((await service.listWords({ has_short_translations: true })).total).toBe(2);
  });

  it('combines filters', async () => {
    expect(
      await words({ part_of_speech: [EnPartOfSpeechE.verb], has_meanings: true, generated: true }),
    ).toEqual(['run:verb']);
    expect(
      await words({ part_of_speech: [EnPartOfSpeechE.verb], is_obsolete: true, has_meanings: true }),
    ).toEqual([]);
  });

  describe('listMeanings', () => {
    it('lists meanings with their word, ordered by word, part of speech, then sort order', async () => {
      const res = await service.listMeanings({ page: 1, limit: 50 });

      expect(res.items.map((i) => `${i.word}:${i.part_of_speech}:${i.title}`)).toEqual([
        'run:noun:m0',
        'run:noun:m1',
        'run:verb:m0',
        'run:verb:m1',
      ]);
      expect(res).toMatchObject({ page: 1, limit: 50, total: 4, has_more: false });
    });

    it('paginates with a stable order', async () => {
      const first = await service.listMeanings({ page: 1, limit: 3 });
      const second = await service.listMeanings({ page: 2, limit: 3 });

      expect(first.items.map((i) => i.title)).toEqual(['m0', 'm1', 'm0']);
      expect(first.has_more).toBe(true);
      expect(second.items.map((i) => `${i.part_of_speech}:${i.title}`)).toEqual(['verb:m1']);
      expect(second).toMatchObject({ page: 2, total: 4, has_more: false });
    });

    it('maps the meaning columns, the owning word and the translations counter', async () => {
      const res = await service.listMeanings({ part_of_speech: [EnPartOfSpeechE.noun], is_obsolete: true });

      expect(res.items).toHaveLength(1);
      expect(res.items[0]).toMatchObject({
        word: 'run',
        part_of_speech: EnPartOfSpeechE.noun,
        title: 'm1',
        definition: 'd1',
        sort_order: 1,
        area_variant: EnAreaVariantsE.british,
        meaning_level: WordLevelE.B2,
        language_register: LanguageRegisterE.informal,
        categories: [],
        is_obsolete: true,
        examples: ['a run of luck'],
        synonyms: ['series', 'streak'],
        antonyms: ['halt'],
        translations_count: 0,
      });
      expect(typeof res.items[0].id).toBe('number');
      // a meaning without links gets an empty list, and the join never duplicates pages
      const all = await service.listMeanings({ page: 1, limit: 50 });
      expect(all.items).toHaveLength(4);
      expect(all.items.filter((i) => i.synonyms.length === 0)).toHaveLength(3);
      expect(all.items.filter((i) => i.antonyms.length === 0)).toHaveLength(3);
      expect(typeof res.items[0].word_id).toBe('number');

      const translated = await service.listMeanings({ part_of_speech: [EnPartOfSpeechE.verb] });
      expect(translated.items.map((i) => i.translations_count)).toEqual([1, 1]);
    });

    it('filters by the word prefix and part of speech', async () => {
      expect(await meanings({ search: 'RU', part_of_speech: [EnPartOfSpeechE.verb] })).toEqual([
        'run:verb:m0',
        'run:verb:m1',
      ]);
      expect(await meanings({ search: 'abandon' })).toEqual([]);
    });

    it('filters by the meaning columns and the presence of translations', async () => {
      expect(await meanings({ area_variant: [EnAreaVariantsE.british] })).toEqual(['run:noun:m1']);
      expect(await meanings({ meaning_level: [WordLevelE.B2] })).toEqual(['run:noun:m1']);
      expect(await meanings({ language_register: [LanguageRegisterE.informal] })).toEqual(['run:noun:m1']);
      expect(await meanings({ is_obsolete: false })).toEqual(['run:noun:m0', 'run:verb:m0', 'run:verb:m1']);
      expect(await meanings({ has_translations: true })).toEqual(['run:verb:m0', 'run:verb:m1']);
      expect(await meanings({ has_translations: false })).toEqual(['run:noun:m0', 'run:noun:m1']);
      expect((await service.listMeanings({ has_translations: true })).total).toBe(2);
    });
  });

  describe('listMeaningTranslations', () => {
    it('lists translations with their meaning and word, in meaning order', async () => {
      const res = await service.listMeaningTranslations({ page: 1, limit: 50 });

      expect(res.items.map((i) => i.title)).toEqual(['run-verb-m0-ru', 'run-verb-m1-ru']);
      expect(res).toMatchObject({ page: 1, limit: 50, total: 2, has_more: false });
      expect(res.items[0]).toMatchObject({
        word: 'run',
        part_of_speech: EnPartOfSpeechE.verb,
        meaning_title: 'm0',
        meaning_definition: 'd0',
        language: AvailableTranslationLanguagesE.ru,
        title: 'run-verb-m0-ru',
        definition: 'ru definition 0',
        variants_of_words: ['v0'],
      });
      expect(typeof res.items[0].id).toBe('number');
      expect(typeof res.items[0].meaning_id).toBe('number');
      expect(typeof res.items[0].word_id).toBe('number');
    });

    it('paginates and filters by word prefix, part of speech and language', async () => {
      const first = await service.listMeaningTranslations({ page: 1, limit: 1 });
      expect(first.items.map((i) => i.title)).toEqual(['run-verb-m0-ru']);
      expect(first).toMatchObject({ total: 2, has_more: true });

      expect(await translations({ search: 'ru' })).toEqual(['run-verb-m0-ru', 'run-verb-m1-ru']);
      expect(await translations({ search: 'abandon' })).toEqual([]);
      expect(await translations({ part_of_speech: [EnPartOfSpeechE.noun] })).toEqual([]);
      expect(await translations({ language: [AvailableTranslationLanguagesE.ru] })).toHaveLength(2);
    });
  });

  describe('listShortTranslations', () => {
    const shortTranslations = async (query: Parameters<EnAdminListsService['listShortTranslations']>[0]) =>
      (await service.listShortTranslations(query)).items.map((i) => `${i.word}:${i.description}`);

    it('lists short translations with their word, in word order', async () => {
      const res = await service.listShortTranslations({ page: 1, limit: 50 });

      expect(res.items.map((i) => `${i.word}:${i.description}`)).toEqual([
        'in the long run:t0',
        'in the long run:t1',
        'run:t0',
      ]);
      expect(res).toMatchObject({ page: 1, limit: 50, total: 3, has_more: false });
      expect(res.items[2]).toMatchObject({
        word: 'run',
        part_of_speech: EnPartOfSpeechE.verb,
        language: AvailableTranslationLanguagesE.ru,
        description: 't0',
        variants_of_words: [],
      });
      expect(typeof res.items[2].id).toBe('number');
      expect(typeof res.items[2].word_id).toBe('number');
    });

    it('paginates and filters by word prefix, part of speech and language', async () => {
      const first = await service.listShortTranslations({ page: 1, limit: 2 });
      expect(first.items.map((i) => i.description)).toEqual(['t0', 't1']);
      expect(first).toMatchObject({ total: 3, has_more: true });

      expect(await shortTranslations({ search: 'RU' })).toEqual(['run:t0']);
      expect(await shortTranslations({ search: 'abandon' })).toEqual([]);
      expect(await shortTranslations({ part_of_speech: [EnPartOfSpeechE.phrase] })).toEqual([
        'in the long run:t0',
        'in the long run:t1',
      ]);
      expect(await shortTranslations({ language: [AvailableTranslationLanguagesE.ru] })).toHaveLength(3);
    });
  });
});
