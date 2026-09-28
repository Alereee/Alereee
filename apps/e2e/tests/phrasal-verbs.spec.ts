import { APIRequestContext, expect, test } from '@playwright/test';

import { API_URL } from '../config';
import { seedWord } from '../helpers/seed';
import { pickOption } from '../helpers/select';

// Phrasal-verb flows: linking a phrasal verb to its base verb through the
// add-word wizard and through the word-card modal.

const getWord = async (request: APIRequestContext, id: number) => {
  const res = await request.get(`${API_URL}/en/${id}`);
  expect(res.ok()).toBe(true);
  return res.json();
};

test.describe('phrasal verbs', () => {
  test('adds a phrasal verb with a checked base through the wizard', async ({ page, request }) => {
    await seedWord(request, 'give');

    await page.goto('/en/managing/add-word');
    await page.getByRole('textbox').fill('give up');
    await page.getByRole('combobox').last().click();
    await pickOption(page, 'verb');
    await page.getByRole('button', { name: 'check-circle' }).click();

    // Basic information: marking the verb as phrasal reveals the base check
    await page.getByPlaceholder('Word Description').fill('to stop trying');
    await page.getByText('Phrasal Verb', { exact: true }).click();
    const baseInput = page
      .getByText('Base of Phrasal Verb', { exact: true })
      .locator('xpath=ancestor::div[1]')
      .locator('input');
    await baseInput.fill('give');
    const baseCheck = page.waitForResponse((r) => r.url().includes('/en/check-word/'));
    await page.getByRole('button', { name: 'check-circle' }).click();
    await baseCheck;
    await page.getByRole('button', { name: 'Next' }).click();

    await page.getByRole('button', { name: 'Next' }).click(); // word forms
    await page.getByRole('button', { name: 'Next' }).click(); // meanings
    await page.getByRole('button', { name: 'Next' }).click(); // short translations
    await page.getByRole('button', { name: 'Next' }).click(); // meaning translations

    await page.getByRole('button', { name: 'Add word' }).click();
    await expect(page.getByText('Added successfully!')).toBeVisible();

    const res = await request.get(
      `${API_URL}/en/check-word/${encodeURIComponent('give up')}?partOfSpeech=verb`,
    );
    const check = (await res.json()) as { hasWord?: boolean; id?: number };
    expect(check.hasWord).toBe(true);

    const word = await getWord(request, check.id as number);
    expect(word.verb___is_phrasal).toBe(true);
    expect(word.base_phrasal).toBe('give');
  });

  test('links a base verb to an existing phrasal verb through the card modal', async ({ page, request }) => {
    await seedWord(request, 'take');
    const id = await seedWord(request, 'take off', { verb___is_phrasal: true });

    await page.goto(`/en/managing/edit-word/${id}`);
    await page.getByRole('button', { name: /Add Base of Phrasal Verb/ }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Adding Base of Phrasal Verb')).toBeVisible();
    await dialog.getByRole('textbox').fill('take');
    // OK submits only once the base has been checked and resolved to an id
    const baseCheck = page.waitForResponse((r) => r.url().includes('/en/check-word/'));
    await dialog.getByRole('button', { name: 'check-circle' }).click();
    await baseCheck;
    await dialog.getByRole('button', { name: 'OK' }).click();

    await expect(dialog).toBeHidden();
    // The tag mixes the label and the base word, so no element matches the
    // bare word exactly — assert on the tag around the label instead
    const baseTag = page.getByRole('main').getByText('Base of Phrasal Verb:').locator('..');
    await expect(baseTag).toContainText('take');

    const word = await getWord(request, id);
    expect(word.base_phrasal).toBe('take');
  });
});
