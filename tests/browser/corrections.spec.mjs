import { test, expect } from '@playwright/test';
import { analyzeVideo, analysisJSON } from './helpers.mjs';

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
});

async function artifact(page, button) {
  const pending = page.waitForEvent('download');
  await button.click();
  const file = await pending;
  const chunks = [];
  for await (const chunk of await file.createReadStream()) chunks.push(chunk);
  return { name: file.suggestedFilename(), bytes: Buffer.concat(chunks) };
}

async function reviewRows(page) {
  const details = page.locator('details.review-summary');
  if (await details.getAttribute('open') === null) await details.locator('summary').click();
  const { bytes } = await artifact(page, page.locator('#human-export'));
  // The synthetic fixture's review fields contain no embedded commas/newlines.
  const [headers, ...rows] = bytes.toString('utf8').trim().split('\r\n')
    .map(row => row.split(',').map(cell => cell.slice(1, -1)));
  return rows.map(row => Object.fromEntries(headers.map((key, i) => [key, row[i]])));
}

async function correctionOptions(page) {
  const details = page.locator('details.review-options');
  if (await details.getAttribute('open') === null) await details.locator('summary').click();
}

test('accepting automatic centers records review without creating a manual correction', async ({ page }) => {
  await analyzeVideo(page);
  const before = await analysisJSON(page);
  await page.locator('#human-done').click();
  await expect(page.locator('#human-frame-time')).toContainText('Sample 2 ·');
  await expect(page.locator('#human-progress')).toContainText('1 of 12 frames done');
  expect(await analysisJSON(page)).toEqual(before);
  const rows = await reviewRows(page);
  expect(rows[0]).toMatchObject({ frame_number: '1', reviewed: 'true',
    manual_annotation_present: 'false', manual_correction_applied: 'false', result_fish_count: '2' });
  expect(rows[1]).toMatchObject({ frame_number: '2', reviewed: 'false' });
});

test('an explicitly empty correction changes exports and restore recovers automatic centers', async ({ page }) => {
  await analyzeVideo(page);
  const before = await analysisJSON(page);
  await page.locator('#human-edit-centers').check();
  await correctionOptions(page);
  await page.locator('#human-clear').click();
  await page.locator('#human-apply-centers').click();
  await expect(page.locator('#human-progress')).toContainText('1 of 12 frames done');
  const empty = await analysisJSON(page);
  expect(empty.frames[0].detections).toEqual([]);
  expect(empty.frames[0].manualCorrectionApplied).toBe(true);
  expect(empty.frames[0].automaticDetections).toEqual(before.frames[0].detections);
  expect(empty.frames.slice(1)).toEqual(before.frames.slice(1));
  expect((await reviewRows(page))[0]).toMatchObject({ manual_annotation_present: 'true',
    manual_fish_count_in_analysis: '0', result_fish_count: '0', reviewed: 'true' });

  await page.locator('#human-restore-auto').click();
  await expect(page.locator('#human-restore-auto')).toBeDisabled();
  await expect(page.locator('#human-progress')).toContainText('0 of 12 frames done');
  expect((await analysisJSON(page)).frames).toEqual(before.frames);
});

test('undo discards draft changes without changing analyzed results', async ({ page }) => {
  await analyzeVideo(page);
  const before = await analysisJSON(page);
  await page.locator('#human-edit-centers').check();
  const coordinates = page.locator('#human-center-coordinate-values');
  const original = await coordinates.inputValue();
  await correctionOptions(page);
  const canvas = page.locator('#human-canvas');
  const bounds = await canvas.boundingBox();
  await canvas.click({ position: { x: bounds.width * .8, y: bounds.height * .8 } });
  await expect(coordinates).not.toHaveValue(original);
  await expect(page.locator('#human-edit-status')).toContainText('Unapplied edits');
  await page.locator('#human-undo').click();
  await expect(coordinates).toHaveValue(original);
  await expect(page.locator('#human-apply-centers')).toBeHidden();
  await expect(page.locator('#human-progress')).toContainText('0 of 12 frames done');
  expect(await analysisJSON(page)).toEqual(before);
});

test('frame PNG preserves source resolution and excludes correction overlays', async ({ page }) => {
  await analyzeVideo(page);
  await correctionOptions(page);
  await page.locator('#human-show-full').check();
  const first = await artifact(page, page.locator('#human-download-frame'));
  expect(first.name).toBe('moving-fish-sample-000001-0ms-full.png');
  expect(first.bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(first.bytes.readUInt32BE(16)).toBe(160);
  expect(first.bytes.readUInt32BE(20)).toBe(100);
  await page.locator('#human-edit-centers').check();
  const canvas = page.locator('#human-canvas');
  const bounds = await canvas.boundingBox();
  await canvas.click({ position: { x: bounds.width * .8, y: bounds.height * .8 } });
  await page.locator('#human-apply-centers').click();
  const corrected = await artifact(page, page.locator('#human-download-frame'));
  expect(corrected.bytes).toEqual(first.bytes);
  await expect(page.locator('#human-download-status')).toContainText('Downloaded sample 1 PNG.');
});
