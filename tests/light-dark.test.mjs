import test from 'node:test';
import assert from 'node:assert/strict';
import { lightDarkReport } from '../dist/light-dark.mjs';
import { lightDarkFramesCsv, lightDarkSummaryCsv } from '../dist/exports.mjs';
import { createSettings } from '../dist/settings.mjs';
import { usesSingleFishSides } from '../dist/tank-zones.mjs';
import { applyManualCenters } from '../dist/review.mjs';
import { snapshotResult } from '../dist/experiment-storage.mjs';

const config = { testType: 'light-dark', expectedFish: 1, intervalMs: 200, pixelsPerInch: 10, thresholdPx: 10,
  crop: { x: 0, y: 0, width: 100, height: 100 }, tankZones: [{ x: 50, y: 0, width: 50, height: 100, side: 'dark' }] };
const frame = (frameIndex, x, timestampMs = frameIndex * 200) => ({ frameIndex, timestampMs,
  detections: x == null ? [] : [{ x, y: 20, trackId: 1, positionSource: 'observed' }] });

test('zone occupancy splits crossing intervals and speed weights elapsed time', () => {
  const report = lightDarkReport([frame(0, 10), frame(1, 20, 100), frame(2, 80, 400)], config);
  assert.equal(report.lightTimeSeconds, .25);
  assert.equal(report.darkTimeSeconds, .15);
  assert.equal(report.observedDurationSeconds, .4);
  assert.equal(report.zoneSwitchCount, 1);
  assert.equal(report.averageSpeedPxPerSecond, 175);
  assert.equal(report.averageSpeedInchesPerSecond, 17.5);
  assert.equal(report.coverageFraction, 1);
});

test('complete coverage remains a valid saved fraction after separate side sums round', () => {
  // A crossing near the end accumulates the two sides in a different order
  // from the full observed duration (previously coverage was 1 + one ULP).
  const frames = Array.from({ length: 12 }, (_, i) => frame(i, i < 10 ? 80 : 20));
  const report = lightDarkReport(frames, config);
  assert.equal(report.coverageFraction, 1);
  const saved = snapshotResult({ trial: 'Crossing', exposure: 'Control', fishId: '1' }, report);
  assert.equal(saved.coverageFraction, 1);
});

test('unknown positions and sample gaps retain time without inventing switches or speed', () => {
  for (const frames of [[frame(0, 10), frame(1, null), frame(2, 80)],
    [frame(0, 10), frame(2, 80)], [frame(0, 10), frame(1, 80, 900)]]) {
    const report = lightDarkReport(frames, config);
    assert.equal(report.unknownTimeSeconds, report.observedDurationSeconds);
    assert.equal(report.zoneSwitchCount, 0);
    assert.equal(report.averageSpeedPxPerSecond, null);
    assert.equal(report.coverageFraction, 0);
  }
});

test('manual correction repairs occupancy and both adjacent switches', () => {
  const frames = [frame(0, 80), frame(1, null), frame(2, 80)];
  const corrected = applyManualCenters(frames[1], [{ x: 20, y: 20 }], config);
  const report = lightDarkReport([frames[0], corrected, frames[2]], config);
  assert.equal(report.zoneSwitchCount, 2);
  assert.equal(report.darkTimeSeconds, .2);
  assert.equal(report.lightTimeSeconds, .2);
  assert.equal(report.velocityDurationSeconds, .4);
  assert.equal(frames[1].detections.length, 0);
});

test('track changes and uncertain positions make occupancy intervals unknown', () => {
  for (const extra of [{ trackId: 2 }, { positionUncertain: true }, { splitFromBlob: true }]) {
    const second = frame(1, 80);
    Object.assign(second.detections[0], extra);
    const report = lightDarkReport([frame(0, 10), second], config);
    assert.equal(report.unknownTimeSeconds, .2);
    assert.equal(report.zoneSwitchCount, 0);
    assert.equal(report.averageSpeedPxPerSecond, null);
  }
});

test('empty or single-sample reports have no extrapolated duration or invented speed', () => {
  for (const frames of [[], [frame(0, 80)]]) {
    const report = lightDarkReport(frames, config);
    assert.equal(report.observedDurationSeconds, 0);
    assert.equal(report.darkTimeSeconds, 0);
    assert.equal(report.averageSpeedPxPerSecond, null);
    assert.equal(report.coverageFraction, null);
  }
});

test('CSV keeps unknown and excluded samples and exposes interval and summary units', () => {
  const frames = [frame(0, 10), frame(1, null), frame(2, 80)];
  const text = lightDarkFramesCsv(frames, { ...config, filterExactCount: true, filterFrameCount: 1 });
  assert.equal(text.split('\r\n').length, 4);
  assert.match(text, /"unknown"/);
  assert.match(text, /"false"/);
  assert.match(text, /"speed_inches_per_second"/);
  assert.match(lightDarkSummaryCsv(lightDarkReport(frames, config)), /"unknownTimeSeconds"/);
});

test('explicit experiment settings enforce light-dark count and preserve legacy side mode', () => {
  const values = { method: 'background', intervalMs: 200, thresholdInches: 1, gridPixels: 5,
    expectedFish: 5, testType: 'light-dark', filterExactCount: true, filterFrameCount: 5 };
  const settings = createSettings(values, config.crop, 100, 100, [], config.tankZones);
  assert.equal(settings.expectedFish, 1);
  assert.equal(settings.filterFrameCount, 1);
  assert.throws(() => createSettings(values, config.crop, 100, 100), /dark tank region/);
  assert.throws(() => createSettings(values, config.crop, 100, 100, [],
    [{ x: 200, y: 0, width: 10, height: 10, side: 'dark' }]), /usable tank/);
  assert.throws(() => createSettings({ ...values, testType: 'other' }, config.crop, 100, 100), /test/);
  assert.equal(usesSingleFishSides({ ...config, testType: 'shoaling' }), false);
  assert.equal(usesSingleFishSides({ ...config, testType: undefined }), true);
});
