/** Display the commit's date in the viewer's local timezone. */
export function versionLabel({ version } = {}) {
  if (!version?.commit) return 'Version unavailable';
  const date = new Date(version.commitDate);
  const formatted = Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date) : 'date unavailable';
  return `Version ${version.commit.slice(0, 8)} · ${formatted}${version.dirty ? ' · modified' : ''}`;
}

/** Ask the worker serving this app, rather than fetching metadata for a newer release. */
export function requestAppVersion(worker, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const finish = (error, data) => {
      clearTimeout(timeout);
      channel.port1.close();
      if (error) reject(error); else resolve(data);
    };
    const timeout = setTimeout(() => finish(new Error('Version unavailable')), timeoutMs);
    channel.port1.onmessage = event => finish(null, event.data);
    try { worker.postMessage({ type: 'GET_APP_VERSION' }, [channel.port2]); }
    catch (error) { channel.port2.close(); finish(error); }
  });
}
