import test from 'node:test';
import assert from 'node:assert/strict';
import { createDistanceControls } from '../dist/distance-controls.mjs';
import { createSettings } from '../dist/settings.mjs';
import { frameMetrics } from '../dist/measurements.mjs';
import { framesCsv } from '../dist/exports.mjs';

class Control extends EventTarget {
  constructor(value) { super(); this.value = value; this.max = '8'; }
  set value(value) { this.text = String(value); }
  get value() { return this.text; }
  change(value, event = 'change') { this.value = value; this.dispatchEvent(new Event(event)); }
}
function harness(hasResults = true) {
  const input = new Control('3.8'), units = new Control('cm'), slider = new Control('1.5');
  let settings = hasResults ? { thresholdInches: 3.8 / 2.54 } : null;
  let running = false, refreshes = 0;
  const binding = createDistanceControls({ input, units, slider, getSettings: () => settings,
    isRunning: () => running, refresh: () => refreshes++, unitsChanged() {} });
  return { input, units, slider, binding, settings: () => settings, refreshes: () => refreshes,
    setRunning: value => { running = value; }, setSettings: value => { settings = value; } };
}
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test('switching units before analysis preserves the entered physical distance without rounding drift', () => {
  const app = harness(false);
  for (let i = 0; i < 20; i++) {
    app.units.change('in');
    close(Number(app.input.value), 3.8 / 2.54);
    app.units.change('cm');
    close(Number(app.input.value), 3.8);
  }
  close(app.binding.readInches(), 3.8 / 2.54);
  assert.equal(app.refreshes(), 0);
  app.input.change('5.08');
  app.units.change('in');
  close(Number(app.input.value), 2);
  close(app.binding.readInches(), 2);
});

test('post-analysis centimeter edits and explorer slider edits stay physically consistent', () => {
  const app = harness();
  app.input.change('3.8');
  close(app.settings().thresholdInches, 3.8 / 2.54);
  close(Number(app.slider.value), 3.8 / 2.54);
  app.slider.change('2', 'input');
  close(app.settings().thresholdInches, 2);
  close(Number(app.input.value), 5.08);
  close(app.binding.readInches(), 2);
  app.units.change('in');
  close(Number(app.input.value), 2);
  app.input.change('1');
  close(app.settings().thresholdInches, 1);
  app.units.change('cm');
  close(Number(app.input.value), 2.54);
  assert.equal(app.refreshes(), 3);
});

test('recalculation and reanalysis use the same threshold, grouping, and CSV values', () => {
  const app = harness();
  const values = { method: 'background', testType: 'shoaling', expectedFish: 2, intervalMs: 200,
    thresholdInches: app.binding.readInches(), gridPixels: 15, filterExactCount: false };
  const crop = { x: 0, y: 0, width: 100, height: 100 };
  app.setSettings(createSettings(values, crop, 100, 100));
  app.input.change('3.8');
  const edited = { ...app.settings(), thresholdPx: app.settings().thresholdInches * app.settings().pixelsPerInch };
  const rerun = createSettings({ ...values, thresholdInches: app.binding.readInches() }, crop, 100, 100);
  const detections = [{ detectionId: 1, x: 20, y: 50 }, { detectionId: 2, x: 80, y: 50 }];
  const frame = config => ({ frameIndex: 0, timestampMs: 0, detections, metrics: frameMetrics(detections, config) });
  close(edited.thresholdPx, rerun.thresholdPx);
  assert.equal(frame(edited).metrics.clusterCount, 0, 'Fish 60 pixels apart are outside a 3.8 cm link');
  assert.equal(framesCsv([frame(edited)]), framesCsv([frame(rerun)]));
});

test('invalid values and changes during an analysis cannot alter active metrics', () => {
  const app = harness();
  const original = app.settings().thresholdInches;
  app.input.change('bad');
  app.input.change('0');
  app.input.change('0.02'); // Below 0.01 inches when expressed in cm.
  assert.equal(app.settings().thresholdInches, original);
  app.setRunning(true);
  app.input.change('8');
  app.slider.change('4', 'input');
  assert.equal(app.settings().thresholdInches, original);
  assert.equal(app.refreshes(), 0);
});
