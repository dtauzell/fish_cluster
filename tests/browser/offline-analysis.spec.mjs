import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { addCorrection, analysisJSON, download } from './helpers.mjs';

test.use({ serviceWorkers: 'allow' });

test('cached app analyzes and exports corrected footage while offline', async ({ page, context }) => {
  page.on('pageerror', error => { throw error; });
  await page.goto('/offline-analysis-workflow/');
  await expect(page.locator('#offline-status')).toHaveText('Ready for offline use');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#offline-status')).toHaveText('Offline · ready to analyze');
  await page.getByRole('button', { name: /Shoaling/ }).click();
  await page.locator('#expected-fish').fill('2');
  await page.locator('#expected-fish').press('Tab');
  await page.getByText('Advanced settings', { exact: true }).click();
  await page.locator('#filter-exact-count').uncheck();
  await page.locator('#video-file').setInputFiles(fileURLToPath(new URL('./fixtures/moving-fish.webm', import.meta.url)));
  const analyze = page.getByRole('button', { name: /Analyze video/ });
  await expect(analyze).toBeEnabled();
  await analyze.click();
  await expect(page).toHaveURL(/#results$/);
  await expect(page.locator('#human-frame-time')).toContainText('Sample 1');
  await addCorrection(page);

  const result = await analysisJSON(page);
  expect(result.frames).toHaveLength(12);
  expect(result.frames[0].manualCorrectionApplied).toBe(true);
  const csv = await download(page, 'Export frames CSV ↓');
  const rows = csv.trim().split('\r\n').map(row => row.split(',').map(cell => cell.slice(1, -1)));
  expect(rows).toHaveLength(13);
  const correctionColumn = rows[0].indexOf('manualCorrectionApplied');
  expect(correctionColumn).toBeGreaterThan(-1);
  expect(rows[1][correctionColumn]).toBe('true');

  const popup = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Frames CSV guide ↗' }).click();
  const guide = await popup;
  await expect(guide).toHaveURL(/\/offline-analysis-workflow\/csv-guide(?:\.html)?#shoaling$/);
  await expect(guide.getByRole('heading', { name: 'Frames CSV column guide', exact: true })).toBeVisible();
});
