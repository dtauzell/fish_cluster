import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.FISH_BROWSER_TEST_PORT || 8138);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  workers: process.env.CI ? 1 : 2,
  retries: 0,
  timeout: 45000,
  expect: { timeout: 10000 },
  outputDir: 'test-results',
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL, actionTimeout: 10000, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node tests/browser/server.mjs',
    url: `${baseURL}/__test/health`,
    reuseExistingServer: false,
    timeout: 15000,
  },
});
