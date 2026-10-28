import { expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export async function analyzeVideo(page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Shoaling/ }).click();
  await page.locator('#expected-fish').fill('2');
  await page.locator('#expected-fish').press('Tab');
  await page.getByText('Advanced settings', { exact: true }).click();
  await page.locator('#filter-exact-count').uncheck();
  await page.locator('#video-file').setInputFiles(fileURLToPath(new URL('./fixtures/moving-fish.webm', import.meta.url)));
  const analyze = page.getByRole('button', { name: /Analyze video/ });
  await expect(analyze).toBeEnabled();
  await analyze.click();
  await expect(page).toHaveURL(/#results$/);
  await expect(page.locator('#human-page')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Done & next →', exact: true })).toBeEnabled();
  await expect(page.locator('#human-frame-time')).toContainText('Sample 1');
}

export async function download(page, button) {
  const panel = page.locator('#results-exports');
  if (await panel.getAttribute('open') === null) await panel.locator('summary').click();
  const pending = page.waitForEvent('download');
  await panel.getByRole('button', { name: button }).click();
  const file = await pending;
  const stream = await file.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export async function analysisJSON(page) {
  return JSON.parse(await download(page, 'Export all JSON ↓'));
}

export async function expectDataTable(page, exported) {
  const table = page.locator('#data-preview table');
  await expect(table).toBeVisible();
  const csv = await table.locator('tr').evaluateAll(rows => rows.map(row =>
    [...row.cells].map(cell => `"${cell.textContent.replaceAll('"', '""')}"`).join(',')
  ).join('\r\n'));
  expect(csv).toBe(exported);
}

export async function addCorrection(page) {
  await page.getByRole('checkbox', { name: 'Edit centers', exact: true }).check();
  await expect(page.locator('#human-center-coordinate-values')).not.toHaveValue('');
  const canvas = page.locator('#human-canvas');
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: box.width * .85, y: box.height * .8 } });
  const apply = page.getByRole('button', { name: 'Apply & stay', exact: true });
  await expect(apply).toBeVisible();
  await apply.click();
  await expect(page.locator('#human-progress')).toContainText('1 of 12 frames done');
}
