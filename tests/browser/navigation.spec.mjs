import { test, expect } from '@playwright/test';
import { analyzeVideo, analysisJSON, addCorrection } from './helpers.mjs';

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
