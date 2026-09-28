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
import { hashLoginString } from '../core/utils/crypto';
import { createJwt } from '../core/utils/auth';
import {
  AvailableTranslationLanguagesE,
  EnAreaVariantsE,
  EnMeaningsListT,
  EnMeaningTranslationsListT,
  EnPartOfSpeechE,
  EnShortTranslationsListT,
  EnWordFormsE,
  EnWordsListT,
} from '../types';

const E2E_USERNAME = 'e2e-admin';
const E2E_PASSWORD = 'e2e-password';

const makeMeaning = (title: string, translated: boolean) => ({
  title,
  definition: `definition of ${title}`,
  is_obsolete: false,
  sort_order: 0,
  examples: [],
  area_variant: EnAreaVariantsE.common,
  translations: translated
    ? [
        {
          language: AvailableTranslationLanguagesE.ru,
          title: `${title}-ru`,
          definition: 'ru',
          variants_of_words: [],
        },
      ]
    : [],
});

const makeWord = (
  word: string,
  part_of_speech: EnPartOfSpeechE,
  meanings: ReturnType<typeof makeMeaning>[] = [],
  short_translations: string[] = [],
) => ({
  word,
  part_of_speech,
  form_of_word: EnWordFormsE.base_form,
  generated: part_of_speech === EnPartOfSpeechE.verb,
  forms: [],
  meanings,
  short_translations: short_translations.map((description) => ({
    language: AvailableTranslationLanguagesE.ru,
    description,
    variants_of_words: [],
  })),
});

