function waitForState(worker, states) {
  return new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timeout);
      worker.removeEventListener('statechange', check);
      if (error) reject(error); else resolve();
    };
    const check = () => {
      if (states.includes(worker.state)) finish();
      else if (worker.state === 'redundant') finish(new Error('The app update failed. Please retry.'));
    };
    const timeout = setTimeout(() => finish(new Error('The app update timed out. Please retry.')), 45000);
    worker.addEventListener('statechange', check);
    check();
  });
}

/** Download a complete release, activate it, and only then reload the page. */
export async function refreshApplication(registration, reload) {
  // A complete saved update is usable even when its server is unreachable.
  if (!registration.waiting) {
    try { await registration.update(); }
    catch (error) { if (!registration.waiting) throw error; }
  }
  const worker = registration.waiting || registration.installing;
  if (worker) {
    await waitForState(worker, ['installed', 'activating', 'activated']);
    const activated = waitForState(worker, ['activated']);
    if (worker.state === 'installed') worker.postMessage({ type: 'ACTIVATE_UPDATE' });
    await activated;
  }
  reload();
}
