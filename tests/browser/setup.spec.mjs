import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { analysisJSON } from './helpers.mjs';

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
});

async function loadVideo(page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Shoaling/ }).click();
  await page.locator('#expected-fish').fill('2');
  await page.locator('#video-file').setInputFiles(fileURLToPath(new URL('./fixtures/moving-fish.webm', import.meta.url)));
  await expect(page.locator('#mask-tools')).toBeEnabled();
  await page.locator('#preview-tools > summary').click();
}

async function preciseCrop(page, crop) {
  const details = page.locator('#crop-fields').locator('..');
  if (await details.getAttribute('open') === null) await details.locator('summary').click();
  for (const [key, value] of Object.entries(crop)) await page.locator(`#crop-${key}`).fill(String(value));
  await page.locator('#apply-crop').click();
  await expect(page.locator('#crop-label')).toContainText(`${crop.width} × ${crop.height} px at (${crop.x}, ${crop.y})`);
}

async function drawMask(page, start, end) {
  const canvas = page.locator('#frame-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * start[0], box.y + box.height * start[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * end[0], box.y + box.height * end[1]);
  await page.mouse.up();
}

async function analyze(page) {
  await page.getByText('Advanced settings', { exact: true }).click();
  await page.locator('#filter-exact-count').uncheck();
  await page.getByRole('button', { name: /Analyze video/ }).click();
  await expect(page).toHaveURL(/#results$/);
  await expect(page.locator('#human-page')).toBeVisible();
  return analysisJSON(page);
}

test('precise crop is applied to exported analysis settings', async ({ page }) => {
  await loadVideo(page);
  const crop = { x: 10, y: 8, width: 130, height: 80 };
  await preciseCrop(page, crop);
  await expect(page.locator('#preview-focus')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#preview-full').click();
  await expect(page.locator('#preview-full')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#preview-zoom-in').click();
  await expect(page.locator('#preview-zoom')).not.toHaveText('Fit');
  await page.locator('#preview-fit').click();
  await expect(page.locator('#preview-zoom')).toHaveText('Fit');
  expect((await analyze(page)).settings.crop).toEqual(crop);
});

test('reflection areas can be drawn, undone and cleared', async ({ page }) => {
  await loadVideo(page);
  await page.locator('#crop-tool').selectOption('exclude');
  const count = page.locator('#mask-count');
  await drawMask(page, [.1, .1], [.3, .3]);
  await expect(count).toHaveText('1 reflection area.');
  await drawMask(page, [.6, .6], [.8, .8]);
  await expect(count).toHaveText('2 reflection areas.');
  await page.locator('#undo-mask').click();
  await expect(count).toHaveText('1 reflection area.');
  const settings = (await analyze(page)).settings;
  expect(settings.exclusions).toHaveLength(1);
  expect(settings.exclusions[0].preferenceOnly).toBe(true);
  expect(settings.exclusions[0].x).toBeCloseTo(16, 0);
  expect(settings.exclusions[0].y).toBeCloseTo(10, 0);
  expect(settings.exclusions[0].width).toBeCloseTo(32, 0);
  expect(settings.exclusions[0].height).toBeCloseTo(20, 0);
  await page.getByRole('link', { name: 'Setup', exact: true }).click();
  await page.locator('#clear-masks').click();
  await expect(count).toHaveText('No reflection areas.');
  await expect(page.locator('#undo-mask')).toBeDisabled();
  await expect(page.locator('#clear-masks')).toBeDisabled();
});

test('named setups persist, apply their geometry and scale, reject duplicates, and delete', async ({ page }) => {
  await loadVideo(page);
  const crop = { x: 10, y: 8, width: 130, height: 80 };
  await preciseCrop(page, crop);
  await page.getByText('Advanced settings', { exact: true }).click();
  await page.locator('#grid-pixels').fill('12');
  await page.locator('#grid-pixels').press('Tab');
  await page.getByText('Saved tank setups', { exact: true }).click();
  const setups = page.locator('#saved-setups');
  await setups.getByLabel('Setup name').fill('Tank A');
  await setups.getByRole('button', { name: 'Save setup' }).click();
  await expect(setups.getByRole('status')).toHaveText('Saved Tank A.');
  await setups.getByRole('button', { name: 'Save setup' }).click();
  await expect(setups.getByRole('status')).toContainText('This setup name exists');
  await expect(setups.getByLabel('Saved setup').locator('option')).toHaveCount(1);
  await page.locator('#clear-crop').click();
  await page.locator('#grid-pixels').fill('20');
  await page.locator('#grid-pixels').press('Tab');
  await setups.getByRole('button', { name: 'Apply setup' }).click();
  await expect(setups.getByRole('status')).toContainText('Applied Tank A');
  await expect(page.locator('#crop-x')).toHaveValue('10');
  await expect(page.locator('#grid-pixels')).toHaveValue('12');
  await page.reload();
  await page.getByRole('button', { name: /Shoaling/ }).click();
  await page.locator('#video-file').setInputFiles(fileURLToPath(new URL('./fixtures/moving-fish.webm', import.meta.url)));
  await expect(page.locator('#mask-tools')).toBeEnabled();
  await page.getByText('Saved tank setups', { exact: true }).click();
  await expect(setups.getByLabel('Saved setup').locator('option')).toHaveText('Tank A (160 × 100)');
  await setups.getByRole('button', { name: 'Apply setup' }).click();
  await expect(setups.getByRole('status')).toContainText('Applied Tank A');
  await expect(page.locator('#crop-width')).toHaveValue('130');
  await expect(page.locator('#grid-pixels')).toHaveValue('12');
  await setups.getByRole('button', { name: 'Delete setup' }).click();
  await expect(setups.getByRole('status')).toHaveText('Setup deleted.');
  await expect(setups.getByLabel('Saved setup').locator('option')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: /Shoaling/ }).click();
  await page.getByText('Saved tank setups', { exact: true }).click();
  await expect(setups.getByLabel('Saved setup').locator('option')).toHaveCount(0);
});

test('fish remain detectable inside a marked reflection preference area', async ({page})=>{
 await loadVideo(page);
 await page.locator('#crop-tool').selectOption('exclude');
 await drawMask(page,[.01,.01],[.99,.99]);
 const result=await analyze(page);
 expect(result.settings.exclusions[0].preferenceOnly).toBe(true);
 expect(result.frames[0].detections).toHaveLength(2);
 expect(result.frames[0].detections.every(p=>p.inReflectionArea)).toBe(true);
 expect(result.frames[0].rejectedDetections).toHaveLength(0);
});
