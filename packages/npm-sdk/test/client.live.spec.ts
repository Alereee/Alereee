import { INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { createJwt } from '../../../apps/server/core/utils/auth';
import { hashLoginString } from '../../../apps/server/core/utils/crypto';
import { AllExceptionsFilter } from '../../../apps/server/src/core/filters/all-exceptions.filter';
import { AppModule } from '../../../apps/server/src/modules/AppModule/app.module';
import { PublicOpenApiService } from '../../../apps/server/src/modules/PublicApiModule/public-openapi.service';
import { NetworkError, NotFoundError, VocabBloomClient, VocabBloomError } from '../src';

/**
 * The client against the real server (issue #275): AppModule on an
 * in-memory SQLite database, listening on an ephemeral port, seeded through
 * the admin API. What the client parses is what the API answers.
 */
describe('VocabBloomClient against the running server (issue #275)', () => {
  let app: INestApplication<App>;
  let client: VocabBloomClient;
  let runId = 0;

  beforeAll(async () => {
    const username = process.env.ADMIN_USERNAME as string;
    const password = process.env.ADMIN_PASSWORD as string;
    const hashByEnv = await hashLoginString(username, password);
    const secretHash = await hashLoginString(username, hashByEnv);
    const auth = { Authorization: `Bearer ${createJwt({ role: 'admin' }, secretHash + hashByEnv)}` };

    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost).httpAdapter));
    await app.listen(0, '127.0.0.1');
    app.get(PublicOpenApiService).attach(app);
    client = new VocabBloomClient({ baseUrl: await app.getUrl(), cache: true });

    const addWord = async (body: object): Promise<number> => {
      const res = await request(app.getHttpServer()).post('/api/en/add/word').set(auth).send(body);
      if (res.status !== 201) throw new Error(`seed failed: ${JSON.stringify(res.body)}`);
      return (res.body as { id: number }).id;
    };
    const meaning = (title: string, extra: object = {}) => ({
      title,
      definition: `definition of ${title}`,
      is_obsolete: false,
      sort_order: 1,
      examples: [],
      area_variant: 'common',
      translations: [],
      ...extra,
    });
    await addWord({
      word: 'sprint',
      part_of_speech: 'verb',
      form_of_word: 'base_form',
      meanings: [meaning('to run fast')],
    });
    runId = await addWord({
      word: 'run',
      part_of_speech: 'verb',
      form_of_word: 'base_form',
      word_level: 'A1',
      forms: [{ word: 'ran', form_of_word: 'past_simple', area_variant: 'common' }],
      meanings: [
        meaning('to move fast', {
          translations: [
            {
              language: 'ru',
              title: 'бежать',
              definition: 'бежать (definition)',
              variants_of_words: ['бежать'],
            },
          ],
          synonyms: ['sprint'],
        }),
      ],
      short_translations: [{ language: 'ru', description: 'бежать', variants_of_words: ['бежать'] }],
    });
    await addWord({
      word: 'abandon',
      part_of_speech: 'verb',
      form_of_word: 'base_form',
      word_level: 'C1',
      meanings: [meaning('to leave')],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('searches, flat and detailed', async () => {
    const flat = await client.search({ search: 'run' });
    expect(flat.meta).toEqual({ count: flat.data.length, fuzzy: false, short_term: false });
    expect(flat.data.map((w) => w.word)).toContain('run');
    expect(flat.data[0]).not.toHaveProperty('meanings');

    const detailed = await client.searchDetailed({
      search: 'run',
      with_meanings: true,
      with_translations: true,
      limit: 5,
    });
    expect(detailed.meta).toMatchObject({ page: 1, limit: 5, fuzzy: false });
    const run = detailed.data.find((w) => w.word === 'run');
    expect(run?.meanings[0]).toMatchObject({ title: 'to move fast', synonyms: ['sprint'] });
    expect(run?.short_translations[0]).toMatchObject({ language: 'ru' });
  });

  it('reads a headword, its parts, and an entry by id', async () => {
    const headword = await client.word('run');
    expect(headword.meta).toEqual({ word: 'run', count: 1, variants: [] });
    expect(headword.data[0].forms.map((f) => f.word)).toEqual(['ran']);

    // an inflected form resolves to its base entry
    expect((await client.word('ran')).data[0].word).toBe('run');

    // the batch lookup answers the same entries per spelling (issue #397)
    const batch = await client.wordsBatch(['ran', 'nope', 'sprint']);
    expect(batch.meta).toEqual({ count: 2, not_found: ['nope'] });
    expect(batch.data.map((item) => [item.word, item.count, item.entries[0].word])).toEqual([
      ['ran', 1, 'run'],
      ['sprint', 1, 'sprint'],
    ]);
    expect(batch.data[0].entries).toEqual(headword.data);

    // the thesaurus reads (issue #403): the fixture links "sprint" as a synonym of "run"
    const synonyms = await client.synonyms('run');
    expect(synonyms.data.map((link) => link.word)).toEqual(['sprint']);
    expect(synonyms.data[0]).toMatchObject({ word_id: runId, part_of_speech: 'verb' });
    expect((await client.antonyms('run')).data).toEqual([]);
    // the list filters of #403: a headword prefix, case-insensitively
    expect((await client.words({ search: 'RU' })).data.map((w) => w.word)).toEqual(['run']);

    const meanings = await client.meanings('run');
    expect(meanings.data[0]).toMatchObject({ title: 'to move fast', word_id: runId, part_of_speech: 'verb' });

    const translations = await client.translations('run', { language: ['ru'] });
    expect(translations.data.short_translations).toHaveLength(1);
    expect(translations.data.meaning_translations[0]).toMatchObject({
      language: 'ru',
      meaning_id: expect.any(Number),
    });

    // the history of edits (issue #531): the fixture words were added on the instance
    const history = await client.history('ran');
    expect(history.meta).toEqual({ word: 'ran', count: 1, variants: [] });
    expect(history.data[0]).toMatchObject({
      part_of_speech: 'verb',
      entity: 'word',
      action: 'create',
      record: null,
      origin: 'admin',
      author: null,
    });
    expect(history.data[0].diff?.word_level).toEqual({ before: null, after: 'A1' });

    const forms = await client.forms('run');
    expect(forms.data).toEqual([
      // a part of an entry carries the mark of the entry (issue #531)
      expect.objectContaining({ word: 'ran', form_of_word: 'past_simple', word_id: runId, modified: true }),
    ]);
    expect((await client.search({ search: 'run' })).data[0]).toMatchObject({
      word: 'run',
      modified: true,
      source: 'vocab-bloom-hub',
    });
    expect(forms.data[0].source).toBe('vocab-bloom-hub');
    expect(history.data[0].source).toBe('vocab-bloom-hub');
    expect((await client.meta()).data.modified_entries).toBe(3);

    expect((await client.wordById(runId)).data.word).toBe('run');
  });

  it('lists with filters and walks the cursor to the end', async () => {
    const page = await client.words({ limit: 2 });
    expect(page.data.map((w) => w.word)).toEqual(['abandon', 'run']);
    expect(page.meta).toMatchObject({ limit: 2, has_more: true, next_cursor: expect.any(String) });
    const rest = await client.words({ limit: 2, cursor: page.meta.next_cursor as string });
    expect(rest.data.map((w) => w.word)).toEqual(['sprint']);

    const all: string[] = [];
    for await (const word of client.iterateWords({ limit: 1, part_of_speech: ['verb'] })) all.push(word.word);
    expect(all).toEqual(['abandon', 'run', 'sprint']);

    const filtered = await client.words({ word_level: ['A1', 'C1'] });
    expect(filtered.data.map((w) => w.word)).toEqual(['abandon', 'run']);
  });

  it('draws a random entry, reads the meta and the OpenAPI document', async () => {
    const random = await client.random({ word_level: ['A1'] });
    expect(random.data.word).toBe('run');

    const meta = await client.meta();
    expect(meta.data).toMatchObject({
      api_version: '1',
      license: 'CC-BY-4.0',
      counts: { words: 3 },
      available_languages: { source: ['en'], translations: ['ru', 'es', 'fr', 'de', 'pt', 'zh', 'ar'] },
    });

    const document = await client.openapi();
    expect(document.openapi).toMatch(/^3\./);
    expect(Object.keys(document.paths as object)).toContain('/api/v1/words/{word}');
  });

  it('files a suggestion into the moderation queue (issue #327)', async () => {
    const report = await client.suggest({
      headword: 'run',
      message: 'The example sentence sounds unnatural — SDK live test.',
    });
    expect(report.data.id).toBeGreaterThan(0);
    expect(report.data.status).toBe('new');
  });

  it('turns API errors into typed exceptions and revalidates through the ETag cache', async () => {
    await expect(client.word('nonexistent')).rejects.toBeInstanceOf(NotFoundError);
    await expect(client.random({ word_level: ['B2'] })).rejects.toMatchObject({
      status: 404,
      code: 'word_doesnt_found',
    });
    await expect(client.words({ cursor: 'garbage' })).rejects.toMatchObject({
      status: 400,
      code: 'invalid_cursor',
    });
    await expect(client.wordById(-1)).rejects.toBeInstanceOf(NotFoundError);
    // a non-numeric id is rejected by the server's ParseIntPipe
    const bad = await client.wordById(Number.NaN).catch((e: unknown) => e);
    expect(bad).toBeInstanceOf(VocabBloomError);
    expect((bad as VocabBloomError).status).toBe(400);

    // the second read of a page goes through If-None-Match → 304 and yields the same body
    const statuses: number[] = [];
    const spying = new VocabBloomClient({
      baseUrl: await app.getUrl(),
      cache: true,
      fetch: async (url, init) => {
        const response = await fetch(url, init);
        statuses.push(response.status);
        return response;
      },
    });
    const first = await spying.words({ limit: 1 });
    const second = await spying.words({ limit: 1 });
    expect(statuses).toEqual([200, 304]);
    expect(second).toEqual(first);
  });

  it('aborts through the signal and reports a dead host as NetworkError', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(client.meta({ signal: controller.signal })).rejects.toBeInstanceOf(NetworkError);

    const dead = new VocabBloomClient({ baseUrl: 'http://127.0.0.1:1' });
    await expect(dead.meta()).rejects.toBeInstanceOf(NetworkError);
  });
});
