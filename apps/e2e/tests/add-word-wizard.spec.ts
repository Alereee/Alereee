import { APIRequestContext, expect, Page, test } from '@playwright/test';

import { API_URL } from '../config';
import { seedWord } from '../helpers/seed';
import { pickOption } from '../helpers/select';

// Branches of the add-word wizard beyond the minimal happy path covered in
// word-crud.spec.ts: forms + meaning + meaning translation filled through the
// wizard steps, the already-exists branch, and the phrase / grammar-pattern
// entry types.

const resolveWordId = async (request: APIRequestContext, word: string, pos: string): Promise<number> => {
  const res = await request.get(`${API_URL}/en/check-word/${encodeURIComponent(word)}?partOfSpeech=${pos}`);
  const check = (await res.json()) as { hasWord?: boolean; id?: number };
  expect(check.hasWord).toBe(true);
  return check.id as number;
};

const getWord = async (request: APIRequestContext, id: number) => {
  const res = await request.get(`${API_URL}/en/${id}`);
  expect(res.ok()).toBe(true);
  return res.json();
};

const clickNext = (page: Page) => page.getByRole('button', { name: 'Next' }).click();

// Small titled blocks render as <Text strong>{title}</Text> + <Button +/>
// inside one container; the strong text nests one div level below it
const addButtonNextTo = (page: Page, title: string) =>
  page
    .getByText(title, { exact: true })
    .locator('xpath=ancestor::div[1]')
    .getByRole('button', { name: 'plus' });

