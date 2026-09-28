import '../../../__tests__/helpers/clearDatabaseUrl';
import { WordRowsService } from '../../../word-rows.service';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { DataSource } from 'typeorm';

import { EnEntry } from '../../../entities/en_entry.entity';
import { DICTIONARY_ENTITIES } from '../../../entities/dictionary-entities';
import { EnWord } from '../../../entities/en_word.entity';
import { EnMeaning } from '../../../entities/en_meaning.entity';
import { EnMeaningTranslation } from '../../../entities/en_meaning_translation.entity';
import { EnShortTranslation } from '../../../entities/en_short_translation.entity';
import { EnSearchService } from '../enSearch.service';
import {
  AvailableTranslationLanguagesE,
  EnEntryTypesE,
  EnPartOfSpeechE,
  EnWordFormsE,
} from '../../../../../../types';

describe('EnSearchService tier categorization (issue #187)', () => {
  let ds: DataSource;
  let service: EnSearchService;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: DICTIONARY_ENTITIES,
      synchronize: true,
    });
    await ds.initialize();

    service = new EnSearchService(ds.getRepository(EnWord), new WordRowsService(ds));
  });

  afterAll(async () => {
    await ds.destroy();
  });

  beforeEach(async () => {
    await ds.synchronize(true);
  });

  const addEntry = (word: string, type = EnEntryTypesE.word) => ds.getRepository(EnEntry).save({ word, type });

  const addWord = (
    entry: EnEntry,
    pos: EnPartOfSpeechE,
    formOfWord = EnWordFormsE.base_form,
    extra: Partial<EnWord> = {},
  ) =>
    ds.getRepository(EnWord).save({
      word: entry,
      part_of_speech: pos,
      form_of_word: formOfWord,
      ...extra,
    });

  /**
   * Seeds a dataset around the search term "run" covering every tier:
   * exact matches, phrasal variants, starts-with, phrases, ends-with, any-match.
   */
  const seedRunDataset = async () => {
    const runEntry = await addEntry('run');
    const runVerb = await addWord(runEntry, EnPartOfSpeechE.verb);
    const runNoun = await addWord(runEntry, EnPartOfSpeechE.noun);

    const runOutEntry = await addEntry('run out');
    await addWord(runOutEntry, EnPartOfSpeechE.verb, EnWordFormsE.base_form, {
      verb___is_phrasal: true,
      base_phrasal: runVerb,
    });

    const runningEntry = await addEntry('running');
    await addWord(runningEntry, EnPartOfSpeechE.verb, EnWordFormsE.present_participle, {
      base_form: runVerb,
    });

    await addWord(await addEntry('runner'), EnPartOfSpeechE.noun);
    await addWord(await addEntry('runway'), EnPartOfSpeechE.noun);
    await addWord(await addEntry('overrun'), EnPartOfSpeechE.verb);
    await addWord(await addEntry('brunch'), EnPartOfSpeechE.noun);

    await addWord(await addEntry('run for it', EnEntryTypesE.phrase), EnPartOfSpeechE.phrase);
    await addWord(await addEntry('in the long run', EnEntryTypesE.phrase), EnPartOfSpeechE.phrase);
    await addWord(await addEntry('runaway train', EnEntryTypesE.phrase), EnPartOfSpeechE.phrase);

    return { runVerb, runNoun };
  };

  const words = (res: Awaited<ReturnType<EnSearchService['searchFlat']>>['items']) => res.map((w) => w.word);

  it('returns tiers in relevance order: exact, phrasal, starts-with, phrases, ends-with, any', async () => {
    await seedRunDataset();

    const { items: res } = await service.searchFlat({ search: 'run', type: undefined, limit: 20 });
    const names = words(res);

    // exact matches (both parts of speech of "run") come first
    expect(names.slice(0, 2)).toEqual(['run', 'run']);
    // then phrasal variants of the exact match
    expect(names[2]).toBe('run out');
    // then words starting with the search term
    expect(names.slice(3, 5).sort()).toEqual(['runner', 'runway']);
    // then phrases containing the term on a word boundary
    expect(names.slice(5, 7).sort()).toEqual(['in the long run', 'run for it']);
    // then words ending with the term
    expect(names[7]).toBe('overrun');
    // finally any-match leftovers (substring matches, including phrases)
    expect(names.slice(8).sort()).toEqual(['brunch', 'runaway train']);

    // the word form "running" resolves to its base and never appears on its own
    expect(names).not.toContain('running');
  });

  it('resolves a search by word form to the base word and its phrasal variants', async () => {
    await seedRunDataset();

    const { items: res } = await service.searchFlat({ search: 'running', type: undefined, limit: 3 });
    const names = words(res);

    expect(names[0]).toBe('run');
    expect(names).toContain('run out');
  });

  it('spends the limit on higher tiers first', async () => {
    await seedRunDataset();

    const { items: res } = await service.searchFlat({ search: 'run', type: undefined, limit: 3 });

    expect(words(res).sort()).toEqual(['run', 'run', 'run out']);
  });

  it('with type=word skips phrase tiers entirely', async () => {
    await seedRunDataset();

    const { items: res } = await service.searchFlat({ search: 'run', type: EnEntryTypesE.word, limit: 20 });
    const names = words(res);

    expect(names).toContain('runner');
    expect(names).toContain('overrun');
    expect(names).not.toContain('run for it');
    expect(names).not.toContain('in the long run');
    expect(names).not.toContain('runaway train');
  });

  it('with type=phrase returns only phrases matched on word boundaries', async () => {
    await seedRunDataset();

    const { items: res } = await service.searchFlat({ search: 'long', type: EnEntryTypesE.phrase, limit: 20 });

    expect(words(res)).toEqual(['in the long run']);
  });

  it('with type=grammar_pattern returns only grammar patterns', async () => {
    await seedRunDataset();
    await addWord(await addEntry('let it run', EnEntryTypesE.grammar_pattern), EnPartOfSpeechE.grammar_pattern);

    const { items: res } = await service.searchFlat({
      search: 'let',
      type: EnEntryTypesE.grammar_pattern,
      limit: 20,
    });

    expect(words(res)).toEqual(['let it run']);
  });

  it('binds the type filter to the exact and phrasal tiers as well (issue #440)', async () => {
    await seedRunDataset();
    await addWord(await addEntry('let it run', EnEntryTypesE.grammar_pattern), EnPartOfSpeechE.grammar_pattern);

    // "run" itself and its phrasal variants are words: with type=phrase they stay out
    const phrases = await service.searchFlat({ search: 'run', type: EnEntryTypesE.phrase, limit: 20 });
    expect(words(phrases.items).sort()).toEqual(['in the long run', 'run for it', 'runaway train']);
    // and the phrases stay out of a grammar-pattern search
    const patterns = await service.searchFlat({
      search: 'run',
      type: EnEntryTypesE.grammar_pattern,
      limit: 20,
    });
    expect(words(patterns.items)).toEqual(['let it run']);
  });

  it('resolves inflected forms to their base entry in the suffix and substring tiers too (issue #440)', async () => {
    await seedRunDataset();
    const outrun = await addWord(await addEntry('outrun'), EnPartOfSpeechE.verb);
    await addWord(await addEntry('outrunning'), EnPartOfSpeechE.verb, EnWordFormsE.present_participle, {
      base_form: outrun,
    });
    const crunch = await addWord(await addEntry('crunch'), EnPartOfSpeechE.noun);
    for (const spelling of ['crunches', "crunch's", "crunches'"]) {
      await addWord(await addEntry(spelling), EnPartOfSpeechE.noun, EnWordFormsE.plural_form, {
        base_form: crunch,
      });
    }

    const names = words((await service.searchFlat({ search: 'run', type: undefined, limit: 30 })).items);
    expect(names.filter((n) => n === 'outrun')).toHaveLength(1);
    expect(names.filter((n) => n === 'crunch')).toHaveLength(1);
    expect(names).not.toContain('outrunning');
    expect(names).not.toContain('crunches');
    expect(names).not.toContain("crunch's");
  });

  it('fills the limit of the prefix tier with distinct headwords in byte order, forms notwithstanding (issue #440)', async () => {
    for (const spelling of ['abbey', 'abide', 'able', 'abode', 'about']) {
      const base = await addWord(await addEntry(spelling), EnPartOfSpeechE.noun);
      for (const suffix of ['s', "'s", "s'"]) {
        await addWord(await addEntry(spelling + suffix), EnPartOfSpeechE.noun, EnWordFormsE.plural_form, {
          base_form: base,
        });
      }
    }

    // 5 headwords behind 20 matching rows: the limit counts headwords
    const res = await service.searchFlat({ search: 'ab', type: undefined, limit: 5 });
    expect(res.short_term).toBe(true);
    expect(words(res.items)).toEqual(['abbey', 'abide', 'able', 'abode', 'about']);
    // a smaller limit keeps the alphabetical head, not an arbitrary subset
    expect(words((await service.searchFlat({ search: 'ab', type: undefined, limit: 2 })).items)).toEqual([
      'abbey',
      'abide',
    ]);
  });

  it('finds a headword that keeps its capitals — a grammar pattern — by its lower-case spelling (issue #440)', async () => {
    await seedRunDataset();
    await addWord(
      await addEntry('It’s the first time ...', EnEntryTypesE.grammar_pattern),
      EnPartOfSpeechE.grammar_pattern,
    );

    const exact = await service.searchFlat({ search: 'it’s the first time ...', type: undefined, limit: 5 });
    expect(words(exact.items)).toEqual(['It’s the first time ...']);
    const prefix = await service.searchFlat({ search: 'it’s', type: EnEntryTypesE.grammar_pattern, limit: 5 });
    expect(words(prefix.items)).toEqual(['It’s the first time ...']);
    const contains = await service.searchFlat({ search: 'first', type: undefined, limit: 5 });
    expect(words(contains.items)).toEqual(['It’s the first time ...']);
  });

  it('keeps reading the prefix tier chunk after chunk until the limit is met (issue #440)', async () => {
    // 30 headwords behind 120 rows: one chunk of rows collapses to far fewer
    // headwords than asked, so the tier has to continue after its last row
    const spellings = Array.from({ length: 30 }, (_, i) => `ab${String.fromCharCode(97 + i)}`);
    for (const spelling of spellings) {
      const base = await addWord(await addEntry(spelling), EnPartOfSpeechE.noun);
      for (const suffix of ['s', "'s", "s'"]) {
        await addWord(await addEntry(spelling + suffix), EnPartOfSpeechE.noun, EnWordFormsE.plural_form, {
          base_form: base,
        });
      }
    }

    const res = await service.searchFlat({ search: 'ab', type: undefined, limit: 25 });
    expect(words(res.items)).toEqual(spellings.slice(0, 25));
    expect(words((await service.searchFlat({ search: 'ab', type: undefined, limit: 100 })).items)).toEqual(
      spellings,
    );
  });

  it('normalizes the search term (trim + lowercase)', async () => {
    await seedRunDataset();

    const { items: res } = await service.searchFlat({ search: '  RUN  ', type: undefined, limit: 2 });

    expect(words(res)).toEqual(['run', 'run']);
  });

  it('escapes LIKE wildcards in the search term', async () => {
    await addWord(await addEntry('axc'), EnPartOfSpeechE.noun);
    await addWord(await addEntry('abbbc'), EnPartOfSpeechE.noun);

    // "_" and "%" must be treated literally, not as LIKE wildcards
    expect((await service.searchFlat({ search: 'a_c', type: undefined, limit: 10 })).items).toEqual([]);
    expect((await service.searchFlat({ search: 'a%c', type: undefined, limit: 10 })).items).toEqual([]);
  });

  describe('short terms (issue #292)', () => {
    // a letter, an article, a two-letter word and headwords that only the
    // substring tiers would reach from "a" / "ab"
    const seedShortDataset = async () => {
      await addWord(await addEntry('a'), EnPartOfSpeechE.article);
      await addWord(await addEntry('ab'), EnPartOfSpeechE.noun);
      const abandon = await addWord(await addEntry('abandon'), EnPartOfSpeechE.verb);
      await addWord(await addEntry('abandoned'), EnPartOfSpeechE.verb, EnWordFormsE.past_simple, {
        base_form: abandon,
      });
      await addWord(await addEntry('cab'), EnPartOfSpeechE.noun);
      await addWord(await addEntry('tabby'), EnPartOfSpeechE.noun);
      await addWord(await addEntry('a cab ride', EnEntryTypesE.phrase), EnPartOfSpeechE.phrase);
    };

    it('searches a one- or two-character term in the exact and prefix tiers only', async () => {
      await seedShortDataset();

      const ab = await service.searchFlat({ search: 'ab', type: undefined, limit: 10 });
      expect(ab.short_term).toBe(true);
      expect(ab.fuzzy).toBe(false);
      // exact first, then the prefix tier; nothing from the suffix, substring or phrase tiers
      expect(words(ab.items)).toEqual(['ab', 'abandon']);

      const a = await service.searchFlat({ search: 'a', type: undefined, limit: 10 });
      expect(a.short_term).toBe(true);
      expect(words(a.items)).toEqual(['a', 'ab', 'abandon']);
    });

    it('resolves a short inflected form to its base entry and honours the type filter', async () => {
      await seedShortDataset();
      const it = await addWord(await addEntry('it'), EnPartOfSpeechE.pronoun);
      await addWord(await addEntry('its'), EnPartOfSpeechE.pronoun, EnWordFormsE.possessive_adjective, {
        base_form: it,
      });

      expect(words((await service.searchFlat({ search: 'it', type: undefined, limit: 10 })).items)).toEqual([
        'it',
      ]);
      expect(words((await service.searchFlat({ search: 'its', type: undefined, limit: 10 })).items)[0]).toBe(
        'it',
      );
      // the type filter binds the exact tier too (issue #440): the word "a"
      // stays out of a phrase search, and the prefix tier only runs for
      // words, so "abandon" and "a cab ride" stay out as well
      const phrases = await service.searchFlat({ search: 'a', type: EnEntryTypesE.phrase, limit: 10 });
      expect(phrases.short_term).toBe(true);
      expect(words(phrases.items)).toEqual([]);
      const wordsOnly = await service.searchFlat({ search: 'a', type: EnEntryTypesE.word, limit: 10 });
      expect(words(wordsOnly.items)[0]).toBe('a');
    });

    it('runs the full tiers from three characters on', async () => {
      await seedShortDataset();

      const abb = await service.searchFlat({ search: 'abb', type: undefined, limit: 10 });
      expect(abb.short_term).toBe(false);
      expect(words(abb.items)).toEqual(['tabby']);
      const cab = await service.searchDetailed({ search: 'cab' });
      expect(cab.short_term).toBe(false);
      expect(cab.items.map((w) => w.word)).toEqual(['cab', 'a cab ride']);
    });

    it('treats a blank term as a short term and answers nothing', async () => {
      await seedShortDataset();

      const blank = await service.searchFlat({ search: '   ', type: undefined, limit: 10 });
      expect(blank).toEqual({ items: [], fuzzy: false, short_term: true });
      const detailed = await service.searchDetailed({ search: ' ' });
      expect(detailed).toMatchObject({ items: [], has_more: false, short_term: true });
    });
  });

  it('returns an empty list when nothing matches', async () => {
    await seedRunDataset();

    expect((await service.searchFlat({ search: 'zzz', type: undefined, limit: 10 })).items).toEqual([]);
  });

  describe('searchDetailed (issue #170)', () => {
    const seedTranslations = async (word: EnWord) => {
      await ds.getRepository(EnShortTranslation).save({
        word,
        description: 'бежать',
        language: AvailableTranslationLanguagesE.ru,
        variants_of_words: ['бежать', 'бегать'],
      });
      const meaning = await ds.getRepository(EnMeaning).save({
        word,
        sort_order: 0,
        title: 'to move fast',
        definition: 'to move at a speed faster than a walk',
        is_obsolete: false,
      });
      await ds.getRepository(EnMeaningTranslation).save({
        meaning,
        language: AvailableTranslationLanguagesE.ru,
        title: 'бежать',
        definition: 'быстро передвигаться',
        variants_of_words: [],
      });
    };

    it('without flags returns items with empty meanings and translations plus paging meta', async () => {
      const { runVerb } = await seedRunDataset();
      await seedTranslations(runVerb);

      const res = await service.searchDetailed({ search: 'run', limit: 5, page: 1 });

      expect(res.page).toBe(1);
      expect(res.limit).toBe(5);
      expect(res.has_more).toBe(true);
      expect(res.items.length).toBe(5);
      res.items.forEach((item) => {
        expect(item.meanings).toEqual([]);
        expect(item.short_translations).toEqual([]);
      });
    });

    it('with_translations populates short translations of the found word', async () => {
      const { runVerb } = await seedRunDataset();
      await seedTranslations(runVerb);

      const res = await service.searchDetailed({ search: 'run', limit: 5, with_translations: true });

      const verb = res.items.find((item) => item.id === runVerb.id);
      expect(verb?.short_translations.map((st) => st.description)).toEqual(['бежать']);
      // meanings stay empty without their flag
      expect(verb?.meanings).toEqual([]);
    });

    it('with_meanings populates meanings together with their translations', async () => {
      const { runVerb } = await seedRunDataset();
      await seedTranslations(runVerb);

      const res = await service.searchDetailed({
        search: 'run',
        limit: 5,
        with_meanings: true,
        translation_languages: [AvailableTranslationLanguagesE.ru],
      });

      const verb = res.items.find((item) => item.id === runVerb.id);
      expect(verb?.meanings.map((m) => m.title)).toEqual(['to move fast']);
      expect(verb?.meanings[0].translations.map((t) => t.definition)).toEqual(['быстро передвигаться']);
    });

    it('paginates the tiered results without overlaps and reports has_more', async () => {
      await seedRunDataset(); // 10 matches for "run" in total

      const page1 = await service.searchDetailed({ search: 'run', limit: 3, page: 1 });
      const page2 = await service.searchDetailed({ search: 'run', limit: 3, page: 2 });
      const page4 = await service.searchDetailed({ search: 'run', limit: 3, page: 4 });

      // page 1 is the top of the tier order, identical to the base search
      expect(page1.items.map((w) => w.word)).toEqual(['run', 'run', 'run out']);
      expect(page1.has_more).toBe(true);

      expect(page2.items).toHaveLength(3);
      const page1Ids = new Set(page1.items.map((w) => w.id));
      page2.items.forEach((w) => expect(page1Ids.has(w.id)).toBe(false));

      // 10 items with limit 3 leave a single item on the last page
      expect(page4.items).toHaveLength(1);
      expect(page4.has_more).toBe(false);
    });

    it('returns an empty page when nothing matches', async () => {
      await seedRunDataset();

      const res = await service.searchDetailed({ search: 'zzz' });

      expect(res.items).toEqual([]);
      expect(res.has_more).toBe(false);
    });
  });

  it('detailed search returns meaning synonyms and antonyms as headwords when with_meanings is set (issues #259, #266)', async () => {
    const run = await addWord(await addEntry('run'), EnPartOfSpeechE.verb);
    const sprint = await addEntry('sprint');
    const dash = await addEntry('dash');
    const walk = await addEntry('walk');
    await ds.getRepository(EnMeaning).save({
      word: run,
      title: 'to move fast',
      definition: 'to move fast on foot',
      sort_order: 1,
      examples: [],
      synonyms: [sprint, dash],
      antonyms: [walk],
    });

    const withMeanings = await service.searchDetailed({ search: 'run', with_meanings: true });
    expect(withMeanings.items[0].meanings).toEqual([
      expect.objectContaining({ title: 'to move fast', synonyms: ['dash', 'sprint'], antonyms: ['walk'] }),
    ]);

    const withoutMeanings = await service.searchDetailed({ search: 'run' });
    expect(withoutMeanings.items[0].meanings).toEqual([]);
  });
});
