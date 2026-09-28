import { expect, test } from '@playwright/test';

// The API reference generated from apps/server/openapi/public-v1.json:
// operation and schema anchors must keep resolving (issue #330)
test.describe('API reference', () => {
  test('an operation anchor resolves and links the playground', async ({ page }) => {
    await page.goto('/en/api#get-words-word');

    const operation = page.locator('section#get-words-word');
    await expect(operation).toBeVisible();
    await expect(operation.getByRole('heading', { level: 3 })).toContainText('/api/v1/words/{word}');
    await expect(operation.getByRole('link', { name: /playground/i })).toHaveAttribute(
      'href',
      /\/en\/playground\?endpoint=get-words-word$/,
    );
  });

  test('the example of an endpoint has a tab per language, and the choice follows the reader', async ({
    page,
  }) => {
    await page.goto('/en/api#get-meta');

    const operation = page.locator('section#get-meta');
    const tabs = operation.getByRole('tablist');
    await expect(tabs.getByRole('tab', { name: 'curl' })).toHaveAttribute('aria-selected', 'true');
    await expect(operation.locator('pre[data-language="curl"]')).toContainText('curl ');
    await expect(operation.locator('pre[data-language="python"]')).toBeHidden();

    await tabs.getByRole('tab', { name: 'Python SDK' }).click();
    await expect(operation.locator('pre[data-language="sdk-python"]')).toContainText(
      'from vocab_bloom_hub import',
    );
    await expect(operation.locator('pre[data-language="curl"]')).toBeHidden();

    // the choice is shared by every endpoint on the page and remembered across loads; an
    // endpoint without a snippet in that language keeps its first tab
    await expect(page.locator('section#get-words-word pre[data-language="curl"]')).toBeVisible();
    await page.reload();
    await expect(operation.locator('pre[data-language="sdk-python"]')).toBeVisible();
  });

  test('a schema link from the endpoint list resolves', async ({ page }) => {
    await page.goto('/en/api');

    // the sidebar of the reference lists every schema as an in-page anchor
    await page.locator('a[href="#schema-PublicWordV1T"]').first().click();
    await expect(page.locator('[id="schema-PublicWordV1T"]')).toBeVisible();
  });

  // issue #528: the reads of every dataset sit with the headword reads, their answer has a schema
  test('lists the read of every dataset with the terms a group carries', async ({ page }) => {
    await page.goto('/en/api#get-words-word-datasets');

    const operation = page.locator('section#get-words-word-datasets');
    await expect(operation).toBeVisible();
    await expect(operation).toContainText('/api/v1/words/{word}/datasets');
    await expect(operation.locator('pre[data-language="curl"]')).toContainText('/api/v1/words/run/datasets');

    const history = page.locator('section#get-words-word-datasets-dataset-history');
    await expect(history.locator('pre[data-language="curl"]')).toContainText(
      '/api/v1/words/run/datasets/default/history',
    );
    await expect(page.locator('#schema-PublicWordDatasetV1T')).toContainText('license_text');

    // both clients have a method for each of the two reads, and the reference shows it
    await operation.getByRole('tablist').getByRole('tab', { name: 'Node.js SDK' }).click();
    await expect(operation.locator('pre[data-language="sdk-node"]')).toContainText(
      "client.wordDatasets('run')",
    );
    await expect(history.locator('pre[data-language="sdk-node"]')).toContainText(
      "client.datasetHistory('run', 'default')",
    );
    await history.getByRole('tablist').getByRole('tab', { name: 'Python SDK' }).click();
    await expect(history.locator('pre[data-language="sdk-python"]')).toContainText(
      'client.dataset_history("run", "default")',
    );
  });
});
