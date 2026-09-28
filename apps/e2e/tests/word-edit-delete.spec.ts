import { APIRequestContext, expect, Page, test } from '@playwright/test';

import { API_URL } from '../config';
import { seedWord } from '../helpers/seed';

// Edit and delete flows of the word card (issue #243 follow-up): every entity
// that word-crud.spec.ts creates through the UI is also edited and deleted
// through its card modal here, with the persisted result verified via the API.

const getWord = async (request: APIRequestContext, id: number) => {
  const res = await request.get(`${API_URL}/en/${id}`);
  expect(res.ok()).toBe(true);
  return res.json();
};

// The whole word-card section (title bar + content). The strong title text
// nests as span > strong inside the section's title div, so the section
// container is two div levels up from the matched <strong>
const wordCardSection = (page: Page, title: string) =>
  page.getByText(title, { exact: true }).locator('xpath=ancestor::div[2]');

// An entry as a dataset of a public source has it: what the source does not
// say — a level, a register, a pronunciation — is empty
const SOURCE_ENTRY =
  JSON.stringify({
    word: 'ambler',
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
    description: 'one who ambles',
    transcription: '',
    is_obsolete: false,
    version: '1.0.0',
    is_abbreviation: false,
    noun___uncountable: false,
    noun___irregular_plural: false,
    noun___always_plural: false,
    base_phrasal: '',
    phrasal_variants: [],
    forms: [{ word: 'amblers', form_of_word: 'plural_form', area_variant: 'common', transcription: '' }],
    short_translations: [{ language: 'ru', description: 'иноходец', variants_of_words: [] }],
    meanings: [
      {
        title: 'a walker',
        definition: 'One who walks at a slow pace.',
        sort_order: 1,
        is_obsolete: false,
        examples: [],
        area_variant: '',
        meaning_level: '',
        language_register: '',
        categories: [],
        synonyms: [],
        antonyms: [],
        translations: [
          { language: 'ru', title: 'иноходец', definition: 'тот, кто идёт не спеша', variants_of_words: [] },
        ],
      },
    ],
  }) + '\n';

