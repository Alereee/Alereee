import { defineConfig, devices } from '@playwright/test';

import {
  E2E_PASSWORD,
  E2E_USERNAME,
  SITE_API_PORT,
  SITE_API_URL,
  SITE_DB_PATH,
  SITE_PORT,
  SITE_URL,
} from './config';

// Browser e2e of the website (issue #330): the API on an isolated SQLite
// database plus the production build of apps/site, wired together the way
// docker-compose wires them — the browser calls the relative /api, the
// site forwards it to API_INTERNAL_URL. Run with `yarn e2e:site` from the
// repository root (builds the site first).
export default defineConfig({
  testDir: './tests-site',
  // one shared API instance; the suites are cheap enough to run serially
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: SITE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    // Seeds the fixture words through the admin API before anything renders
    { name: 'seed', testMatch: /site\.setup\.ts/ },
    {
      name: 'site-chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['seed'],
    },
  ],
  webServer: [
    {
      // Same shape as the admin suite's server (playwright.config.ts): the
      // database is wiped before the boot, the Swagger UI is the health URL.
      // The public rate limit is lifted — the link crawler and the word-page
      // SSR fan out many public reads from one IP.
      command: `mkdir -p .tmp && rm -f ${JSON.stringify(SITE_DB_PATH)} && yarn workspace server start`,
      url: SITE_API_URL,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'pipe',
      env: {
        DATABASE_URL: `sqlite:${SITE_DB_PATH}`,
        SERVER_PORT: String(SITE_API_PORT),
        ADMIN_USERNAME: E2E_USERNAME,
        ADMIN_PASSWORD: E2E_PASSWORD,
        LOG_LEVEL: 'warn',
        DICTIONARY_AUTO_IMPORT: 'false',
        // the suite is hermetic: no request to api.github.com for the update notice (issue #477)
        UPDATE_CHECK: 'false',
        PUBLIC_API_RATE_LIMIT: '10000/60',
        // the suite files a handful of reports from one address
        SUGGESTIONS_RATE_LIMIT: '100/60',
      },
    },
    {
      // Serves the build produced by `yarn e2e:site:build` (repo root), which
      // bakes the relative /api base into the client bundle; API_INTERNAL_URL
      // is read at runtime for SSR and the /api/* forwarding. Bypasses the
      // workspace `start` script so the developer's .env never leaks in.
      command: 'yarn workspace site exec next start',
      url: SITE_URL,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: String(SITE_PORT),
        API_INTERNAL_URL: SITE_API_URL,
        NODE_ENV: 'production',
      },
    },
  ],
});
