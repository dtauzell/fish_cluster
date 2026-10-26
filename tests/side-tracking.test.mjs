import test from 'node:test';
import assert from 'node:assert/strict';
import { trackSingleFishSides, observedFishSide, visibleSideChanges } from '../dist/side-tracking.mjs';
import { analysisTankSide, usesSingleFishSides } from '../dist/tank-zones.mjs';
import { applyManualCenters, restoreAutomaticCenters } from '../dist/review.mjs';
import { analyzeVideo } from '../dist/pipeline.mjs';
import { detectionsCsv } from '../dist/exports.mjs';

const config = { expectedFish: 1, intervalMs: 200, pixelsPerInch: 10, thresholdPx: 10,
  crop: { x: 50, y: 100, width: 100, height: 100 },
  tankZones: [{ x: 100, y: 100, width: 50, height: 100, side: 'dark' }] };
const frame = (frameIndex, x, extra = {}) => ({ frameIndex, timestampMs: frameIndex * 200,
  detections: x == null ? [] : [{ x, y: 150, positionSource: 'observed', trackId: 1 }], ...extra });

test('a single dark region enables side tracking and the rest of the usable tank is light', () => {
  assert.equal(usesSingleFishSides(config), true);
  assert.equal(analysisTankSide({ x: 120, y: 150 }, config), 'dark');
  assert.equal(analysisTankSide({ x: 70, y: 150 }, config), 'light');
  assert.equal(analysisTankSide({ x: 10, y: 150 }, config), 'unmarked');
  assert.equal(analysisTankSide({ x: 120, y: 150 }, { ...config,
    exclusions: [{ x: 110, y: 140, width: 20, height: 20 }] }), 'unmarked');
  assert.equal(analysisTankSide({ x: 120, y: 150 }, { ...config, tankZones: [...config.tankZones,
    { x: 110, y: 140, width: 20, height: 20, side: 'light' }] }), 'light');
  for (const settings of [{ ...config, expectedFish: 5 }, { ...config, tankZones: [] },
    { ...config, tankZones: [{ ...config.tankZones[0], side: 'light' }] }]) {
    assert.equal(trackSingleFishSides([frame(0, 70), frame(1, 120)], settings), null);
  }
  assert.equal(analysisTankSide({ x: 70, y: 150 }, { ...config, expectedFish: 5 }), 'unmarked');
});

test('side changes record original sample identity and projection into a filtered review view', () => {
  const frames = [frame(0, 70), frame(1, 120), frame(2, 130), frame(3, 80), frame(4, 125)];
  const report = trackSingleFishSides(frames, config);
  assert.deepEqual(report.samples.map(sample => sample.side), ['light', 'dark', 'dark', 'light', 'dark']);
  assert.deepEqual(report.changes.map(c => [c.frameIndex, c.timestampMs, c.from, c.to]),
    [[1, 200, 'light', 'dark'], [3, 600, 'dark', 'light'], [4, 800, 'light', 'dark']]);
  assert.equal(report.darkSampleCount, 3);
  assert.equal(report.lightSampleCount, 2);
  assert.equal(report.unknownSampleCount, 0);
  assert.deepEqual(visibleSideChanges(report, [0, 1, 2, 3, 4]), [1, 3, 4]);
  assert.deepEqual(visibleSideChanges(report, [0, 2, 3]), [2]);
  assert.deepEqual(visibleSideChanges(report, []), []);
});

test('missing and ambiguous samples stay unknown and never become a crossing after filtering them out', () => {
  const frames = [frame(0, 70), frame(1, null), frame(2, 120), frame(3, 80,
    { detections: [{ x: 80, y: 150 }, { x: 120, y: 150 }] }), frame(4, 70)];
  const report = trackSingleFishSides(frames, config);
  assert.deepEqual(report.samples.map(s => s.side), ['light', 'unknown', 'dark', 'unknown', 'light']);
  assert.equal(report.changes.length, 0);
  assert.deepEqual(visibleSideChanges(report, [0, 2, 4]), []);
  for (const extra of [{ detections: [{ x: 120, y: 150, positionUncertain: true }] },
    { detections: [{ x: 120, y: 150, splitFromBlob: true }] },
    { detections: [{ x: 120, y: 150, positionSource: 'overlap-estimate' }] },
    { detections: [{ x: NaN, y: 150 }] },
    { rejectedDetections: [{ x: 130, y: 140 }] }]) {
    assert.equal(observedFishSide(frame(0, 120, extra), config), 'unknown');
  }
  assert.equal(observedFishSide(frame(0, 120), { ...config, filterExactCount: true, filterFrameCount: 2 }), 'unknown');
});

test('a gap in samples, time, or automatic paths does not imply an observed crossing', () => {
  for (const second of [frame(2, 120), frame(1, 120, { timestampMs: 900 }), frame(1, 120, { timestampMs: 0 }),
    frame(1, 120, { detections: [{ x: 120, y: 150, trackId: 2 }] })]) {
    const report = trackSingleFishSides([frame(0, 70), second], config);
    assert.equal(report.darkSampleCount, 1);
    assert.equal(report.lightSampleCount, 1);
    assert.equal(report.changes.length, 0);
  }
});

test('applied manual corrections update side tracking, exports, and adjacent changes; restore undoes them', () => {
  const original = frame(1, 120, { rejectedDetections: [{ x: 70, y: 150 }] });
  assert.equal(observedFishSide(original, config), 'unknown');
  const corrected = applyManualCenters(original, [{ x: 70, y: 150 }], config);
  assert.equal(corrected.detections[0].tankSide, 'light');
  assert.equal(corrected.metrics.lightSideCount, 1);
  const report = trackSingleFishSides([frame(0, 120), corrected, frame(2, 120)], config);
  assert.equal(report.changes.length, 2);
  const lines = detectionsCsv([corrected]).trim().split('\r\n').map(line => line.split(',').map(v => v.slice(1, -1)));
  assert.equal(lines[1][lines[0].indexOf('tank_side')], 'light');
  assert.equal(observedFishSide(restoreAutomaticCenters(corrected, config), config), 'unknown');
  assert.equal(original.detections[0].x, 120);
});

test('pipeline exports a light position outside the only marked dark region', async () => {
  const settings = { ...config, crop: { x: 50, y: 100, width: 100, height: 100 }, method: 'roboflow', confidence: .5 };
  const source = { seekTo: async () => {}, readGray: () => new Uint8Array(10000),
    readBitmap: async () => ({ close() {} }) };
  let count = 0;
  const prepareModel = async () => ({ engine: { infer: async () =>
    [{ class: 'fish', x: count++ % 2 ? 70 : 20, y: 50, width: 10, height: 10, confidence: 1 }] } });
  const frames = [];
  for await (const event of analyzeVideo({ config: settings, source, prepareModel, duration: .45 })) if (event.frame) frames.push(event.frame);
  assert.deepEqual(frames.map(frame => frame.detections[0].tankSide), ['light', 'dark', 'light']);
  assert.deepEqual(frames.map(frame => frame.metrics.lightSideCount), [1, 0, 1]);
  assert.equal(trackSingleFishSides(frames, settings).changes.length, 2);
});
