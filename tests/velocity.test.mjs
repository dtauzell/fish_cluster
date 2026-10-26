import test from 'node:test';
import assert from 'node:assert/strict';
import { singleFishVelocity, velocityChart } from '../dist/velocity.mjs';
import { applyManualCenters } from '../dist/review.mjs';
import { createVelocityView } from '../dist/velocity-ui.mjs';

const config = { expectedFish: 1, intervalMs: 200, pixelsPerInch: 10,
  thresholdPx: 10, crop: { x: 0, y: 0, width: 500, height: 500 } };
function frame(frameIndex, x, y = 0, extra = {}) {
  return { frameIndex, timestampMs: frameIndex * 200,
    detections: x == null ? [] : [{ x, y, positionSource: 'observed', trackId: 1 }], ...extra };
}

test('single-fish speed uses elapsed time and Euclidean distance, and keeps zero speed', () => {
  const frames = [frame(0, 0), frame(1, 3, 4), frame(2, 3, 4), frame(3, 15, 9)];
  const report = singleFishVelocity(frames, config);
  assert.deepEqual(report.intervals.map(i => i.speedPxPerSecond), [25, 0, 65]);
  assert.equal(report.minPxPerSecond, 0);
  assert.equal(report.maxPxPerSecond, 65);
  assert.equal(report.averagePxPerSecond, 30);
  assert.equal(report.averageInchesPerSecond, 3);
  assert.equal(report.measuredDurationMs, 600);
  assert.equal(report.intervals[0].timestampMs, 100);
  assert.equal(report.intervals[0].speedInchesPerSecond, 2.5);
  const still = singleFishVelocity([frame(0, 1), frame(1, 1)], config);
  assert.equal(still.maxPxPerSecond, 0);
  assert.doesNotMatch(velocityChart(still), /NaN|Infinity/);
});

test('average speed weights measured time and scale changes do not alter pixel speeds', () => {
  const frames = [frame(0, 0), frame(1, 10, 0, { timestampMs: 100 }), frame(2, 25, 0, { timestampMs: 400 })];
  const report = singleFishVelocity(frames, config);
  assert.equal(report.minPxPerSecond, 50);
  assert.equal(report.maxPxPerSecond, 100);
  assert.equal(report.averagePxPerSecond, 62.5);
  assert.equal(report.averageInchesPerSecond, 6.25);
  const rescaled = singleFishVelocity(frames, { ...config, pixelsPerInch: 20 });
  assert.equal(rescaled.averagePxPerSecond, 62.5);
  assert.equal(rescaled.averageInchesPerSecond, 3.125);
});

test('missing, multiple, excluded, ambiguous and estimated samples break the velocity graph', () => {
  const frames = [frame(0, 0), frame(1, 1), frame(2, null), frame(3, 3), frame(4, 4),
    frame(5, 5, 0, { detections: [{ x: 5, y: 0 }, { x: 30, y: 0 }] }), frame(6, 6), frame(7, 7)];
  let report = singleFishVelocity(frames, config);
  assert.deepEqual(report.intervals.map(i => i.endFrameIndex), [1, 4, 7]);
  const chart = velocityChart(report);
  const path = chart.match(/<path d="([^"]+)"/)[1];
  assert.equal((path.match(/M/g) ?? []).length, 3);
  for (const point of [{ x: 2, y: 0, positionUncertain: true }, { x: 2, y: 0, splitFromBlob: true },
    { x: 2, y: 0, positionSource: 'overlap-estimate' }, { x: NaN, y: 0 }]) {
    report = singleFishVelocity([frame(0, 0), frame(1, 1, 0, { detections: [point] }), frame(2, 2)], config);
    assert.equal(report.validIntervalCount, 0);
  }
  report = singleFishVelocity([frame(0, 0), frame(1, 1, 0, { rejectedDetections: [{ x: 20, y: 20 }] }), frame(2, 2)], config);
  assert.equal(report.validIntervalCount, 0);
  assert.equal(singleFishVelocity(frames, { ...config, filterExactCount: true, filterFrameCount: 2 }).validIntervalCount, 0);
});

