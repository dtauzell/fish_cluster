import { test, expect } from '@playwright/test';
import { analyzeVideo, analysisJSON } from './helpers.mjs';

test.use({ serviceWorkers: 'block' });
test('experimental overlap setting defaults off and reaches detection after opt-in', async ({ page }) => {
  await page.route('**/background.mjs', async route => {
    const response = await route.fetch();
    const source = (await response.text()).replace('export function detectBackgroundFish(', 'function originalDetectBackgroundFish(');
    await route.fulfill({ response, body: source + `
      export function detectBackgroundFish(...args) {
        (globalThis.overlapOptions ??= []).push(args[4].thresholdOverlap);
        return originalDetectBackgroundFish(...args);
      }
    ` });
  });
  await analyzeVideo(page);
  expect((await analysisJSON(page)).settings.thresholdOverlap).toBe(false);
  expect(await page.evaluate(() => globalThis.overlapOptions.every(v => v === false))).toBe(true);
  await page.locator('#nav-setup').click();
  const option = page.locator('#threshold-overlap');
  await expect(option).not.toBeChecked();
  await option.check();
  await expect(page.locator('#status')).toContainText('Analyze again');
  await page.evaluate(() => { globalThis.overlapOptions = []; });
  await page.locator('#analyze').click();
  await expect(page).toHaveURL(/#results$/);
  expect((await analysisJSON(page)).settings.thresholdOverlap).toBe(true);
  expect(await page.evaluate(() => globalThis.overlapOptions.length > 0 && globalThis.overlapOptions.every(v => v === true))).toBe(true);
});
