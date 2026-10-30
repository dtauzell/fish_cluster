import { test, expect } from '@playwright/test';
import { analyzeVideo, analysisJSON, addCorrection, download } from './helpers.mjs';

// Ordinary UI scenarios use fresh pages without a cache masking changed assets.
// The offline suite separately exercises real, enabled service workers.
test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
});

// Exercise Results with known review categories while retaining real video
// loading, decoded-frame navigation, rendering and correction behavior.
async function analyzeReviewCases(page) {
  await page.route('**/pipeline.mjs', async route => {
    const response = await route.fetch();
    const source = (await response.text()).replace('export async function* analyzeVideo(', 'async function* analyzeOriginalVideo(');
    await route.fulfill({ response, body: source + `
      export async function* analyzeVideo(options) {
        for await (const event of analyzeOriginalVideo(options)) {
          const frame = event.frame;
          if (frame) {
            if (frame.frameIndex === 1) { frame.detections = []; frame.selectionConfident = false; }
            if (frame.frameIndex === 3) {
              frame.selectionConfident = false;
              frame.detections[0].positionUncertain = true;
            }
            if (frame.frameIndex === 5) frame.detections[0].splitFromBlob = true;
            if (frame.frameIndex === 7) {
              frame.rejectedDetections = [{ ...frame.detections[0], rejectionReason: 'ambiguous-single-fish' }];
            }
            frame.metrics = frameMetrics(frame.detections, options.config, frame.rejectedDetections.length);
          }
          yield event;
        }
      }
    ` });
  });
  await analyzeVideo(page);
}

test('Results issue filters show counts and restrict navigation and playback', async ({ page }) => {
  await analyzeReviewCases(page);
  const filter = page.locator('#human-frame-filter');
  for (const [mode, label, count] of [['all', 'All', 12], ['missing', 'Missing', 1],
    ['ambiguous', 'Ambiguous', 2], ['uncertain', 'Uncertain', 2], ['flagged', 'Flagged', 4]]) {
    await expect(filter.locator(`option[value="${mode}"]`)).toHaveText(`${label} (${count})`);
    await filter.selectOption(mode);
    await expect(page.locator('#human-filter-summary')).toContainText(`${count} of 12 frames`);
    await expect(page.locator('#human-frame-number')).toHaveAttribute('max', String(count));
  }
  await page.locator('#human-frame-number').fill('1');
  await page.locator('#human-frame-number').press('Enter');
  await expect(page.locator('#human-frame-time')).toContainText('Sample 2 ·');
  await expect(page.locator('#human-next')).toBeEnabled();
  await page.locator('#human-next').click();
  await expect(page.locator('#human-frame-time')).toContainText('Sample 4 ·');
  await expect(page.locator('#human-play')).toBeEnabled();
  await page.locator('#human-playback-speed').selectOption('1');
  await page.locator('#human-play').click();
  await expect(page.locator('#human-frame-time')).toContainText('Sample 6 ·');
  await page.locator('#human-stop').click();
  await expect(page.locator('#human-progress')).toContainText('0 of 4 frames done');
  // Changing the view does not narrow the exported analysis.
  expect((await analysisJSON(page)).frames).toHaveLength(12);
});

test('correcting filtered frames updates categories and an empty filter can return to All', async ({ page }) => {
  await analyzeReviewCases(page);
  const filter = page.locator('#human-frame-filter');
  await filter.selectOption('ambiguous');
  await expect(page.locator('#human-frame-time')).toContainText('Sample 4 ·');
  await expect(page.locator('#human-edit-centers')).toBeEnabled();
  await page.locator('#human-edit-centers').check();
  const canvas = page.locator('#human-canvas');
  let box = await canvas.boundingBox();
  await canvas.click({ position: { x: box.width * .85, y: box.height * .8 } });
  await page.locator('#human-apply-centers').click();
  await expect(filter.locator('option[value="ambiguous"]')).toHaveText('Ambiguous (1)');
  await expect(page.locator('#human-frame-time')).toContainText('Sample 8 ·');
  await expect(filter).toHaveValue('ambiguous');
  await filter.selectOption('missing');
  await expect(page.locator('#human-frame-time')).toContainText('Sample 2 ·');
  await expect(page.locator('#human-clear')).toBeEnabled();
  box = await canvas.boundingBox();
  await canvas.click({ position: { x: box.width * .5, y: box.height * .5 } });
  await page.locator('#human-apply-centers').click();
  await expect(page.locator('#human-empty-filter')).toBeVisible();
  await expect(page.locator('#human-frame-workspace')).toBeHidden();
  await expect(filter.locator('option[value="missing"]')).toHaveText('Missing (0)');
  await expect(filter).toBeVisible();
  await filter.selectOption('all');
  await expect(page.locator('#human-frame-workspace')).toBeVisible();
  await expect(page.locator('#human-frame-time')).toContainText('Sample 1 ·');
  await expect(page.locator('#human-next')).toBeEnabled();
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
  await expect(play).toBeEnabled();
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
  expect(edited.settings.thresholdCentimeters).toBeCloseTo(4.2, 10);
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
  expect(slid.settings.thresholdCentimeters).toBeCloseTo(inches * 2.54, 10);
  expect(slid.frames.every(frame => frame.metrics.clusterCount === 1)).toBe(true);
  await page.getByRole('link', { name: 'Setup', exact: true }).click();
  expect(Number(await page.locator('#threshold').inputValue())).toBeCloseTo(inches * 2.54, 10);
  await page.getByRole('button', { name: /Analyze video/ }).click();
  await expect(page).toHaveURL(/#results$/);
  const rerun = await analysisJSON(page);
  expect(rerun.settings.thresholdCentimeters).toBeCloseTo(inches * 2.54, 10);
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
