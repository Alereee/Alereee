import { INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/modules/AppModule/app.module';
import { AllExceptionsFilter } from '../src/core/filters/all-exceptions.filter';
import { createJwt } from '../core/utils/auth';
import { hashLoginString } from '../core/utils/crypto';
import {
  EnAreaVariantsE,
  EnPartOfSpeechE,
  EnWordFormsE,
  PublicHeadwordHistoryV1ResT,
  PublicHeadwordV1ResT,
  PublicMetaV1ResT,
  PublicWordDatasetsV1ResT,
} from '../types';

const E2E_USERNAME = 'e2e-admin';
const E2E_PASSWORD = 'e2e-password';

/**
 * A headword read from every dataset of the instance (issue #528), on an
 * instance that holds the default dataset only — every instance on SQLite,
 * and one on Postgres before a second dataset is installed: one group, and
 * in it what the headword read of the served dataset answers. Several
 * datasets are the matter of `datasets.pg-spec.ts`.
 */
describe('a headword from every dataset (e2e, issue #528)', () => {
  let app: INestApplication<App>;
  const auth = { Authorization: '' };
  const server = () => app.getHttpServer();
  const ids: Record<string, number> = {};

  const add = async (word: string, part_of_speech: EnPartOfSpeechE, description: string) => {
    const res = await request(server())
      .post('/api/en/add/word')
      .set(auth)
      .send({
        word,
        part_of_speech,
        form_of_word: EnWordFormsE.base_form,
        description,
        forms:
          part_of_speech === EnPartOfSpeechE.verb
            ? [
                {
                  word: `${word}ed`,
                  form_of_word: EnWordFormsE.past_simple,
                  area_variant: EnAreaVariantsE.common,
                },
              ]
            : [],
        meanings: [
          {
            title: description,
            definition: `${description}.`,
            is_obsolete: false,
            sort_order: 1,
            examples: [],
            area_variant: EnAreaVariantsE.common,
            translations: [],
          },
        ],
        short_translations: [],
      })
      .expect(201);
    ids[`${word} ${part_of_speech}`] = res.body.id as number;
  };

  const read = async (spelling: string) =>
    (
      await request(server())
        .get(`/api/v1/words/${encodeURIComponent(spelling)}/datasets`)
        .expect(200)
    ).body as PublicWordDatasetsV1ResT;

  beforeAll(async () => {
    process.env.ADMIN_USERNAME = E2E_USERNAME;
    process.env.ADMIN_PASSWORD = E2E_PASSWORD;
    const hashByEnv = await hashLoginString(E2E_USERNAME, E2E_PASSWORD);
    const secretHash = await hashLoginString(E2E_USERNAME, hashByEnv);
    auth.Authorization = `Bearer ${createJwt({ role: 'admin' }, secretHash + hashByEnv)}`;

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost).httpAdapter));
    await app.init();

    await add('amber', EnPartOfSpeechE.noun, 'a fossil resin');
    await add('amber', EnPartOfSpeechE.verb, 'to make the colour of amber');
    await add('Amber', EnPartOfSpeechE.noun, 'a given name');
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers one group for the one dataset, under the terms `/meta` states', async () => {
    const { data, meta } = await read('amber');
    expect(meta).toEqual({ word: 'amber', datasets: 1, found: 1 });
    expect(data).toHaveLength(1);

    const served = ((await request(server()).get('/api/v1/meta').expect(200)).body as PublicMetaV1ResT).data;
    const { entries, word, variants, count, ...terms } = data[0];
    expect(terms).toEqual({
      dataset: 'default',
      active: true,
      source: served.source,
      dataset_version: served.dataset_version,
      license: served.license,
      license_url: served.license_url,
      attribution: served.attribution,
      attribution_url: served.attribution_url,
      notice: served.notice,
      license_text: served.license_text,
    });
    expect({ word, variants, count }).toEqual({ word: 'amber', variants: ['Amber'], count: 2 });

    // the entries are the ones of the headword read, to the last field
    const headword = (await request(server()).get('/api/v1/words/amber').expect(200))
      .body as PublicHeadwordV1ResT;
    expect(entries).toEqual(headword.data);
    expect(entries.map((entry) => [entry.source, entry.modified])).toEqual([
      ['vocab-bloom-hub', true],
      ['vocab-bloom-hub', true],
    ]);
  });

  it('matches the spelling by the rule of a headword read', async () => {
    const upper = await read('Amber');
    expect(upper.meta).toEqual({ word: 'Amber', datasets: 1, found: 1 });
    expect(upper.data[0]).toEqual(expect.objectContaining({ word: 'Amber', variants: ['amber'], count: 1 }));
    expect(upper.data[0].entries.map((entry) => entry.id)).toEqual([ids['Amber noun']]);

    const shouted = await read('AMBER');
    expect(shouted.meta).toEqual({ word: 'AMBER', datasets: 1, found: 1 });
    expect(shouted.data[0]).toEqual(
      expect.objectContaining({ word: 'amber', variants: ['Amber', 'amber'], count: 3 }),
    );

    // an inflected form names its base entry
    const form = await read('ambered');
    expect(form.data[0].entries.map((entry) => [entry.word, entry.part_of_speech])).toEqual([
      ['amber', 'verb'],
    ]);
  });

  it('answers 404 for a headword no dataset holds, and 400 for one that cannot be a headword', async () => {
    const missing = await request(server()).get('/api/v1/words/no-such-headword/datasets').expect(404);
    expect(missing.body).toEqual(expect.objectContaining({ error: true, message: 'word_doesnt_found' }));
    await request(server())
      .get(`/api/v1/words/${'a'.repeat(129)}/datasets`)
      .expect(400);
  });

  it('reads the history of a headword in a dataset named by its name', async () => {
    await request(server())
      .patch(`/api/en/common-info/${ids['amber noun']}`)
      .set(auth)
      .send({ description: 'a fossil resin, yellow to brown' })
      .expect(200);

    const named = (await request(server()).get('/api/v1/words/amber/datasets/default/history').expect(200))
      .body as PublicHeadwordHistoryV1ResT;
    const served = (await request(server()).get('/api/v1/words/amber/history').expect(200))
      .body as PublicHeadwordHistoryV1ResT;
    expect(named).toEqual(served);
    expect(named.meta).toEqual({ word: 'amber', count: 3, variants: ['Amber'] });
    expect(named.data[0]).toEqual(
      expect.objectContaining({
        word: 'amber',
        part_of_speech: 'noun',
        action: 'update',
        source: 'vocab-bloom-hub',
        diff: { description: { before: 'a fossil resin', after: 'a fossil resin, yellow to brown' } },
      }),
    );
  });

  it('reads the headword "id" like any other: an id is a number, a part of a headword is not', async () => {
    await add('id', EnPartOfSpeechE.noun, 'a part of the mind');

    const groups = (await request(server()).get('/api/v1/words/id/datasets').expect(200))
      .body as PublicWordDatasetsV1ResT;
    expect(groups.data[0]).toEqual(expect.objectContaining({ word: 'id', count: 1 }));
    await request(server()).get('/api/v1/words/id/datasets/default/history').expect(200);
    // the partial reads of the served dataset too
    for (const part of ['meanings', 'forms', 'translations', 'synonyms', 'antonyms', 'history']) {
      await request(server()).get(`/api/v1/words/id/${part}`).expect(200);
    }
    // and an entry is still read by its id
    const byId = await request(server()).get(`/api/v1/words/id/${ids['id noun']}`).expect(200);
    expect(byId.body.data.word).toBe('id');
    await request(server()).get('/api/v1/words/id/not-a-number').expect(400);
  });

  it('refuses a dataset the instance does not hold, and a name no dataset can have', async () => {
    const absent = await request(server()).get('/api/v1/words/amber/datasets/wiktionary/history').expect(404);
    expect(absent.body).toEqual(expect.objectContaining({ error: true, message: 'dataset_not_found' }));
    await request(server()).get('/api/v1/words/amber/datasets/Not%20A%20Name/history').expect(400);
    await request(server()).get('/api/v1/words/no-such-headword/datasets/default/history').expect(404);
  });

  it('carries the caching headers of a public read and answers 304 to its own validator', async () => {
    const first = await request(server()).get('/api/v1/words/amber/datasets').expect(200);
    expect(first.headers.etag).toMatch(/^W\/"[A-Za-z0-9_-]+"$/);
    expect(first.headers['cache-control']).toContain('public');
    expect(Number.isNaN(Date.parse(first.headers['last-modified']))).toBe(false);

    await request(server())
      .get('/api/v1/words/amber/datasets')
      .set('If-None-Match', first.headers.etag)
      .expect(304);
    const history = await request(server()).get('/api/v1/words/amber/datasets/default/history').expect(200);
    expect(history.headers.etag).toMatch(/^W\/"[A-Za-z0-9_-]+"$/);
  });
});
