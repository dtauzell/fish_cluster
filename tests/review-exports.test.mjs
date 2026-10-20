import test from 'node:test';
import assert from 'node:assert/strict';
import { frameMetrics, changeFrames } from '../dist/measurements.mjs';
import { applyManualCenters, restoreAutomaticCenters, compareFrame, summarizeReview } from '../dist/review.mjs';
import { detectionsCsv, framesCsv, humanCsv, exportedSettings } from '../dist/exports.mjs';
import { frameCandidates } from '../dist/candidate-selection.mjs';

const config = {
  method: 'background', expectedFish: 2, thresholdPx: 15, thresholdInches: .5,
  pixelsPerInch: 30, crop: { x: 50, y: 100, width: 100, height: 100 }
};
const detections = [
  { detectionId: 1, className: 'fish candidate', x: 60, y: 110, confidence: 1 },
  { detectionId: 2, className: 'fish candidate', x: 70, y: 110, confidence: 1 }
];
const frame = { frameIndex: 0, timestampMs: 0, rawPredictionCount: 2,
  detections, metrics: frameMetrics(detections, config) };

// These CSV fixtures contain no quoted commas or newlines.
const rows = text => text.split('\r\n').map(line => line.split(',').map(cell => cell.slice(1, -1)));
const records = text => {
  const [columns, ...values] = rows(text);
  return values.map(row => Object.fromEntries(columns.map((key, index) => [key, row[index]])));
};

test('review excludes outside marks and matches duplicate marks only once', () => {
  const marks = [{ x: 60, y: 110 }, { x: 60, y: 110 }, { x: 49, y: 110 }];
  const result = compareFrame({ ...frame, detections: [detections[0]] }, marks, config);
  assert.equal(result.manual.fishCount, 2);
  assert.equal(result.outside, 1);
  assert.equal(result.matched, 1);
});

test('review summary uses only reviewed frames and compares counts, centers and groups', () => {
  const marks = new Map([[0, detections], [1, []]]);
  assert.deepEqual(summarizeReview([frame, frame], marks, new Set([0]), config), {
    countMatches: 1, centerMatches: 1, groupMatches: 1
  });
});

test('human CSV preserves outside marks, group numbering and frames without marks', () => {
  const marks = new Map([[0, [...detections, { x: 20, y: 30 }]]]);
  const exported = records(humanCsv([frame, { ...frame, frameIndex: 1, timestampMs: 200 }], marks, new Set([0]), config));
  assert.equal(exported.length, 4);
  assert.equal(exported[0].manual_group_id, '1');
  assert.equal(exported[0].matched_center_count, '2');
  assert.equal(exported[2].inside_crop, 'false');
  assert.equal(exported[2].manual_group_id, '');
  assert.equal(exported[2].x_px, '20.00');
  assert.equal(exported[3].frame_number, '2');
  assert.equal(exported[3].reviewed, 'false');
  assert.equal(exported[3].manual_fish_count_in_crop, '0');
});

test('detection and frame exports preserve metrics and flag group-size changes', () => {
  const singles = { ...frame, metrics: frameMetrics(detections, { ...config, thresholdPx: 1 }) };
  assert.deepEqual(changeFrames([frame, singles]), [1]);
  const detectionRows = records(detectionsCsv([frame]));
  assert.equal(detectionRows[0].group_id, '1');
  assert.equal(detectionRows[0].group_size, '2');
  assert.equal(detectionRows[0].split_from_blob, 'false');
  const frameRows = records(framesCsv([frame, singles]));
  assert.equal(frameRows[0].groupSizes, '2');
  assert.equal(frameRows[0].meanPairDistanceInches, String(10 / 30));
  assert.equal(frameRows[1].groupChanged, 'true');
  assert.equal(frameRows[1].groupSizes, '1+1');
});

test('exported settings omit the key and include original video dimensions', () => {
  const settings = exportedSettings({ ...config, key: 'private', projectSlug: 'zebrafish_in_aquarium', version: 9 }, 540, 960);
  assert.equal('key' in settings, false);
  assert.equal(settings.frameWidth, 540);
  assert.equal(settings.frameHeight, 960);
  assert.match(settings.modelReference, /universe.roboflow.com/);
});

