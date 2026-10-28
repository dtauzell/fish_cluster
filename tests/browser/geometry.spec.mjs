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

// Fractions correspond to the 160 × 100 source video when the full frame is shown.
async function canvasPoint(page, x, y) {
  const canvas = page.locator('#frame-canvas');
  const box = await canvas.boundingBox();
  return { x: box.x + box.width * x / 160, y: box.y + box.height * y / 100 };
}

async function analyze(page) {
  await page.getByText('Advanced settings', { exact: true }).click();
  await page.locator('#filter-exact-count').uncheck();
  await page.getByRole('button', { name: /Analyze video/ }).click();
  await expect(page).toHaveURL(/#results$/);
  await expect(page.locator('#human-page')).toBeVisible();
  return analysisJSON(page);
}

test('four-corner crop supports undo and cancel and exports video coordinates', async ({ page }) => {
  await loadVideo(page);
  await page.locator('#selection-shape').selectOption('polygon');
  const status = page.locator('#corner-status');
  const clickPoint = async (x, y) => {
    const point = await canvasPoint(page, x, y);
    await page.mouse.click(point.x, point.y);
  };
  await clickPoint(16, 10);
  await clickPoint(140, 14);
  await expect(status).toContainText('2/4 corners');
  await page.locator('#undo-corner').click();
  await expect(status).toContainText('1/4 corners');
  await page.locator('#cancel-corners').click();
  await expect(status).toContainText('Four-corner mode');
  await expect(page.locator('#undo-corner')).toBeDisabled();
  await expect(page.locator('#cancel-corners')).toBeDisabled();
  const corners = [{ x: 16, y: 10 }, { x: 140, y: 14 }, { x: 130, y: 88 }, { x: 22, y: 80 }];
  for (const point of corners) await clickPoint(point.x, point.y);
  await expect(page.locator('#crop-label')).toContainText('Four-corner tank');
  await expect(status).toContainText('Four-corner mode');
  const crop = (await analyze(page)).settings.crop;
  expect(crop.polygon).toHaveLength(4);
  for (let i = 0; i < corners.length; i++) {
    expect(crop.polygon[i].x).toBeCloseTo(corners[i].x, 0);
    expect(crop.polygon[i].y).toBeCloseTo(corners[i].y, 0);
  }
  expect(crop).toMatchObject({ x: 16, y: 10, width: 124, height: 78 });
});

test('calibration drawn while zoomed uses video pixels and clearing keeps the scale', async ({ page }) => {
  await loadVideo(page);
  await page.locator('#preview-zoom-in').click();
  await expect(page.locator('#preview-zoom')).toHaveText('150%');
  await page.locator('#scale-panel > summary').click();
  await page.locator('#draw-calibration').click();
  // One half-inch spans 32 video pixels, even though the preview is enlarged.
  const start = await canvasPoint(page, 64, 50);
  const end = await canvasPoint(page, 96, 50);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y);
  await page.mouse.up();
  await expect(page.locator('#calibration-status')).toContainText('Line: 32');
  await page.locator('#calibration-length').fill('1.27');
  await page.locator('#apply-calibration').click();
  await expect(page.locator('#calibration-status')).toContainText('Scale applied');
  await page.locator('#clear-calibration').click();
  await expect(page.locator('#apply-calibration')).toBeDisabled();
  await expect(page.locator('#clear-calibration')).toBeDisabled();
  const settings = (await analyze(page)).settings;
  expect(settings.gridPixels).toBeCloseTo(32, 0);
  expect(settings.pixelsPerInch).toBeCloseTo(64, 0);
});
