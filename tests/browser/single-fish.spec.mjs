import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { analysisJSON } from './helpers.mjs';

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
});

async function analyzeSingleFish(page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Light \/ dark/ }).click();
  // This short, constant-floor fixture tests occupancy and speed. Its five
  // background references do not provide enough history to learn flicker.
  await page.getByText('Advanced settings', { exact: true }).click();
  await page.locator('#suppress-flicker').uncheck();
  await page.locator('#video-file').setInputFiles(fileURLToPath(new URL('./fixtures/single-fish.webm', import.meta.url)));
  await expect(page.locator('#mask-tools')).toBeEnabled();
  await page.locator('#crop-tool').selectOption('dark');
  const canvas = page.locator('#frame-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height);
  await page.mouse.up();
  await expect(page.locator('#zone-count')).toContainText('1 dark');
  await page.locator('#analyze').click();
  await expect(page).toHaveURL(/#results$/);
  await expect(page.locator('#human-done')).toBeEnabled();
}

test('one fish crossing produces measured occupancy, switch navigation and calibrated speed', async ({ page }) => {
  await analyzeSingleFish(page);
  const result = await analysisJSON(page);
  expect(result.analysisComplete).toBe(true);
  expect(result.frames).toHaveLength(12);
  for (const [index, frame] of result.frames.entries()) {
    expect(frame.detections).toHaveLength(1);
    expect(frame.detections[0].x).toBeCloseTo(51.5 + index * 12, 0);
    expect(frame.detections[0].y).toBeCloseTo(99.5, 0);
  }
  expect(result.summary).toMatchObject({ zoneSwitchCount: 1, unknownTimeSeconds: 0 });
  expect(result.summary.coverageFraction).toBeCloseTo(1, 8);
  expect(result.summary.darkTimeSeconds).toBeCloseTo(1.9, 8);
  expect(result.summary.lightTimeSeconds).toBeCloseTo(.3, 8);
  expect(result.summary.observedDurationSeconds).toBeCloseTo(2.2, 8);
  expect(result.velocity.validIntervalCount).toBe(11);
  expect(result.velocity.averagePxPerSecond).toBeCloseTo(60, 8);
  await expect(page.locator('#ld-switches')).toHaveText('1');
  await expect(page.locator('#velocity-average')).toHaveText('60.00 px/s');
  await page.locator('#velocity-units').selectOption('inches');
  await expect(page.locator('#velocity-average')).toHaveText(`${(60 / 30.6 * 2.54).toFixed(2)} cm/s`);
  await page.locator('#next-change').click();
  await expect(page.locator('#human-frame-time')).toContainText('Sample 11 ·');
  await page.getByText('Trial results across fish', { exact: true }).click();
  const batch = page.locator('#batch-results');
  await batch.getByLabel('Trial', { exact: true }).fill('Crossing');
  await batch.getByLabel('Exposure level').fill('Control');
  await batch.getByLabel('Fish ID').fill('Fish 1');
  await batch.getByRole('button', { name: 'Add current fish', exact: true }).click();
  await expect(batch.getByRole('status')).toHaveText('Fish result saved.');
});

test('an empty correction breaks adjacent speed intervals and restoration repairs coverage', async ({ page }) => {
  await analyzeSingleFish(page);
  const before = await analysisJSON(page);
  await page.locator('#human-frame-number').fill('6');
  await page.locator('#human-frame-number').press('Enter');
  await expect(page.locator('#human-frame-time')).toContainText('Sample 6 ·');
  await page.locator('#human-edit-centers').check();
  await page.getByText('Display & correction options', { exact: true }).click();
  await page.locator('#human-clear').click();
  await page.locator('#human-apply-centers').click();
  const gap = await analysisJSON(page);
  expect(gap.frames[5].detections).toEqual([]);
  expect(gap.summary.unknownTimeSeconds).toBeCloseTo(.4, 8);
  expect(gap.summary.velocityDurationSeconds).toBeCloseTo(1.8, 8);
  expect(gap.velocity.validIntervalCount).toBe(9);
  expect(gap.velocity.averagePxPerSecond).toBeCloseTo(60, 8);
  expect(gap.velocity.intervals.some(interval => interval.startFrameIndex === 5 || interval.endFrameIndex === 5)).toBe(false);
  await expect(page.locator('#velocity-coverage')).toContainText('9 of 11 adjacent intervals measured');
  await page.locator('#human-restore-auto').click();
  const restored = await analysisJSON(page);
  expect(restored.frames).toEqual(before.frames);
  expect(restored.summary).toEqual(before.summary);
  expect(restored.velocity).toEqual(before.velocity);
  await expect(page.locator('#velocity-coverage')).toContainText('11 of 11 adjacent intervals measured');
});
