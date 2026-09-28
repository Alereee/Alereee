import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { gzipSync } from 'node:zlib';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/modules/AppModule/app.module';
import { checkIsPostgres } from '../configuration';
import { filesOf, writeTarGz, writeZip } from '../src/converters/__tests__/pack';
import { createJwt } from '../core/utils/auth';
import { hashLoginString } from '../core/utils/crypto';
import { DatasetsListT, ImportDictionaryChunkT } from '../types';

const E2E_USERNAME = 'e2e-admin';
const E2E_PASSWORD = 'e2e-password';
const FIXTURES = path.join(__dirname, '../src/converters/__tests__/fixtures');
// EnDictionaryImportPhasesE.converting_source / completed
const CONVERTING = 13;
const COMPLETED = 5;

/**
 * A dataset of the catalog installed from the file of its source (issue
 * #527): the admin attaches what the source distributes, the server converts
 * and imports it into a schema of its own, and the instance serves it under
 * the terms the catalog states. The suite runs on both drivers: SQLite has
 * no schemas and refuses, Postgres does the work.
 */
describe('installing a dataset from its source (e2e, issue #527)', () => {
  let app: INestApplication<App>;
  let dir: string;
  const auth = { Authorization: '' };
  const server = () => app.getHttpServer();
  const supported = checkIsPostgres();
  const sources: Record<'wiktionary' | 'wordnet' | 'princeton' | 'cmudict', string> = {
    wiktionary: '',
    wordnet: '',
    princeton: '',
    cmudict: path.join(FIXTURES, 'cmudict.dict'),
  };

  const chunksOf = (text: string): ImportDictionaryChunkT[] =>
    text
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ImportDictionaryChunkT);

  const list = async (): Promise<DatasetsListT> =>
    (await request(server()).get('/api/en/datasets').set(auth).expect(200)).body as DatasetsListT;

  const datasetOf = async (name: string) => (await list()).datasets.find((dataset) => dataset.name === name);

  const install = (name: string, file: string, pronunciations?: string) => {
    const req = request(server()).post(`/api/en/datasets/${name}/install`).set(auth).attach('file', file);
    return pronunciations ? req.attach('pronunciations', pronunciations) : req;
  };

  // what follows the last chunk of the stream (the import slot) lands a moment later
  const released = async (): Promise<void> => {
    for (let attempt = 1; attempt <= 40; attempt += 1) {
      const status = await request(server()).get('/api/en/dictionary/import/status').set(auth).expect(200);
      if (!status.body.running) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('the import slot was not released');
  };

  beforeAll(async () => {
    process.env.ADMIN_USERNAME = E2E_USERNAME;
    process.env.ADMIN_PASSWORD = E2E_PASSWORD;
    const hashByEnv = await hashLoginString(E2E_USERNAME, E2E_PASSWORD);
    const secretHash = await hashLoginString(E2E_USERNAME, hashByEnv);
    auth.Authorization = `Bearer ${createJwt({ role: 'admin' }, secretHash + hashByEnv)}`;

    // the fixtures as their sources pack them, under names that say nothing: an upload has none
    dir = await mkdtemp(path.join(os.tmpdir(), 'vocab-bloom-e2e-sources-'));
    sources.wiktionary = path.join(dir, 'a');
    await writeFile(sources.wiktionary, gzipSync(await readFile(path.join(FIXTURES, 'kaikki.jsonl'))));
    sources.wordnet = await writeZip(
      path.join(dir, 'b'),
      await filesOf(path.join(FIXTURES, 'wordnet'), 'oewn2025/'),
    );
    sources.princeton = await writeTarGz(
      path.join(dir, 'c'),
      await filesOf(path.join(FIXTURES, 'wordnet'), 'dict/'),
      ['dict/'],
    );

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('is an admin route', async () => {
    await request(server())
      .post('/api/en/datasets/wordnet/install')
      .attach('file', sources.wordnet)
      .expect(401);
  });

  it('refuses what is not a dataset of a source', async () => {
    const unknown = await install('nope', sources.wordnet).expect(404);
    expect(unknown.body.message).toBe('dataset_not_found');
    // the project's own dataset comes through the import page
    const own = await install('default', sources.wordnet).expect(400);
    expect(own.body.message).toBe('dataset_not_installable');
  });

  if (!supported) {
    it('has no schemas on SQLite: 409 datasets_not_supported, and the upload is not kept', async () => {
      const res = await install('wordnet', sources.wordnet, sources.cmudict).expect(409);
      expect(res.body.message).toBe('datasets_not_supported');
      expect(await datasetOf('wordnet')).toEqual(expect.objectContaining({ installed: false }));
    });
    return;
  }

  it('asks for the file, and for the file of this source', async () => {
    const none = await request(server()).post('/api/en/datasets/wordnet/install').set(auth).expect(400);
    expect(none.body.message).toBe('dataset_upload_missing');

    for (const [name, file, pronunciations] of [
      ['wiktionary', sources.wordnet],
      ['wiktionary', sources.cmudict],
      ['wordnet', sources.wiktionary],
      ['wordnet', sources.cmudict],
      ['wordnet_princeton', sources.cmudict],
      ['wordnet', sources.wordnet, sources.wordnet],
    ] as Array<[string, string, string?]>) {
      const res = await install(name, file, pronunciations).expect(400);
      expect({ name, message: res.body.message }).toEqual({ name, message: 'dataset_source_invalid' });
    }

    // nothing was created for a file that was refused, nothing of it is left on the disk
    expect((await list()).datasets.filter((dataset) => dataset.installed).map((d) => d.name)).toEqual([
      'default',
    ]);
    const kept = await readdir(path.join(os.tmpdir(), 'vocab-bloom-import', 'sources')).catch(() => []);
    expect(kept).toEqual([]);
    await released();
  });

  it('installs Wiktionary from its extract while the default dataset keeps serving', async () => {
    const res = await install('wiktionary', sources.wiktionary).expect(201);
    const chunks = chunksOf(res.text);

    // the conversion first, then the import of what it wrote
    expect(chunks[0]).toEqual({ percent: 0, stage: CONVERTING });
    expect(chunks.filter((chunk) => chunk.stage === CONVERTING).at(-1)?.percent).toBe(100);
    expect(chunks.at(-1)).toEqual(
      expect.objectContaining({ percent: 100, stage: COMPLETED, datasetVersion: expect.any(String) }),
    );
    // a first install adds, it has nothing to update
    expect(chunks.at(-1)).not.toHaveProperty('updated_entries');
    await released();

    expect(await datasetOf('wiktionary')).toEqual(
      expect.objectContaining({
        installed: true,
        active: false,
        source: 'wiktionary',
        license: 'CC-BY-SA-4.0',
        version: chunks.at(-1)?.datasetVersion,
        imported_at: expect.any(String),
      }),
    );
    expect((await list()).active).toBe('default');
    await request(server()).get('/api/v1/words/lamp').expect(404);
    const meta = await request(server()).get('/api/v1/meta').expect(200);
    expect(meta.body.data).toEqual(
      expect.objectContaining({ dataset: 'default', source: 'vocab-bloom-hub', license: 'CC-BY-4.0' }),
    );
  });

  it('serves it under the terms of Wiktionary once it is activated', async () => {
    await request(server()).post('/api/en/datasets/wiktionary/activate').set(auth).expect(200);

    const lamp = await request(server()).get('/api/v1/words/lamp').expect(200);
    expect(lamp.body.meta).toEqual({ word: 'lamp', count: 3, variants: [] });
    const noun = lamp.body.data.find((entry: { part_of_speech: string }) => entry.part_of_speech === 'noun');
    expect(noun).toEqual(
      expect.objectContaining({
        source: 'wiktionary',
        transcription: '/lɛəmp/',
        // nothing says how formal the word is: no register, not a default one
        language_register: null,
        word_level: null,
      }),
    );
    expect(noun.forms.map((form: { word: string }) => form.word)).toEqual(['lamps']);
    expect(noun.meanings.map((meaning: { title: string }) => meaning.title)).toEqual([
      'A device that gives light',
      'A source of spiritual light',
      'A heavy blow',
    ]);
    expect(
      noun.meanings[0].translations.map((t: { language: string; title: string }) => [t.language, t.title]),
    ).toEqual(
      expect.arrayContaining([
        ['ru', 'лампа'],
        ['zh', '灯'],
        ['de', 'Lampe'],
        ['es', 'lámpara'],
      ]),
    );

    // the inflected form finds its entry; the phrasal verb knows its base verb
    const lamps = await request(server()).get('/api/v1/words/lamps').expect(200);
    expect(lamps.body.data[0].word).toBe('lamp');
    const takeOff = await request(server()).get('/api/v1/words/take%20off').expect(200);
    expect(takeOff.body.data[0]).toEqual(
      expect.objectContaining({ verb___is_phrasal: true, base_phrasal: 'take' }),
    );
    const phrase = await request(server()).get('/api/v1/words/better%20late%20than%20never').expect(200);
    expect(phrase.body.data[0].part_of_speech).toBe('phrase');

    const meta = await request(server()).get('/api/v1/meta').expect(200);
    expect(meta.body.data).toEqual(
      expect.objectContaining({
        dataset: 'wiktionary',
        source: 'wiktionary',
        license: 'CC-BY-SA-4.0',
        license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
        attribution: expect.stringContaining('Wiktionary contributors'),
        attribution_url: 'https://en.wiktionary.org',
        notice: '',
        // a Creative Commons license is named by its link
        license_text: '',
      }),
    );
  });

  it('updates an installed dataset from a newer file: the entries are replaced, not doubled', async () => {
    const before = (await request(server()).get('/api/v1/meta').expect(200)).body.data.counts;

    const res = await install('wiktionary', sources.wiktionary).expect(201);
    const last = chunksOf(res.text).at(-1);
    await released();

    expect(last).toEqual(
      expect.objectContaining({ stage: COMPLETED, added_entries: 0, kept_user_modified: 0 }),
    );
    expect(last?.updated_entries).toBeGreaterThan(0);
    const lamp = await request(server()).get('/api/v1/words/lamp').expect(200);
    expect(lamp.body.meta).toEqual({ word: 'lamp', count: 3, variants: [] });
    // the counts of /meta are cached for a minute: the rows are what is compared
    expect(before.entries).toBeGreaterThan(0);
  });

  it('installs both editions of WordNet, each into its own dataset, from a zip and from a tar.gz', async () => {
    const open = await install('wordnet', sources.wordnet, sources.cmudict).expect(201);
    expect(chunksOf(open.text).at(-1)?.stage).toBe(COMPLETED);
    await released();
    const princeton = await install('wordnet_princeton', sources.princeton).expect(201);
    expect(chunksOf(princeton.text).at(-1)?.stage).toBe(COMPLETED);
    await released();

    expect(
      (await list()).datasets.map((dataset) => [dataset.name, dataset.installed, dataset.license]),
    ).toEqual([
      ['default', true, 'CC-BY-4.0'],
      ['wiktionary', true, 'CC-BY-SA-4.0'],
      ['wordnet', true, 'CC-BY-4.0'],
      ['wordnet_princeton', true, 'WordNet'],
    ]);

    await request(server()).post('/api/en/datasets/wordnet/activate').set(auth).expect(200);
    const run = await request(server()).get('/api/v1/words/run').expect(200);
    expect(run.body.data[0]).toEqual(
      expect.objectContaining({
        source: 'wordnet',
        part_of_speech: 'verb',
        transcription: '/ɹʌn/',
        verb___is_irregular: true,
      }),
    );
    expect(run.body.data[0].meanings[0]).toEqual(
      expect.objectContaining({ synonyms: ['sprint'], antonyms: ['walk'], language_register: 'slang' }),
    );
    const good = await request(server()).get('/api/v1/words/good/forms').expect(200);
    expect(good.body.data.map((form: { word: string }) => form.word).sort()).toEqual(['best', 'better']);
    // Wiktionary is not in here: the phrase is an entry of the other dataset
    await request(server()).get('/api/v1/words/better%20late%20than%20never').expect(404);

    // the same release without the pronunciations: the entries, no transcription
    await request(server()).post('/api/en/datasets/wordnet_princeton/activate').set(auth).expect(200);
    const plain = await request(server()).get('/api/v1/words/run').expect(200);
    expect(plain.body.data[0]).toEqual(
      expect.objectContaining({ source: 'princeton-wordnet', transcription: '' }),
    );
    const meta = await request(server()).get('/api/v1/meta').expect(200);
    expect(meta.body.data).toEqual(
      expect.objectContaining({
        dataset: 'wordnet_princeton',
        license: 'WordNet',
        attribution: expect.stringContaining('Princeton University'),
      }),
    );
    // the WordNet license wants its notice on every copy of the data: the API carries it in full (issue #531)
    expect(meta.body.data.license_text).toContain(
      'WordNet 3.1 Copyright 2011 by Princeton University.  All rights reserved.',
    );
    expect(meta.body.data.license_text).toContain('Carnegie Mellon University');
  });

  // issue #531: a dataset of a public source says nothing about generated text, so it holds none
  it('takes a word the owner wrote into a dataset of a source, and nothing a model generated', async () => {
    await request(server()).post('/api/en/datasets/wiktionary/activate').set(auth).expect(200);
    const word = (generated: boolean) => ({
      word: 'lantern',
      part_of_speech: 'noun',
      form_of_word: 'base_form',
      generated,
      forms: [],
      meanings: [],
      short_translations: [],
    });

    const refused = await request(server()).post('/api/en/add/word').set(auth).send(word(true)).expect(400);
    expect(refused.body.message).toBe('generated_not_allowed');
    await request(server()).get('/api/v1/words/lantern').expect(404);

    const added = await request(server()).post('/api/en/add/word').set(auth).send(word(false)).expect(201);
    const served = await request(server()).get('/api/v1/words/lantern').expect(200);
    // the word is the owner's, in a dataset of Wiktionary: the reader is told
    expect(served.body.data[0]).toEqual(expect.objectContaining({ source: 'wiktionary', modified: true }));
    const marked = await request(server())
      .patch(`/api/en/common-info/${added.body.id}`)
      .set(auth)
      .send({ generated: true })
      .expect(400);
    expect(marked.body.message).toBe('generated_not_allowed');

    // …and an import of generated lines stops before it writes them
    const line = JSON.stringify({ ...word(true), word: 'candle', description: 'generated', version: '1' });
    const imported = await request(server())
      .post('/api/en/dictionary/import/upload')
      .set(auth)
      .attach('words', Buffer.from(`${line}\n`), 'words.jsonl');
    expect(chunksOf(imported.text).some((chunk) => chunk.stage === COMPLETED)).toBe(false);
    await released();
    await request(server()).get('/api/v1/words/candle').expect(404);

    // the dataset of the project is what models generated, and says so
    await request(server()).post('/api/en/datasets/default/activate').set(auth).expect(200);
    await request(server()).post('/api/en/add/word').set(auth).send(word(true)).expect(201);
    const own = await request(server()).get('/api/v1/words/lantern').expect(200);
    expect(own.body.data[0]).toEqual(expect.objectContaining({ source: 'vocab-bloom-hub', modified: true }));
  });

  it('keeps the datasets apart: the file of one source does not go into the dataset of another', async () => {
    // an export of the active dataset names its source; as an import into `default` it is refused
    await request(server()).post('/api/en/datasets/default/activate').set(auth).expect(200);
    const manifest = {
      version: '1',
      source: 'wiktionary',
      files: { 'vocab-bloom-hub-en-words.jsonl': { lines: 0 } },
    };
    const refused = await request(server())
      .post('/api/en/dictionary/import/upload')
      .set(auth)
      .attach('words', Buffer.from(''), 'words.jsonl')
      .attach('manifest', Buffer.from(JSON.stringify(manifest)), 'manifest.json')
      .expect(409);
    expect(refused.body.message).toBe('dataset_source_mismatch');
    await released();

    const journal = await request(server()).get('/api/en/audit?entity_type=dataset').set(auth).expect(200);
    const created = journal.body.items.filter((row: { action: string }) => row.action === 'create');
    expect(created.map((row: { headword: string }) => row.headword).sort()).toEqual([
      'wiktionary',
      'wordnet',
      'wordnet_princeton',
    ]);
  });
});