describe('admin listings GET /api/en/words, /meanings, /meaning-translations, /short-translations (e2e, issues #249, #411)', () => {
  let app: INestApplication<App>;
  const auth = { Authorization: '' };
  const server = () => app.getHttpServer();

  beforeAll(async () => {
    process.env.ADMIN_USERNAME = E2E_USERNAME;
    process.env.ADMIN_PASSWORD = E2E_PASSWORD;
    const hashByEnv = await hashLoginString(E2E_USERNAME, E2E_PASSWORD);
    const secretHash = await hashLoginString(E2E_USERNAME, hashByEnv);
    auth.Authorization = `Bearer ${createJwt({ role: 'admin' }, secretHash + hashByEnv)}`;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
        ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 100 }] }),
        TypeOrmModule.forRootAsync(typeOrmRoot),
        EnModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    await request(server())
      .post('/api/en/add/word')
      .set(auth)
      .send(
        makeWord(
          'run',
          EnPartOfSpeechE.verb,
          [makeMeaning('move fast', true), makeMeaning('manage', false)],
          ['бежать'],
        ),
      )
      .expect(201);
    await request(server())
      .post('/api/en/add/word')
      .set(auth)
      .send(makeWord('run', EnPartOfSpeechE.noun))
      .expect(201);
    await request(server())
      .post('/api/en/add/word')
      .set(auth)
      .send(makeWord('abandon', EnPartOfSpeechE.verb))
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('is admin-only', async () => {
    await request(server()).get('/api/en/words').expect(401);
  });

  // EnController serves GET /api/en/:id; the listing controller must win the route match
  it('is served by the listing controller, not by GET /api/en/:id', async () => {
    const res = await request(server()).get('/api/en/words').set(auth).expect(200);
    const body = res.body as EnWordsListT;

    expect(body.items.map((i) => `${i.word}:${i.part_of_speech}`)).toEqual([
      'abandon:verb',
      'run:noun',
      'run:verb',
    ]);
    expect(body).toMatchObject({ page: 1, limit: 50, total: 3, has_more: false });
  });

  it('parses repeated enum keys, boolean strings and pagination from the query string', async () => {
    const res = await request(server())
      .get('/api/en/words')
      .set(auth)
      .query('part_of_speech=verb&part_of_speech=noun&generated=true&search=ru&page=1&limit=1')
      .expect(200);
    const body = res.body as EnWordsListT;

    expect(body.items.map((i) => `${i.word}:${i.part_of_speech}`)).toEqual(['run:verb']);
    expect(body).toMatchObject({ page: 1, limit: 1, total: 1, has_more: false });
  });

  it('walks the rows after an id in id order and answers next_after, with the page number ignored', async () => {
    const all = (await request(server()).get('/api/en/words').set(auth).query({ limit: 200 }).expect(200))
      .body as EnWordsListT;
    const ids = all.items.map((i) => i.id).sort((a, b) => a - b);
    expect(ids.length).toBeGreaterThan(1);

    const first = (
      await request(server()).get('/api/en/words').set(auth).query({ limit: 1, after: 0, page: 7 }).expect(200)
    ).body as EnWordsListT;
    expect(first).toMatchObject({ page: 1, limit: 1, total: all.total, has_more: true, next_after: ids[0] });
    expect(first.items.map((i) => i.id)).toEqual([ids[0]]);

    const next = (
      await request(server())
        .get('/api/en/words')
        .set(auth)
        .query({ limit: 1, after: first.next_after })
        .expect(200)
    ).body as EnWordsListT;
    expect(next.items.map((i) => i.id)).toEqual([ids[1]]);

    const past = (
      await request(server()).get('/api/en/words').set(auth).query({ limit: 1, after: 999999 }).expect(200)
    ).body as EnWordsListT;
    expect(past).toMatchObject({ items: [], has_more: false, next_after: null });
    await request(server()).get('/api/en/words').set(auth).query({ after: -1 }).expect(400);
  });

  it('rejects unknown query keys and invalid values', async () => {
    await request(server()).get('/api/en/words').set(auth).query({ sort: 'word' }).expect(400);
    await request(server()).get('/api/en/words').set(auth).query({ generated: 'maybe' }).expect(400);
    await request(server()).get('/api/en/words').set(auth).query({ limit: 500 }).expect(400);
  });

  it('lists meanings with their word, admin-only and not swallowed by GET /api/en/:id', async () => {
    await request(server()).get('/api/en/meanings').expect(401);

    const res = await request(server())
      .get('/api/en/meanings')
      .set(auth)
      .query('part_of_speech=verb&has_translations=true')
      .expect(200);
    const body = res.body as EnMeaningsListT;

    expect(body.items.map((i) => `${i.word}:${i.part_of_speech}:${i.title}`)).toEqual(['run:verb:move fast']);
    expect(body.items[0]).toMatchObject({ definition: 'definition of move fast', translations_count: 1 });
    expect(body).toMatchObject({ page: 1, limit: 50, total: 1, has_more: false });

    await request(server()).get('/api/en/meanings').set(auth).query({ generated: 'true' }).expect(400);
  });

  it('lists meaning translations with their meaning and word, admin-only and not swallowed by GET /api/en/:id', async () => {
    await request(server()).get('/api/en/meaning-translations').expect(401);

    const res = await request(server())
      .get('/api/en/meaning-translations')
      .set(auth)
      .query('language=ru&search=ru')
      .expect(200);
    const body = res.body as EnMeaningTranslationsListT;

    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      word: 'run',
      part_of_speech: 'verb',
      meaning_title: 'move fast',
      language: 'ru',
      title: 'move fast-ru',
    });
    expect(body).toMatchObject({ total: 1, has_more: false });

    await request(server()).get('/api/en/meaning-translations').set(auth).query({ language: 'xx' }).expect(400);
  });

  it('lists short translations with their word, admin-only and not swallowed by GET /api/en/:id', async () => {
    await request(server()).get('/api/en/short-translations').expect(401);

    const res = await request(server())
      .get('/api/en/short-translations')
      .set(auth)
      .query('language=ru&search=ru')
      .expect(200);
    const body = res.body as EnShortTranslationsListT;

    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      word: 'run',
      part_of_speech: 'verb',
      language: 'ru',
      description: 'бежать',
      variants_of_words: [],
    });
    expect(body).toMatchObject({ total: 1, has_more: false });

    await request(server()).get('/api/en/short-translations').set(auth).query({ language: 'xx' }).expect(400);
    await request(server())
      .get('/api/en/short-translations')
      .set(auth)
      .query({ has_meanings: 'true' })
      .expect(400);
  });
});
