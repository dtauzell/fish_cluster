import { test, expect } from '@playwright/test';
import { analyzeVideo, analysisJSON, addCorrection, download } from './helpers.mjs';

// Ordinary UI scenarios use fresh pages without a cache masking changed assets.
// The offline suite separately exercises real, enabled service workers.
test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
});

test('review playback supports speed, stop, and spacebar without marking frames done', async ({ page }) => {
  await analyzeVideo(page);
  const play = page.locator('#human-play');
  const stop = page.locator('#human-stop');
  const item = page.locator('#human-frame-number');
  await page.locator('#human-playback-speed').selectOption('1');
  await play.click();
  await expect(stop).toBeEnabled();
  await page.waitForTimeout(300);
  await expect(item).toHaveValue('1');
  await expect(item).toHaveValue('2');
  await stop.click();
  const stopped = await item.inputValue();
  await page.waitForTimeout(1200);
  await expect(item).toHaveValue(stopped);

  await page.locator('#human-playback-speed').selectOption('10');
  await play.click();
  await expect(item).not.toHaveValue(stopped);
  // Space also works while the speed selector has focus.
  await page.locator('#human-playback-speed').focus();
  await page.keyboard.press('Space');
  await expect(stop).toBeDisabled();
  const paused = await item.inputValue();
  await page.waitForTimeout(400);
  await expect(item).toHaveValue(paused);
  await page.keyboard.press('Space');
  await expect(stop).toBeEnabled();
  await expect(item).not.toHaveValue(paused);
  await page.keyboard.press('Space');
  await expect(stop).toBeDisabled();
  // A held Space must not toggle repeatedly, including with Play focused.
  await play.focus();
  await page.keyboard.down('Space');
  await expect(stop).toBeEnabled();
  await page.keyboard.down('Space');
  await expect(stop).toBeEnabled();
  await page.keyboard.up('Space');
  await page.keyboard.press('Space');
  await expect(stop).toBeDisabled();
  await expect(page.locator('#human-progress')).toContainText('0 of 12 frames done');
});

test('review playback finishes at the end, restarts, and stops on navigation', async ({ page }) => {
  await analyzeVideo(page);
  const item = page.locator('#human-frame-number');
  const play = page.locator('#human-play');
  const stop = page.locator('#human-stop');
  await item.fill('11');
  await item.press('Enter');
  await expect(play).toBeEnabled();
  await page.locator('#human-playback-speed').selectOption('10');
  await play.click();
  await expect(item).toHaveValue('12');
  await expect(stop).toBeDisabled();
  await play.click();
  await expect(item).not.toHaveValue('12');
  await page.keyboard.press('ArrowRight');
  await expect(stop).toBeDisabled();
  const paused = await item.inputValue();
  await page.waitForTimeout(400);
  await expect(item).toHaveValue(paused);
  await play.click();
  await page.getByRole('link', { name: 'Setup', exact: true }).click();
  await page.getByRole('link', { name: 'Results', exact: true }).click();
  await expect(stop).toBeDisabled();
});

test('switching units before analysis preserves the physical distance', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Shoaling/ }).click();
  const units = page.getByRole('combobox', { name: /^Distance units/ });
  const distance = page.locator('#threshold');
  await expect(distance).toHaveValue('3.8');
  await units.selectOption('in');
  await expect.poll(async () => Number(await distance.inputValue())).toBeCloseTo(3.8 / 2.54, 10);
  await units.selectOption('cm');
  await expect(distance).toHaveValue('3.8');
});

test('centimeter edits and slider changes agree with exports and reanalysis', async ({ page }) => {
  await analyzeVideo(page);
  await page.getByRole('link', { name: 'Setup', exact: true }).click();
  await page.locator('#threshold').fill('4.2');
  await page.locator('#threshold').press('Tab');
  await page.getByRole('link', { name: 'Results', exact: true }).click();
  const edited = await analysisJSON(page);
  expect(edited.settings.thresholdInches).toBeCloseTo(4.2 / 2.54, 10);
  expect(edited.frames).toHaveLength(12);
  expect(edited.frames.every(frame => frame.metrics.clusterCount === 0)).toBe(true);
  const csv = await download(page, 'Export frames CSV ↓');
  const rows = csv.trim().split('\r\n').map(row => row.split(',').map(value => value.slice(1, -1)));
  const clusters = rows[0].indexOf('clusterCount');
  expect(clusters).toBeGreaterThan(-1);
  expect(rows.slice(1).every(row => row[clusters] === '0')).toBe(true);

  await page.getByText('Explore groups & link distance', { exact: true }).click();
  const slider = page.locator('#cluster-distance');
  await slider.focus();
  await slider.press('End');
  const inches = Number(await slider.inputValue());
  const slid = await analysisJSON(page);
  expect(slid.settings.thresholdInches).toBe(inches);
  expect(slid.frames.every(frame => frame.metrics.clusterCount === 1)).toBe(true);
  await page.getByRole('link', { name: 'Setup', exact: true }).click();
  expect(Number(await page.locator('#threshold').inputValue())).toBeCloseTo(inches * 2.54, 10);
  await page.getByRole('button', { name: /Analyze video/ }).click();
  await expect(page).toHaveURL(/#results$/);
  const rerun = await analysisJSON(page);
  expect(rerun.settings.thresholdInches).toBe(inches);
  expect(rerun.frames.map(frame => frame.metrics.groupSizes)).toEqual(slid.frames.map(frame => frame.metrics.groupSizes));
});

test('changing tests preserves corrections until a different test is confirmed', async ({ page }) => {
  await analyzeVideo(page);
  await addCorrection(page);
  const before = await analysisJSON(page);
  expect(before.frames.some(frame => frame.manualCorrectionApplied)).toBe(true);
  const progress = await page.locator('#human-progress').innerText();
  const coordinates = await page.locator('#human-center-coordinate-values').inputValue();
  const chooser = page.getByRole('dialog', { name: 'Change test', exact: true });
  for (const action of ['cancel', 'escape', 'keep']) {
    await page.getByRole('button', { name: 'Change test', exact: true }).click();
    await expect(chooser).toBeVisible();
    if (action === 'cancel') await chooser.getByRole('button', { name: 'Cancel', exact: true }).click();
    if (action === 'escape') await page.keyboard.press('Escape');
    if (action === 'keep') await chooser.getByRole('button', { name: 'Keep Shoaling', exact: true }).click();
    await expect(chooser).not.toBeVisible();
    await expect(page).toHaveURL(/#results$/);
    await expect(page.locator('#human-progress')).toHaveText(progress);
    await expect(page.locator('#human-center-coordinate-values')).toHaveValue(coordinates);
    expect(await analysisJSON(page)).toEqual(before);
  }
  await page.getByRole('button', { name: 'Change test', exact: true }).click();
  page.once('dialog', dialog => dialog.dismiss());
  await chooser.getByRole('button', { name: 'Switch to Light / dark', exact: true }).click();
  await expect(chooser).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#human-progress')).toHaveText(progress);
  await expect(page.locator('#human-center-coordinate-values')).toHaveValue(coordinates);
  expect(await analysisJSON(page)).toEqual(before);
  await page.getByRole('button', { name: 'Change test', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await chooser.getByRole('button', { name: 'Switch to Light / dark', exact: true }).click();
  await expect(chooser).not.toBeVisible();
  await expect(page.locator('#test-name')).toHaveText('Light / dark');
  await expect(page.locator('#nav-results')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#human-page')).not.toBeVisible();
});
