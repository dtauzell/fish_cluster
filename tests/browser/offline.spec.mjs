import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

test.use({ serviceWorkers: 'allow' });

for (const button of ['Force refresh', 'Load update']) {
test(`${button} activates an already downloaded release while offline`, async ({ page, context, request }, testInfo) => {
  const scope = button === 'Load update' ? 'offline-update-banner' : 'offline-saved-update';
  await request.post('/__test/release', { data: { scope, release: 'a' } });
  await page.goto(`/${scope}/`);
  await expect(page.locator('#offline-status')).toHaveText('Ready for offline use');
  const banner = page.getByRole('complementary', { name: 'App update', exact: true });
  await expect(banner).toBeHidden();
  await expect(page.locator('#app-version')).toContainText('Version aaaaaaaa');
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  // Serve a different prepared release at the SAME origin/scope. Trigger the
  // browser's native update check, as the app's periodic checker does.
  await request.post('/__test/release', { data: { scope, release: 'b' } });
  await page.evaluate(async () => { const registration = await navigator.serviceWorker.getRegistration(); await registration.update(); });
  await expect(page.locator('#offline-status')).toContainText('App update saved');
  await expect(page.locator('#app-version')).toContainText('Version aaaaaaaa');
  await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting))).toBe(true);
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Update available');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(banner).toBeInViewport({ ratio: 1 });

  if (button === 'Load update') {
    await page.screenshot({ path: testInfo.outputPath('update-banner-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(banner).toBeInViewport({ ratio: 1 });
    await expect(banner.getByRole('button', { name: button, exact: true })).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath('update-banner-mobile.png') });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole('button', { name: /Shoaling/ }).click();
    await page.locator('#video-file').setInputFiles(fileURLToPath(new URL('./fixtures/moving-fish.webm', import.meta.url)));
    await expect(page.getByRole('button', { name: /Analyze video/ })).toBeEnabled();
    page.once('dialog', dialog => dialog.dismiss());
    await banner.getByRole('button', { name: button, exact: true }).click();
    await expect(banner).toBeVisible();
    await expect(page.locator('#app-version')).toContainText('Version aaaaaaaa');
    expect(await page.locator('#video-file').evaluate(input => input.files.length)).toBe(1);
    page.once('dialog', dialog => dialog.accept());
  }

  await context.setOffline(true);
  await page.getByRole('button', { name: button, exact: true }).click();
  await expect(page.locator('#app-version')).toContainText('Version bbbbbbbb');
  await expect(page.locator('#offline-status')).toHaveText('Offline · ready to analyze');
  await expect(banner).toBeHidden();
  await page.reload();
  await expect(page.locator('#app-version')).toContainText('Version bbbbbbbb');
  await expect(page.getByRole('button', { name: /Shoaling/ })).toBeVisible();
});
}
