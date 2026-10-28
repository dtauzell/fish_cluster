import { test, expect } from '@playwright/test';
import { analyzeVideo, analysisJSON, addCorrection, download, expectDataTable } from './helpers.mjs';

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
});

test('test chooser enables setup and shows controls for each mode', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#test-chooser')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Choose your test' })).toBeVisible();
  await expect(page.locator('#analyze')).toBeDisabled();

  await page.getByRole('button', { name: /Shoaling/ }).click();
  await expect(page.locator('#test-chooser')).toBeHidden();
  await expect(page.locator('#test-name')).toHaveText('Shoaling');
  await expect(page.locator('#expected-fish')).toBeEnabled();
  await expect(page.locator('#threshold')).toBeVisible();
  await page.getByText('Advanced settings', { exact: true }).click();
  await expect(page.locator('#filter-exact-count')).toBeVisible();
  await expect(page.locator('#analyze')).toBeDisabled();

  await page.getByRole('button', { name: 'Change test', exact: true }).click();
  const chooser = page.getByRole('dialog', { name: 'Change test' });
  await expect(chooser).toBeVisible();
  await chooser.getByRole('button', { name: 'Switch to Light / dark', exact: true }).click();
  await expect(page.locator('#test-name')).toHaveText('Light / dark');
  await expect(page.locator('#expected-fish')).toBeDisabled();
  await expect(page.locator('#human-expected-fish')).toBeDisabled();
  await expect(page.locator('#threshold')).toBeHidden();
  await expect(page.locator('#filter-exact-count')).toBeHidden();
  await expect(page.locator('#crop-tool option[value="dark"]')).toHaveJSProperty('hidden', false);
  await expect(page.locator('#crop-tool option[value="light"]')).toHaveJSProperty('hidden', false);
  await expect(page.locator('#undo-zone')).toHaveJSProperty('hidden', false);
  await expect(page.locator('#analyze')).toBeDisabled();
});

test('sampling summary follows the selected interval', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Shoaling/ }).click();
  await expect(page.locator('#sampling-summary')).toHaveText('Every 0.2 seconds · 5 samples/sec');
  await page.locator('#interval').fill('500');
  await expect(page.locator('#sampling-summary')).toHaveText('Every 0.5 seconds · 2 samples/sec');
  await page.locator('#interval').fill('0');
  await expect(page.locator('#sampling-summary')).toHaveText('Enter a positive sampling interval.');
});

test('About round trip preserves analysis and correction data', async ({ page }) => {
  await analyzeVideo(page);
  await addCorrection(page);
  const before = await analysisJSON(page);
  const progress = await page.locator('#human-progress').innerText();
  const coordinates = await page.locator('#human-center-coordinate-values').inputValue();

  await page.getByRole('link', { name: 'About the analysis', exact: true }).click();
  await expect(page).toHaveURL(/#about$/);
  await expect(page.locator('#about-page')).toBeVisible();
  await expect(page.locator('#about-content')).not.toContainText('Loading the method guide');
  await page.getByRole('link', { name: 'Results', exact: true }).click();
  await expect(page).toHaveURL(/#results$/);
  await expect(page.locator('#human-progress')).toHaveText(progress);
  await expect(page.locator('#human-center-coordinate-values')).toHaveValue(coordinates);
  expect(await analysisJSON(page)).toEqual(before);
});

test('review Help opens and closes', async ({ page }) => {
  await analyzeVideo(page);
  const trigger = page.getByRole('button', { name: 'Help', exact: true });
  await trigger.click();
  const help = page.getByRole('dialog', { name: 'Review buttons explained' });
  await expect(help).toBeVisible();
  await expect(help.getByRole('region', { name: 'Review controls explained' })).toBeVisible();
  await help.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(help).not.toBeVisible();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(help).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(help).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test('Data requires results and previews the current exports after corrections', async ({ page }) => {
  await page.goto('/#data');
  await expect(page).toHaveURL(/#analysis$/);
  await expect(page.locator('#nav-data')).toHaveAttribute('aria-disabled', 'true');
  await page.locator('#nav-data').click({ force: true });
  await expect(page.locator('#data-page')).toBeHidden();

  await analyzeVideo(page);
  const preview = page.locator('#data-preview');
  for (const [format, button] of [['frames', 'Export frames CSV ↓'], ['detections', 'Export detections CSV ↓'], ['json', 'Export all JSON ↓']]) {
    const exported = await download(page, button);
    await page.locator('#nav-data').click();
    await expect(page).toHaveURL(/#data$/);
    await expect(page.locator('#nav-data')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#human-page')).toBeHidden();
    await page.locator('#data-format').selectOption(format);
    if (format === 'json') expect(await preview.locator('pre').textContent()).toBe(exported);
    else await expectDataTable(page, exported);
    await page.locator('#nav-results').click();
  }

  await addCorrection(page);
  const corrected = await analysisJSON(page);
  await page.locator('#nav-data').click();
  await page.locator('#data-format').selectOption('json');
  expect(JSON.parse(await preview.textContent())).toEqual(corrected);
  expect(corrected.frames[0].manualCorrectionApplied).toBe(true);
  await page.locator('#nav-results').click();
  await expect(page.locator('#human-progress')).toContainText('1 of 12 frames done');
});

test('CSV preview columns can be selected and are remembered per export format', async ({ page }) => {
  await analyzeVideo(page);
  await page.locator('#nav-data').click();
  const controls = page.locator('#data-column-options');
  await page.locator('#data-columns summary').click();
  const preview = page.locator('#data-preview table');
  const timestamp = controls.getByRole('checkbox', { name: 'timestamp_ms', exact: true });
  await expect(timestamp).toBeChecked();
  const columnCount = await preview.locator('th').count();
  await timestamp.uncheck();
  await expect(preview.locator('thead')).not.toContainText('timestamp_ms');
  await expect(preview.locator('tbody tr').first().locator('td')).toHaveCount(columnCount - 1);

  await page.reload();
  await expect(page).toHaveURL(/#analysis$/);
  await analyzeVideo(page);
  await page.locator('#nav-data').click();
  await page.locator('#data-columns summary').click();
  await expect(controls.getByRole('checkbox', { name: 'timestamp_ms', exact: true })).not.toBeChecked();

  await page.locator('#data-format').selectOption('detections');
  await expect(controls.getByRole('checkbox', { name: 'timestamp_ms', exact: true })).toBeChecked();
  await controls.getByRole('checkbox', { name: 'detection_id', exact: true }).uncheck();
  await page.locator('#data-format').selectOption('frames');
  await expect(controls.getByRole('checkbox', { name: 'timestamp_ms', exact: true })).not.toBeChecked();
  await controls.getByRole('checkbox', { name: 'timestamp_ms', exact: true }).check();
  await expect(preview.locator('th')).toHaveCount(columnCount);
  await page.locator('#data-format').selectOption('detections');
  await expect(controls.getByRole('checkbox', { name: 'detection_id', exact: true })).not.toBeChecked();
  await page.locator('#data-format').selectOption('json');
  await expect(page.locator('#data-columns')).toBeHidden();
  await expect(page.locator('#data-preview pre')).toBeVisible();
});