test.describe('UI-driven word edit and delete', () => {
  // issue #531: what was changed in an entry, and the way back
  test('the card shows the history of the word and takes an edit back', async ({ page, request }) => {
    const id = await seedWord(request, 'ramble');
    const edited = await request.patch(`${API_URL}/en/common-info/${id}`, {
      data: { description: 'to walk without a goal' },
    });
    expect(edited.ok()).toBe(true);

    await page.goto(`/en/managing/edit-word/${id}`);
    const card = page.locator('section').first();
    await expect(card.getByText('to walk without a goal', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'History of edits' }).click();
    const history = page.getByTestId('changes-history');
    // taking it back leaves a row of its own, a change as well
    const edit = history.getByRole('row').filter({ hasText: 'changed' }).filter({ hasNotText: 'taken back' });
    await expect(edit).toContainText('to ramble fast');
    await expect(edit).toContainText('to walk without a goal');
    await expect(history.getByRole('row').filter({ hasText: 'added' })).toHaveCount(1);

    await edit.getByRole('button', { name: 'Take back' }).click();
    await page.getByRole('tooltip').getByRole('button', { name: 'Take back' }).click();
    await expect(page.getByText('The change was taken back')).toBeVisible();

    // the card says what the word said before the edit
    await expect(card.getByText('to ramble fast', { exact: true })).toBeVisible();
    expect((await getWord(request, id)).description).toBe('to ramble fast');

    // the history keeps both: the edit, and that it was taken back
    await expect(edit).toContainText('no longer shows since');
    await expect(edit.getByRole('button', { name: 'Take back' })).toHaveCount(0);
    await expect(history.getByRole('row').filter({ hasText: 'taken back' })).toHaveCount(1);
  });

  // issue #531: a dialog is opened to look as often as to edit. Saved as it
  // was opened it changes nothing — no value of a form takes the place of a
  // field the source left empty, no row of the history, no mark on the entry
  test('a dialog saved as it was opened leaves the entry as its source has it', async ({ page, request }) => {
    const imported = await request.post(`${API_URL}/en/dictionary/import/upload`, {
      multipart: {
        words: { name: 'words.jsonl', mimeType: 'application/x-ndjson', buffer: Buffer.from(SOURCE_ENTRY) },
      },
    });
    expect(imported.ok()).toBe(true);
    const check = await request.get(`${API_URL}/en/check-word/ambler?partOfSpeech=noun`);
    const { id } = (await check.json()) as { id: number };
    const before = await getWord(request, id);
    expect(before).toEqual(
      expect.objectContaining({ language_register: null, word_level: null, user_modified: false }),
    );

    await page.goto(`/en/managing/edit-word/${id}`);
    const save = async () => {
      const dialog = page.getByRole('dialog').filter({ visible: true });
      await dialog.getByRole('button', { name: 'OK' }).click();
      await expect(dialog).toBeHidden();
    };
    await page.getByRole('button', { name: 'Edit Common Data' }).click();
    await save();
    await wordCardSection(page, 'Short Translations').getByRole('button', { name: 'edit' }).click();
    await save();
    await wordCardSection(page, 'Word Meanings').getByRole('button', { name: 'edit' }).first().click();
    await save();
    await wordCardSection(page, 'Word Meanings').getByRole('button', { name: 'edit' }).nth(1).click();
    await save();
    await page.getByText('Plural form:').locator('..').getByRole('button', { name: 'edit' }).click();
    await save();

    expect(await getWord(request, id)).toEqual(before);
    const history = await request.get(`${API_URL}/en/changes?headword=ambler`);
    expect(((await history.json()) as { total: number }).total).toBe(0);
    await expect(page.getByText('Modified by you')).toHaveCount(0);
  });

  test('edits a short translation through the card modal and persists it', async ({ page, request }) => {
    const id = await seedWord(request, 'perish');

    await page.goto(`/en/managing/edit-word/${id}`);
    // The only translation card in the section carries one edit button
    await wordCardSection(page, 'Short Translations').getByRole('button', { name: 'edit' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Editing Short Translation')).toBeVisible();
    await dialog.locator('textarea').fill('погибать, исчезать');
    await dialog.getByRole('button', { name: 'OK' }).click();

    await expect(page.getByText('Short translation updated')).toBeVisible();
    await expect(page.getByRole('main').getByText('погибать, исчезать')).toBeVisible();

    const word = await getWord(request, id);
    expect(word.short_translations).toEqual([
      expect.objectContaining({ language: 'ru', description: 'погибать, исчезать' }),
    ]);
  });

  test('deletes a short translation through the confirmation modal', async ({ page, request }) => {
    const id = await seedWord(request, 'crumble', {
      short_translations: [{ language: 'ru', description: 'краткий перевод crumble', variants_of_words: [] }],
    });

    await page.goto(`/en/managing/edit-word/${id}`);
    const section = wordCardSection(page, 'Short Translations');
    await expect(section.getByText('краткий перевод crumble')).toBeVisible();
    await section.getByRole('button', { name: 'close' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'OK' }).click();

    // Deleting a short translation shows no toast — the card just re-renders
    await expect(section.getByText('краткий перевод crumble')).toBeHidden();

    const word = await getWord(request, id);
    expect(word.short_translations).toEqual([]);
  });

  test('edits a meaning through the card modal and persists it', async ({ page, request }) => {
    const id = await seedWord(request, 'mend');

    await page.goto(`/en/managing/edit-word/${id}`);
    // The first edit button in the section belongs to the meaning itself;
    // the later ones belong to its translations
    await wordCardSection(page, 'Word Meanings').getByRole('button', { name: 'edit' }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Editing Meaning')).toBeVisible();
    await dialog.getByRole('textbox').first().fill('to repair');
    await dialog.locator('textarea').fill('to fix something that is broken');
    await dialog.getByRole('button', { name: 'OK' }).click();

    await expect(page.getByText('Meaning updated')).toBeVisible();
    await expect(page.getByRole('main').getByText('to repair')).toBeVisible();

    const word = await getWord(request, id);
    expect(word.meanings).toEqual([
      expect.objectContaining({ title: 'to repair', definition: 'to fix something that is broken' }),
    ]);
    // Editing the meaning must not touch its translations
    expect(word.meanings[0].translations).toHaveLength(1);
  });

  test('deletes a meaning through the confirmation modal', async ({ page, request }) => {
    const id = await seedWord(request, 'fade');

    await page.goto(`/en/managing/edit-word/${id}`);
    const section = wordCardSection(page, 'Word Meanings');
    await expect(section.getByText('fade meaning')).toBeVisible();
    // The first close button deletes the meaning; the later ones its translations
    await section.getByRole('button', { name: 'close' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'OK' }).click();

    await expect(page.getByText('Meaning deleted successfully')).toBeVisible();
    await expect(section.getByText('fade meaning')).toBeHidden();

    const word = await getWord(request, id);
    expect(word.meanings).toEqual([]);
  });

  test('edits a meaning translation through the card modal and persists it', async ({ page, request }) => {
    const id = await seedWord(request, 'soothe');

    await page.goto(`/en/managing/edit-word/${id}`);
    // Edit buttons in the meanings section: [0] the meaning, [1] its translation
    await wordCardSection(page, 'Word Meanings').getByRole('button', { name: 'edit' }).nth(1).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Editing Meaning Translation')).toBeVisible();
    await dialog.getByRole('textbox').first().fill('успокаивать');
    await dialog.locator('textarea').fill('снимать боль или волнение');
    await dialog.getByRole('button', { name: 'OK' }).click();

    await expect(page.getByText('Meaning Translation updated')).toBeVisible();
    await expect(page.getByRole('main').getByText('успокаивать')).toBeVisible();

    const word = await getWord(request, id);
    expect(word.meanings[0].translations).toEqual([
      expect.objectContaining({
        language: 'ru',
        title: 'успокаивать',
        definition: 'снимать боль или волнение',
        // Untouched fields survive the edit
        variants_of_words: ['перевод-soothe'],
      }),
    ]);
  });

  test('deletes a meaning translation through the confirmation modal', async ({ page, request }) => {
    const id = await seedWord(request, 'scatter');

    await page.goto(`/en/managing/edit-word/${id}`);
    const section = wordCardSection(page, 'Word Meanings');
    // Close buttons in the meanings section: [0] the meaning, [1] its translation
    await section.getByRole('button', { name: 'close' }).nth(1).click();
    await page.getByRole('dialog').getByRole('button', { name: 'OK' }).click();

    await expect(page.getByText('Meaning Translation deleted successfully')).toBeVisible();
    await expect(section.getByText('перевод scatter')).toBeHidden();

    const word = await getWord(request, id);
    expect(word.meanings).toHaveLength(1);
    expect(word.meanings[0].translations).toEqual([]);
  });

  test('adds and removes synonyms / antonyms inline on the card (issue #266)', async ({ page, request }) => {
    // the link targets must exist before the word that links to them
    await seedWord(request, 'twinkle');
    await seedWord(request, 'blacken');
    const id = await seedWord(request, 'sparkle', {
      meanings: [
        {
          title: 'sparkle meaning',
          definition: 'definition of sparkle',
          is_obsolete: false,
          sort_order: 1,
          examples: [],
          area_variant: 'common',
          synonyms: ['twinkle'],
          translations: [],
        },
      ],
    });

    await page.goto(`/en/managing/edit-word/${id}`);
    const section = wordCardSection(page, 'Word Meanings');
    // each relation is one row: its label, the linked-word tags and the controls
    const row = (label: string) => section.getByText(label, { exact: true }).locator('xpath=..');
    await expect(row('Synonyms:').getByRole('link', { name: 'twinkle' })).toBeVisible();

    // add an antonym through the inline picker; the dropdown shows the part of speech
    await row('Antonyms:').getByRole('button', { name: 'plus' }).click();
    await row('Antonyms:').getByRole('combobox').fill('bla');
    const option = page.locator('.ant-select-item-option-content').filter({ hasText: 'blacken' });
    await expect(option).toContainText('verb');
    await option.click();
    await expect(page.getByText('Meaning updated').first()).toBeVisible();
    await row('Antonyms:').getByRole('button', { name: 'check' }).click();
    await expect(row('Antonyms:').getByRole('link', { name: 'blacken' })).toBeVisible();

    // unlink the synonym from its tag
    await row('Synonyms:').locator('.ant-tag-close-icon').click();
    await expect(row('Synonyms:').getByRole('link', { name: 'twinkle' })).toBeHidden();

    const word = await getWord(request, id);
    expect(word.meanings[0].synonyms).toEqual([]);
    expect(word.meanings[0].antonyms).toEqual(['blacken']);
  });

  test('edits a word form through the card modal and persists it', async ({ page, request }) => {
    const id = await seedWord(request, 'drift');

    await page.goto(`/en/managing/edit-word/${id}`);
    await page.getByText('Past simple:').locator('..').getByRole('button', { name: 'edit' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Editing Word Form')).toBeVisible();
    await dialog.getByPlaceholder('Word', { exact: true }).fill('drifted-edited');
    await dialog.getByPlaceholder('Pronunciation').fill('ˈdrɪftɪd');
    await dialog.getByRole('button', { name: 'OK' }).click();

    // Editing a form shows no toast — the modal closes and the tag updates
    await expect(dialog).toBeHidden();
    await expect(page.getByText('drifted-edited', { exact: true })).toBeVisible();

    const word = await getWord(request, id);
    expect(word.forms).toEqual([
      expect.objectContaining({
        word: 'drifted-edited',
        form_of_word: 'past_simple',
        transcription: 'ˈdrɪftɪd',
      }),
    ]);
  });

  test('deletes a word form through the confirmation modal', async ({ page, request }) => {
    // The seed helper derives the past-simple form as `word + 'ed'`, so the
    // base word must not end in 'e' for the form to read naturally
    const id = await seedWord(request, 'ascend');

    await page.goto(`/en/managing/edit-word/${id}`);
    await expect(page.getByText('ascended', { exact: true })).toBeVisible();
    await page.getByText('Past simple:').locator('..').getByRole('button', { name: 'close' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'OK' }).click();

    await expect(page.getByText('Word form deleted successfully')).toBeVisible();
    await expect(page.getByText('ascended', { exact: true })).toBeHidden();

    const word = await getWord(request, id);
    expect(word.forms).toEqual([]);
  });

  test('cancelling the common-data modal keeps the word unchanged', async ({ page, request }) => {
    const id = await seedWord(request, 'endure');

    await page.goto(`/en/managing/edit-word/${id}`);
    await page.getByRole('button', { name: 'Edit Common Data' }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('Word Description').fill('this edit must never be saved');
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await expect(dialog).toBeHidden();
    const main = page.getByRole('main');
    await expect(main.getByText('to endure fast')).toBeVisible();
    await expect(main.getByText('this edit must never be saved')).toBeHidden();

    const word = await getWord(request, id);
    expect(word.description).toBe('to endure fast');
  });
});
