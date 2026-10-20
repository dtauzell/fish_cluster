import test from 'node:test';
import assert from 'node:assert/strict';
import { selectCentralCandidates, frameCandidates } from '../dist/candidate-selection.mjs';
import { frameMetrics } from '../dist/measurements.mjs';
import { summarizeSharpnessLabels } from '../dist/sharpness.mjs';
import { sharpnessCsv, detectionsCsv, framesCsv } from '../dist/exports.mjs';

const crop = { x: 100, y: 200, width: 100, height: 100 };
const candidates = [
  { detectionId: 1, x: 110, y: 210, sharpness: 20 },
  { detectionId: 2, x: 150, y: 250, sharpness: 100 },
  { detectionId: 3, x: 170, y: 250, sharpness: 80 }
];
const config = { crop, method: 'background', expectedFish: 2, thresholdPx: 30, pixelsPerInch: 30 };

test('nearest-center rule uses the crop center, preserves IDs/order and retains rejects', () => {
  const before = structuredClone(candidates);
  const result = selectCentralCandidates(candidates, crop, 2);
  assert.deepEqual(result.detections.map(point => point.detectionId), [2, 3]);
  assert.equal(result.detections[0].distanceFromCenterPx, 0);
  assert.equal(result.rejectedDetections[0].detectionId, 1);
  assert.equal(result.rejectedDetections[0].rejectionReason, 'farther-from-crop-center');
  assert.deepEqual(candidates, before);
  assert.deepEqual(frameCandidates(result).map(point => point.detectionId), [1, 2, 3]);
});

test('no excess means no removal or invented fish; disabled rule retains extras', () => {
  assert.equal(selectCentralCandidates(candidates, crop, 3).rejectedDetections.length, 0);
  assert.equal(selectCentralCandidates(candidates.slice(0, 1), crop, 5).detections.length, 1);
  assert.equal(selectCentralCandidates(candidates, crop).detections.length, 3);
  assert.deepEqual(selectCentralCandidates([], crop, 5), { detections: [], rejectedDetections: [] });
  assert.throws(() => selectCentralCandidates([], crop, 0), /positive integer/);
});

test('equal center distances retain original order', () => {
  const tied = [{ detectionId: 3, x: 140, y: 250 }, { detectionId: 2, x: 160, y: 250 }];
  assert.equal(selectCentralCandidates(tied, crop, 1).detections[0].detectionId, 3);
});

test('random-spacing comparison is omitted only when candidates were actually removed', () => {
  const selected = selectCentralCandidates(candidates, crop, 2);
  const metrics = frameMetrics(selected.detections, config, selected.rejectedDetections.length);
  assert.equal(metrics.fishCount, 2);
  assert.equal(metrics.meanPairDistancePx, 20);
  assert.equal(metrics.randomSpacingPercentile, null);
  assert.equal(metrics.randomSpacingUnavailableReason, 'center-selection');
  assert.ok(Number.isFinite(frameMetrics(selected.detections, config).randomSpacingPercentile));
});

test('diagnostic labels and exports include rejected candidates while metrics use kept ones', () => {
  const selected = selectCentralCandidates(candidates, crop, 2);
  const frame = { frameIndex: 0, timestampMs: 0, rawPredictionCount: 3, ...selected,
    metrics: frameMetrics(selected.detections, config, 1) };
  const labels = new Map([[0, new Map([[1, 'reflection'], [2, 'fish']])]]);
  assert.deepEqual(summarizeSharpnessLabels([frame], labels), {
    fish: { count: 1, median: 100 }, reflection: { count: 1, median: 20 }
  });
  const [columns, rejected, ...kept] = sharpnessCsv([frame], labels).split('\r\n').map(line => line.split(',').map(cell => cell.slice(1, -1)));
  assert.equal(rejected[columns.indexOf('included_in_analysis')], 'false');
  assert.equal(rejected[columns.indexOf('rejection_reason')], 'farther-from-crop-center');
  assert.equal(rejected[columns.indexOf('human_label')], 'reflection');
  assert.equal(kept.length, 2);
  assert.equal(detectionsCsv([frame]).split('\r\n').length, 3); // Header plus kept points only.
  assert.match(framesCsv([frame]), /center-selection/);
});
