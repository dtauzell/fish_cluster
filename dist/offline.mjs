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
      if (registration.waiting) show('App update saved · close all app tabs to use it');
    };
    showUpdate();
    const watchUpdate = () => {
      registration.installing?.addEventListener('statechange', showUpdate);
    };
    registration.addEventListener('updatefound', watchUpdate);
    watchUpdate();
  } catch {
    show('Could not save app offline · reconnect and reload to retry');
  }
}

window.addEventListener('online', () => { if (ready) showReady(); });
window.addEventListener('offline', () => { if (ready) showReady(); });
prepareOffline();
