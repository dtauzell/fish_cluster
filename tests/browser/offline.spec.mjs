import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'allow' });

test('Force refresh activates an already downloaded release while offline', async ({ page, context, request }) => {
  const scope = 'offline-saved-update';
  await request.post('/__test/release', { data: { scope, release: 'a' } });
  await page.goto(`/${scope}/`);
  await expect(page.locator('#offline-status')).toHaveText('Ready for offline use');
  await expect(page.locator('#app-version')).toContainText('Version aaaaaaaa');
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  // Serve a different prepared release at the SAME origin/scope. Trigger the
  // browser's native update check, as the app's periodic checker does.
  await request.post('/__test/release', { data: { scope, release: 'b' } });
  await page.evaluate(async () => { const registration = await navigator.serviceWorker.getRegistration(); await registration.update(); });
  await expect(page.locator('#offline-status')).toContainText('App update saved');
  await expect(page.locator('#app-version')).toContainText('Version aaaaaaaa');
  await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting))).toBe(true);

  await context.setOffline(true);
  await page.getByRole('button', { name: 'Force refresh', exact: true }).click();
  await expect(page.locator('#app-version')).toContainText('Version bbbbbbbb');
  await expect(page.locator('#offline-status')).toHaveText('Offline · ready to analyze');
  await page.reload();
  await expect(page.locator('#app-version')).toContainText('Version bbbbbbbb');
  await expect(page.getByRole('button', { name: /Shoaling/ })).toBeVisible();
});