test('sample gaps, long elapsed gaps, reversed timestamps and track changes never become velocities', () => {
  for (const frames of [[frame(0, 0), frame(2, 2)],
    [frame(0, 0), frame(1, 1, 0, { timestampMs: 900 })],
    [frame(0, 0), frame(1, 1, 0, { timestampMs: -100 })],
    [frame(0, 0), frame(1, 1, 0, { timestampMs: 0 })],
    [frame(0, 0), frame(1, 1, 0, { detections: [{ x: 1, y: 0, trackId: 2 }] })]]) {
    assert.equal(singleFishVelocity(frames, config).validIntervalCount, 0);
  }
});

test('manual corrections repair adjacent velocity intervals without changing original frames', () => {
  const frames = [frame(0, 0), frame(1, null), frame(2, 20)];
  assert.equal(singleFishVelocity(frames, config).validIntervalCount, 0);
  const corrected = applyManualCenters(frames[1], [{ x: 10, y: 0 }], config);
  const report = singleFishVelocity([frames[0], corrected, frames[2]], config);
  assert.equal(report.validIntervalCount, 2);
  assert.equal(report.averagePxPerSecond, 50);
  assert.equal(frames[1].detections.length, 0);
});

test('multi-fish recordings have no report; empty and uncalibrated recordings have no invented values', () => {
  assert.equal(singleFishVelocity([frame(0, 0), frame(1, 1)], { ...config, expectedFish: 5 }), null);
  for (const frames of [[], [frame(0, 0)], [frame(0, null), frame(1, null)]]) {
    const report = singleFishVelocity(frames, config);
    assert.equal(report.minPxPerSecond, null);
    assert.equal(report.maxPxPerSecond, null);
    assert.equal(report.averagePxPerSecond, null);
    assert.equal(velocityChart(report), '');
  }
  const uncalibrated = singleFishVelocity([frame(0, 0), frame(1, 1)], { ...config, pixelsPerInch: 0 });
  assert.equal(uncalibrated.averagePxPerSecond, 5);
  assert.equal(uncalibrated.averageInchesPerSecond, null);
  assert.equal(velocityChart(uncalibrated, 'inches'), '');
});

test('velocity view is optional, single-fish only, and refreshes after corrections and calibration', () => {
  class Control extends EventTarget {
    constructor() { super(); Object.assign(this, { hidden: false, checked: false, value: 'pixels', textContent: '', innerHTML: '' }); }
    querySelector() { return this.option ??= {}; }
  }
  const controls = new Map();
  const $ = id => { if (!controls.has(id)) controls.set(id, new Control()); return controls.get(id); };
  const saved = globalThis.document;
  globalThis.document = { getElementById: $ };
  try {
    let settings = { ...config }, frames = [frame(0, 0), frame(1, 10)];
    const view = createVelocityView({ getFrames: () => frames, getSettings: () => settings, getSelectedTime: () => 200 });
    view.refresh();
    assert.equal($('velocity-panel').hidden, false);
    assert.equal($('velocity-details').hidden, true);
    assert.equal(view.exportReport(), null);
    $('show-velocity').checked = true;
    $('show-velocity').dispatchEvent(new Event('change'));
    assert.equal($('velocity-details').hidden, false);
    assert.equal($('velocity-average').textContent, '50.00 px/s');
    assert.match($('velocity-chart').innerHTML, /<path/);
    assert.match($('velocity-chart').innerHTML, /stroke-dasharray/);
    $('velocity-units').value = 'inches';
    $('velocity-units').dispatchEvent(new Event('change'));
    assert.equal($('velocity-average').textContent, '5.00 in/s');
    settings = { ...settings, pixelsPerInch: 20 };
    view.refresh();
    assert.equal($('velocity-average').textContent, '2.50 in/s');
    frames = [frame(0, 0), frame(1, 20)]; view.refresh();
    assert.equal($('velocity-average').textContent, '5.00 in/s');
    assert.equal(view.exportReport().averagePxPerSecond, 100);
    settings = { ...settings, expectedFish: 5 }; view.refresh();
    assert.equal($('velocity-panel').hidden, true);
    assert.equal(view.exportReport(), null);
    settings = { ...settings, expectedFish: 1 }; frames = [frame(0, null)]; view.refresh();
    assert.equal($('velocity-min').textContent, '—');
    assert.equal($('velocity-empty').hidden, false);
    assert.equal($('velocity-chart').hidden, true);
  } finally { globalThis.document = saved; }
});
