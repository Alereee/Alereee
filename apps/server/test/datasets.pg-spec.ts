import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/modules/AppModule/app.module';
import { DatasetsService } from '../src/modules/DatasetsModule/datasets.service';
import { prepareDatabase } from '../src/db/datasets';
import { createJwt } from '../core/utils/auth';
import { hashLoginString } from '../core/utils/crypto';
import { DatasetsListT, EnAreaVariantsE, EnPartOfSpeechE, EnWordFormsE } from '../types';

/**
 * Datasets as Postgres schemas (issue #527): what installing, activating
 * and deleting a dataset does in the database. The suite may run against a
 * loaded dictionary, so it never writes to the default dataset: it installs
 * two datasets of the catalog, works in them and removes them — and refuses
 * to start on an instance that holds either, which it would delete.
 */
const NAME = 'wordnet_princeton';
const IMPORTED = 'wordnet';
const SCHEMA = `ds_${NAME}`;
const HEADWORD = `zzpgspec${Date.now().toString(36)}`;

const DICTIONARY_TABLES = [
  'en_entries',
  'en_words',
  'en_meanings',
  'en_meanings_translations',
  'en_short_translations',
  'en_meaning_synonyms',
  'en_meaning_antonyms',
  'suggestions',
];

describe('datasets in schemas (Postgres, issue #527)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  const auth = { Authorization: '' };
  const server = () => app.getHttpServer();

  const list = async (): Promise<DatasetsListT> =>
    (await request(server()).get('/api/en/datasets').set(auth).expect(200)).body as DatasetsListT;

  // the structure of a table set, without the names that differ by design
  // (the schema, the sequence's schema, the generated constraint names)
  const columnsOf = async (schema: string) =>
    dataSource.query(
      `SELECT table_name, column_name, data_type, udt_schema, udt_name, is_nullable, character_maximum_length,
              regexp_replace(coalesce(column_default, ''), '[a-z_0-9]+\\.(en_|suggestions)', '\\1') AS column_default
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = ANY($2)
        ORDER BY table_name, column_name`,
      [schema, DICTIONARY_TABLES],
    );
  const indexesOf = async (schema: string): Promise<string[]> => {
    const rows = (await dataSource.query(
      `SELECT i.indexdef
         FROM pg_indexes i
        WHERE i.schemaname = $1 AND i.tablename = ANY($2)
          AND NOT EXISTS (SELECT 1 FROM pg_constraint c
                           JOIN pg_namespace n ON n.oid = c.connamespace
                          WHERE n.nspname = i.schemaname AND c.conname = i.indexname)`,
      [schema, DICTIONARY_TABLES],
    )) as Array<{ indexdef: string }>;
    return rows
      .map(({ indexdef }) =>
        indexdef
          .replace(/^CREATE (UNIQUE )?INDEX "?[^ ]+"? ON /, 'INDEX $1ON ')
          .replaceAll(`${schema}.`, '')
          .replaceAll('public.', ''),
      )
      .sort();
  };
  const foreignKeysOf = async (schema: string): Promise<string[]> => {
    const rows = (await dataSource.query(
      `SELECT cl.relname AS "table", a.attname AS "column", fcl.relname AS "ref_table", fa.attname AS "ref_column",
              c.confdeltype AS "on_delete", c.confupdtype AS "on_update"
         FROM pg_constraint c
         JOIN pg_namespace n ON n.oid = c.connamespace
         JOIN pg_class cl ON cl.oid = c.conrelid
         JOIN pg_class fcl ON fcl.oid = c.confrelid
         JOIN pg_namespace fn ON fn.oid = fcl.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
         JOIN pg_attribute fa ON fa.attrelid = c.confrelid AND fa.attnum = c.confkey[1]
        WHERE c.contype = 'f' AND n.nspname = $1 AND fn.nspname = $1 AND cl.relname = ANY($2)`,
      [schema, DICTIONARY_TABLES],
    )) as Array<Record<string, string>>;
    return rows.map((row) => Object.values(row).join(' ')).sort();
  };

  beforeAll(async () => {
    const username = process.env.ADMIN_USERNAME as string;
    const password = process.env.ADMIN_PASSWORD as string;
    const hashByEnv = await hashLoginString(username, password);
    const secretHash = await hashLoginString(username, hashByEnv);
    auth.Authorization = `Bearer ${createJwt({ role: 'admin' }, secretHash + hashByEnv)}`;

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    dataSource = app.get(DataSource);

    const held = (await list()).datasets.filter(
      (dataset) => dataset.installed && [NAME, IMPORTED].includes(dataset.name),
    );
    if (held.length) {
      await app.close();
      throw new Error(
        `The database holds the dataset(s) ${held.map((dataset) => dataset.name).join(', ')}: ` +
          'this suite installs and deletes them. Run it against a database without them.',
      );
    }
    owned = true;
  });

  // set once the suite knows the datasets it removes are its own
  let owned = false;

  afterAll(async () => {
    if (!owned) return;
    // whatever failed above, the instance goes back to what it served and the test datasets go
    await request(server()).post('/api/en/datasets/default/activate').set(auth);
    for (const name of [NAME, IMPORTED]) {
      await request(server()).delete(`/api/en/datasets/${name}`).set(auth);
      await dataSource.query(`DROP SCHEMA IF EXISTS "ds_${name}" CASCADE`);
    }
    await app.close();
  });

  it('registered `public` as the default dataset, its dictionary tables marked as built', async () => {
    const { supported, datasets } = await list();
    expect(supported).toBe(true);
    expect(datasets[0]).toEqual(
      expect.objectContaining({ name: 'default', is_default: true, license: 'CC-BY-4.0' }),
    );

    const journal = (await dataSource.query(`SELECT "name" FROM "public"."dataset_migrations"`)) as Array<{
      name: string;
    }>;
    expect(journal.map((row) => row.name)).toContain('DatasetBaseline1789500000000');
  });

  it('installs a dataset as a schema with the dictionary tables and a migration journal of its own', async () => {
    const created = await app.get(DatasetsService).install(NAME);
    expect(created).toEqual(
      expect.objectContaining({ name: NAME, schema: SCHEMA, source: 'princeton-wordnet', version: null }),
    );
    expect((await list()).datasets.find((dataset) => dataset.name === NAME)).toEqual(
      expect.objectContaining({
        name: NAME,
        installed: true,
        source: 'princeton-wordnet',
        license: 'WordNet',
        active: false,
        is_default: false,
        version: null,
      }),
    );

    const tables = (await dataSource.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY 1`,
      [SCHEMA],
    )) as Array<{ table_name: string }>;
    expect(tables.map((row) => row.table_name)).toEqual([...DICTIONARY_TABLES, 'dataset_migrations'].sort());

    // the shared tables are not repeated in a dataset
    for (const shared of ['settings', 'datasets', 'audit_log', 'migrations']) {
      expect(tables.map((row) => row.table_name)).not.toContain(shared);
    }

    // installed twice is installed once; a name the catalog does not have is no dataset
    expect((await app.get(DatasetsService).install(NAME)).id).toBe(created.id);
    await expect(app.get(DatasetsService).install('wiktionary_en')).rejects.toThrow('dataset_name_invalid');
    await expect(app.get(DatasetsService).install('default')).rejects.toThrow('dataset_name_invalid');
  });

  it('builds the same tables as `public` has: columns, indexes and foreign keys', async () => {
    expect(await columnsOf(SCHEMA)).toEqual(await columnsOf('public'));
    expect(await indexesOf(SCHEMA)).toEqual(await indexesOf('public'));
    expect(await foreignKeysOf(SCHEMA)).toEqual(await foreignKeysOf('public'));
  });

  it('serves the active dataset only: a word written to one is not in the other', async () => {
    const before = await dataSource.query(`SELECT count(*)::int AS n FROM "public"."en_words"`);

    const activated = await request(server()).post(`/api/en/datasets/${NAME}/activate`).set(auth).expect(200);
    expect(activated.body).toEqual(expect.objectContaining({ name: NAME, active: true }));
    expect((await list()).active).toBe(NAME);
    expect(await dataSource.query('SELECT current_schema() AS s')).toEqual([{ s: SCHEMA }]);

    // an empty dataset: nothing of the default one shows through
    await request(server()).get(`/api/v1/words/${HEADWORD}`).expect(404);
    const meta = await request(server()).get('/api/v1/meta').expect(200);
    expect(meta.body.data.counts.entries).toBe(0);

    await request(server())
      .post('/api/en/add/word')
      .set(auth)
      .send({
        word: HEADWORD,
        part_of_speech: EnPartOfSpeechE.noun,
        form_of_word: EnWordFormsE.base_form,
        forms: [],
        meanings: [
          {
            title: 'a test word',
            definition: 'a word that exists in one dataset only',
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
    const found = await request(server()).get(`/api/v1/words/${HEADWORD}`).expect(200);
    expect(found.body.data[0].word).toBe(HEADWORD);
    expect(await dataSource.query(`SELECT count(*)::int AS n FROM "${SCHEMA}"."en_words"`)).toEqual([{ n: 1 }]);

    // …and back: the default dataset never saw the word, its rows are what they were
    await request(server()).post('/api/en/datasets/default/activate').set(auth).expect(200);
    expect(await dataSource.query('SELECT current_schema() AS s')).toEqual([{ s: 'public' }]);
    await request(server()).get(`/api/v1/words/${HEADWORD}`).expect(404);
    expect(await dataSource.query(`SELECT count(*)::int AS n FROM "public"."en_words"`)).toEqual(before);
    const setting = await dataSource.query(
      `SELECT "value" FROM "public"."settings" WHERE "field" = 'active_dataset'`,
    );
    expect(setting).toEqual([{ value: 'default' }]);
  });

  it('switches under load: no request meets the closed connection', async () => {
    const reads = Array.from({ length: 40 }, () => request(server()).get('/api/v1/meta'));
    const switches = (async () => {
      await request(server()).post(`/api/en/datasets/${NAME}/activate`).set(auth).expect(200);
      await request(server()).post('/api/en/datasets/default/activate').set(auth).expect(200);
    })();
    const later = Array.from({ length: 40 }, () => request(server()).get('/api/v1/meta'));

    const answers = await Promise.all([...reads, ...later]);
    await switches;

    expect(answers.map((answer) => answer.status).filter((status) => status !== 200)).toEqual([]);
    // an answer names the dataset it was taken from, whichever side of the switch it fell on
    for (const answer of answers) expect(['default', NAME]).toContain(answer.body.data.dataset);
    expect((await list()).active).toBe('default');
  });

  it('counts a switch as a change: Last-Modified does not go back in time', async () => {
    const onDefault = await request(server()).get('/api/v1/meta').expect(200);
    await request(server()).post(`/api/en/datasets/${NAME}/activate`).set(auth).expect(200);
    const onOther = await request(server()).get('/api/v1/meta').expect(200);
    await request(server()).post('/api/en/datasets/default/activate').set(auth).expect(200);

    const earlier = Date.parse(onDefault.headers['last-modified'] ?? new Date(0).toUTCString());
    expect(Date.parse(onOther.headers['last-modified'] as string)).toBeGreaterThanOrEqual(earlier);
    expect(onOther.headers.etag).not.toBe(onDefault.headers.etag);
  });

  it('starts on the active dataset, with the migrations of every schema applied', async () => {
    await request(server()).post(`/api/en/datasets/${NAME}/activate`).set(auth).expect(200);
    try {
      await expect(prepareDatabase()).resolves.toBe(SCHEMA);
    } finally {
      await request(server()).post('/api/en/datasets/default/activate').set(auth).expect(200);
    }
    await expect(prepareDatabase()).resolves.toBe('public');
  });

  it('imports into a dataset that is not the active one: a schema of its own, the active dataset untouched', async () => {
    const other = IMPORTED;
    const word = `${HEADWORD}imp`;
    const line =
      JSON.stringify({
        word,
        part_of_speech: 'noun',
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
        description: 'imported into a dataset of its own',
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
      }) + '\n';
    // an export of a WordNet dataset of another instance, its terms typed over by hand
    const manifest = {
      version: '2026.09',
      files: { 'vocab-bloom-hub-en-words.jsonl': { lines: 1 } },
      source: 'wordnet',
      license: 'CC0-1.0',
      attribution: 'Somebody else',
      notice: 'Not what the catalog says',
    };
    const before = await dataSource.query(`SELECT count(*)::int AS n FROM "public"."en_words"`);
    const versionBefore = await dataSource.query(
      `SELECT "value" FROM "public"."settings" WHERE "field" = 'en_dataset_version'`,
    );

    try {
      const res = await request(server())
        .post('/api/en/dictionary/import/upload')
        .set(auth)
        .field('dataset', other)
        .attach('words', Buffer.from(line), 'words.jsonl')
        .attach('manifest', Buffer.from(JSON.stringify(manifest)), 'manifest.json')
        .expect(201);
      expect(res.text).toContain('"datasetVersion":"2026.09"');

      // the import installed the dataset under the terms of the catalog, filled it and left the active one alone
      const { active, datasets } = await list();
      expect(active).toBe('default');
      expect(datasets.find((dataset) => dataset.name === other)).toEqual(
        expect.objectContaining({
          installed: true,
          source: 'wordnet',
          license: 'CC-BY-4.0',
          license_url: 'https://creativecommons.org/licenses/by/4.0/',
          attribution: expect.stringContaining('Open English WordNet'),
          attribution_url: 'https://en-word.net',
          notice: null,
          version: '2026.09',
          active: false,
        }),
      );
      expect(await dataSource.query(`SELECT "word" FROM "ds_${other}"."en_entries"`)).toEqual([{ word }]);
      expect(await dataSource.query(`SELECT count(*)::int AS n FROM "public"."en_words"`)).toEqual(before);
      await request(server()).get(`/api/v1/words/${word}`).expect(404);
      // the version the settings mirror is the active dataset's, not the imported one's
      expect(
        await dataSource.query(`SELECT "value" FROM "public"."settings" WHERE "field" = 'en_dataset_version'`),
      ).toEqual(versionBefore);

      // served once it is the active one
      await request(server()).post(`/api/en/datasets/${other}/activate`).set(auth).expect(200);
      const found = await request(server()).get(`/api/v1/words/${word}`).expect(200);
      expect(found.body.data[0]).toEqual(expect.objectContaining({ word, source: 'wordnet' }));
      // …under its own terms
      const meta = await request(server()).get('/api/v1/meta').expect(200);
      expect(meta.body.data).toEqual(
        expect.objectContaining({
          dataset: other,
          source: 'wordnet',
          license: 'CC-BY-4.0',
          license_url: 'https://creativecommons.org/licenses/by/4.0/',
          attribution: expect.stringContaining('Open English WordNet'),
          notice: '',
          dataset_version: '2026.09',
        }),
      );

      // data of another source does not go into it
      const mixed = await request(server())
        .post('/api/en/dictionary/import/upload')
        .set(auth)
        .field('dataset', other)
        .attach('words', Buffer.from(line), 'words.jsonl')
        .attach('manifest', Buffer.from(JSON.stringify({ ...manifest, source: 'wiktionary' })), 'manifest.json')
        .expect(409);
      expect(mixed.body.message).toBe('dataset_source_mismatch');
    } finally {
      await request(server()).post('/api/en/datasets/default/activate').set(auth);
      await request(server()).delete(`/api/en/datasets/${other}`).set(auth);
      await dataSource.query(`DROP SCHEMA IF EXISTS "ds_${other}" CASCADE`);
    }
  });

  it('never deletes the active dataset or the default one; deleting drops the schema', async () => {
    const isDefault = await request(server()).delete('/api/en/datasets/default').set(auth).expect(409);
    expect(isDefault.body.message).toBe('dataset_is_default');

    await request(server()).post(`/api/en/datasets/${NAME}/activate`).set(auth).expect(200);
    const isActive = await request(server()).delete(`/api/en/datasets/${NAME}`).set(auth).expect(409);
    expect(isActive.body.message).toBe('dataset_is_active');
    await request(server()).post('/api/en/datasets/default/activate').set(auth).expect(200);

    await request(server()).delete(`/api/en/datasets/${NAME}`).set(auth).expect(200);
    expect(
      await dataSource.query(`SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = $1`, [SCHEMA]),
    ).toEqual([{ n: 0 }]);
    // the catalog still offers it
    expect((await list()).datasets.find((dataset) => dataset.name === NAME)).toEqual(
      expect.objectContaining({ installed: false, version: null, created_at: null }),
    );
    await request(server()).post(`/api/en/datasets/${NAME}/activate`).set(auth).expect(404);
  });
});
