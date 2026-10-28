import { expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// Parse downloaded CSV independently of the application's formatter, including
// quoted commas/newlines so metadata can exercise real export escaping.
export function csvRecords(text) {
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

export async function buttonCsv(page, button) {
  const pending = page.waitForEvent('download');
  await button.click();
  const file = await pending;
  const chunks = [];
  for await (const chunk of await file.createReadStream()) chunks.push(chunk);
  return csvRecords(Buffer.concat(chunks).toString('utf8'));
}

export async function openDetails(details) {
  if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click();
}

export async function prepareLightDark(page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Light \/ dark/ }).click();
  await openDetails(page.locator('details.advanced-settings'));
  // Five reference frames on this short constant-floor fixture cannot learn
  // floor flicker independently of the moving rectangle.
  await page.locator('#suppress-flicker').uncheck();
  await page.locator('#video-file').setInputFiles(fileURLToPath(new URL('./fixtures/single-fish.webm', import.meta.url)));
  await expect(page.locator('#analyze')).toBeEnabled();
  await page.locator('#crop-tool').selectOption('dark');
  const canvas = page.locator('#frame-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height);
  await page.mouse.up();
  await expect(page.locator('#zone-count')).toContainText('1 dark');
}

export async function analyzePrepared(page) {
  await page.locator('#analyze').click();
  await expect(page).toHaveURL(/#results$/);
  await expect(page.locator('#human-done')).toBeEnabled();
}

export async function saveFish(page, { trial, exposure, fishId }) {
  await openDetails(page.locator('#batch-results').locator('..'));
  const batch = page.locator('#batch-results');
  await batch.getByLabel('Trial', { exact: true }).fill(trial);
  await batch.getByLabel('Exposure level').fill(exposure);
  await batch.getByLabel('Fish ID').fill(fishId);
  await batch.getByRole('button', { name: 'Add current fish', exact: true }).click();
  return batch;
}
