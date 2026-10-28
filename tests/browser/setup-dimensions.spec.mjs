import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { analysisJSON } from './helpers.mjs';

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
});

const movingFish = fileURLToPath(new URL('./fixtures/moving-fish.webm', import.meta.url));
const singleFish = fileURLToPath(new URL('./fixtures/single-fish.webm', import.meta.url));

async function upload(page, file, dimensions) {
  await page.locator('#video-file').setInputFiles(file);
  await expect(page.locator('#video-meta')).toContainText(dimensions);
  await expect(page.locator('#mask-tools')).toBeEnabled();
}

async function setCrop(page, crop) {
  const tools = page.locator('#preview-tools');
  if (await tools.getAttribute('open') === null) await tools.locator(':scope > summary').click();
  const details = page.locator('#crop-fields').locator('..');
  if (await details.getAttribute('open') === null) await details.locator('summary').click();
  for (const [key, value] of Object.entries(crop)) await page.locator(`#crop-${key}`).fill(String(value));
  await page.locator('#apply-crop').click();
  await expect(page.locator('#crop-label')).toContainText(`${crop.width} × ${crop.height} px at (${crop.x}, ${crop.y})`);
}

async function saveNamedSetup(page, name, crop, gridPixels) {
  await setCrop(page, crop);
  await page.getByText('Advanced settings', { exact: true }).click();
  await page.locator('#grid-pixels').fill(String(gridPixels));
  await page.locator('#grid-pixels').press('Tab');
  await page.getByText('Saved tank setups', { exact: true }).click();
  const setups = page.locator('#saved-setups');
  await setups.getByLabel('Setup name').fill(name);
  await setups.getByRole('button', { name: 'Save setup' }).click();
  await expect(setups.getByRole('status')).toHaveText(`Saved ${name}.`);
  await expect(setups.getByLabel('Saved setup').locator('option')).toHaveText(`${name} (160 × 100)`);
  return setups;
}

test('saved setups reject mismatched dimensions without applying crop or scale', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Shoaling/ }).click();
  await upload(page, movingFish, '160 × 100');
  const setupCrop = { x: 10, y: 8, width: 130, height: 80 };
  const setups = await saveNamedSetup(page, 'Tank A', setupCrop, 12.5);

  // Establish a distinct current calibration so a rejected setup cannot mask a change.
  await page.locator('#grid-pixels').fill('18');
  await page.locator('#grid-pixels').press('Tab');
  await upload(page, singleFish, '320 × 200');
  const status = setups.getByRole('status');
  await expect(status).toContainText('Previous setup was not applied');
  await expect(status).toContainText('Setup requires 160 × 100 video pixels; this video is 320 × 200.');
  await expect(page.locator('#crop-x')).toHaveValue('0');
  await expect(page.locator('#crop-y')).toHaveValue('0');
  await expect(page.locator('#crop-width')).toHaveValue('320');
  await expect(page.locator('#crop-height')).toHaveValue('200');
  await expect(page.locator('#grid-pixels')).toHaveValue('18');

  // A direct Apply setup attempt must also report the mismatch and leave edits intact.
  await setups.getByRole('button', { name: 'Apply setup' }).click();
  await expect(status).toContainText('Setup requires 160 × 100 video pixels; this video is 320 × 200.');
  await expect(page.locator('#crop-x')).toHaveValue('0');
  await expect(page.locator('#crop-y')).toHaveValue('0');
  await expect(page.locator('#crop-width')).toHaveValue('320');
  await expect(page.locator('#crop-height')).toHaveValue('200');
  await expect(page.locator('#grid-pixels')).toHaveValue('18');

  // Current video geometry remains editable; returning to matching dimensions permits
  // applying the persisted setup, whose values are verified in the analysis export.
  await setCrop(page, { x: 20, y: 10, width: 200, height: 150 });
  await page.locator('#grid-pixels').fill('19.5');
  await page.locator('#grid-pixels').press('Tab');
  await upload(page, movingFish, '160 × 100');
  await setups.getByRole('button', { name: 'Apply setup' }).click();
  await expect(status).toContainText('Applied Tank A.');
  await expect(page.locator('#crop-x')).toHaveValue('10');
  await expect(page.locator('#crop-y')).toHaveValue('8');
  await expect(page.locator('#crop-width')).toHaveValue('130');
  await expect(page.locator('#crop-height')).toHaveValue('80');
  await expect(page.locator('#grid-pixels')).toHaveValue('12.5');

  const advanced = page.locator('details.advanced-settings');
  if (await advanced.getAttribute('open') === null) await advanced.locator('summary').click();
  await page.locator('#filter-exact-count').uncheck();
  await page.getByRole('button', { name: /Analyze video/ }).click();
  await expect(page).toHaveURL(/#results$/);
  const exported = await analysisJSON(page);
  expect(exported.settings.crop).toEqual(setupCrop);
  expect(exported.settings.gridPixels).toBe(12.5);
});
