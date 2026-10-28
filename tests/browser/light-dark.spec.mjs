import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { analysisJSON, download } from './helpers.mjs';

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
});

// Exports quote every cell, including embedded quotes and newlines.
function csvRecords(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && quoted && text[i + 1] === '"') { cell += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (!quoted && (c === ',' || c === '\r' || c === '\n')) {
      row.push(cell); cell = '';
      if (c !== ',') { rows.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++; }
    } else cell += c;
  }
  if (row.length || cell) { row.push(cell); rows.push(row); }
  const [headers, ...data] = rows;
  return data.map(values => Object.fromEntries(headers.map((name, i) => [name, values[i]])));
}

async function analyzeLightDark(page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Light \/ dark/ }).click();
  await page.locator('#video-file').setInputFiles(fileURLToPath(new URL('./fixtures/moving-fish.webm', import.meta.url)));
  await expect(page.locator('#crop-tool')).toBeEnabled();
  await page.locator('#crop-tool').selectOption('dark');
  const canvas = page.locator('#frame-canvas');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * .05, box.y + box.height * .05);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .48, box.y + box.height * .95);
  await page.mouse.up();
  await expect(page.locator('#zone-count')).not.toHaveText('No light/dark regions marked.');
  const analyze = page.getByRole('button', { name: /Analyze video/ });
  await expect(analyze).toBeEnabled();
  await analyze.click();
  await expect(page).toHaveURL(/#results$/);
  await expect(page.locator('#human-frame-time')).toContainText('Sample 1');
}

async function batchDownload(page, name) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name, exact: true }).click();
  const file = await pending;
  const chunks = [];
  for await (const chunk of await file.createReadStream()) chunks.push(chunk);
  return csvRecords(Buffer.concat(chunks).toString('utf8'));
}

test('light/dark real analysis exports consistent summary and frame data', async ({ page }) => {
  await analyzeLightDark(page);
  const result = await analysisJSON(page);
  expect(result.testType).toBe('light-dark');
  expect(result.frames).toHaveLength(12);
  const [summary] = csvRecords(await download(page, 'Export summary CSV ↓'));
  for (const [key, value] of Object.entries(summary)) {
    if (result.summary[key] == null) expect(value).toBe('');
    else expect(Number(value)).toBeCloseTo(result.summary[key], 8);
  }
  const frames = csvRecords(await download(page, 'Export frames CSV ↓'));
  expect(frames).toHaveLength(result.frames.length);
  for (const [column, key] of [['dark_time_seconds', 'darkTimeSeconds'], ['light_time_seconds', 'lightTimeSeconds'], ['unknown_time_seconds', 'unknownTimeSeconds']]) {
    expect(frames.reduce((total, row) => total + Number(row[column]), 0)).toBeCloseTo(result.summary[key], 8);
  }
  expect(result.summary.darkTimeSeconds + result.summary.lightTimeSeconds + result.summary.unknownTimeSeconds).toBeCloseTo(result.summary.observedDurationSeconds, 8);
});

test('trial collection validates, replaces corrected snapshots, persists and removes results', async ({ page }) => {
  await analyzeLightDark(page);
  await page.getByText('Trial results across fish', { exact: true }).click();
  const batch = page.locator('#batch-results');
  const status = batch.locator('[data-status]');
  const add = batch.getByRole('button', { name: 'Add current fish' });
  await add.click();
  await expect(status).toContainText('Enter trial, exposure and fish ID');
  await batch.locator('[data-trial]').fill(' Trial A ');
  await batch.locator('[data-exposure]').fill(' low ');
  await add.click();
  await expect(status).toContainText('Enter trial, exposure and fish ID');
  await batch.locator('[data-fish]').fill(' Fish 1 ');
  await add.click();
  await expect(status).toHaveText('Fish result saved.');
  const original = (await batchDownload(page, 'Download per-fish CSV'))[0];
  expect([original.trial, original.exposure, original.fishId, original.fileName]).toEqual(['Trial A', 'low', 'Fish 1', 'moving-fish.webm']);
  await add.click();
  await expect(status).toContainText('already exists');
  await expect(batch.locator('table tr:has(td)')).toHaveCount(1);
  const replace = batch.getByRole('button', { name: 'Replace matching fish' });
  await expect(replace).toBeVisible();

  // Clear a measured sample so its adjacent interval becomes unknown.
  await page.locator('#human-edit-centers').check();
  await page.getByText('Display & correction options', { exact: true }).click();
  await page.locator('#human-clear').click();
  await page.locator('#human-apply-centers').click();
  const corrected = await analysisJSON(page);
  expect(Number(original.coverageFraction)).not.toBe(corrected.summary.coverageFraction);
  expect((await batchDownload(page, 'Download per-fish CSV'))[0]).toEqual(original);
  await replace.click();
  await expect(status).toHaveText('Fish result saved.');
  const [updated] = await batchDownload(page, 'Download per-fish CSV');
  expect(Number(updated.coverageFraction)).toBeCloseTo(corrected.summary.coverageFraction, 8);
  expect(updated.fishId).toBe('Fish 1');
  const [group] = await batchDownload(page, 'Download group means CSV');
  expect([group.trial, group.exposure, group.fishCount, group.expectedFish]).toEqual(['Trial A', 'low', '1', '10']);
  expect(Number(group.coverageFractionMean)).toBeCloseTo(corrected.summary.coverageFraction, 8);

  await page.reload();
  // Results are stored independently of the current analysis and appear once
  // light/dark results are opened again.
  await analyzeLightDark(page);
  await page.getByText('Trial results across fish', { exact: true }).click();
  await expect(batch.locator('table tr:has(td)')).toHaveCount(1);
  expect((await batchDownload(page, 'Download per-fish CSV'))[0]).toEqual(updated);
  await batch.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(batch.locator('table tr:has(td)')).toHaveCount(0);
  await expect(batch.getByRole('button', { name: 'Download per-fish CSV' })).toBeDisabled();
  await page.reload();
  await analyzeLightDark(page);
  await page.getByText('Trial results across fish', { exact: true }).click();
  await expect(batch.locator('table tr:has(td)')).toHaveCount(0);
});
