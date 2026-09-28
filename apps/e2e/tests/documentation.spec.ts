import { expect, test } from '@playwright/test';

import { seedWord } from '../helpers/seed';
import { pickOption } from '../helpers/select';

test.describe('documentation', () => {
  test('index page lists every documented public endpoint', async ({ page }) => {
    await page.goto('/en/documentation');

    // the searches are GET reads only (issue #396); the POST forms are gone (#440)
    await expect(page.getByRole('link', { name: 'Basic search', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Detailed search', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /POST form/ })).toHaveCount(0);
    // the auth routes are admin plumbing, not part of the public API
    await expect(page.getByRole('link', { name: 'Sign in' })).toHaveCount(0);
  });

  test('endpoint page describes the request filters', async ({ page }) => {
    await page.goto('/en/documentation/search-detailed');

    // the same path also shows up inside the curl example below
    await expect(page.getByText('/api/v1/search/detailed', { exact: true })).toBeVisible();
    await expect(page.getByText(/Shares the public API budget/)).toBeVisible();

    const params = page.getByRole('table').first();
    await expect(params.getByText('with_meanings')).toBeVisible();
    await expect(params.getByText('translation_languages')).toBeVisible();
    // limit and page share the same range
    await expect(params.getByText('1–20').first()).toBeVisible();
  });

  test('runs a real request and shows the answer as json and as a table', async ({ page, request }) => {
    await seedWord(request, 'flicker');

    await page.goto('/en/documentation/search-detailed');

    await page.getByRole('textbox').first().fill('flicker');
    await page.getByRole('switch', { name: 'with_meanings' }).click();
    await page.getByRole('button', { name: 'Send request' }).click();

    await expect(page.getByText('"word": "flicker"')).toBeVisible();
    await expect(page.getByText('"has_more": false')).toBeVisible();
    // the joined meaning proves the filter reached the database
    await expect(page.getByText('"title": "flicker meaning"')).toBeVisible();

    await page.getByText('Table', { exact: true }).click();

    await expect(page.getByRole('cell', { name: 'flicker', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'has_more' })).toBeVisible();
  });

  // issue #528: a headword as every dataset has it; the dataset of the history is one of the catalog
  test('reads a headword from every dataset and its history in one of them', async ({ page, request }) => {
    await seedWord(request, 'dapple');

    await page.goto('/en/documentation/word-datasets');
    await expect(page.getByText('/api/v1/words/{word}/datasets', { exact: true })).toBeVisible();
    await page.getByRole('textbox').first().fill('dapple');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByText('"dataset": "default"')).toBeVisible();
    await expect(page.getByText('"word": "dapple"').first()).toBeVisible();

    await page.goto('/en/documentation/word-dataset-history');
    const params = page.getByRole('table').first();
    await expect(params.getByText('dataset', { exact: true })).toBeVisible();
    await expect(params.getByText(/Name of a dataset of the instance/)).toBeVisible();
    await page.getByRole('textbox').first().fill('dapple');
    // the last select of the page: the ones of the header come first
    await page.getByRole('combobox').last().click();
    await pickOption(page, 'default');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByText('"action": "create"').first()).toBeVisible();
    await expect(page.getByText('"source": "vocab-bloom-hub"').first()).toBeVisible();
  });

  test('the suggestions endpoint page files a real report from the playground (issue #349)', async ({
    page,
    request,
  }) => {
    await seedWord(request, 'murmur');

    await page.goto('/en/documentation');
    await expect(page.getByRole('link', { name: 'Report a mistake' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'OpenAPI document' })).toBeVisible();

    await page.goto('/en/documentation/suggestions');
    await expect(page.getByText('/api/v1/suggestions', { exact: true })).toBeVisible();
    // its own bucket, not the shared prefix budget
    await expect(page.getByText(/5 requests/)).toBeVisible();

    const textboxes = page.getByRole('textbox');
    await textboxes.nth(0).fill('murmur');
    await textboxes.nth(1).fill('The definition reads oddly — documentation playground e2e.');
    await page.getByRole('button', { name: 'Send request' }).click();

    await expect(page.getByText('"status": "new"')).toBeVisible();
  });

  test('unknown endpoint slug renders the not found page', async ({ page }) => {
    await page.goto('/en/documentation/nope');

    await expect(page.getByText('Page not found')).toBeVisible();
  });
});
