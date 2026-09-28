import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/modules/AppModule/app.module';
import { createJwt } from '../core/utils/auth';
import { hashLoginString } from '../core/utils/crypto';
import { EnAreaVariantsE, EnPartOfSpeechE, EnWordFormsE, PublicHeadwordV1ResT } from '../types';

const E2E_USERNAME = 'e2e-admin';
const E2E_PASSWORD = 'e2e-password';

/**
 * Spellings that differ by the case of their letters. The project's own
 * dataset writes its headwords in lower case and a lookup does not depend on
 * the case (issue #440); a dataset of a public source holds "Polish" next
 * to "polish" — two words, each with entries of its own, and a request that
 * spells one of them is answered with that one.
 */
describe('headwords that differ by case (e2e)', () => {
  let app: INestApplication<App>;
  const auth = { Authorization: '' };
  const server = () => app.getHttpServer();
  const ids: Record<string, number> = {};

  const add = async (
    word: string,
    part_of_speech: EnPartOfSpeechE,
    description: string,
    forms: object[] = [],
  ) => {
    const res = await request(server())
      .post('/api/en/add/word')
      .set(auth)
      .send({
        word,
        part_of_speech,
        form_of_word: EnWordFormsE.base_form,
        description,
        forms,
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

  const read = async (spelling: string, part = '') =>
    (
      await request(server())
        .get(`/api/v1/words/${encodeURIComponent(spelling)}${part}`)
        .expect(200)
    ).body as PublicHeadwordV1ResT;

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

    await add('polish', EnPartOfSpeechE.verb, 'to make smooth and shiny', [
      { word: 'polished', form_of_word: EnWordFormsE.past_simple, area_variant: EnAreaVariantsE.common },
    ]);
    await add('polish', EnPartOfSpeechE.noun, 'a substance that makes shiny');
    await add('Polish', EnPartOfSpeechE.noun, 'the language of Poland');
    await add('lantern', EnPartOfSpeechE.noun, 'a light in a case');
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers a spelling with the word it spells, and names the other one', async () => {
    const lower = await read('polish');
    expect(lower.meta).toEqual({ word: 'polish', count: 2, variants: ['Polish'] });
    expect(lower.data.map((entry) => [entry.word, entry.part_of_speech])).toEqual([
      ['polish', 'noun'],
      ['polish', 'verb'],
    ]);

    const upper = await read('Polish');
    expect(upper.meta).toEqual({ word: 'Polish', count: 1, variants: ['polish'] });
    expect(upper.data.map((entry) => [entry.id, entry.word])).toEqual([[ids['Polish noun'], 'Polish']]);
  });

  it('answers a spelling the dictionary does not hold as it is with every word it may mean', async () => {
    const shouted = await read('POLISH');
    expect(shouted.meta).toEqual({ word: 'polish', count: 3, variants: ['Polish', 'polish'] });
    expect(shouted.data.map((entry) => entry.word).sort()).toEqual(['Polish', 'polish', 'polish']);
    // every entry says which word it is
    expect(new Set(shouted.data.map((entry) => entry.word)).size).toBe(2);
  });

  it('does not mind the case where the dictionary holds one spelling', async () => {
    for (const spelling of ['lantern', 'Lantern', 'LANTERN', '  lantern ']) {
      const found = await read(spelling);
      expect(found.meta).toEqual({ word: 'lantern', count: 1, variants: [] });
      expect(found.data[0].id).toBe(ids['lantern noun']);
    }
  });

  it('resolves an inflected form to its base entry, of the spelling it has', async () => {
    const form = await read('polished');
    expect(form.meta).toEqual({ word: 'polished', count: 1, variants: [] });
    expect(form.data.map((entry) => [entry.word, entry.part_of_speech])).toEqual([['polish', 'verb']]);
  });

  it('keeps the two words apart in the partial reads and in the history', async () => {
    const meanings = await read('Polish', '/meanings');
    expect(meanings.meta).toEqual({ word: 'Polish', count: 1, variants: ['polish'] });
    expect(meanings.data.map((meaning) => (meaning as unknown as { title: string }).title)).toEqual([
      'the language of Poland',
    ]);

    await request(server())
      .patch(`/api/en/common-info/${ids['Polish noun']}`)
      .set(auth)
      .send({ description: 'the language spoken in Poland' })
      .expect(200);

    const upper = await request(server()).get('/api/v1/words/Polish/history').expect(200);
    expect(upper.body.meta).toEqual({ word: 'Polish', count: 2, variants: ['polish'] });
    expect(
      upper.body.data.map((change: { word: string; action: string }) => [change.word, change.action]),
    ).toEqual([
      ['Polish', 'update'],
      ['Polish', 'create'],
    ]);
    // the history of "polish" knows nothing of the edit of "Polish"
    const lower = await request(server()).get('/api/v1/words/polish/history').expect(200);
    expect(
      lower.body.data.map((change: { word: string; part_of_speech: string; action: string }) => [
        change.word,
        change.part_of_speech,
        change.action,
      ]),
    ).toEqual([
      ['polish', 'noun', 'create'],
      ['polish', 'verb', 'create'],
    ]);
  });

  it('answers a batch by the words it names, once each', async () => {
    const batch = await request(server())
      .post('/api/v1/words/batch')
      .send({ words: ['Polish', 'polish', ' polish ', 'Lantern', 'lantern', 'Nothing'] })
      .expect(200);
    expect(batch.body.data.map((item: { word: string; count: number }) => [item.word, item.count])).toEqual([
      ['Polish', 1],
      ['polish', 2],
      ['lantern', 1],
    ]);
    expect(batch.body.meta).toEqual({ count: 3, not_found: ['nothing'] });
  });

  it('answers 404 for a spelling that names nothing, whatever its case', async () => {
    await request(server()).get('/api/v1/words/Polis').expect(404);
    await request(server()).get('/api/v1/words/polis/history').expect(404);
  });
});
