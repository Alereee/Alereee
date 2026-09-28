import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/modules/AppModule/app.module';
import { createJwt } from '../core/utils/auth';
import { hashLoginString } from '../core/utils/crypto';
import { EnAreaVariantsE, EnPartOfSpeechE, EnWordFormsE } from '../types';

const E2E_USERNAME = 'e2e-admin';
const E2E_PASSWORD = 'e2e-password';

/**
 * The history of edits (issue #531) as the API shows it: an entry that was
 * changed or added on the instance says so to every reader, because the
 * licenses of the datasets ask for it.
 */
describe('the history of edits (e2e, issue #531)', () => {
  let app: INestApplication<App>;
  let importDir: string;
  const originalImportDir = process.env.DICTIONARY_IMPORT_DIR;
  const auth = { Authorization: '' };
  const server = () => app.getHttpServer();

  const wordLine = (word: string, partOfSpeech = 'noun') =>
    JSON.stringify({
      word,
      part_of_speech: partOfSpeech,
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
      description: `the word ${word}`,
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

  const importWords = async (lines: string[]) => {
    await request(server())
      .post('/api/en/dictionary/import/upload')
      .set(auth)
      .attach('words', Buffer.from(lines.join('')), 'words.jsonl')
      .expect(201);
  };

  // an update of the dictionary reads a dataset the server can reach
  const updateFrom = async (lines: string[]) => {
    const folder = `update-${Date.now()}`;
    await mkdir(path.join(importDir, folder));
    await writeFile(path.join(importDir, folder, 'vocab-bloom-hub-en-words.jsonl'), lines.join(''));
    await request(server())
      .post('/api/en/dictionary/import')
      .set(auth)
      .send({ source: { kind: 'file', path: folder }, update: true })
      .expect(201);
  };

  const publicWord = async (word: string) =>
    (
      await request(server())
        .get(`/api/v1/words/${encodeURIComponent(word)}`)
        .expect(200)
    ).body.data as Array<{
      id: number;
      part_of_speech: string;
      modified: boolean;
    }>;

  beforeAll(async () => {
    process.env.ADMIN_USERNAME = E2E_USERNAME;
    process.env.ADMIN_PASSWORD = E2E_PASSWORD;
    const hashByEnv = await hashLoginString(E2E_USERNAME, E2E_PASSWORD);
    const secretHash = await hashLoginString(E2E_USERNAME, hashByEnv);
    auth.Authorization = `Bearer ${createJwt({ role: 'admin' }, secretHash + hashByEnv)}`;
    importDir = await mkdtemp(path.join(os.tmpdir(), 'vocab-bloom-e2e-changes-'));
    process.env.DICTIONARY_IMPORT_DIR = importDir;

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    await importWords([wordLine('lamp'), wordLine('lamp', 'verb'), wordLine('mouse')]);
  });

  afterAll(async () => {
    if (originalImportDir === undefined) delete process.env.DICTIONARY_IMPORT_DIR;
    else process.env.DICTIONARY_IMPORT_DIR = originalImportDir;
    await rm(importDir, { recursive: true, force: true });
    await app.close();
  });

  it('serves an imported entry as what its source says', async () => {
    const lamp = await publicWord('lamp');
    expect(lamp.map((entry) => [entry.part_of_speech, entry.modified])).toEqual([
      ['noun', false],
      ['verb', false],
    ]);
    const detailed = await request(server()).get('/api/v1/search/detailed?search=mouse').expect(200);
    expect(detailed.body.data[0]).toEqual(expect.objectContaining({ word: 'mouse', modified: false }));
    const listed = await request(server()).get('/api/v1/words?limit=10').expect(200);
    expect(listed.body.data.map((entry: { modified: boolean }) => entry.modified)).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('marks the article that was edited, and not the other article of the headword', async () => {
    const [noun] = await publicWord('lamp');

    await request(server())
      .patch(`/api/en/common-info/${noun.id}`)
      .set(auth)
      .send({ description: 'a device that produces light' })
      .expect(200);

    expect((await publicWord('lamp')).map((entry) => [entry.part_of_speech, entry.modified])).toEqual([
      ['noun', true],
      ['verb', false],
    ]);
    const detailed = await request(server()).get('/api/v1/search/detailed?search=lamp').expect(200);
    expect(
      detailed.body.data.map((entry: { part_of_speech: string; modified: boolean }) => [
        entry.part_of_speech,
        entry.modified,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ['noun', true],
        ['verb', false],
      ]),
    );
    const byId = await request(server()).get(`/api/v1/words/id/${noun.id}`).expect(200);
    expect(byId.body.data.modified).toBe(true);
  });

  it('marks a word that was made on the instance', async () => {
    await request(server())
      .post('/api/en/add/word')
      .set(auth)
      .send({
        word: 'lantern',
        part_of_speech: EnPartOfSpeechE.noun,
        form_of_word: EnWordFormsE.base_form,
        forms: [],
        meanings: [
          {
            title: 'a light in a case',
            definition: 'A light in a case that lets it shine through.',
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

    expect((await publicWord('lantern'))[0]).toEqual(expect.objectContaining({ modified: true }));
    const batch = await request(server())
      .post('/api/v1/words/batch')
      .send({ words: ['lantern', 'mouse'] })
      .expect(200);
    expect(
      batch.body.data.map((item: { word: string; entries: Array<{ modified: boolean }> }) => [
        item.word,
        item.entries[0].modified,
      ]),
    ).toEqual([
      ['lantern', true],
      ['mouse', false],
    ]);
  });

  it('serves the entry as what its source says again once an update has replaced it', async () => {
    // the admin returns "lamp" to the official version: the text stays, and the mark with it
    await request(server()).patch('/api/en/reset-user-modified/lamp').set(auth).expect(200);
    expect((await publicWord('lamp'))[0].modified).toBe(true);

    await updateFrom([wordLine('lamp'), wordLine('lamp', 'verb')]);

    const lamp = await request(server()).get('/api/v1/words/lamp').expect(200);
    expect(
      lamp.body.data.map((entry: { description: string; modified: boolean }) => [
        entry.description,
        entry.modified,
      ]),
    ).toEqual([
      ['the word lamp', false],
      ['the word lamp', false],
    ]);
    // the word of the owner was not in the update: it is still theirs
    expect((await publicWord('lantern'))[0].modified).toBe(true);
  });

  it('carries the history in an export: another instance that takes the copy says what was edited', async () => {
    const exported = await request(server()).get('/api/en/dictionary/export').set(auth).expect(200);
    const { exportId } = JSON.parse(exported.text.trim().split('\n').at(-1) as string) as { exportId: string };
    const archive = await request(server())
      .get(`/api/en/dictionary/export/download/${exportId}`)
      .set(auth)
      .buffer(true)
      .parse((res, done) => {
        const parts: Buffer[] = [];
        res.on('data', (part: Buffer) => parts.push(part));
        res.on('end', () => done(null, Buffer.concat(parts)));
      })
      .expect(200);
    const zip = archive.body as Buffer;
    // the terms and the history travel in the archive, next to the data
    expect(zip.includes(Buffer.from('LICENSE'))).toBe(true);
    expect(zip.includes(Buffer.from('vocab-bloom-hub-en-changes.jsonl'))).toBe(true);

    // another instance, with an empty dictionary
    await app.close();
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    await request(server()).get('/api/v1/words/lantern').expect(404);

    const imported = await request(server())
      .post('/api/en/dictionary/import/upload')
      .set(auth)
      .attach('archive', zip, 'export.zip')
      .expect(201);
    expect(imported.text).toContain('"stage":5');

    expect((await publicWord('lantern'))[0]).toEqual(expect.objectContaining({ modified: true }));
    expect((await publicWord('mouse'))[0]).toEqual(expect.objectContaining({ modified: false }));
    // "lamp" was edited and then replaced by its source: the copy knows both, and serves the source
    expect((await publicWord('lamp')).map((entry) => entry.modified)).toEqual([false, false]);
  });

  it('shows a reader what was changed, and the admin everything that ever was', async () => {
    const [mouse] = await publicWord('mouse');
    await request(server())
      .patch(`/api/en/common-info/${mouse.id}`)
      .set(auth)
      .send({ description: 'a small rodent', transcription: '/maʊs/' })
      .expect(200);

    const history = await request(server()).get('/api/v1/words/MOUSE/history').expect(200);
    expect(history.headers.etag).toBeDefined();
    expect(history.body).toEqual({
      data: [
        {
          created_at: expect.any(String),
          word: 'mouse',
          part_of_speech: 'noun',
          entity: 'word',
          action: 'update',
          record: null,
          diff: {
            description: { before: 'the word mouse', after: 'a small rodent' },
            transcription: { before: '', after: '/maʊs/' },
          },
          origin: 'admin',
          author: null,
          // the dataset the edit was made in: what the changed entry is attributed to
          source: 'vocab-bloom-hub',
        },
      ],
      meta: { word: 'mouse', count: 1, variants: [] },
    });

    // a word of the owner: everything it came with, without the editorial state of the instance
    const lantern = await request(server()).get('/api/v1/words/lantern/history').expect(200);
    expect(lantern.body.data).toEqual([expect.objectContaining({ entity: 'word', action: 'create' })]);
    expect(lantern.body.data[0].diff.meanings.after).toEqual([
      expect.objectContaining({ title: 'a light in a case' }),
    ]);
    expect(Object.keys(lantern.body.data[0].diff)).not.toEqual(
      expect.arrayContaining(['generated', 'generated_by_model']),
    );

    // what an update replaced is served as the source has it: nothing to tell a reader
    const lamp = await request(server()).get('/api/v1/words/lamp/history').expect(200);
    expect(lamp.body).toEqual({ data: [], meta: { word: 'lamp', count: 0, variants: [] } });
    await request(server()).get('/api/v1/words/no-such-word/history').expect(404);

    await request(server()).get('/api/en/changes').expect(401);
    const past = await request(server()).get('/api/en/changes?headword=lamp').set(auth).expect(200);
    expect(past.body.items).toEqual([
      expect.objectContaining({
        headword: 'lamp',
        part_of_speech: 'noun',
        superseded_at: expect.any(String),
        revertible: false,
        diff: {
          description: { before: 'the word lamp', after: 'a device that produces light' },
          // the admin sees the version the entry had; a reader is not shown the editorial state
          version: { before: '1.0.0', after: 'custom_version' },
        },
      }),
    ]);
    const active = await request(server()).get('/api/en/changes?active=true&limit=10').set(auth).expect(200);
    expect(active.body).toEqual(expect.objectContaining({ total: 2, page: 1, limit: 10, has_more: false }));
    expect(
      active.body.items.map((item: { headword: string; revertible: boolean }) => [
        item.headword,
        item.revertible,
      ]),
    ).toEqual([
      ['mouse', true],
      ['lantern', true],
    ]);
    expect(Object.keys(active.body.items[1].diff)).toEqual(expect.arrayContaining(['generated']));
    await request(server()).get('/api/en/changes?entity=nonsense').set(auth).expect(400);
  });

  it('carries the mark wherever an entry or a part of it is served', async () => {
    // "mouse" was edited, "lamp" is as its source has it
    const flat = await request(server()).get('/api/v1/search?search=mouse').expect(200);
    expect(flat.body.data[0]).toEqual(
      expect.objectContaining({ word: 'mouse', modified: true, source: 'vocab-bloom-hub' }),
    );
    const untouched = await request(server()).get('/api/v1/search?search=lamp').expect(200);
    expect(untouched.body.data.map((item: { modified: boolean }) => item.modified)).toEqual([false, false]);

    const listed = await request(server()).get('/api/v1/words?search=mouse').expect(200);
    expect(listed.body.data).toEqual([expect.objectContaining({ word: 'mouse', modified: true })]);

    // the parts of an entry say what the entry says
    const [lantern] = await publicWord('lantern');
    const meanings = await request(server()).get('/api/v1/words/lantern/meanings').expect(200);
    expect(meanings.body.data).toEqual([
      expect.objectContaining({
        title: 'a light in a case',
        word_id: lantern.id,
        modified: true,
        source: 'vocab-bloom-hub',
      }),
    ]);
    await request(server())
      .post('/api/en/word/short-translation')
      .set(auth)
      .send({ word_id: lantern.id, language: 'ru', description: 'фонарь', variant_of_words: ['фонарь'] })
      .expect(201);
    await request(server())
      .post('/api/en/word-form')
      .set(auth)
      .send({
        base_word_id: lantern.id,
        word: 'lanterns',
        form_of_word: EnWordFormsE.plural_form,
        area_variant: EnAreaVariantsE.common,
        transcription: '/ˈlæntənz/',
      })
      .expect(201);
    const translations = await request(server()).get('/api/v1/words/lantern/translations').expect(200);
    expect(translations.body.data.short_translations).toEqual([
      expect.objectContaining({ description: 'фонарь', modified: true, source: 'vocab-bloom-hub' }),
    ]);
    const forms = await request(server()).get('/api/v1/words/lantern/forms').expect(200);
    expect(forms.body.data).toEqual([
      expect.objectContaining({ word: 'lanterns', modified: true, source: 'vocab-bloom-hub' }),
    ]);

    // the dataset as a whole: two headwords are served with edits of the owner, "lamp" is not one of them
    const meta = await request(server()).get('/api/v1/meta').expect(200);
    expect(meta.body.data.modified_entries).toBe(2);
  });

  it('takes a change back: the entry is what its source says again', async () => {
    const listed = await request(server()).get('/api/en/changes?headword=mouse').set(auth).expect(200);
    const [{ id }] = listed.body.items as Array<{ id: number }>;

    await request(server()).post(`/api/en/changes/${id}/revert`).expect(401);
    await request(server())
      .post(`/api/en/changes/${id}/revert`)
      .set(auth)
      .expect(200)
      .expect({ success: true });

    const mouse = await request(server()).get('/api/v1/words/mouse').expect(200);
    expect(mouse.body.data[0]).toEqual(
      expect.objectContaining({ description: 'the word mouse', transcription: '', modified: false }),
    );
    const history = await request(server()).get('/api/v1/words/mouse/history').expect(200);
    expect(history.body.data).toEqual([]);
    // the last change of the entry was taken back: it carries the version of its dataset again
    const stored = await request(server()).get(`/api/en/${mouse.body.data[0].id}`).set(auth).expect(200);
    expect(stored.body).toEqual(expect.objectContaining({ version: '1.0.0', user_modified: false }));

    // the history keeps both: the change, and that it was taken back
    const kept = await request(server()).get('/api/en/changes?headword=mouse').set(auth).expect(200);
    expect(
      kept.body.items.map((item: { origin: string; superseded_at: string | null }) => [
        item.origin,
        item.superseded_at !== null,
      ]),
    ).toEqual([
      ['revert', true],
      ['admin', true],
    ]);

    const again = await request(server()).post(`/api/en/changes/${id}/revert`).set(auth).expect(409);
    expect(again.body.message).toBe('change_not_revertible');
    await request(server()).post('/api/en/changes/999999/revert').set(auth).expect(404);
  });

  it('takes a word of the owner out when its creation is taken back, the later changes first', async () => {
    const listed = await request(server()).get('/api/en/changes?headword=lantern').set(auth).expect(200);
    const changes = listed.body.items as Array<{ id: number; entity: string; action: string }>;
    expect(changes.map((change) => [change.entity, change.action])).toEqual([
      ['word_form', 'create'],
      ['short_translation', 'create'],
      ['word', 'create'],
    ]);
    const creation = changes[2];

    // the word says more than it did when it was added
    const early = await request(server()).post(`/api/en/changes/${creation.id}/revert`).set(auth).expect(409);
    expect(early.body.message).toBe('change_outdated');

    for (const change of changes) {
      await request(server()).post(`/api/en/changes/${change.id}/revert`).set(auth).expect(200);
    }

    await request(server()).get('/api/v1/words/lantern').expect(404);
  });
});
