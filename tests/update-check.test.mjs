import test from 'node:test';
import assert from 'node:assert/strict';
import { watchForAppUpdates } from '../dist/update-check.mjs';

function harness(update) {
  const events = new EventTarget(), page = new EventTarget();
  page.visibilityState = 'visible';
  let time = 0, tick, cleared = false, checks = 0;
  const stop = watchForAppUpdates({ update: async () => { checks++; return update?.(); } }, {
    events, page, now: () => time,
    timers: { setInterval: (callback, interval) => { tick = callback; assert.equal(interval, 300000); return 1; },
      clearInterval: handle => { assert.equal(handle, 1); cleared = true; } },
  });
  return { events, page, stop, tick: () => tick(), advance: ms => { time += ms; },
    checks: () => checks, cleared: () => cleared };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('visible offline copies check every five minutes and on returning to the app', async () => {
  const app = harness();
  app.advance(300000);
  await app.tick();
  assert.equal(app.checks(), 1);
  app.advance(60000);
  app.events.dispatchEvent(new Event('focus'));
  await settle();
  assert.equal(app.checks(), 2);
  app.advance(60000);
  app.page.dispatchEvent(new Event('visibilitychange'));
  await settle();
  assert.equal(app.checks(), 3);
  app.stop();
});

test('reconnecting retries immediately while repeated focus events are throttled', async () => {
  const app = harness();
  app.events.dispatchEvent(new Event('focus'));
  await settle();
  assert.equal(app.checks(), 0);
  app.events.dispatchEvent(new Event('online'));
  await settle();
  assert.equal(app.checks(), 1);
  app.events.dispatchEvent(new Event('focus'));
  app.page.dispatchEvent(new Event('visibilitychange'));
  await settle();
  assert.equal(app.checks(), 1);
  app.stop();
});

test('an unreachable server is harmless and concurrent checks share one request', async () => {
  let reject;
  const app = harness(() => new Promise((resolve, failure) => { reject = failure; }));
  app.advance(300000);
  const pending = app.tick();
  await settle();
  app.events.dispatchEvent(new Event('online'));
  assert.equal(app.checks(), 1);
  reject(new Error('Offline'));
  await pending;
  app.advance(300000);
  const retry = app.tick();
  await settle();
  assert.equal(app.checks(), 2);
  reject(new Error('Still offline'));
  await retry;
  app.stop();
});

test('hidden tabs defer checks and closing a page removes its timer and listeners', async () => {
  const app = harness();
  app.advance(300000);
  app.page.visibilityState = 'hidden';
  await app.tick();
  assert.equal(app.checks(), 0);
  app.page.visibilityState = 'visible';
  app.page.dispatchEvent(new Event('visibilitychange'));
  await settle();
  assert.equal(app.checks(), 1);
  app.events.dispatchEvent(new Event('pagehide'));
  assert.equal(app.cleared(), true);
  app.advance(300000);
  await app.tick();
  app.events.dispatchEvent(new Event('online'));
  await settle();
  assert.equal(app.checks(), 1);
});

test('returning through browser back/forward history keeps update checks active', async () => {
  const app = harness();
  const hide = new Event('pagehide');
  Object.defineProperty(hide, 'persisted', { value: true });
  app.page.visibilityState = 'hidden';
  app.events.dispatchEvent(hide);
  assert.equal(app.cleared(), false);
  app.advance(300000);
  app.page.visibilityState = 'visible';
  app.page.dispatchEvent(new Event('visibilitychange'));
  await settle();
  assert.equal(app.checks(), 1);
  app.stop();
});