test.describe('add-word wizard branches', () => {
  test('adds a word with a form, a meaning, and its translation through the wizard', async ({
    page,
    request,
  }) => {
    await page.goto('/en/managing/add-word');

    await page.getByRole('textbox').fill('stumble');
    await page.getByRole('combobox').last().click();
    await pickOption(page, 'verb');
    await page.getByRole('button', { name: 'check-circle' }).click();

    // Basic information
    await page.getByPlaceholder('Word Description').fill('to trip while walking');
    await clickNext(page);

    // Word forms: one pre-created empty row per form type, past simple first
    await page.getByPlaceholder('Form').first().fill('stumbled');
    await clickNext(page);

    // Meanings: title, definition, and one example
    await page.getByRole('button', { name: /Add meaning/ }).click();
    await page.getByRole('textbox').first().fill('to trip over something');
    await page.locator('textarea').fill('to hit your foot against something and almost fall');
    await addButtonNextTo(page, 'Examples').click();
    await page.getByRole('textbox').last().fill('I stumbled on a rock');
    await clickNext(page);

    // Short translations: skipped, the untouched default row is dropped
    await clickNext(page);

    // Meaning translations: one ru translation with a direct-translation variant
    await page.getByRole('button', { name: /Add translation/ }).click();
    await page.getByRole('textbox').first().fill('споткнуться');
    await page.locator('textarea').fill('задеть ногой препятствие и чуть не упасть');
    await addButtonNextTo(page, 'Possible Direct Translations').click();
    await page.getByRole('textbox').last().fill('спотыкаться');
    await clickNext(page);

    await page.getByRole('button', { name: 'Add word' }).click();
    await expect(page.getByText('Added successfully!')).toBeVisible();

    const id = await resolveWordId(request, 'stumble', 'verb');
    const word = await getWord(request, id);
    expect(word.forms).toEqual([expect.objectContaining({ word: 'stumbled', form_of_word: 'past_simple' })]);
    expect(word.meanings).toEqual([
      expect.objectContaining({
        title: 'to trip over something',
        definition: 'to hit your foot against something and almost fall',
        examples: ['I stumbled on a rock'],
      }),
    ]);
    expect(word.meanings[0].translations).toEqual([
      expect.objectContaining({
        language: 'ru',
        title: 'споткнуться',
        definition: 'задеть ногой препятствие и чуть не упасть',
        variants_of_words: ['спотыкаться'],
      }),
    ]);
    expect(word.short_translations).toEqual([]);
  });

  test('shows the already-exists block with a link to the edit page', async ({ page, request }) => {
    const id = await seedWord(request, 'hollow');

    await page.goto('/en/managing/add-word');
    await page.getByRole('textbox').fill('hollow');
    await page.getByRole('combobox').last().click();
    await pickOption(page, 'verb');
    await page.getByRole('button', { name: 'check-circle' }).click();

    await expect(page.getByText('Word already exists')).toBeVisible();
    await page.getByRole('link', { name: 'Edit word?' }).click();

    await expect(page).toHaveURL(new RegExp(`/en/managing/edit-word/${id}$`));
    await expect(page.getByText('hollow meaning')).toBeVisible();
  });

  test('adds a phrase entry and persists it', async ({ page, request }) => {
    await page.goto('/en/managing/add-word');

    // Switching the entry type fixes the part of speech and hides its select.
    // Scoped to main (the header carries a locale combobox) and to enabled
    // ones (the sidebar carries a disabled dictionary combobox)
    await page.getByRole('main').getByRole('combobox', { disabled: false }).first().click();
    // EntityTypeSelect renders its options through a custom optionRender, so
    // the visible dropdown items carry neither a title attribute nor the
    // accessible option role (rc-select keeps that on a hidden a11y list) —
    // click the visible item by its text instead
    await page.locator('.ant-select-item-option').filter({ hasText: 'Phrase' }).click();
    await page.getByRole('textbox').fill('break the ice');
    await page.getByRole('button', { name: 'check-circle' }).click();

    await page.getByPlaceholder('Word Description').fill('to make people feel more relaxed');
    await clickNext(page); // basic information
    await clickNext(page); // word forms — phrases have none
    await clickNext(page); // meanings

    await page.locator('textarea').fill('растопить лёд, разрядить обстановку');
    await clickNext(page); // short translations
    await clickNext(page); // meaning translations

    await page.getByRole('button', { name: 'Add word' }).click();
    await expect(page.getByText('Added successfully!')).toBeVisible();

    const id = await resolveWordId(request, 'break the ice', 'phrase');
    const word = await getWord(request, id);
    expect(word.part_of_speech).toBe('phrase');
    expect(word.forms).toEqual([]);
    expect(word.short_translations).toEqual([
      expect.objectContaining({ language: 'ru', description: 'растопить лёд, разрядить обстановку' }),
    ]);
  });

  test('adds a grammar pattern with the pattern editor and persists it', async ({ page, request }) => {
    await page.goto('/en/managing/add-word');

    await page.getByRole('main').getByRole('combobox', { disabled: false }).first().click();
    await page.locator('.ant-select-item-option').filter({ hasText: 'Grammar Pattern' }).click();
    await page.getByRole('textbox').fill('no sooner than');
    await page.getByRole('button', { name: 'check-circle' }).click();

    await page
      .getByPlaceholder('Word Description')
      .fill('emphasises that one thing happens right after another');
    // Build the pattern: a text part, a slot, another text part. Every new
    // part is appended at the end, so it is the last textbox on the page
    await page.getByRole('button', { name: 'Add Part' }).click();
    await page.getByRole('textbox').last().fill('no sooner');
    await page.getByRole('button', { name: 'Add SLOT' }).click();
    await page.getByRole('button', { name: 'Add Part' }).click();
    await page.getByRole('textbox').last().fill('than');
    await clickNext(page); // basic information
    await clickNext(page); // word forms — grammar patterns have none
    await clickNext(page); // meanings
    await clickNext(page); // short translations
    await clickNext(page); // meaning translations

    await page.getByRole('button', { name: 'Add word' }).click();
    await expect(page.getByText('Added successfully!')).toBeVisible();

    const id = await resolveWordId(request, 'no sooner than', 'grammar_pattern');
    const word = await getWord(request, id);
    expect(word.part_of_speech).toBe('grammar_pattern');
    expect(word.pattern).toEqual(['no sooner', '__SLOT__', 'than']);
  });
});
