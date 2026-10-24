import test from 'node:test';
import assert from 'node:assert/strict';
import { framePassesCountFilter, reviewFrameIndices, automaticCandidateCount } from '../dist/frame-selection.mjs';
import { applyManualCenters, restoreAutomaticCenters } from '../dist/review.mjs';
import { frameMetrics } from '../dist/measurements.mjs';
import { humanCsv } from '../dist/exports.mjs';

const config = { method: 'background', expectedFish: 5, filterExactCount: true, filterFrameCount: 5,
  thresholdPx: 20, pixelsPerInch: 30, crop: { x: 0, y: 0, width: 100, height: 100 } };
const points = count => Array.from({ length: count }, (_, i) => ({ detectionId: i + 1, x: 10 + i * 10, y: 40 }));
const frame = (index, count) => ({ frameIndex: index, timestampMs: index * 200,
  detections: points(count), rejectedDetections: [], metrics: frameMetrics(points(count), config) });

test('review exposes low and excess candidate counts, including center-rule exclusions', () => {
  const extra = { ...frame(2, 5), rejectedDetections: [{ ...points(6)[5], rejectionReason: 'farther-from-crop-center' }] };
  const frames = [frame(0, 5), frame(1, 4), extra, frame(3, 0)];
  assert.deepEqual(frames.filter(f => framePassesCountFilter(f, config)).map(f => f.frameIndex), [0, 2]);
  assert.deepEqual(reviewFrameIndices(frames, 'all', 5), [0, 1, 2, 3]);
  assert.deepEqual(reviewFrameIndices(frames, 'mismatches', 5), [1, 2, 3]);
  assert.equal(automaticCandidateCount(extra), 6);
});

test('manual correction promotes a skipped frame without removing it from the mismatch subset; undo excludes it again', () => {
  const frames = [frame(0, 5), frame(1, 4)];
  assert.equal(framePassesCountFilter(frames[1], config), false);
  frames[1] = applyManualCenters(frames[1], points(5), config);
  assert.equal(framePassesCountFilter(frames[1], config), true);
  assert.equal(automaticCandidateCount(frames[1]), 4);
  assert.deepEqual(reviewFrameIndices(frames, 'mismatches', 5), [1]);
  frames[1] = restoreAutomaticCenters(frames[1], config);
  assert.equal(framePassesCountFilter(frames[1], config), false);
  assert.deepEqual(reviewFrameIndices(frames, 'mismatches', 5), [1]);
});

test('combined results navigation includes corrected samples without changing sample identity', () => {
  const frames = [frame(17, 4), frame(23, 5), frame(42, 6)];
  assert.deepEqual(reviewFrameIndices(frames, 'included', 5, config), [1]);
  assert.deepEqual(reviewFrameIndices(frames, 'mismatches', 5, config), [0, 2]);
  frames[0] = applyManualCenters(frames[0], points(5), config);
  assert.deepEqual(reviewFrameIndices(frames, 'included', 5, config), [0, 1]);
  assert.deepEqual(reviewFrameIndices(frames, 'mismatches', 5, config), [0, 2]);
  assert.equal(frames[0].frameIndex, 17);
  frames[1] = applyManualCenters(frames[1], [], config);
  assert.deepEqual(reviewFrameIndices(frames, 'included', 5, config), [0]);
  assert.deepEqual(reviewFrameIndices(frames, 'all', 5, config), [0, 1, 2]);
  frames[0] = restoreAutomaticCenters(frames[0], config);
  assert.deepEqual(reviewFrameIndices(frames, 'included', 5, config), []);
  assert.deepEqual(reviewFrameIndices(frames, 'all', 5, config), [0, 1, 2]);
  assert.deepEqual(reviewFrameIndices(frames, 'included', 5, { ...config, filterExactCount: false }), [0, 1, 2]);
});

test('review filtering handles no mismatches and all samples excluded from results', () => {
  assert.deepEqual(reviewFrameIndices([frame(0, 5)], 'mismatches', 5), []);
  const frames = [frame(0, 4), frame(1, 3)];
  assert.equal(frames.filter(f => framePassesCountFilter(f, config)).length, 0);
  assert.deepEqual(reviewFrameIndices(frames, 'mismatches', 5), [0, 1]);
  assert.equal(frames.filter(f => framePassesCountFilter(f, { ...config, filterExactCount: false })).length, 2);
});

test('human export keeps original sample identity and inclusion status for skipped and corrected samples', () => {
  const skipped = frame(17, 4);
  const csv = humanCsv([skipped], new Map(), new Set([0]), config);
  const [header, row] = csv.split('\r\n').map(line => line.split(',').map(cell => cell.slice(1, -1)));
  const result = Object.fromEntries(header.map((key, i) => [key, row[i]]));
  assert.equal(result.frame_index, '17');
  assert.equal(result.frame_number, '18');
  assert.equal(result.timestamp_ms, '3400');
  assert.equal(result.reviewed, 'true');
  assert.equal(result.included_in_results, 'false');
  assert.equal(result.automatic_candidate_count, '4');
  const corrected = applyManualCenters(skipped, points(5), config);
  const correctedCsv = humanCsv([corrected], new Map([[0, points(5)]]), new Set([0]), config);
  const values = correctedCsv.split('\r\n')[1].split(',').map(cell => cell.slice(1, -1));
  assert.equal(values[header.indexOf('included_in_results')], 'true');
  assert.equal(values[header.indexOf('automatic_candidate_count')], '4');
});
