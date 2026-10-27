import { refreshApplication } from './refresh.mjs';

const indicator = document.getElementById('offline-status');
let ready = false;

function show(message) {
  if (indicator) indicator.textContent = message;
}

function showReady() {
  show(navigator.onLine ? 'Ready for offline use' : 'Offline · ready to analyze');
}

async function prepareOffline() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    show('Offline saving unavailable in this browser');
    return;
  }
  show('Saving app for offline use…');
  try {
    const registration = await navigator.serviceWorker.register(new URL('./sw.js', import.meta.url), {
      updateViaCache: 'none',
    });
    if (!registration.active) {
      await new Promise((resolve, reject) => {
        const worker = registration.installing || registration.waiting;
        if (!worker) { reject(new Error('No offline worker')); return; }
        const check = () => {
          if (worker.state === 'activated') resolve();
          if (worker.state === 'redundant') reject(new Error('Offline saving failed'));
        };
        worker.addEventListener('statechange', check);
        check();
      });
    }
    ready = true;
    showReady();
    const showUpdate = () => {
      if (registration.waiting) show(document.getElementById('force-refresh')
        ? 'App update saved · use Force refresh below to load it'
        : 'App update saved · close all app tabs to use it');
    };
    showUpdate();
    const watchUpdate = () => {
      registration.installing?.addEventListener('statechange', showUpdate);
    };
    registration.addEventListener('updatefound', watchUpdate);
    watchUpdate();
    return registration;
  } catch {
    show('Could not save app offline · reconnect and reload to retry');
  }
}

window.addEventListener('online', () => { if (ready) showReady(); });
window.addEventListener('offline', () => { if (ready) showReady(); });
const preparation = prepareOffline();

const refreshButton = document.getElementById('force-refresh');
refreshButton?.addEventListener('click', async () => {
  const message = document.getElementById('refresh-status');
  const hasVideo = Boolean(document.getElementById('video-file')?.files?.length ||
    document.getElementById('source-video')?.getAttribute('src'));
  if (hasVideo && !window.confirm('Reload the latest app? This closes your current video and discards unsaved analysis and corrections. Export anything you want to keep first.')) return;
  refreshButton.disabled = true;
  message.textContent = 'Checking for the latest app…';
  try {
    const registration = await preparation;
    if (!registration) throw new Error('Offline updates are unavailable. Reload this page to retry.');
    await refreshApplication(registration, () => window.location.reload());
  } catch (error) {
    message.textContent = `Could not refresh: ${error.message} Check that the site or local dev server is reachable, then retry.`;
    refreshButton.disabled = false;
  }
});
