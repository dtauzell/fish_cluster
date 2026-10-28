import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { analysisJSON, download } from './helpers.mjs';

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
});

async function preparePausedAnalysis(page, phase) {
  // Hold the real generator at a known event boundary so Stop cannot race a
  // fast synthetic video. Decoding, detection, frames and cancellation stay real.
  await page.route('**/pipeline.mjs', async route => {
    const response = await route.fetch();
    const source = await response.text();
    expect(source).toContain('export async function* analyzeVideo(');
    await route.fulfill({ response, body: source.replace('export async function* analyzeVideo(', 'async function* analyzeOriginalVideo(') + `
      let firstRun = true;
      export async function* analyzeVideo(options) {
        const pauseThisRun = firstRun;
        firstRun = false;
        for await (const event of analyzeOriginalVideo(options)) {
          yield event;
          if (pauseThisRun && ${phase === 'background' ? "event.type === 'status' && event.progress < 10" : 'event.frame?.frameIndex === 1'}) {
            await new Promise(resolve => { window.releaseAnalysis = resolve; window.analysisPaused = true; });
          }
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
  await expect.poll(() => page.evaluate(() => window.analysisPaused === true)).toBe(true);
  await expect(page.locator('#video-file')).toBeDisabled();
  await expect(page.locator('#interval')).toBeDisabled();
}

async function stop(page) {
  await page.getByRole('button', { name: 'Stop analysis', exact: true }).click();
  await page.evaluate(() => window.releaseAnalysis());
  await expect(page.locator('#cancel')).toBeHidden();
  await expect(page.locator('#video-file')).toBeEnabled();
  await expect(page.locator('#interval')).toBeEnabled();
}

test('stopping during background preparation leaves setup usable and can restart', async ({ page }) => {
  await preparePausedAnalysis(page, 'background');
  await expect(page.locator('#status')).toContainText('Building tank background');
  await stop(page);
  await expect(page.locator('#status')).toContainText('Stopped after 0 frames');
  await expect(page.locator('#nav-results')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#human-review-link')).toBeHidden();
  await page.locator('#analyze').click();
  await expect(page).toHaveURL(/#results$/);
  const rerun = await analysisJSON(page);
  expect(rerun.analysisComplete).toBe(true);
  expect(rerun.frames).toHaveLength(12);
});

test('stopping after decoded samples exports only partial results and rerun replaces them', async ({ page }) => {
  await preparePausedAnalysis(page, 'frames');
  await expect(page.locator('#status')).toContainText('Analyzed 2 of 12 frames');
  await stop(page);
  await expect(page).toHaveURL(/#results$/);
  const partial = await analysisJSON(page);
  expect(partial.analysisComplete).toBe(false);
  expect(partial.frames.map(frame => frame.frameIndex)).toEqual([0, 1]);
  expect(partial.frames.map(frame => frame.timestampMs)).toEqual([0, 200]);
  expect(partial.frames.every(frame => frame.detections.length === 2)).toBe(true);
  await expect(page.locator('#human-frame-number')).toHaveAttribute('max', '2');
  const csv = await download(page, 'Export frames CSV ↓');
  expect(csv.trim().split('\r\n')).toHaveLength(3);
  await page.getByRole('link', { name: 'Setup', exact: true }).click();
  await page.locator('#analyze').click();
  await expect(page).toHaveURL(/#results$/);
  const complete = await analysisJSON(page);
  expect(complete.analysisComplete).toBe(true);
  expect(complete.frames).toHaveLength(12);
  expect(complete.frames.map(frame => frame.frameIndex)).toEqual(Array.from({ length: 12 }, (_, i) => i));
  await expect(page.locator('#human-progress')).toContainText('0 of 12 frames done');
});
