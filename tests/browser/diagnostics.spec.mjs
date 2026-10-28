import { test, expect } from '@playwright/test';
import { analyzeVideo, addCorrection, analysisJSON } from './helpers.mjs';
import { buttonCsv, openDetails } from './trial-helpers.mjs';

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
});

test('candidate labels persist per frame, export and do not alter analysis or corrections', async ({ page }) => {
  await analyzeVideo(page);
  await addCorrection(page);
  const before = await analysisJSON(page);
  expect(before.frames[0].manualCorrectionApplied).toBe(true);
  expect(before.sharpnessLabels).toEqual([]);
  const progress = await page.locator('#human-progress').innerText();
  const coordinates = await page.locator('#human-center-coordinate-values').inputValue();

  await openDetails(page.locator('.sharpness-panel'));
  const candidates = page.locator('#sharpness-candidates select');
  expect(await candidates.count()).toBeGreaterThanOrEqual(2);
  const candidateId = async locator => Number((await locator.getAttribute('aria-label')).match(/\d+$/)[0]);
  const fishId = await candidateId(candidates.nth(0));
  const clearedId = await candidateId(candidates.nth(1));
  await candidates.nth(0).selectOption('fish');
  await candidates.nth(1).selectOption('reflection');

  await page.locator('#human-next').click();
  await expect(page.locator('#human-frame-time')).toContainText('Sample 2');
  await expect(candidates.first()).toBeVisible();
  const reflectionId = await candidateId(candidates.first());
  await candidates.first().selectOption('reflection');
  await page.locator('#human-prev').click();
  await expect(page.locator('#human-frame-time')).toContainText('Sample 1');
  await expect(candidates.nth(0)).toHaveValue('fish');
  await expect(candidates.nth(1)).toHaveValue('reflection');
  await candidates.nth(1).selectOption('');
  await expect(candidates.nth(1)).toHaveValue('');
  await expect(page.locator('#human-progress')).toHaveText(progress);
  await expect(page.locator('#human-center-coordinate-values')).toHaveValue(coordinates);

  const after = await analysisJSON(page);
  expect(after.sharpnessLabels).toEqual(expect.arrayContaining([
    { frameIndex: before.frames[0].frameIndex, detectionId: fishId, label: 'fish' },
    { frameIndex: before.frames[1].frameIndex, detectionId: reflectionId, label: 'reflection' },
  ]));
  expect(after.sharpnessLabels).toHaveLength(2);
  const { sharpnessLabels: _labelsBefore, ...resultsBefore } = before;
  const { sharpnessLabels: _labelsAfter, ...resultsAfter } = after;
  expect(resultsAfter).toEqual(resultsBefore);

  const rows = await buttonCsv(page, page.locator('#sharpness-export'));
  const find = (frameIndex, detectionId) => rows.find(row => Number(row.frame_index) === frameIndex && Number(row.detection_id) === detectionId);
  expect(find(before.frames[0].frameIndex, fishId)?.human_label).toBe('fish');
  expect(find(before.frames[0].frameIndex, clearedId)?.human_label).toBe('');
  expect(find(before.frames[1].frameIndex, reflectionId)?.human_label).toBe('reflection');
  expect(rows.filter(row => row.human_label)).toHaveLength(2);
  await page.locator('#human-next').click();
  await expect(page.locator('#human-frame-time')).toContainText('Sample 2');
  await expect(candidates.first()).toHaveValue('reflection');
});
