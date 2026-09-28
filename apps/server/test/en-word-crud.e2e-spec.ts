import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { typeOrmRoot } from '../src/db/typeorm-root';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import configuration from '../configuration';
import request from 'supertest';
import { App } from 'supertest/types';

import { EnModule } from '../src/modules/EnModule/en.module';
import { EnSearchService } from '../src/modules/EnModule/modules/EnSearch/enSearch.service';
import { hashLoginString } from '../core/utils/crypto';
import { createJwt } from '../core/utils/auth';
import { AvailableTranslationLanguagesE, EnAreaVariantsE, EnPartOfSpeechE, EnWordFormsE } from '../types';

const E2E_USERNAME = 'e2e-admin';
const E2E_PASSWORD = 'e2e-password';

const makeAddWordBody = () => ({
  word: 'run',
  part_of_speech: EnPartOfSpeechE.verb,
  form_of_word: EnWordFormsE.base_form,
  description: 'to move fast on foot',
  forms: [
    {
      word: 'ran',
      form_of_word: EnWordFormsE.past_simple,
      area_variant: EnAreaVariantsE.common,
      transcription: 'ræn',
    },
  ],
  meanings: [
    {
      title: 'to move fast',
      definition: 'to move fast on foot',
      is_obsolete: false,
      sort_order: 1,
      examples: ['I run every morning'],
      area_variant: EnAreaVariantsE.common,
      translations: [
        {
          language: AvailableTranslationLanguagesE.ru,
          title: 'бежать',
          definition: 'быстро перемещаться',
          variants_of_words: ['бежать'],
        },
      ],
    },
  ],
  short_translations: [
    {
      language: AvailableTranslationLanguagesE.ru,
      description: 'бежать',
      variants_of_words: ['бежать'],
    },
  ],
});

