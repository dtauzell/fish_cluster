import { test, expect } from '@playwright/test';
import { analysisJSON } from './helpers.mjs';
import { prepareLightDark, analyzePrepared, saveFish, buttonCsv, openDetails } from './trial-helpers.mjs';

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
});

test('a stopped light/dark trial stays partial when saved, reloaded and exported', async ({ page }) => {
  await page.route('**/pipeline.mjs', async route => {
    const response = await route.fetch();
    const source = await response.text();
    expect(source).toContain('export async function* analyzeVideo(');
    // Gate after four real samples so the short fixture cannot finish before
    // Stop. A fresh document restores the unmodified module below.
    await route.fulfill({ response, body: source.replace('export async function* analyzeVideo(', 'async function* analyzeOriginalVideo(') + `
      export async function* analyzeVideo(options) {
        for await (const event of analyzeOriginalVideo(options)) {
          yield event;
          if (event.frame?.frameIndex === 3) {
            await new Promise(resolve => { window.releaseAnalysis = resolve; window.analysisPaused = true; });
          }
        }
      }
    ` });
  });
  await prepareLightDark(page);
  await page.locator('#analyze').click();
  await expect.poll(() => page.evaluate(() => window.analysisPaused === true)).toBe(true);
  await page.getByRole('button', { name: 'Stop analysis', exact: true }).click();
  await page.evaluate(() => window.releaseAnalysis());
  await expect(page).toHaveURL(/#results$/);
  const partial = await analysisJSON(page);
  expect(partial.analysisComplete).toBe(false);
  expect(partial.frames.map(frame => frame.frameIndex)).toEqual([0, 1, 2, 3]);
  expect(partial.summary.observedDurationSeconds).toBeCloseTo(.6, 8);
  expect(partial.summary.darkTimeSeconds).toBeCloseTo(.6, 8);
  expect(partial.summary.lightTimeSeconds).toBe(0);
  expect(partial.summary.unknownTimeSeconds).toBe(0);

  // Finishing review of every retained frame does not make a stopped analysis
  // complete or extrapolate its totals into the unsampled remainder.
  for (let i = 1; i <= 4; i++) {
    await expect(page.locator('#human-frame-time')).toContainText(`Sample ${i} ·`);
    await page.locator('#human-done').click();
  }
  await expect(page.locator('#human-review-complete')).toBeVisible();
  const batch = await saveFish(page, { trial: 'Stopped trial', exposure: 'Control', fishId: 'Fish 1' });
  await expect(batch.getByRole('status')).toHaveText('Fish result saved.');
  await expect(batch.getByRole('cell', { name: 'Partial', exact: true })).toBeVisible();
  const [saved] = await buttonCsv(page, batch.getByRole('button', { name: 'Download per-fish CSV' }));
  expect(saved).toMatchObject({ trial: 'Stopped trial', fishId: 'Fish 1', partial: 'true', complete: 'false', fileName: 'single-fish.webm' });
  expect(Number(saved.observedDurationSeconds)).toBeCloseTo(.6, 8);
  const [group] = await buttonCsv(page, batch.getByRole('button', { name: 'Download group means CSV' }));
  expect(group).toMatchObject({ fishCount: '1', partialFishCount: '1', completeFishCount: '0' });

  await page.unroute('**/pipeline.mjs');
  await page.reload();
  // Analyze a complete run in the new document to show that an existing saved
  // snapshot keeps its own partial status independently of the current run.
  await prepareLightDark(page);
  await analyzePrepared(page);
  expect((await analysisJSON(page)).analysisComplete).toBe(true);
  await openDetails(batch.locator('..'));
  await expect(batch.getByRole('cell', { name: 'Partial', exact: true })).toBeVisible();
  const afterReload = await buttonCsv(page, batch.getByRole('button', { name: 'Download per-fish CSV' }));
  expect(afterReload).toEqual([saved]);
  expect(await buttonCsv(page, batch.getByRole('button', { name: 'Download group means CSV' }))).toEqual([group]);
});
