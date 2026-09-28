import { expect, test } from '@playwright/test';

// The playground against the real public API: the browser calls the site's
// relative /api, the site forwards it to API_INTERNAL_URL (issue #330)
test.describe('playground', () => {
  test('picks an endpoint, fills the required field and shows the live answer', async ({ page }) => {
    await page.goto('/en/playground');

    // pick GET /words/{word} in the endpoint list (buttons, not a select)
    await page
      .getByRole('navigation', { name: 'Endpoints' })
      .getByRole('button')
      .filter({ has: page.locator('code:text-is("/words/{word}")') })
      .click();
    await expect(page.getByRole('heading', { level: 2 })).toContainText('/api/v1/words/{word}');

    // the send button waits for the required parameter
    const send = page.getByRole('button', { name: 'Send request' });
    await expect(send).toBeDisabled();
    await page.locator('#field-word').fill('run');
    await send.click();

    // the response block carries the HTTP status and the fixture data
    await expect(page.locator('strong').filter({ hasText: '200' })).toBeVisible();
    await expect(page.locator('pre').filter({ hasText: '"word": "run"' })).toBeVisible();
    await expect(page.locator('pre').filter({ hasText: 'to move fast' })).toBeVisible();
  });

  // issue #528: the headword as every dataset of the instance has it, and the history of one of them
  test('reads a headword from every dataset, and its history in the dataset that is named', async ({
    page,
  }) => {
    await page.goto('/en/playground?endpoint=get-words-word-datasets');
    await expect(page.getByRole('heading', { level: 2 })).toContainText('/api/v1/words/{word}/datasets');

    const send = page.getByRole('button', { name: 'Send request' });
    await page.locator('#field-word').fill('run');
    await send.click();
    await expect(page.locator('strong').filter({ hasText: '200' })).toBeVisible();
    // one group for the one dataset of the fixture, under its terms
    await expect(page.locator('pre').filter({ hasText: '"dataset": "default"' })).toBeVisible();
    await expect(page.locator('pre').filter({ hasText: '"license": "CC-BY-4.0"' })).toBeVisible();
    await expect(page.locator('pre').filter({ hasText: '"found": 1' })).toBeVisible();

    await page.goto('/en/playground?endpoint=get-words-word-datasets-dataset-history');
    await expect(page.getByRole('heading', { level: 2 })).toContainText(
      '/api/v1/words/{word}/datasets/{dataset}/history',
    );
    // two segments of the path, both required
    await expect(send).toBeDisabled();
    await page.locator('#field-word').fill('run');
    await page.locator('#field-dataset').fill('default');
    await send.click();
    await expect(page.locator('strong').filter({ hasText: '200' })).toBeVisible();
    await expect(page.locator('pre').filter({ hasText: '"action": "create"' })).toBeVisible();
  });

  test('the ?endpoint= query preselects an operation (the API reference links it)', async ({ page }) => {
    await page.goto('/en/playground?endpoint=get-random');

    await expect(page.getByRole('heading', { level: 2 })).toContainText('/api/v1/random');

    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.locator('strong').filter({ hasText: '200' })).toBeVisible();
  });
});
