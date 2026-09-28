import { APIRequestContext, expect, Page, test } from '@playwright/test';

import { API_URL } from '../config';
import { seedWord } from '../helpers/seed';
import { pickOption } from '../helpers/select';

// UI-driven CRUD flows (issue #243): every scenario performs the change through
// the real admin UI and then verifies the persisted result through the API
// against the isolated e2e database. Prerequisite data is still seeded via the
// API — only the flow under test goes through the browser.

const getWord = async (request: APIRequestContext, id: number) => {
  const res = await request.get(`${API_URL}/en/${id}`);
  expect(res.ok()).toBe(true);
  return res.json();
};

// Section headers in the word card render as <Text strong>{title}</Text> next
// to their add <Button +/> inside one container div; the strong text nests one
// level deeper than the plain text, so climb to the nearest div instead of '..'
const sectionAddButton = (page: Page, title: string) =>
  page
    .getByText(title, { exact: true })
    .locator('xpath=ancestor::div[1]')
    .getByRole('button', { name: 'plus' });

test.describe('UI-driven word CRUD', () => {
  test('adds a word through the add-word wizard and persists it', async ({ page, request }) => {
    await page.goto('/en/managing/add-word');

    // Step 1: check that the word does not exist yet
    await page.getByRole('textbox').fill('sprout');
    await page.getByRole('combobox').last().click();
    await pickOption(page, 'verb');
    await page.getByRole('button', { name: 'check-circle' }).click();

    // Step 2: basic information (the wizard advances only when the word is absent)
    await page.getByPlaceholder('Word Description').fill('to begin to grow');
    await page.getByPlaceholder('Pronunciation').fill('spraʊt');
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 3: word forms — left empty, blank rows are dropped before submit
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 4: meanings — skipped, covered by the edit-page scenario below
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 5: short translations — fill the default ru row
    await page.locator('textarea').fill('пускать ростки');
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 6: meaning translations — nothing to translate
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 7: preview and save
    await page.getByRole('button', { name: 'Add word' }).click();
    await expect(page.getByText('Added successfully!')).toBeVisible();

    // The form-to-database chain really persisted the word
    const checkRes = await request.get(`${API_URL}/en/check-word/sprout?partOfSpeech=verb`);
    const check = (await checkRes.json()) as { hasWord?: boolean; id?: number };
    expect(check.hasWord).toBe(true);

    const word = await getWord(request, check.id as number);
    expect(word.word).toBe('sprout');
    expect(word.part_of_speech).toBe('verb');
    expect(word.description).toBe('to begin to grow');
    expect(word.transcription).toBe('spraʊt');
    expect(word.short_translations).toEqual([
      expect.objectContaining({ language: 'ru', description: 'пускать ростки' }),
    ]);
  });

  test('edits common data through the edit modal and persists it', async ({ page, request }) => {
    const id = await seedWord(request, 'flourish');

    await page.goto(`/en/managing/edit-word/${id}`);
    await page.getByRole('button', { name: 'Edit Common Data' }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('Word Description').fill('to grow or develop successfully');
    await dialog.getByPlaceholder('Pronunciation').fill('ˈflʌr.ɪʃ');
    await dialog.getByRole('button', { name: 'OK' }).click();

    // The modal closes on success and the card re-renders with the new data
    await expect(dialog).toBeHidden();
    // Scoped to main: the closed modal keeps the same text inside its textarea
    const main = page.getByRole('main');
    await expect(main.getByText('to grow or develop successfully')).toBeVisible();
    await expect(main.getByText('ˈflʌr.ɪʃ')).toBeVisible();

    const word = await getWord(request, id);
    expect(word.description).toBe('to grow or develop successfully');
    expect(word.transcription).toBe('ˈflʌr.ɪʃ');
  });

  test('adds a short translation through the card modal and persists it', async ({ page, request }) => {
    const id = await seedWord(request, 'wither');

    await page.goto(`/en/managing/edit-word/${id}`);
    await sectionAddButton(page, 'Short Translations').click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Adding Short Translation')).toBeVisible();
    await dialog.getByRole('textbox').fill('вянуть, увядать');
    await dialog.getByRole('button', { name: 'OK' }).click();

    await expect(page.getByText('Short translation added')).toBeVisible();
    // Scoped to main: the closed modal keeps the same text inside its textarea
    await expect(page.getByRole('main').getByText('вянуть, увядать')).toBeVisible();

    // The seeded word already carries one ru short translation
    const word = await getWord(request, id);
    expect(word.short_translations).toHaveLength(2);
    expect(word.short_translations).toEqual(
      expect.arrayContaining([expect.objectContaining({ language: 'ru', description: 'вянуть, увядать' })]),
    );
  });

  test('adds a word form through the card modal and persists it', async ({ page, request }) => {
    // Seeded without forms so every form row shows only its add button
    const id = await seedWord(request, 'linger', { forms: [] });

    await page.goto(`/en/managing/edit-word/${id}`);
    await page.getByText('Past simple:').locator('..').getByRole('button', { name: 'plus' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Adding Word Form')).toBeVisible();
    await dialog.getByPlaceholder('Word', { exact: true }).fill('lingered');
    await dialog.getByPlaceholder('Pronunciation').fill('ˈlɪŋɡəd');
    await dialog.getByRole('button', { name: 'OK' }).click();

    // Adding a form shows no toast — the modal just closes and the tag appears
    await expect(dialog).toBeHidden();
    await expect(page.getByText('lingered', { exact: true })).toBeVisible();

    const word = await getWord(request, id);
    expect(word.forms).toEqual([
      expect.objectContaining({ word: 'lingered', form_of_word: 'past_simple', transcription: 'ˈlɪŋɡəd' }),
    ]);
  });

  test('adds a meaning with a ru translation through the card modals and persists them', async ({
    page,
    request,
  }) => {
    // Seeded without meanings so the card starts from an empty meanings section
    const id = await seedWord(request, 'bloom', { meanings: [] });

    await page.goto(`/en/managing/edit-word/${id}`);
    await sectionAddButton(page, 'Word Meanings').click();

    // The meaning modal has exactly two textboxes: the short-meaning input and
    // the definition textarea (sort order is a spinbutton, selects are comboboxes)
    const meaningDialog = page.getByRole('dialog');
    await expect(meaningDialog.getByText('Add meaning')).toBeVisible();
    await meaningDialog.getByRole('textbox').first().fill('to produce flowers');
    await meaningDialog.getByRole('textbox').last().fill('of a plant: to open its flowers');
    await meaningDialog.getByRole('button', { name: 'OK' }).click();
    await expect(page.getByText('Meaning added')).toBeVisible();
    await expect(page.getByRole('main').getByText('to produce flowers')).toBeVisible();

    // Now translate the freshly added meaning
    await page.getByRole('button', { name: /Add translation/ }).click();
    const translationDialog = page.getByRole('dialog');
    await expect(translationDialog.getByText('Adding Meaning Translation')).toBeVisible();
    await translationDialog.getByRole('textbox').first().fill('цвести');
    await translationDialog.getByRole('textbox').last().fill('о растении: раскрывать цветки');
    await translationDialog.getByRole('button', { name: 'OK' }).click();

    await expect(page.getByText('Meaning Translation added')).toBeVisible();
    await expect(page.getByRole('main').getByText('цвести')).toBeVisible();

    const word = await getWord(request, id);
    expect(word.meanings).toHaveLength(1);
    expect(word.meanings[0]).toEqual(
      expect.objectContaining({ title: 'to produce flowers', definition: 'of a plant: to open its flowers' }),
    );
    expect(word.meanings[0].translations).toEqual([
      expect.objectContaining({
        language: 'ru',
        title: 'цвести',
        definition: 'о растении: раскрывать цветки',
      }),
    ]);
  });
});
