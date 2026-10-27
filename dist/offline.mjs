import { refreshApplication } from './refresh.mjs';
import { requestAppVersion, versionLabel } from './version.mjs';
import { watchForAppUpdates } from './update-check.mjs';

const indicator = document.getElementById('offline-status');
const updateBanner = document.getElementById('app-update-banner');
let readyRegistration = null;

function show(message) {
  if (indicator) indicator.textContent = message;
}

function showReady() {
  if (updateBanner) updateBanner.hidden = !readyRegistration?.waiting;
  if (readyRegistration?.waiting) {
    show(updateBanner ? 'App update saved · use Load update to load it' : document.getElementById('force-refresh')
      ? 'App update saved · use Force refresh below to load it'
      : 'App update saved · close all app tabs to use it');
    return;
  }
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
    readyRegistration = registration;
    showReady();
    const showUpdate = () => {
      showReady();
    };
    showUpdate();
    const watchUpdate = () => {
      registration.installing?.addEventListener('statechange', showUpdate);
    };
    registration.addEventListener('updatefound', watchUpdate);
    watchUpdate();
    watchForAppUpdates(registration);
    return registration;
  } catch {
    show('Could not save app offline · reconnect and reload to retry');
  }
}

window.addEventListener('online', () => { if (readyRegistration) showReady(); });
window.addEventListener('offline', () => { if (readyRegistration) showReady(); });
const preparation = prepareOffline();

preparation.then(async registration => {
  const label = document.getElementById('app-version');
  if (!label) return;
  try {
    const metadata = await requestAppVersion(navigator.serviceWorker.controller || registration.active);
    label.textContent = versionLabel(metadata);
    label.title = metadata.version?.commit
      ? `Commit ${metadata.version.commit}\nCommit date: ${metadata.version.commitDate}\nOffline build: ${metadata.revision}${metadata.version.dirty ? '\nIncludes uncommitted changes.' : ''}`
      : 'Git metadata was unavailable when this version was prepared.';
  } catch { label.textContent = 'Version unavailable'; }
});

const refreshButton = document.getElementById('force-refresh');
const updateButton = document.getElementById('load-app-update');
function refreshStatus(text) {
  for (const id of ['refresh-status', 'update-banner-status']) {
    const message = document.getElementById(id);
    if (message) message.textContent = text;
  }
}
async function loadLatestApp() {
  const hasVideo = Boolean(document.getElementById('video-file')?.files?.length ||
    document.getElementById('source-video')?.getAttribute('src'));
  if (hasVideo && !window.confirm('Reload the latest app? This closes your current video and discards unsaved analysis and corrections. Export anything you want to keep first.')) return;
  for (const button of [refreshButton, updateButton]) if (button) button.disabled = true;
  refreshStatus('Loading the latest app…');
  try {
    const registration = await preparation;
    if (!registration) throw new Error('Offline updates are unavailable. Reload this page to retry.');
    await refreshApplication(registration, () => window.location.reload());
  } catch (error) {
    refreshStatus(`Could not refresh: ${error.message} Check that the site or local dev server is reachable, then retry.`);
    for (const button of [refreshButton, updateButton]) if (button) button.disabled = false;
  }
}
refreshButton?.addEventListener('click', loadLatestApp);
updateButton?.addEventListener('click', loadLatestApp);
