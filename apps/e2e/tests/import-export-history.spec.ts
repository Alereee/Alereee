import { statSync } from 'node:fs';
import { expect, test } from '@playwright/test';

import { API_URL } from '../config';
import { seedWord } from '../helpers/seed';

// One minimal dataset line in the export format (issue #353); the field set
// mirrors makeSetWord in the server's import spec — forms, short_translations
// and meanings must at least be empty arrays
const datasetLine = (word: string) =>
  JSON.stringify({
    word,
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
    description: `to ${word} through the import pipeline`,
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

// The heavy managing flows end to end (issue #353): an upload import with the
// live NDJSON progress, the export download, and the audit rows both leave.
// The tests build on each other, so they run in this order (workers: 1).
test.describe('import, export and history', () => {
  test('a words file uploaded on the Separate files tab imports with live progress', async ({
    page,
    request,
  }) => {
    await page.goto('/en/managing/import-dictionary');
    await page.getByRole('tab', { name: 'Separate files' }).click();

    await page
      .getByTestId('slot-words')
      .locator('input[type=file]')
      .setInputFiles({
        name: 'words.jsonl',
        mimeType: 'application/x-ndjson',
        buffer: Buffer.from(datasetLine('e2eimported')),
      });

    // the version typed by hand travels as the manifest override and comes
    // back through the progress stream once the import completes
    await page.getByRole('radio', { name: 'Fill in by hand' }).check();
    await page.getByLabel('Dataset version').fill('9.9.9');

    await page.getByRole('button', { name: 'Start importing' }).click();

    // the NDJSON stream drives the bar to 100% and the action row leaves
    await expect(page.getByText('100.00%')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Start importing' })).toBeHidden();

    // the word really landed, through the normal read API
    const check = await request.get(`${API_URL}/en/check-word/e2eimported?partOfSpeech=verb`);
    expect(((await check.json()) as { hasWord: boolean }).hasWord).toBe(true);
  });

  test('the export streams its progress and downloads the archive', async ({ page }) => {
    await page.goto('/en/managing/export-dictionary');

    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Start exporting' }).click();

    const download = await downloading;
    expect(download.suggestedFilename()).toBe('vocab-bloom-hub-en-export.zip');
    const path = await download.path();
    expect(statSync(path).size).toBeGreaterThan(0);

    await expect(page.getByText('100.00%')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Export again' })).toBeVisible();
  });

  // An entry edited here carries custom_version, a mark of this instance:
  // the owner names the version such entries are published under
  test('the export takes the version of the edited entries, and nothing that is not a version', async ({
    page,
  }) => {
    await page.goto('/en/managing/export-dictionary');
    const version = page.getByLabel('Version of the entries edited here');
    const start = page.getByRole('button', { name: 'Start exporting' });
    await expect(page.getByText('The dictionary itself is not changed.', { exact: false })).toBeVisible();

    await version.fill('the next one');
    await expect(page.getByText('64 characters at most', { exact: false })).toBeVisible();
    await expect(start).toBeDisabled();

    await version.fill('2.1.0');
    await expect(start).toBeEnabled();
    const asked = page.waitForRequest((request) => request.url().includes('/dictionary/export?'));
    await start.click();
    expect(new URL((await asked).url()).searchParams.get('edited_version')).toBe('2.1.0');
    await expect(page.getByText('100.00%')).toBeVisible({ timeout: 30_000 });
  });

  // issue #531: one journal for one thing
  test('history keeps the edits of the dictionary apart from the events of the instance', async ({
    page,
    request,
  }) => {
    await seedWord(request, 'chronicle');

    await page.goto('/en/history');
    await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible();

    // the edits of the dictionary come first; the search narrows by headword prefix (fires on Enter)
    await expect(page.getByRole('tab', { name: 'Edits of the dictionary' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.getByPlaceholder('Word prefix…').fill('chronicle');
    await page.getByPlaceholder('Word prefix…').press('Enter');
    const seededRow = page.getByRole('row').filter({ hasText: 'chronicle' });
    await expect(seededRow).toHaveCount(1);
    await expect(seededRow).toContainText('added');
    await expect(seededRow).toContainText('entry');
    await expect(seededRow.getByRole('button', { name: 'Take back' })).toBeVisible();

    // what was done on the instance is the other journal: the import of the
    // first test is one summary row, import / dictionary
    await page.getByRole('tab', { name: 'Events of the instance' }).click();
    const importRow = page.getByRole('row').filter({ hasText: 'dictionary' }).filter({ hasText: 'import' });
    await expect(importRow.first()).toBeVisible();
    await expect(importRow.first()).toContainText('source');
    // the word that was added is no event of the instance
    await expect(page.getByRole('row').filter({ hasText: 'chronicle' })).toHaveCount(0);
  });
});