describe('En word add/edit routes (e2e, issue #87)', () => {
  let app: INestApplication<App>;
  let token: string;
  let wordId: number;
  let meaningId: number;

  const server = () => app.getHttpServer();
  const auth = { Authorization: '' };

  beforeAll(async () => {
    // AdminGuard derives the JWT secret from these on every request
    process.env.ADMIN_USERNAME = E2E_USERNAME;
    process.env.ADMIN_PASSWORD = E2E_PASSWORD;

    const hashByEnv = await hashLoginString(E2E_USERNAME, E2E_PASSWORD);
    const secretHash = await hashLoginString(E2E_USERNAME, hashByEnv);
    token = createJwt({ role: 'admin' }, secretHash + hashByEnv);
    auth.Authorization = `Bearer ${token}`;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        // SettingsService (pulled in through EnModule) depends on the global ConfigService
        ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
        ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 100 }] }),
        TypeOrmModule.forRootAsync(typeOrmRoot),
        EnModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Same options as the global pipe in main.ts
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('auth', () => {
    it('rejects add/edit requests without a token', async () => {
      await request(server()).post('/api/en/add/word').send(makeAddWordBody()).expect(401);
      await request(server()).patch('/api/en/common-info/1').send({ description: 'x' }).expect(401);
      await request(server()).post('/api/en/word/meaning').send({}).expect(401);
    });

    it('rejects a token signed with a wrong secret', async () => {
      const forged = createJwt({ role: 'admin' }, 'not-the-real-secret');

      await request(server())
        .post('/api/en/add/word')
        .set('Authorization', `Bearer ${forged}`)
        .send(makeAddWordBody())
        .expect(401);
    });
  });

  describe('adding a word', () => {
    it('creates the word with forms, meanings and translations through the HTTP layer', async () => {
      await request(server()).post('/api/en/add/word').set(auth).send(makeAddWordBody()).expect(201);

      const checkRes = await request(server())
        .get('/api/en/check-word/run')
        .set(auth)
        .query({ partOfSpeech: EnPartOfSpeechE.verb })
        .expect(200);
      expect(checkRes.body.hasWord).toBe(true);
      wordId = checkRes.body.id;

      const wordRes = await request(server()).get(`/api/en/${wordId}`).set(auth).expect(200);
      expect(wordRes.body.word).toBe('run');
      expect(wordRes.body.forms).toEqual([expect.objectContaining({ word: 'ran' })]);
      expect(wordRes.body.meanings).toEqual([
        expect.objectContaining({
          title: 'to move fast',
          translations: [expect.objectContaining({ title: 'бежать' })],
        }),
      ]);
      expect(wordRes.body.short_translations).toEqual([expect.objectContaining({ description: 'бежать' })]);
      meaningId = wordRes.body.meanings[0].id;
    });

    it('rejects a body with an unknown field via the global pipe (forbidNonWhitelisted)', async () => {
      await request(server())
        .post('/api/en/add/word')
        .set(auth)
        .send({ ...makeAddWordBody(), word: 'walk', hacker_field: 'oops' })
        .expect(400);
    });

    it('rejects a malformed nested meaning via the global pipe', async () => {
      const body = makeAddWordBody();
      body.word = 'walk';
      (body.meanings[0] as Record<string, unknown>).sort_order = 'first';

      await request(server()).post('/api/en/add/word').set(auth).send(body).expect(400);
    });

    it('responds with 409 for a duplicate word', async () => {
      await request(server()).post('/api/en/add/word').set(auth).send(makeAddWordBody()).expect(409);
    });
  });

  describe('editing a word', () => {
    it('updates the common info through PATCH /api/en/common-info/:id', async () => {
      await request(server())
        .patch(`/api/en/common-info/${wordId}`)
        .set(auth)
        .send({ description: 'updated description', verb___is_irregular: true })
        .expect(200)
        .expect({ success: true });

      const wordRes = await request(server()).get(`/api/en/${wordId}`).set(auth).expect(200);
      expect(wordRes.body.description).toBe('updated description');
      expect(wordRes.body.verb___is_irregular).toBe(true);
    });

    it('rejects unknown fields on the edit endpoint', async () => {
      await request(server())
        .patch(`/api/en/common-info/${wordId}`)
        .set(auth)
        .send({ hacker_field: 'oops' })
        .expect(400);
    });

    it('rejects a non-numeric id as 400 instead of a driver error (issue #345)', async () => {
      await request(server()).get('/api/en/abc').set(auth).expect(400);
      await request(server()).patch('/api/en/common-info/abc').set(auth).send({ description: 'x' }).expect(400);
      await request(server()).delete('/api/en/abc').set(auth).expect(400);
    });

    it('edits a word form through PATCH /api/en/word-form', async () => {
      const wordRes = await request(server()).get(`/api/en/${wordId}`).set(auth).expect(200);
      const formId = wordRes.body.forms[0].id;

      await request(server())
        .patch('/api/en/word-form')
        .set(auth)
        .send({ id: formId, transcription: 'ræn (updated)' })
        .expect(200)
        .expect({ success: true });

      const updated = await request(server()).get(`/api/en/${wordId}`).set(auth).expect(200);
      expect(updated.body.forms[0].transcription).toBe('ræn (updated)');
    });
  });

  describe('meaning sub-resource', () => {
    it('adds a meaning through POST /api/en/word/meaning', async () => {
      const res = await request(server())
        .post('/api/en/word/meaning')
        .set(auth)
        .send({
          word_id: wordId,
          title: 'to manage',
          definition: 'to operate or be in charge',
          is_obsolete: false,
          sort_order: 2,
          examples: ['she runs a bakery'],
          area_variant: EnAreaVariantsE.common,
          meaning_level: null,
          language_register: null,
          categories: [],
          translations: [],
        })
        .expect(201);

      expect(res.body).toEqual({ success: true, id: expect.any(Number) });
    });

    it('edits a meaning through PATCH /api/en/word/meaning', async () => {
      await request(server())
        .patch('/api/en/word/meaning')
        .set(auth)
        .send({ id: meaningId, title: 'to sprint' })
        .expect(200)
        .expect({ success: true });

      const wordRes = await request(server()).get(`/api/en/${wordId}`).set(auth).expect(200);
      const titles = (wordRes.body.meanings as Array<{ title: string }>).map((m) => m.title);
      expect(titles).toContain('to sprint');
    });

    it('links synonyms to existing words and rejects unknown ones (issue #259)', async () => {
      // "teleport" is not in the dictionary; "ran" exists only as a form of "run"
      for (const synonym of ['teleport', 'ran']) {
        await request(server())
          .patch('/api/en/word/meaning')
          .set(auth)
          .send({ id: meaningId, synonyms: [synonym] })
          .expect(400)
          .expect((res) => expect(res.body.message).toBe('synonym_doesnt_exist'));
      }

      await request(server())
        .post('/api/en/add/word')
        .set(auth)
        .send({ word: 'sprint', part_of_speech: EnPartOfSpeechE.verb, form_of_word: EnWordFormsE.base_form })
        .expect(201);

      await request(server())
        .patch('/api/en/word/meaning')
        .set(auth)
        .send({ id: meaningId, synonyms: [' Sprint ', 'run'] })
        .expect(200)
        .expect({ success: true });

      const wordRes = await request(server()).get(`/api/en/${wordId}`).set(auth).expect(200);
      const meaning = (wordRes.body.meanings as Array<{ id: number; synonyms: string[] }>).find(
        (m) => m.id === meaningId,
      );
      // normalized, without the headword itself
      expect(meaning?.synonyms).toEqual(['sprint']);

      // the detailed search (served publicly by /api/v1/search/detailed, outside
      // this EnModule-only fixture) joins the normalized synonyms too
      const searchRes = await app.get(EnSearchService).searchDetailed({ search: 'run', with_meanings: true });
      const found = searchRes.items.find((w) => w.id === wordId);
      expect(found?.meanings.map((m) => m.synonyms)).toContainEqual(['sprint']);
    });

    it('links antonyms like synonyms and rejects a word listed as both (issue #266)', async () => {
      await request(server())
        .patch('/api/en/word/meaning')
        .set(auth)
        .send({ id: meaningId, antonyms: ['teleport'] })
        .expect(400)
        .expect((res) => expect(res.body.message).toBe('antonym_doesnt_exist'));

      await request(server())
        .post('/api/en/add/word')
        .set(auth)
        .send({ word: 'walk', part_of_speech: EnPartOfSpeechE.verb, form_of_word: EnWordFormsE.base_form })
        .expect(201);

      // "sprint" is already a synonym of this meaning (previous test)
      await request(server())
        .patch('/api/en/word/meaning')
        .set(auth)
        .send({ id: meaningId, antonyms: ['sprint'] })
        .expect(400)
        .expect((res) => expect(res.body.message).toBe('synonym_antonym_conflict'));

      await request(server())
        .patch('/api/en/word/meaning')
        .set(auth)
        .send({ id: meaningId, antonyms: [' Walk ', 'run'] })
        .expect(200)
        .expect({ success: true });

      const wordRes = await request(server()).get(`/api/en/${wordId}`).set(auth).expect(200);
      const meaning = (
        wordRes.body.meanings as Array<{ id: number; synonyms: string[]; antonyms: string[] }>
      ).find((m) => m.id === meaningId);
      expect(meaning?.synonyms).toEqual(['sprint']);
      expect(meaning?.antonyms).toEqual(['walk']);

      const listRes = await request(server())
        .get('/api/en/meanings')
        .set(auth)
        .query({ search: 'run' })
        .expect(200);
      const listed = (listRes.body.items as Array<{ id: number; antonyms: string[] }>).find(
        (m) => m.id === meaningId,
      );
      expect(listed?.antonyms).toEqual(['walk']);
    });

    it('deletes a meaning through DELETE /api/en/word/meaning/:id', async () => {
      await request(server()).delete(`/api/en/word/meaning/${meaningId}`).set(auth).expect(200);

      const wordRes = await request(server()).get(`/api/en/${wordId}`).set(auth).expect(200);
      const ids = (wordRes.body.meanings as Array<{ id: number }>).map((m) => m.id);
      expect(ids).not.toContain(meaningId);
    });
  });

  describe('short translation sub-resource', () => {
    it('adds and edits a short translation through the HTTP layer', async () => {
      const addRes = await request(server())
        .post('/api/en/word/short-translation')
        .set(auth)
        .send({
          word_id: wordId,
          language: AvailableTranslationLanguagesE.ru,
          description: 'управлять',
          variant_of_words: ['управлять'],
        })
        .expect(201);
      const shortTranslationId = addRes.body.id as number;

      await request(server())
        .patch('/api/en/word/short-translation')
        .set(auth)
        .send({ id: shortTranslationId, description: 'руководить' })
        .expect(200)
        .expect({ success: true });

      const wordRes = await request(server()).get(`/api/en/${wordId}`).set(auth).expect(200);
      const descriptions = (wordRes.body.short_translations as Array<{ description: string }>).map(
        (s) => s.description,
      );
      expect(descriptions).toContain('руководить');
    });
  });

  describe('deleting a word', () => {
    it('removes the word through DELETE /api/en/:id', async () => {
      await request(server()).delete(`/api/en/${wordId}`).set(auth).expect(200).expect({ success: true });

      await request(server()).get(`/api/en/${wordId}`).set(auth).expect(404);
    });
  });

  describe('user-modified flag (issue #328)', () => {
    let flagWordId: number;
    let flagFormId: number;

    const getWord = async () => {
      const res = await request(server()).get(`/api/en/${flagWordId}`).set(auth).expect(200);
      return res.body as { user_modified: boolean; forms: Array<{ id: number }>; meanings: Array<unknown> };
    };
    const resetFlag = (word: string) =>
      request(server())
        .patch(`/api/en/reset-user-modified/${encodeURIComponent(word)}`)
        .set(auth);

    it('marks an admin-created word from the start', async () => {
      const addRes = await request(server())
        .post('/api/en/add/word')
        .set(auth)
        .send({ ...makeAddWordBody(), word: 'swim', forms: [] })
        .expect(201);
      flagWordId = addRes.body.id as number;

      expect((await getWord()).user_modified).toBe(true);
    });

    it('clears the flag through PATCH /api/en/reset-user-modified/:word', async () => {
      await resetFlag('swim').expect(200).expect({ success: true });
      expect((await getWord()).user_modified).toBe(false);
    });

    it('404s when resetting a missing entry', async () => {
      await resetFlag('no-such-entry').expect(404);
    });

    it('flags the entry again on a common-info edit', async () => {
      await request(server())
        .patch(`/api/en/common-info/${flagWordId}`)
        .set(auth)
        .send({ description: 'to move through water' })
        .expect(200);
      expect((await getWord()).user_modified).toBe(true);
    });

    it('flags the entry on a meaning mutation', async () => {
      await resetFlag('swim').expect(200);
      await request(server())
        .post('/api/en/word/meaning')
        .set(auth)
        .send({
          word_id: flagWordId,
          title: 'to swim',
          definition: 'to move through water',
          is_obsolete: false,
          sort_order: 2,
          examples: [],
          area_variant: EnAreaVariantsE.common,
          translations: [],
        })
        .expect(201);
      expect((await getWord()).user_modified).toBe(true);
    });

    it('flags the base entry when a form is added or edited', async () => {
      await resetFlag('swim').expect(200);
      const addFormRes = await request(server())
        .post('/api/en/word-form')
        .set(auth)
        .send({
          word: 'swam',
          form_of_word: EnWordFormsE.past_simple,
          area_variant: EnAreaVariantsE.common,
          transcription: 'swæm',
          base_word_id: flagWordId,
        })
        .expect(201);
      flagFormId = addFormRes.body.id as number;
      // the flag lands on the base word's entry, not on the form's own entry
      expect((await getWord()).user_modified).toBe(true);

      await resetFlag('swim').expect(200);
      // a form saved as it was changes nothing: the entry still follows its dataset (issue #531)
      await request(server())
        .patch('/api/en/word-form')
        .set(auth)
        .send({ id: flagFormId, transcription: 'swæm' })
        .expect(200);
      expect((await getWord()).user_modified).toBe(false);

      await request(server())
        .patch('/api/en/word-form')
        .set(auth)
        .send({ id: flagFormId, transcription: 'swam' })
        .expect(200);
      expect((await getWord()).user_modified).toBe(true);
    });

    it('flags the base entry when a form row is deleted', async () => {
      await resetFlag('swim').expect(200);
      await request(server()).delete(`/api/en/${flagFormId}`).set(auth).expect(200);
      expect((await getWord()).user_modified).toBe(true);
    });
  });
});
