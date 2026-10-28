import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { analyzeVideo, analysisJSON } from './helpers.mjs';
import { prepareLightDark, analyzePrepared, saveFish, buttonCsv } from './trial-helpers.mjs';

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
});

test('an unreadable replacement video clears old results and a valid upload recovers', async ({ page }) => {
  await analyzeVideo(page);
  await page.getByRole('link', { name: 'Setup', exact: true }).click();
  await page.locator('#video-file').setInputFiles({ name: 'broken.webm', mimeType: 'video/webm', buffer: Buffer.from('not a video') });
  await expect(page.locator('#status')).toContainText('The browser could not decode this video');
  await expect(page.locator('#analyze')).toBeDisabled();
  await expect(page.locator('#nav-results')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#video-file')).toBeEnabled();
  await page.locator('#video-file').setInputFiles(fileURLToPath(new URL('./fixtures/moving-fish.webm', import.meta.url)));
  await expect(page.locator('#analyze')).toBeEnabled();
  await page.locator('#analyze').click();
  await expect(page).toHaveURL(/#results$/);
  const recovered = await analysisJSON(page);
  expect(recovered.videoName).toBe('moving-fish.webm');
  expect(recovered.analysisComplete).toBe(true);
  expect(recovered.frames).toHaveLength(12);
});

test('a decoding failure after two samples preserves exports and permits a complete rerun', async ({ page }) => {
  // Fail the decoder boundary after two real decoded/detected frames, once.
  // This avoids browser-specific corrupt-video timing without inventing results.
  await page.route('**/pipeline.mjs', async route => {
    const response = await route.fetch();
    const source = await response.text();
    expect(source).toContain('export async function* analyzeVideo(');
    await route.fulfill({ response, body: source.replace('export async function* analyzeVideo(', 'async function* analyzeOriginalVideo(') + `
      let firstRun = true;
      export async function* analyzeVideo(options) {
        const injectFailure = firstRun;
        firstRun = false;
        let failSeek = false;
        const originalSource = options.source;
        const source = { ...originalSource, seekTo: async seconds => {
          if (failSeek) throw new Error('Synthetic decoder failure');
          await originalSource.seekTo(seconds);
        } };
        for await (const event of analyzeOriginalVideo({ ...options, source })) {
          yield event;
          if (injectFailure && event.frame?.frameIndex === 1) failSeek = true;
        }
      }
    ` });
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Shoaling/ }).click();
  await page.locator('#expected-fish').fill('2');
  await page.getByText('Advanced settings', { exact: true }).click();
  await page.locator('#filter-exact-count').uncheck();
  await page.locator('#video-file').setInputFiles(fileURLToPath(new URL('./fixtures/moving-fish.webm', import.meta.url)));
  await expect(page.locator('#analyze')).toBeEnabled();
  await page.locator('#analyze').click();
  await expect(page.locator('#status')).toHaveText('Analysis stopped: Synthetic decoder failure');
  await expect(page.locator('#cancel')).toBeHidden();
  await expect(page.locator('#analyze')).toBeEnabled();
  await expect(page.locator('#video-file')).toBeEnabled();
  await expect(page.locator('#interval')).toBeEnabled();
  await page.getByRole('link', { name: 'Results', exact: true }).click();
  const partial = await analysisJSON(page);
  expect(partial.analysisComplete).toBe(false);
  expect(partial.frames.map(frame => frame.frameIndex)).toEqual([0, 1]);
  await page.getByRole('link', { name: 'Setup', exact: true }).click();
  await page.locator('#analyze').click();
  await expect(page).toHaveURL(/#results$/);
  const recovered = await analysisJSON(page);
  expect(recovered.analysisComplete).toBe(true);
  expect(recovered.frames).toHaveLength(12);
});

for (const failure of ['corrupt saved data', 'blocked storage reads']) {
  test(`${failure} preserves analysis and downloadable trial snapshots`, async ({ page }) => {
    await page.addInitScript(mode => {
      const key = 'fish-cluster-experiments-v1';
      if (mode === 'corrupt saved data') localStorage.setItem(key, '{broken');
      else {
        const getItem = Storage.prototype.getItem;
        Storage.prototype.getItem = function(name) {
          if (name === key) throw new DOMException('Storage access blocked', 'SecurityError');
          return getItem.call(this, name);
        };
      }
    }, failure);
    await prepareLightDark(page);
    await expect(page.locator('#saved-setups [data-status]')).toContainText('Could not read saved data');
    await analyzePrepared(page);
    expect((await analysisJSON(page)).frames).toHaveLength(12);
    const batch = await saveFish(page, { trial: 'Recovery', exposure: 'Control', fishId: 'Fish 1' });
    await expect(batch.getByRole('status')).toContainText('browser storage failed');
    await expect(batch.getByRole('status')).toContainText('saving is disabled because saved data could not be read');
    const records = await buttonCsv(page, batch.getByRole('button', { name: 'Download per-fish CSV' }));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ trial: 'Recovery', fishId: 'Fish 1', complete: 'true' });
    if (failure === 'corrupt saved data') {
      expect(await page.evaluate(() => localStorage.getItem('fish-cluster-experiments-v1'))).toBe('{broken');
    }
  });
}

test('quota failure keeps previous saved trials intact and new trials exportable', async ({ page }) => {
  await prepareLightDark(page);
  await analyzePrepared(page);
  const metadata = { trial: 'Recovery', exposure: 'Control', fishId: 'Saved fish' };
  const batch = await saveFish(page, metadata);
  await expect(batch.getByRole('status')).toHaveText('Fish result saved.');
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(name, value) {
      if (name === 'fish-cluster-experiments-v1') throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      return setItem.call(this, name, value);
    };
  });
  await saveFish(page, { ...metadata, fishId: 'Unsaved fish' });
  await expect(batch.getByRole('status')).toContainText('browser storage failed');
  const inMemory = await buttonCsv(page, batch.getByRole('button', { name: 'Download per-fish CSV' }));
  expect(inMemory.map(row => row.fishId)).toEqual(['Saved fish', 'Unsaved fish']);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('fish-cluster-experiments-v1')));
  expect(stored.results.map(row => row.fishId)).toEqual(['Saved fish']);

  // A new document restores the native storage methods and the durable records.
  await prepareLightDark(page);
  await analyzePrepared(page);
  await saveFish(page, { ...metadata, fishId: 'Recovered fish' });
  await expect(batch.getByRole('status')).toHaveText('Fish result saved.');
  const recovered = await buttonCsv(page, batch.getByRole('button', { name: 'Download per-fish CSV' }));
  expect(recovered.map(row => row.fishId)).toEqual(['Saved fish', 'Recovered fish']);
});
