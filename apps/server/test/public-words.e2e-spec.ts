import { INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/modules/AppModule/app.module';
import { AllExceptionsFilter } from '../src/core/filters/all-exceptions.filter';
import { hashLoginString } from '../core/utils/crypto';
import { createJwt } from '../core/utils/auth';
import {
  AvailableTranslationLanguagesE,
  CategoryE,
  EnAreaVariantsE,
  EnPartOfSpeechE,
  EnWordFormsE,
  EnWordT,
  PublicHeadwordFormsV1ResT,
  PublicHeadwordLinksV1ResT,
  PublicHeadwordMeaningsV1ResT,
  PublicHeadwordTranslationsV1ResT,
  PublicHeadwordV1ResT,
  PublicMetaV1ResT,
  PublicSearchV1ResT,
  PublicWordsBatchV1ResT,
  PublicWordsV1ResT,
  PublicWordV1ResT,
  PublicWordV1T,
  WordLevelE,
} from '../types';
import { encodeWordCursor, wordListFingerprint } from '../src/modules/PublicApiModule/utils/cursor';

const E2E_USERNAME = 'e2e-admin';
const E2E_PASSWORD = 'e2e-password';

const ENV_KEYS = ['PUBLIC_API_ENABLED', 'ADMIN_API_ENABLED', 'PUBLIC_API_RATE_LIMIT'] as const;

const ruTranslation = (title: string) => ({
  language: AvailableTranslationLanguagesE.ru,
  title,
  definition: `${title} (definition)`,
  variants_of_words: [title],
});
// a second language (issue #410): the pipeline must treat it as data
const esTranslation = (title: string) => ({
  ...ruTranslation(title),
  language: AvailableTranslationLanguagesE.es,
});

const makeMeaning = (
  title: string,
  sort_order: number,
  extra: { translations?: ReturnType<typeof ruTranslation>[]; synonyms?: string[]; antonyms?: string[] } = {},
) => ({
  title,
  definition: `definition of ${title}`,
  is_obsolete: false,
  sort_order,
  examples: [],
  area_variant: EnAreaVariantsE.common,
  translations: extra.translations ?? [],
  ...(extra.synonyms && { synonyms: extra.synonyms }),
  ...(extra.antonyms && { antonyms: extra.antonyms }),
});

// The public reads of issue #272: headword and id lookups, the partial
// reads, the filtered cursor-paged list, the random entry and the meta
// endpoint. The whole AppModule is booted so the public-prefix middleware,
// the throttler and the error filter are in place.
describe('public API reads /api/v1/words, /random, /meta (e2e, issue #272)', () => {
  let app: INestApplication<App>;
  const auth = { Authorization: '' };
  const server = () => app.getHttpServer();
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
  const ids: Record<string, number> = {};

  // the add endpoint echoes the request back with the id of the created entry
  const addWord = async (body: object): Promise<number> => {
    const res = await request(server()).post('/api/en/add/word').set(auth).send(body).expect(201);
    return (res.body as { id: number }).id;
  };

  beforeAll(async () => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    process.env.ADMIN_USERNAME = E2E_USERNAME;
    process.env.ADMIN_PASSWORD = E2E_PASSWORD;
    const hashByEnv = await hashLoginString(E2E_USERNAME, E2E_PASSWORD);
    const secretHash = await hashLoginString(E2E_USERNAME, hashByEnv);
    auth.Authorization = `Bearer ${createJwt({ role: 'admin' }, secretHash + hashByEnv)}`;

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set('trust proxy', true);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost).httpAdapter));
    await app.init();

    // insertion order fixes the ids the (word, id) ordering below relies on:
    // sprint, run (verb) + its two forms, run (noun), abandon, "put up with"
    ids.sprint = await addWord({
      word: 'sprint',
      part_of_speech: EnPartOfSpeechE.verb,
      form_of_word: EnWordFormsE.base_form,
      word_level: WordLevelE.B2,
      categories: [CategoryE.sport, CategoryE.IT],
      meanings: [makeMeaning('to run fast', 1)],
    });
    ids.runVerb = await addWord({
      word: 'run',
      part_of_speech: EnPartOfSpeechE.verb,
      form_of_word: EnWordFormsE.base_form,
      word_level: WordLevelE.A1,
      forms: [
        { word: 'ran', form_of_word: EnWordFormsE.past_simple, area_variant: EnAreaVariantsE.common },
        {
          word: 'running',
          form_of_word: EnWordFormsE.present_participle,
          area_variant: EnAreaVariantsE.common,
        },
      ],
      meanings: [
        // sort_order says "manage" comes second even though it is inserted first
        makeMeaning('to manage', 2, { translations: [ruTranslation('управлять')] }),
        makeMeaning('to move fast', 1, {
          translations: [ruTranslation('бежать'), esTranslation('correr')],
          synonyms: ['sprint'],
        }),
      ],
      short_translations: [
        { language: AvailableTranslationLanguagesE.ru, description: 'бежать', variants_of_words: ['бежать'] },
        { language: AvailableTranslationLanguagesE.es, description: 'correr', variants_of_words: ['correr'] },
      ],
    });
    ids.runNoun = await addWord({
      word: 'run',
      part_of_speech: EnPartOfSpeechE.noun,
      form_of_word: EnWordFormsE.base_form,
      word_level: WordLevelE.B1,
      categories: [CategoryE.sport],
      meanings: [makeMeaning('an act of running', 1)],
    });
    ids.abandon = await addWord({
      word: 'abandon',
      part_of_speech: EnPartOfSpeechE.verb,
      form_of_word: EnWordFormsE.base_form,
      word_level: WordLevelE.C1,
      // the only antonym of the fixture (issue #403); "run" exists already
      meanings: [makeMeaning('to leave', 1, { antonyms: ['run'] })],
    });
    ids.phrase = await addWord({
      word: 'put up with',
      part_of_speech: EnPartOfSpeechE.phrase,
      form_of_word: EnWordFormsE.base_form,
      meanings: [makeMeaning('to tolerate', 1)],
    });
  });

  afterAll(async () => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    await app.close();
  });

  // The suite sends well over a hundred requests from one address; the
  // default budget (100/60) would 429 the last tests. The two rate-limit
  // tests set their own value; afterEach clears it again
  beforeEach(() => {
    process.env.PUBLIC_API_RATE_LIMIT = '100000/60';
  });

  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  const expectPublicError = (body: unknown, statusCode: number, message?: string) =>
    expect(body).toEqual({ statusCode, message: message ?? expect.any(String), error: true });

  // ------------------------------------------------------------ headword

  describe('GET /api/v1/words/{word}', () => {
    it('answers every entry of the headword without auth, ordered by part of speech', async () => {
      const res = await request(server()).get('/api/v1/words/run').expect(200);
      expect(res.headers['x-api-version']).toBe('1');
      const body = res.body as PublicHeadwordV1ResT;
      expect(body.meta).toEqual({ word: 'run', count: 2, variants: [] });
      expect(body.data.map((w) => [w.id, w.part_of_speech])).toEqual([
        [ids.runNoun, EnPartOfSpeechE.noun],
        [ids.runVerb, EnPartOfSpeechE.verb],
      ]);

      const verb = body.data[1];
      expect(verb.forms.map((f) => f.word)).toEqual(['ran', 'running']);
      expect(verb.meanings.map((m) => m.title)).toEqual(['to move fast', 'to manage']);
      expect(verb.meanings[0].synonyms).toEqual(['sprint']);
      expect(verb.meanings[0].antonyms).toEqual([]);
      expect(verb.meanings[0].translations).toEqual([
        expect.objectContaining({ language: 'ru', title: 'бежать', variants_of_words: ['бежать'] }),
        expect.objectContaining({ language: 'es', title: 'correr' }),
      ]);
      expect(verb.short_translations).toEqual([
        expect.objectContaining({ description: 'бежать', language: 'ru' }),
        expect.objectContaining({ description: 'correr', language: 'es' }),
      ]);
      // the contract omits the timestamps, the owner relations and the
      // instance's editorial state everywhere (issue #392)
      for (const internal of [
        'createdAt',
        'generated',
        'generated_by_model',
        'version',
        'user_modified',
        'base_form',
      ]) {
        expect(verb).not.toHaveProperty(internal);
      }
      expect(verb.phrasal_variants).toEqual([]);
      expect(verb.base_phrasal).toBeNull();
      expect(verb.meanings[0].translations[0]).not.toHaveProperty('createdAt');
      expect(verb.short_translations[0]).not.toHaveProperty('createdAt');
      expect(verb.short_translations[0]).not.toHaveProperty('word');
    });

    it('resolves an inflected form to its base entry, case-insensitively', async () => {
      const res = await request(server()).get('/api/v1/words/RAN').expect(200);
      const body = res.body as PublicHeadwordV1ResT;
      expect(body.meta).toEqual({ word: 'ran', count: 1, variants: [] });
      expect(body.data[0]).toMatchObject({ id: ids.runVerb, word: 'run' });
    });

    it('finds phrases by their URL-encoded spelling', async () => {
      const res = await request(server()).get('/api/v1/words/put%20up%20with').expect(200);
      expect((res.body as PublicHeadwordV1ResT).data[0]).toMatchObject({ id: ids.phrase, word: 'put up with' });
    });

    it('answers 404 in the public error shape for an unknown headword', async () => {
      const res = await request(server()).get('/api/v1/words/nope').expect(404);
      expect(res.headers['x-api-version']).toBe('1');
      expectPublicError(res.body, 404, 'word_doesnt_found');
      await request(server()).get('/api/v1/words/%20').expect(404);
    });

    it('rejects a headword longer than the column instead of running the lookup (issue #345)', async () => {
      const oversized = 'x'.repeat(129);
      const res = await request(server()).get(`/api/v1/words/${oversized}`).expect(400);
      expectPublicError(res.body, 400);
      expect(res.body.message).toContain('128');
      await request(server()).get(`/api/v1/words/${oversized}/meanings`).expect(400);
      await request(server()).get(`/api/v1/words/${oversized}/translations`).expect(400);
      await request(server()).get(`/api/v1/words/${oversized}/forms`).expect(400);
    });
  });

  describe('POST /api/v1/words/batch', () => {
    it('answers many headwords in request order, collapsing duplicates and case, with a not-found list', async () => {
      const res = await request(server())
        .post('/api/v1/words/batch')
        .send({ words: ['Run', 'nope', 'put up with', 'RAN', 'run', ' sprint ', 'zzz'] })
        .expect(200);
      expect(res.headers['x-api-version']).toBe('1');
      const body = res.body as PublicWordsBatchV1ResT;
      expect(body.meta).toEqual({ count: 4, not_found: ['nope', 'zzz'] });
      expect(body.data.map((item) => [item.word, item.count, item.entries.map((w) => w.id)])).toEqual([
        ['run', 2, [ids.runNoun, ids.runVerb]],
        ['put up with', 1, [ids.phrase]],
        // an inflected form resolves to its base entry, under its own spelling
        ['ran', 1, [ids.runVerb]],
        ['sprint', 1, [ids.sprint]],
      ]);
      // the entries are the full projection of the single lookup
      const single = (await request(server()).get('/api/v1/words/run').expect(200))
        .body as PublicHeadwordV1ResT;
      expect(body.data[0].entries).toEqual(single.data);
      // a POST read carries no caching directives (Express still stamps its own ETag)
      expect(res.headers['cache-control']).toBeUndefined();
      expect(res.headers['last-modified']).toBeUndefined();
    });

    it('answers an empty list, not 404, when nothing is found', async () => {
      const res = await request(server())
        .post('/api/v1/words/batch')
        .send({ words: ['nope'] })
        .expect(200);
      expect(res.body).toEqual({ data: [], meta: { count: 0, not_found: ['nope'] } });
    });

    it('rejects an empty, oversized or non-string batch and unknown fields', async () => {
      const reject = async (body: object) => {
        const res = await request(server()).post('/api/v1/words/batch').send(body).expect(400);
        expectPublicError(res.body, 400);
      };
      await reject({ words: [] });
      await reject({ words: Array.from({ length: 51 }, (_, i) => `w${i}`) });
      await reject({ words: [42] });
      await reject({ words: ['x'.repeat(129)] });
      // a blank spelling would vanish from the answer: rejected instead
      await reject({ words: ['run', '   '] });
      await reject({ words: 'run' });
      await reject({ words: ['run'], limit: 5 });
      await reject({});
    });

    it('costs one request against the prefix budget, whatever the size of the batch', async () => {
      process.env.PUBLIC_API_RATE_LIMIT = '2/60';
      const ip = { 'X-Forwarded-For': '203.0.113.97' };
      const words = Array.from({ length: 50 }, (_, i) => `word${i}`);
      await request(server()).post('/api/v1/words/batch').set(ip).send({ words }).expect(200);
      await request(server()).post('/api/v1/words/batch').set(ip).send({ words }).expect(200);
      const limited = await request(server()).post('/api/v1/words/batch').set(ip).send({ words }).expect(429);
      expectPublicError(limited.body, 429, 'too_many_requests');
    });
  });

  describe('GET /api/v1/words/{word}/meanings, /translations, /forms', () => {
    it('flattens the meanings of every entry, each naming its entry', async () => {
      const res = await request(server()).get('/api/v1/words/run/meanings').expect(200);
      const body = res.body as PublicHeadwordMeaningsV1ResT;
      expect(body.meta).toEqual({ word: 'run', count: 2, variants: [] });
      expect(body.data.map((m) => [m.title, m.word_id, m.part_of_speech])).toEqual([
        ['an act of running', ids.runNoun, EnPartOfSpeechE.noun],
        ['to move fast', ids.runVerb, EnPartOfSpeechE.verb],
        ['to manage', ids.runVerb, EnPartOfSpeechE.verb],
      ]);
      expect(body.data[1]).toMatchObject({
        synonyms: ['sprint'],
        translations: [
          expect.objectContaining({ title: 'бежать' }),
          expect.objectContaining({ title: 'correr' }),
        ],
      });
    });

    it('lists the forms with the entry they belong to', async () => {
      const res = await request(server()).get('/api/v1/words/run/forms').expect(200);
      const body = res.body as PublicHeadwordFormsV1ResT;
      expect(body.data).toEqual([
        expect.objectContaining({
          word: 'ran',
          form_of_word: 'past_simple',
          word_id: ids.runVerb,
          part_of_speech: 'verb',
        }),
        expect.objectContaining({ word: 'running', form_of_word: 'present_participle', word_id: ids.runVerb }),
      ]);
    });

    it('lists short and per-meaning translations, filterable by language', async () => {
      const res = await request(server()).get('/api/v1/words/run/translations').expect(200);
      const body = res.body as PublicHeadwordTranslationsV1ResT;
      expect(body.meta).toEqual({ word: 'run', count: 2, variants: [] });
      expect(body.data.short_translations).toEqual([
        expect.objectContaining({ description: 'бежать', word_id: ids.runVerb, part_of_speech: 'verb' }),
        expect.objectContaining({ description: 'correr', language: 'es' }),
      ]);
      expect(body.data.meaning_translations.map((t) => t.title)).toEqual(['бежать', 'correr', 'управлять']);
      expect(body.data.meaning_translations[0]).toMatchObject({
        word_id: ids.runVerb,
        meaning_id: expect.any(Number),
        language: 'ru',
      });

      // one language, or several as a repeated key (issue #410)
      const ru = await request(server()).get('/api/v1/words/run/translations?language=ru').expect(200);
      expect((ru.body as PublicHeadwordTranslationsV1ResT).data.meaning_translations).toHaveLength(2);
      expect((ru.body as PublicHeadwordTranslationsV1ResT).data.short_translations).toHaveLength(1);
      const es = await request(server()).get('/api/v1/words/run/translations?language=es').expect(200);
      const esBody = es.body as PublicHeadwordTranslationsV1ResT;
      expect(esBody.data.meaning_translations.map((t) => [t.title, t.language])).toEqual([['correr', 'es']]);
      expect(esBody.data.short_translations.map((t) => t.description)).toEqual(['correr']);
      const both = await request(server())
        .get('/api/v1/words/run/translations?language=ru&language=es')
        .expect(200);
      expect((both.body as PublicHeadwordTranslationsV1ResT).data.meaning_translations).toHaveLength(3);
      // the detailed search filters the joined translations the same way
      const detailed = await request(server())
        .get(
          '/api/v1/search/detailed?search=run&with_meanings=true&with_translations=true&translation_languages=es',
        )
        .expect(200);
      const found = (detailed.body.data as PublicWordV1T[]).find((w) => w.id === ids.runVerb)!;
      expect(found.meanings.flatMap((m) => m.translations.map((t) => t.language))).toEqual(['es']);
      expect(found.short_translations.map((t) => t.language)).toEqual(['es']);

      const bad = await request(server()).get('/api/v1/words/run/translations?language=xx').expect(400);
      expectPublicError(bad.body, 400);
    });
  });

  // ------------------------------------------------------------------ id

  describe('GET /api/v1/words/{word}/synonyms, /antonyms (issue #403)', () => {
    it('lists the linked headwords per meaning, naming the meaning and the entry', async () => {
      const res = await request(server()).get('/api/v1/words/RUN/synonyms').expect(200);
      const body = res.body as PublicHeadwordLinksV1ResT;
      expect(body.meta).toEqual({ word: 'run', count: 2, variants: [] });
      const meanings = (await request(server()).get('/api/v1/words/run/meanings').expect(200))
        .body as PublicHeadwordMeaningsV1ResT;
      const moveFast = meanings.data.find((m) => m.title === 'to move fast')!;
      expect(body.data).toEqual([
        {
          word: 'sprint',
          meaning_id: moveFast.id,
          word_id: ids.runVerb,
          part_of_speech: EnPartOfSpeechE.verb,
          // a part of an entry is attributed like the whole (issue #527)…
          source: 'vocab-bloom-hub',
          // …and says that the entry was added on the instance, as the words of this suite were (issue #531)
          modified: true,
        },
      ]);
      // an inflected form resolves to its base entry here too
      expect((await request(server()).get('/api/v1/words/ran/synonyms').expect(200)).body.data).toHaveLength(1);

      const antonyms = (await request(server()).get('/api/v1/words/abandon/antonyms').expect(200))
        .body as PublicHeadwordLinksV1ResT;
      expect(antonyms.meta).toEqual({ word: 'abandon', count: 1, variants: [] });
      expect(antonyms.data).toEqual([
        expect.objectContaining({ word: 'run', word_id: ids.abandon, part_of_speech: EnPartOfSpeechE.verb }),
      ]);
      // a headword without links answers an empty list, not 404
      expect((await request(server()).get('/api/v1/words/run/antonyms').expect(200)).body.data).toEqual([]);
      // an unknown headword is 404 like every headword read
      await request(server()).get('/api/v1/words/nope/synonyms').expect(404);
      await request(server())
        .get(`/api/v1/words/${'x'.repeat(129)}/antonyms`)
        .expect(400);
    });
  });

  describe('GET /api/v1/words/id/{id}', () => {
    it('answers the entry in the { data } envelope', async () => {
      const res = await request(server()).get(`/api/v1/words/id/${ids.runNoun}`).expect(200);
      expect(res.headers['x-api-version']).toBe('1');
      expect((res.body as PublicWordV1ResT).data).toMatchObject({
        id: ids.runNoun,
        word: 'run',
        part_of_speech: 'noun',
        categories: ['sport'],
      });
    });

    it('rejects a non-numeric id and reports an unknown one as 404', async () => {
      const bad = await request(server()).get('/api/v1/words/id/abc').expect(400);
      expectPublicError(bad.body, 400);
      const missing = await request(server()).get('/api/v1/words/id/999999').expect(404);
      expectPublicError(missing.body, 404, 'word_doesnt_found');
    });
  });

  // ---------------------------------------------------------------- list

  describe('GET /api/v1/words', () => {
    const list = (query = '') =>
      request(server())
        .get(`/api/v1/words${query}`)
        .expect(200)
        .then((res) => res.body as PublicWordsV1ResT);
    const keys = (body: PublicWordsV1ResT) => body.data.map((w) => `${w.word}:${w.part_of_speech}`);

    it('lists base forms ordered by (word, id) without meanings by default', async () => {
      const body = await list();
      expect(keys(body)).toEqual(['abandon:verb', 'put up with:phrase', 'run:verb', 'run:noun', 'sprint:verb']);
      expect(body.meta).toEqual({ limit: 20, has_more: false, next_cursor: null });
      expect(body.data[2].forms.map((f) => f.word)).toEqual(['ran', 'running']);
      expect(body.data[2].meanings).toEqual([]);
      expect(body.data[2].short_translations).toEqual([]);
    });

    it('walks the pages through the cursor without repeating or skipping items', async () => {
      const first = await list('?limit=2');
      expect(keys(first)).toEqual(['abandon:verb', 'put up with:phrase']);
      expect(first.meta).toEqual({ limit: 2, has_more: true, next_cursor: expect.any(String) });

      const second = await list(`?limit=2&cursor=${encodeURIComponent(first.meta.next_cursor as string)}`);
      expect(keys(second)).toEqual(['run:verb', 'run:noun']);
      expect(second.meta.has_more).toBe(true);

      const third = await list(`?limit=2&cursor=${encodeURIComponent(second.meta.next_cursor as string)}`);
      expect(keys(third)).toEqual(['sprint:verb']);
      expect(third.meta).toEqual({ limit: 2, has_more: false, next_cursor: null });
    });

    it('keeps the cursor stable across the two entries of one headword', async () => {
      // a cursor right on "run" (verb): the next page starts with "run" (noun)
      const cursor = encodeWordCursor({ word: 'run', id: ids.runVerb, filters: wordListFingerprint({}) });
      const body = await list(`?cursor=${encodeURIComponent(cursor)}`);
      expect(keys(body)).toEqual(['run:noun', 'sprint:verb']);
    });

    it('binds the cursor to its filters and reads an empty cursor as the first page (issue #440)', async () => {
      const first = await list('?limit=2&part_of_speech=verb');
      const cursor = encodeURIComponent(first.meta.next_cursor as string);
      // the same filters, in another order of the query string: the next page
      expect(keys(await list(`?part_of_speech=verb&cursor=${cursor}&limit=2`))).toEqual(['sprint:verb']);
      // other filters: the cursor names a position in another listing
      const foreign = await request(server()).get(`/api/v1/words?cursor=${cursor}`).expect(400);
      expectPublicError(foreign.body, 400, 'invalid_cursor');
      const narrowed = await request(server())
        .get(`/api/v1/words?part_of_speech=verb&word_level=B2&cursor=${cursor}`)
        .expect(400);
      expectPublicError(narrowed.body, 400, 'invalid_cursor');
      // nothing after `cursor=` is no cursor
      expect(keys(await list('?cursor=&limit=2'))).toEqual(['abandon:verb', 'put up with:phrase']);
    });

    it('folds the case of a headword that keeps its capitals — a grammar pattern (issue #440)', async () => {
      const id = await addWord({
        word: 'When it comes to ...',
        part_of_speech: EnPartOfSpeechE.grammar_pattern,
        form_of_word: EnWordFormsE.base_form,
        area_variant: EnAreaVariantsE.common,
        meanings: [],
      });
      try {
        // sorted among the w's, not before "abandon"
        expect(keys(await list())).toEqual([
          'abandon:verb',
          'put up with:phrase',
          'run:verb',
          'run:noun',
          'sprint:verb',
          'When it comes to ...:grammar_pattern',
        ]);
        expect(keys(await list('?search=wh'))).toEqual(['When it comes to ...:grammar_pattern']);
        expect(keys(await list('?search=WHEN%20IT'))).toEqual(['When it comes to ...:grammar_pattern']);
        // the headword read and the search find it by the lower-case spelling, and answer the stored one
        const read = await request(server()).get('/api/v1/words/when%20it%20comes%20to%20...').expect(200);
        expect((read.body as PublicHeadwordV1ResT).data[0].word).toBe('When it comes to ...');
        const found = await request(server()).get('/api/v1/search?search=when%20it').expect(200);
        expect((found.body as PublicSearchV1ResT).data.map((w) => w.word)).toEqual(['When it comes to ...']);
      } finally {
        await request(server()).delete(`/api/en/${id}`).set(auth).expect(200);
      }
    });

    it('filters by the word columns, OR-ing the values of one filter', async () => {
      expect(keys(await list('?word_level=B1'))).toEqual(['run:noun']);
      expect(keys(await list('?word_level=B1&word_level=B2'))).toEqual(['run:noun', 'sprint:verb']);
      expect(keys(await list('?part_of_speech=verb&word_level=B2'))).toEqual(['sprint:verb']);
      expect(keys(await list('?part_of_speech=noun&part_of_speech=phrase'))).toEqual([
        'put up with:phrase',
        'run:noun',
      ]);
      expect(keys(await list('?area_variant=british'))).toEqual([]);
    });

    it('filters by a case-insensitive headword prefix and by is_obsolete (issue #403)', async () => {
      expect(keys(await list('?search=ru'))).toEqual(['run:verb', 'run:noun']);
      expect(keys(await list('?search=RU&part_of_speech=noun'))).toEqual(['run:noun']);
      // a phrase prefix keeps its space; LIKE wildcards in the term are literal
      expect(keys(await list('?search=put%20up'))).toEqual(['put up with:phrase']);
      expect(keys(await list('?search=%25'))).toEqual([]);
      expect(keys(await list('?search=ra&form_of_word=past_simple'))).toEqual(['ran:verb']);
      expect(keys(await list('?is_obsolete=true'))).toEqual([]);
      expect(keys(await list('?is_obsolete=false&search=sp'))).toEqual(['sprint:verb']);
      // the same filters drive the random draw
      const random = await request(server()).get('/api/v1/random?search=aba').expect(200);
      expect((random.body as PublicWordV1ResT).data.word).toBe('abandon');
      await request(server()).get('/api/v1/random?search=zzz').expect(404);
      // validated like every filter
      await request(server())
        .get(`/api/v1/words?search=${'x'.repeat(129)}`)
        .expect(400);
      await request(server()).get('/api/v1/words?is_obsolete=maybe').expect(400);
    });

    it('filters by category over the array column', async () => {
      expect(keys(await list('?category=IT'))).toEqual(['sprint:verb']);
      expect(keys(await list('?category=sport'))).toEqual(['run:noun', 'sprint:verb']);
      expect(keys(await list('?category=sport&category=IT'))).toEqual(['run:noun', 'sprint:verb']);
      expect(keys(await list('?category=medical'))).toEqual([]);
    });

    it('lists inflected forms only when form_of_word asks for them', async () => {
      const past = await list('?form_of_word=past_simple');
      expect(keys(past)).toEqual(['ran:verb']);
      const both = await list('?form_of_word=past_simple&form_of_word=present_participle');
      expect(keys(both)).toEqual(['ran:verb', 'running:verb']);
    });

    it('joins meanings and short translations on request', async () => {
      const body = await list('?with_meanings=true&with_translations=true&part_of_speech=verb&word_level=A1');
      expect(keys(body)).toEqual(['run:verb']);
      expect(body.data[0].meanings.map((m) => m.title)).toEqual(['to move fast', 'to manage']);
      expect(body.data[0].meanings[0].translations.map((t) => t.title)).toEqual(['бежать', 'correr']);
      expect(body.data[0].short_translations.map((t) => t.description)).toEqual(['бежать', 'correr']);
      expect(body.data[0].short_translations[0]).not.toHaveProperty('createdAt');
    });

    it('rejects a foreign cursor, unknown filter values, unknown keys and an out-of-range limit', async () => {
      const cursor = await request(server()).get('/api/v1/words?cursor=not-a-cursor').expect(400);
      expectPublicError(cursor.body, 400, 'invalid_cursor');
      const value = await request(server()).get('/api/v1/words?word_level=Z9').expect(400);
      expectPublicError(value.body, 400);
      expect((value.body as { message: string }).message).toContain('word_level');
      const key = await request(server()).get('/api/v1/words?page=2').expect(400);
      expectPublicError(key.body, 400);
      const limit = await request(server()).get('/api/v1/words?limit=500').expect(400);
      expectPublicError(limit.body, 400);
    });
  });

  // -------------------------------------------------------------- random

  describe('GET /api/v1/random', () => {
    it('answers a base-form entry matching the filters', async () => {
      const res = await request(server()).get('/api/v1/random').expect(200);
      expect(res.headers['x-api-version']).toBe('1');
      const word = (res.body as PublicWordV1ResT).data;
      expect(word.form_of_word).toBe(EnWordFormsE.base_form);
      expect(word.meanings.length).toBeGreaterThan(0);

      for (let i = 0; i < 5; i += 1) {
        const noun = await request(server()).get('/api/v1/random?part_of_speech=noun').expect(200);
        expect((noun.body as PublicWordV1ResT).data).toMatchObject({ id: ids.runNoun, word: 'run' });
      }
      const past = await request(server()).get('/api/v1/random?form_of_word=past_simple').expect(200);
      expect((past.body as PublicWordV1ResT).data).toMatchObject({ word: 'ran' });
    });

    // The draw is a random pivot in the id range of the whole table, then
    // the first match at or after it, wrapping around to the last match
    // before it. Pinning the pivot instead of sampling: "sprint" (the first
    // id) is only reached from the lowest pivot, so a sampled test lost it
    // in 40 draws about once in five hundred runs
    it('reaches every matching entry: at the pivot, after it and by wrapping around', async () => {
      const draw = async (fraction: number): Promise<number> => {
        const random = jest.spyOn(Math, 'random').mockReturnValue(fraction);
        try {
          const res = await request(server()).get('/api/v1/random?word_level=B1&word_level=B2').expect(200);
          return (res.body as PublicWordV1ResT).data.id;
        } finally {
          random.mockRestore();
        }
      };
      // the lowest pivot is "sprint" itself
      expect(await draw(0)).toBe(ids.sprint);
      // a pivot between the two matches walks forward to the noun "run"
      expect(await draw(0.5)).toBe(ids.runNoun);
      // the highest pivot has no match after it: the last match before it
      expect(await draw(0.999)).toBe(ids.runNoun);
    });

    it('answers 404 when nothing matches', async () => {
      const res = await request(server()).get('/api/v1/random?word_level=A2').expect(404);
      expectPublicError(res.body, 404, 'word_doesnt_found');
      const bad = await request(server()).get('/api/v1/random?part_of_speech=nope').expect(400);
      expectPublicError(bad.body, 400);
    });
  });

  // ---------------------------------------------------------------- meta

  describe('GET /api/v1/meta', () => {
    it('reports the versions, the data license and the counts', async () => {
      const res = await request(server()).get('/api/v1/meta').expect(200);
      expect(res.headers['x-api-version']).toBe('1');
      const { data } = res.body as PublicMetaV1ResT;
      expect(data).toEqual({
        api_version: '1',
        app_version: expect.stringMatching(/^\d+\.\d+\.\d+/),
        dataset_version: null,
        license: 'CC-BY-4.0',
        license_url: 'https://creativecommons.org/licenses/by/4.0/',
        attribution: expect.stringContaining('CC BY 4.0'),
        notice: expect.stringContaining('language models'),
        // issue #527: the dataset the instance serves and where its data comes from
        dataset: 'default',
        source: 'vocab-bloom-hub',
        attribution_url: 'https://huggingface.co/datasets/Fristail27/vocab-bloom-hub-en',
        // issue #531: a license named by its link has no notice to carry in full
        license_text: '',
        // …and every headword of this suite was added on the instance: sprint, run, abandon, put up with
        modified_entries: 4,
        counts: {
          // headwords: sprint, run, ran, running, abandon, put up with
          entries: 6,
          // base forms that are not phrases or grammar patterns: sprint, run ×2, abandon
          words: 4,
          phrases: 1,
          grammar_patterns: 0,
          word_forms: 2,
          meanings: 6,
          meaning_translations: 3,
          short_translations: 2,
        },
        // issue #394: the language dimension of the instance; #410 added Spanish
        available_languages: { source: ['en'], translations: ['ru', 'es', 'fr', 'de', 'pt', 'zh', 'ar'] },
      });
    });

    it('reports the dataset version recorded by the last import', async () => {
      await request(server())
        .post('/api/settings/add')
        .set(auth)
        .send({ field: 'en_dataset_version', value: '2026.08.1' })
        .expect(201);
      const res = await request(server()).get('/api/v1/meta').expect(200);
      expect((res.body as PublicMetaV1ResT).data.dataset_version).toBe('2026.08.1');
    });
  });

  // -------------------------------------------------------------- prefix

  it('shares the prefix rate limit and the surface switch with the search routes', async () => {
    process.env.PUBLIC_API_RATE_LIMIT = '2/60';
    const ip = { 'X-Forwarded-For': '203.0.113.72' };
    await request(server()).get('/api/v1/words/run').set(ip).expect(200);
    await request(server()).get('/api/v1/meta').set(ip).expect(200);
    const limited = await request(server()).get('/api/v1/random').set(ip).expect(429);
    expectPublicError(limited.body, 429, 'too_many_requests');
    delete process.env.PUBLIC_API_RATE_LIMIT;

    process.env.PUBLIC_API_ENABLED = 'false';
    const hidden = await request(server()).get('/api/v1/words/run').expect(404);
    expectPublicError(hidden.body, 404);
    // the admin read of the same entry is untouched
    const admin = await request(server()).get(`/api/en/${ids.runVerb}`).set(auth).expect(200);
    expect((admin.body as EnWordT).word).toBe('run');
  });
});
