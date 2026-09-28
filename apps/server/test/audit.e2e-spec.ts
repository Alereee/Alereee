import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/modules/AppModule/app.module';
import { createJwt } from '../core/utils/auth';
import { hashLoginString } from '../core/utils/crypto';
import {
  AuditActionE,
  AuditEntityTypeE,
  AuditListT,
  AuditTriggerE,
  AvailableTranslationLanguagesE,
  ChangeListT,
  EnAreaVariantsE,
  EnPartOfSpeechE,
  EnWordFormsE,
} from '../types';

const E2E_USERNAME = 'e2e-admin';
const E2E_PASSWORD = 'e2e-password';

const addWordBody = (word: string) => ({
  word,
  part_of_speech: EnPartOfSpeechE.verb,
  form_of_word: EnWordFormsE.base_form,
  description: `to ${word}`,
  forms: [],
  meanings: [
    {
      title: `${word} meaning`,
      definition: `definition of ${word}`,
      is_obsolete: false,
      sort_order: 1,
      examples: [],
      area_variant: EnAreaVariantsE.common,
      translations: [
        {
          language: AvailableTranslationLanguagesE.ru,
          title: 'перевод',
          definition: 'перевод',
          variants_of_words: ['перевод'],
        },
      ],
    },
  ],
  short_translations: [],
});

/**
 * The audit journal of issue #334: what was done on the instance — settings,
 * imports, switches of the dataset, verdicts on reports, the decision to let
 * an update replace an entry — one row each; the listing is admin-only and
 * filterable. The edits of the dictionary are not in it (issue #531): they
 * are the history of the dataset, which is a part of the data. The journal
 * is operational: nothing of it appears on the public surface.
 */
describe('Audit log (e2e, issue #334)', () => {
  let app: INestApplication<App>;
  let wordId: number;
  const auth = { Authorization: '' };
  const server = () => app.getHttpServer();

  const audit = async (query = ''): Promise<AuditListT> => {
    const res = await request(server()).get(`/api/en/audit${query}`).set(auth).expect(200);
    return res.body as AuditListT;
  };

  beforeAll(async () => {
    process.env.ADMIN_USERNAME = E2E_USERNAME;
    process.env.ADMIN_PASSWORD = E2E_PASSWORD;
    const hashByEnv = await hashLoginString(E2E_USERNAME, E2E_PASSWORD);
    const secretHash = await hashLoginString(E2E_USERNAME, hashByEnv);
    auth.Authorization = `Bearer ${createJwt({ role: 'admin' }, secretHash + hashByEnv)}`;

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('requires the admin token', async () => {
    await request(server()).get('/api/en/audit').expect(401);
  });

  it('starts empty', async () => {
    const list = await audit();
    expect(list).toEqual({ items: [], total: 0, page: 1, limit: 50, has_more: false });
  });

  it('leaves the edits of the dictionary to the history of the dataset: one journal for one thing', async () => {
    const res = await request(server()).post('/api/en/add/word').set(auth).send(addWordBody('run')).expect(201);
    wordId = res.body.id;
    await request(server())
      .patch(`/api/en/common-info/${wordId}`)
      .set(auth)
      .send({ word_level: 'B2', transcription: 'rʌn' })
      .expect(200);
    const meaning = await request(server())
      .post('/api/en/word/meaning')
      .set(auth)
      .send({
        word_id: wordId,
        title: 'second meaning',
        definition: 'another definition',
        is_obsolete: false,
        sort_order: 2,
        examples: [],
        area_variant: EnAreaVariantsE.common,
        translations: [],
      })
      .expect(201);
    await request(server()).delete(`/api/en/word/meaning/${meaning.body.id}`).set(auth).expect(200);

    expect((await audit()).total).toBe(0);

    const history = await request(server()).get('/api/en/changes').set(auth).expect(200);
    expect(
      (history.body as ChangeListT).items.map((change) => [change.entity, change.action, change.headword]),
    ).toEqual([
      ['meaning', 'delete', 'run'],
      ['meaning', 'create', 'run'],
      ['word', 'update', 'run'],
      ['word', 'create', 'run'],
    ]);
  });

  it('records the decision to let an update replace an entry, under its headword', async () => {
    await request(server()).patch('/api/en/reset-user-modified/run').set(auth).expect(200);

    const list = await audit();
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({
      action: AuditActionE.update,
      entity_type: AuditEntityTypeE.word,
      headword: 'run',
      trigger: AuditTriggerE.admin,
      diff: { user_modified: { before: true, after: false } },
    });
    expect(typeof list.items[0].created_at).toBe('string');
  });

  it('records settings changes under their field name', async () => {
    await request(server())
      .post('/api/settings/add')
      .set(auth)
      .send({ field: 'e2e_field', value: 'one' })
      .expect(201);
    await request(server())
      .patch('/api/settings/update')
      .set(auth)
      .send({ field: 'e2e_field', value: 'two' })
      .expect(200);

    const rows = (await audit(`?entity_type=${AuditEntityTypeE.setting}`)).items;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      action: AuditActionE.update,
      headword: 'e2e_field',
      diff: { value: { before: 'one', after: 'two' } },
    });
  });

  it('filters by action, entity type and headword prefix; pages newest first', async () => {
    const all = await audit('?limit=2&page=1');
    expect(all.items).toHaveLength(2);
    expect(all.has_more).toBe(true);
    expect(Date.parse(all.items[0].created_at)).toBeGreaterThanOrEqual(Date.parse(all.items[1].created_at));

    const words = await audit(`?entity_type=${AuditEntityTypeE.word}&search=ru`);
    expect(words.items.map((r) => [r.entity_type, r.headword])).toEqual([[AuditEntityTypeE.word, 'run']]);

    const created = await audit(`?action=${AuditActionE.create}&entity_type=${AuditEntityTypeE.setting}`);
    expect(created.items).toHaveLength(1);
    expect((await audit(`?action=${AuditActionE.delete}`)).items).toEqual([]);
  });

  it('stays off the public surface: the prefix is admin API', async () => {
    // with the admin API disabled the route does not exist (docs/api.md)
    expect((await audit()).total).toBeGreaterThan(0);
  });
});
