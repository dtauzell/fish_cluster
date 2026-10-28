import { test, expect } from '@playwright/test';
import { analysisJSON } from './helpers.mjs';
import { prepareLightDark, analyzePrepared, saveFish, buttonCsv, openDetails } from './trial-helpers.mjs';

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
});

test('trial groups weight fish equally, count available metrics, and persist separately', async ({ page }) => {
  await prepareLightDark(page);
  await analyzePrepared(page);
  const first = await analysisJSON(page);
  expect(first.summary.unknownTimeSeconds).toBeCloseTo(0, 8);
  let batch = await saveFish(page, { trial: 'Trial A', exposure: 'Control', fishId: 'Fish 1' });
  await expect(batch.getByRole('status')).toHaveText('Fish result saved.');

  await page.locator('#human-edit-centers').check();
  await openDetails(page.getByText('Display & correction options', { exact: true }).locator('..'));
  async function clearSample(number) {
    const item = page.locator('#human-frame-number');
    await item.fill(String(number));
    await item.press('Enter');
    await expect(page.locator('#human-frame-time')).toContainText(`Sample ${number} ·`);
    await page.locator('#human-clear').click();
    await page.locator('#human-apply-centers').click();
  }
  await clearSample(6);
  const second = await analysisJSON(page);
  expect(second.summary.velocityDurationSeconds).toBeLessThan(first.summary.velocityDurationSeconds);
  expect(second.summary.darkTimeSeconds / (second.summary.darkTimeSeconds + second.summary.lightTimeSeconds))
    .not.toBeCloseTo(first.summary.darkTimeSeconds / (first.summary.darkTimeSeconds + first.summary.lightTimeSeconds), 8);
  batch = await saveFish(page, { trial: 'Trial A', exposure: 'Control', fishId: 'Fish 2' });
  await expect(batch.getByRole('status')).toHaveText('Fish result saved.');
  for (const sample of [2, 4, 8, 10, 12]) await clearSample(sample);
  const third = await analysisJSON(page);
  expect(third.summary.averageSpeedPxPerSecond).toBeNull();
  expect(third.summary.velocityDurationSeconds).toBe(0);
  batch = await saveFish(page, { trial: 'Trial A', exposure: 'Control', fishId: 'Fish 3' });
  await expect(batch.getByRole('status')).toHaveText('Fish result saved.');
  await saveFish(page, { trial: 'Trial A', exposure: 'High', fishId: 'Fish 1' });
  await expect(batch.getByRole('status')).toHaveText('Fish result saved.');
  await saveFish(page, { trial: 'Trial B', exposure: 'Control', fishId: 'Fish 1' });
  await expect(batch.getByRole('status')).toHaveText('Fish result saved.');

  const fishButton = batch.getByRole('button', { name: 'Download per-fish CSV' });
  const groupButton = batch.getByRole('button', { name: 'Download group means CSV' });
  const fish = await buttonCsv(page, fishButton);
  const groups = await buttonCsv(page, groupButton);
  expect(fish).toHaveLength(5);
  expect(groups).toHaveLength(3);
  const group = groups.find(row => row.trial === 'Trial A' && row.exposure === 'Control');
  expect(group).toMatchObject({ fishCount: '3', completeFishCount: '3', partialFishCount: '0', darkFractionN: '2', averageSpeedPxPerSecondN: '2', coverageFractionN: '3' });
  const rows = fish.filter(row => row.trial === 'Trial A' && row.exposure === 'Control');
  expect(rows.map(row => row.fishId)).toEqual(['Fish 1', 'Fish 2', 'Fish 3']);
  expect(rows[2].averageSpeedPxPerSecond).toBe('');
  const a = Number(rows[0].darkFraction), b = Number(rows[1].darkFraction);
  expect(Number(group.darkFractionMean)).toBeCloseTo((a + b) / 2, 8);
  const weighted = rows.slice(0, 2).reduce((sum, row) => sum + Number(row.darkTimeSeconds), 0) /
    rows.slice(0, 2).reduce((sum, row) => sum + Number(row.darkTimeSeconds) + Number(row.lightTimeSeconds), 0);
  expect(Math.abs(Number(group.darkFractionMean) - weighted)).toBeGreaterThan(.001);
  expect(Number(group.averageSpeedPxPerSecondMean)).toBeCloseTo((Number(rows[0].averageSpeedPxPerSecond) + Number(rows[1].averageSpeedPxPerSecond)) / 2, 8);
  expect(groups.filter(row => row.fishCount === '1').map(row => [row.trial, row.exposure])).toEqual([['Trial A', 'High'], ['Trial B', 'Control']]);

  await page.reload();
  await prepareLightDark(page);
  await analyzePrepared(page);
  await openDetails(page.locator('#batch-results').locator('..'));
  await expect(batch.locator('table tr:has(td)')).toHaveCount(5);
  expect(await buttonCsv(page, fishButton)).toEqual(fish);
  expect(await buttonCsv(page, groupButton)).toEqual(groups);
});
