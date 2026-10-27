/** Check quietly; a waiting worker stays inactive until the user refreshes. */
export function watchForAppUpdates(registration, {
  events = window, page = document, timers = globalThis, now = Date.now,
  intervalMs = 5 * 60 * 1000,
} = {}) {
  let pending = null, lastCheck = now(), stopped = false;
  function check(force = false) {
    if (stopped || page.visibilityState === 'hidden' || pending || (!force && now() - lastCheck < 60000)) return pending;
    lastCheck = now();
    pending = Promise.resolve().then(() => registration.update()).catch(() => {
      // Offline use and an unavailable local dev server are expected.
    }).finally(() => { pending = null; });
    return pending;
  }
  const onReturn = () => check();
  const onReconnect = () => check(true);
  const interval = timers.setInterval(() => check(true), intervalMs);
  events.addEventListener('focus', onReturn);
  events.addEventListener('online', onReconnect);
  page.addEventListener('visibilitychange', onReturn);
  function stop() {
    stopped = true;
    timers.clearInterval(interval);
    events.removeEventListener('focus', onReturn);
    events.removeEventListener('online', onReconnect);
    events.removeEventListener('pagehide', onPageHide);
    page.removeEventListener('visibilitychange', onReturn);
  }
  const onPageHide = event => { if (!event.persisted) stop(); };
  events.addEventListener('pagehide', onPageHide);
  return stop;
}
