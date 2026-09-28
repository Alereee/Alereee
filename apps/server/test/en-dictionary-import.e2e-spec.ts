import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { typeOrmRoot } from '../src/db/typeorm-root';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import configuration from '../configuration';
import request from 'supertest';
import { App } from 'supertest/types';
import { mkdtemp, rm } from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import { EnModule } from '../src/modules/EnModule/en.module';
import { hashLoginString } from '../core/utils/crypto';
import { createJwt } from '../core/utils/auth';

const E2E_USERNAME = 'e2e-admin';
const E2E_PASSWORD = 'e2e-password';

// The local dataset sources of the import endpoints (issue #269): the request
// shapes and the rejections the admin UI relies on. The import pipeline itself
// is covered by the service specs.
describe('dictionary import sources (e2e, issue #269)', () => {
  let app: INestApplication<App>;
  let importDir: string;
  const auth = { Authorization: '' };
  const server = () => app.getHttpServer();
  const originalImportDir = process.env.DICTIONARY_IMPORT_DIR;

  beforeAll(async () => {
    process.env.ADMIN_USERNAME = E2E_USERNAME;
    process.env.ADMIN_PASSWORD = E2E_PASSWORD;
    const hashByEnv = await hashLoginString(E2E_USERNAME, E2E_PASSWORD);
    const secretHash = await hashLoginString(E2E_USERNAME, hashByEnv);
    auth.Authorization = `Bearer ${createJwt({ role: 'admin' }, secretHash + hashByEnv)}`;
    importDir = await mkdtemp(path.join(os.tmpdir(), 'vocab-bloom-e2e-import-'));

    // the sources endpoint asks the HF refs API for the dataset's version
    // tags (issue #322) — a test never talks to the network
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('unreachable', { status: 503 }));

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
  });

  afterAll(async () => {
    if (originalImportDir === undefined) delete process.env.DICTIONARY_IMPORT_DIR;
    else process.env.DICTIONARY_IMPORT_DIR = originalImportDir;
    await rm(importDir, { recursive: true, force: true });
    await app.close();
  });

  it('requires the admin token on every import endpoint', async () => {
    await request(server()).get('/api/en/dictionary/import/sources').expect(401);
    await request(server()).post('/api/en/dictionary/import').send({}).expect(401);
    await request(server()).post('/api/en/dictionary/import/upload').expect(401);
  });

  it('reports no server-side files while DICTIONARY_IMPORT_DIR is unset and rejects file imports', async () => {
    delete process.env.DICTIONARY_IMPORT_DIR;

    await request(server())
      .get('/api/en/dictionary/import/sources')
      .set(auth)
      .expect(200)
      .expect({ import_dir_configured: false, files: [], revisions: [] });
    await request(server())
      .post('/api/en/dictionary/import')
      .set(auth)
      .send({ source: { kind: 'file', path: 'export.zip' } })
      .expect(400)
      .expect((res) => expect(res.body.message).toBe('import_dir_not_configured'));
  });

  it('validates the source and refuses paths outside the import directory', async () => {
    process.env.DICTIONARY_IMPORT_DIR = importDir;

    await request(server())
      .get('/api/en/dictionary/import/sources')
      .set(auth)
      .expect(200)
      .expect({ import_dir_configured: true, files: [], revisions: [] });
    // the file source needs a path; unknown kinds fail validation
    await request(server())
      .post('/api/en/dictionary/import')
      .set(auth)
      .send({ source: { kind: 'file' } })
      .expect(400);
    await request(server())
      .post('/api/en/dictionary/import')
      .set(auth)
      .send({ source: { kind: 'ftp', path: 'x' } })
      .expect(400);
    await request(server())
      .post('/api/en/dictionary/import')
      .set(auth)
      .send({ source: { kind: 'file', path: '../../etc/passwd' } })
      .expect(400)
      .expect((res) => expect(res.body.message).toBe('dataset_file_not_found'));
    await request(server())
      .post('/api/en/dictionary/import')
      .set(auth)
      .send({ source: { kind: 'file', path: 'missing.zip' } })
      .expect(400)
      .expect((res) => expect(res.body.message).toBe('dataset_file_not_found'));
  });

  it('rejects an upload without files and one that is neither an archive nor dataset files', async () => {
    await request(server())
      .post('/api/en/dictionary/import/upload')
      .set(auth)
      .expect(400)
      .expect((res) => expect(res.body.message).toBe('dataset_upload_missing'));
    await request(server())
      .post('/api/en/dictionary/import/upload')
      .set(auth)
      .attach('archive', Buffer.from('not a zip'), 'notes.txt')
      .expect(400)
      .expect((res) => expect(res.body.message).toBe('dataset_invalid'));
  });

  it('imports the dataset files from their upload slots, the words slot alone being enough', async () => {
    const words = {
      word: 'glimmer',
      part_of_speech: 'verb',
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
      description: 'to shine faintly',
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
    };

    const res = await request(server())
      .post('/api/en/dictionary/import/upload')
      .set(auth)
      // the slot decides what the file is; its own name does not matter
      .attach('words', Buffer.from(JSON.stringify(words) + '\n'), 'anything.txt')
      .expect(201);
    const chunks = res.text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { stage: number; percent: number; datasetVersion?: string });
    expect(chunks[chunks.length - 1]).toEqual({ percent: 100, stage: 5 });
    // no manifest: no version was reported
    expect(chunks.some((c) => c.datasetVersion !== undefined)).toBe(false);

    const check = await request(server())
      .get('/api/en/check-word/glimmer?partOfSpeech=verb')
      .set(auth)
      .expect(200);
    expect(check.body.hasWord).toBe(true);

    // manifest values typed by hand travel as text fields and are validated
    const manual = await request(server())
      .post('/api/en/dictionary/import/upload')
      .set(auth)
      .field('version', '2.0.0')
      .field('synonym_links', '0')
      .attach('words', Buffer.from(JSON.stringify(words) + '\n'), 'words.jsonl')
      .expect(201);
    expect(manual.text).toContain('"datasetVersion":"2.0.0"');
    await request(server())
      .post('/api/en/dictionary/import/upload')
      .set(auth)
      .field('synonym_links', 'many')
      .attach('words', Buffer.from(JSON.stringify(words) + '\n'), 'words.jsonl')
      .expect(400);
  });
});