test('masked manual marks remain exported but do not count toward comparison', () => {
  const maskedConfig = { ...config, exclusions: [{ x: 55, y: 105, width: 10, height: 10 }] };
  const result = compareFrame(frame, detections, maskedConfig);
  assert.equal(result.manual.fishCount, 1);
  assert.equal(result.outside, 1);
  const exported = records(humanCsv([frame], new Map([[0, detections]]), new Set([0]), maskedConfig));
  assert.equal(exported[0].inside_crop, 'true');
  assert.equal(exported[0].included_in_analysis, 'false');
  assert.equal(exported[0].manual_group_id, '');
  assert.equal(exported[0].manual_fish_count_in_crop, '2');
  assert.equal(exported[0].manual_fish_count_in_analysis, '1');
  assert.equal(exported[1].included_in_analysis, 'true');
});

test('manual corrections replace only one frame, retain automatic evidence, and export their source', () => {
  const original = { ...frame, rejectedDetections: [{ x: 145, y: 190, detectionId: 3, rejectionReason: 'farther-from-crop-center' }] };
  const marks = [{ x: 65, y: 115 }, { x: 49, y: 110 }, { x: 90, y: 140 }];
  const corrected = applyManualCenters(original, marks, config);
  marks[0].x = 99; // Applied centers are a snapshot, independent of later editing.
  assert.equal(original.detections, detections);
  assert.equal(corrected.automaticDetections, detections);
  assert.equal(corrected.manualCorrectionApplied, true);
  assert.deepEqual(corrected.detections.map(p => [p.x, p.y]), [[65, 115], [90, 140]]);
  assert.ok(corrected.detections.every(p => p.positionSource === 'manual' && p.trackId === undefined && !p.positionUncertain));
  assert.equal(corrected.metrics.manualPositionCount, 2);
  assert.deepEqual(frameCandidates(corrected), [...detections, ...original.rejectedDetections]);
  const again = applyManualCenters(corrected, [{ x: 65, y: 115 }], config);
  assert.equal(again.automaticDetections, detections);
  assert.equal(again.detections.length, 1);
  const exported = records(detectionsCsv([again]));
  assert.equal(exported[0].position_source, 'manual');
  assert.equal(exported[0].position_uncertain, 'false');
  assert.equal(exported[0].track_id, '');
  assert.equal(records(framesCsv([again]))[0].manualCorrectionApplied, 'true');
  const reviewed = records(humanCsv([again], new Map([[0, []]]), new Set([0]), config))[0];
  assert.equal(reviewed.automatic_fish_count, '2');
  assert.equal(reviewed.result_fish_count, '1');
  assert.equal(reviewed.manual_correction_applied, 'true');
  assert.equal(compareFrame(again, detections, config).matched, 2); // Never compare manual corrections to themselves.
  assert.equal(summarizeReview([again], new Map([[0, detections]]), new Set([0]), config).countMatches, 1);
  const restored = restoreAutomaticCenters(again, { ...config, thresholdPx: 1 });
  assert.equal(restored.detections, detections);
  assert.equal(restored.metrics.isolatedCount, 2); // Recompute at the current link distance.
  assert.equal(restored.automaticDetections, undefined);
  assert.equal(restored.manualCorrectionApplied, undefined);
});

test('manual corrections respect masks and permit an explicitly empty frame', () => {
  const masked = { ...config, exclusions: [{ x: 55, y: 105, width: 15, height: 15 }] };
  const corrected = applyManualCenters(frame, [{ x: 60, y: 110 }, { x: 90, y: 130 }], masked);
  assert.equal(corrected.detections.length, 1);
  const empty = applyManualCenters(frame, [], config);
  assert.equal(empty.metrics.fishCount, 0);
  assert.equal(restoreAutomaticCenters(empty, config).detections.length, 2);
});
