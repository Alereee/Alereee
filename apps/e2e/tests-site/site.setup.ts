import { test as setup } from '@playwright/test';

// Pure helpers from the server workspace (node:crypto + jsonwebtoken):
// the same Bearer derivation the server test suites use. The admin suite
// logs in through the UI instead; the site stack has no admin UI to do so.
import { hashLoginString } from '../../server/core/utils/crypto';
import { createJwt } from '../../server/core/utils/auth';
import { E2E_PASSWORD, E2E_USERNAME, SITE_API_URL } from '../config';
import { FIXTURE_WORDS } from '../helpers/site-fixture';

// Seeds the dictionary the website renders (issue #330). The words mirror
// apps/server/test/harness/public-api-fixture.ts, so the site suite and the
// SDK live tests assert the same data.
setup('seed the fixture words through the admin API', async ({ request }) => {
  const hashByEnv = await hashLoginString(E2E_USERNAME, E2E_PASSWORD);
  const secretHash = await hashLoginString(E2E_USERNAME, hashByEnv);
  const token = createJwt({ role: 'admin' }, secretHash + hashByEnv);
  const headers = { Authorization: `Bearer ${token}` };

  const ids = new Map<string, number>();
  for (const word of FIXTURE_WORDS) {
    const res = await request.post(`${SITE_API_URL}/en/add/word`, { data: word, headers });
    if (!res.ok()) {
      throw new Error(
        `Seeding "${(word as { word: string }).word}" failed with ${res.status()}: ${await res.text()}`,
      );
    }
    ids.set((word as { word: string }).word, ((await res.json()) as { id: number }).id);
  }

  // Two words a dataset of a public source spells the same but for the case:
  // each is a page of its own. Seeded here and not with the fixture words —
  // the SDK suites assert the counts of those
  for (const [word, part_of_speech, description] of [
    ['polish', 'verb', 'to make smooth and shiny'],
    ['Polish', 'noun', 'the language of Poland'],
  ]) {
    const res = await request.post(`${SITE_API_URL}/en/add/word`, {
      data: {
        word,
        part_of_speech,
        form_of_word: 'base_form',
        area_variant: 'common',
        description,
        forms: [],
        meanings: [],
        short_translations: [],
      },
      headers,
    });
    if (!res.ok()) throw new Error(`Seeding "${word}" failed with ${res.status()}: ${await res.text()}`);
    ids.set(word, ((await res.json()) as { id: number }).id);
  }
  const edited = await request.patch(`${SITE_API_URL}/en/common-info/${ids.get('Polish')}`, {
    data: { description: 'the language spoken in Poland' },
    headers,
  });
  if (!edited.ok()) throw new Error(`Editing "Polish" failed with ${edited.status()}`);

  // A correction of a reader who asked to be named, applied by the admin
  // (issue #531): the page of "sprint" says what was changed and who sent it
  const sent = await request.post(`${SITE_API_URL}/v1/suggestions`, {
    data: {
      headword: 'sprint',
      kind: 'edit',
      edits: [
        {
          target_type: 'word',
          target_id: ids.get('sprint'),
          changes: { description: 'to run at full speed for a short distance' },
        },
      ],
      author_name: 'Ada Lovelace',
      author_consent: true,
    },
  });
  if (!sent.ok()) throw new Error(`The correction was not taken: ${sent.status()} ${await sent.text()}`);
  const { data } = (await sent.json()) as { data: { id: number } };
  const applied = await request.post(`${SITE_API_URL}/en/suggestions/${data.id}/apply`, { headers });
  if (!applied.ok()) {
    throw new Error(`The correction was not applied: ${applied.status()} ${await applied.text()}`);
  }
});
