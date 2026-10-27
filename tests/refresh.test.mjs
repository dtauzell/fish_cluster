import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshApplication } from '../dist/refresh.mjs';

class Worker extends EventTarget {
  constructor(state) { super(); this.state = state; this.messages = []; }
  change(state) { this.state = state; this.dispatchEvent(new Event('statechange')); }
  postMessage(message) { this.messages.push(message); }
}

test('force refresh activates a saved release offline and reloads only after activation', async () => {
  const worker = new Worker('installed');
  const calls = [];
  worker.postMessage = message => {
    calls.push(message.type);
    queueMicrotask(() => worker.change('activating'));
  };
  const refresh = refreshApplication({ waiting: worker, update: async () => { calls.push('update'); throw new Error('Offline'); } },
    () => calls.push('reload'));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['ACTIVATE_UPDATE']);
  worker.change('activated');
  await refresh;
  assert.deepEqual(calls, ['ACTIVATE_UPDATE', 'reload']);
});

test('force refresh can use an update that finishes saving while a network check fails', async () => {
  const worker = new Worker('installed');
  worker.postMessage = () => queueMicrotask(() => worker.change('activated'));
  let reloaded = false;
  const registration = { waiting: null, update: async () => {
    registration.waiting = worker;
    throw new Error('Network disconnected');
  } };
  await refreshApplication(registration, () => { reloaded = true; });
  assert.equal(reloaded, true);
});

test('force refresh waits for the complete download before activating an installing worker', async () => {
  const worker = new Worker('installing');
  let reloaded = false;
  const refresh = refreshApplication({ installing: worker, update: async () => {} }, () => { reloaded = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(worker.messages.length, 0);
  worker.change('installed');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(worker.messages, [{ type: 'ACTIVATE_UPDATE' }]);
  assert.equal(reloaded, false);
  worker.change('activated');
  await refresh;
  assert.equal(reloaded, true);
});

test('force refresh reloads when the existing release is already current', async () => {
  const calls = [];
  await refreshApplication({ update: async () => calls.push('update') }, () => calls.push('reload'));
  assert.deepEqual(calls, ['update', 'reload']);
});

test('an unreachable dev server leaves the existing app open', async () => {
  let reloaded = false;
  await assert.rejects(refreshApplication({ update: async () => { throw new Error('Server unavailable'); } },
    () => { reloaded = true; }), /Server unavailable/);
  assert.equal(reloaded, false);
});

test('an incomplete new release cannot activate or reload the app', async () => {
  const worker = new Worker('installing');
  let reloaded = false;
  const refresh = refreshApplication({ installing: worker, update: async () => {} }, () => { reloaded = true; });
  const rejected = assert.rejects(refresh, /update failed/);
  await new Promise(resolve => setImmediate(resolve));
  worker.change('redundant');
  await rejected;
  assert.equal(worker.messages.length, 0);
  assert.equal(reloaded, false);
});

test('a release activated by another tab is awaited without sending another activation message', async () => {
  const worker = new Worker('activating');
  let reloaded = false;
  const refresh = refreshApplication({ installing: worker, update: async () => {} }, () => { reloaded = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reloaded, false);
  worker.change('activated');
  await refresh;
  assert.equal(worker.messages.length, 0);
  assert.equal(reloaded, true);
});
