import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectBackgroundFish } from '../dist/background.mjs';
import { selectCentralCandidates } from '../dist/candidate-selection.mjs';
import { matchPointsWithin } from '../dist/analysis.mjs';

const crop = { x: 50, y: 200, width: 420, height: 330 };
function image(name) {
  const bytes = readFileSync(new URL(`./fixtures/${name}.pgm`, import.meta.url));
  const header = Buffer.from('P5\n420 330\n255\n');
  assert.deepEqual(bytes.subarray(0, header.length), header);
  assert.equal(bytes.length - header.length, crop.width * crop.height);
  return bytes.subarray(header.length);
}
const background = image('tank-background');
function detect(pixels, preferCenter) {
  return detectBackgroundFish(pixels, background, crop.width, crop.height, { expectedFish: 5, preferCenter })
    .map((candidate, index) => ({ ...candidate, detectionId: index + 1,
      x: candidate.x + crop.x, y: candidate.y + crop.y }));
}

test('frame 555 splits touching fish even when reflections already fill the count', () => {
  const pixels = image('frame-555');
  const previous = selectCentralCandidates(detect(pixels, false), crop, 5);
  const selected = selectCentralCandidates(detect(pixels, true), crop, 5);
  const expectedCenters = [{ x: 371, y: 302 }, { x: 230, y: 313 },
    { x: 350, y: 351 }, { x: 363, y: 375 }, { x: 295, y: 407 }];
  assert.ok(previous.detections.some(point => point.x > 390)); // A reflection occupied the missing fish's slot.
  assert.equal(selected.detections.length, 5);
  assert.equal(matchPointsWithin(expectedCenters, selected.detections, 15), 5);
  assert.ok(selected.detections.every(point => point.x < 390));
  const split = selected.detections.filter(point => point.splitFromBlob);
  assert.equal(split.length, 2);
  assert.ok(split.every(point => point.splitReason === 'large-central-region'));
  assert.ok(split.every(point => point.sourceBlobArea === 512));
  assert.equal(split.reduce((sum, point) => sum + point.area, 0), 512);
  assert.ok(selected.detections.every(point => !('pixels' in point)));
});

test('frame 437 retains real edge fish without splitting a broad outer reflection', () => {
  const pixels = image('frame-437');
  const selected = selectCentralCandidates(detect(pixels, true), crop, 5);
  const expectedCenters = [{ x: 301, y: 246 }, { x: 302, y: 284 },
    { x: 338, y: 322 }, { x: 408, y: 334 }, { x: 376, y: 371 }];
  assert.equal(selected.detections.length, 5);
  assert.equal(matchPointsWithin(expectedCenters, selected.detections, 15), 5);
  assert.equal(selected.detections.filter(point => point.splitFromBlob).length, 0);
  assert.equal(selected.rejectedDetections.length, 3);
});

test('frame 555 also splits the pair in the original default floor crop', () => {
  const region = { x: 50, y: 240, width: 420, height: 290 };
  const offset = 40 * crop.width;
  const candidates = detectBackgroundFish(image('frame-555').subarray(offset), background.subarray(offset),
    region.width, region.height, { expectedFish: 5, preferCenter: true }).map((point, index) => ({
      ...point, detectionId: index + 1, x: point.x + region.x, y: point.y + region.y
    }));
  const kept = selectCentralCandidates(candidates, region, 5).detections;
  assert.equal(kept.length, 5);
  assert.equal(kept.filter(point => point.splitFromBlob).length, 2);
  assert.ok(kept.every(point => point.x < 390));
});

test('pipeline separates the pair before center selection and exports split provenance', async () => {
  const { analyzeVideo } = await import('../dist/pipeline.mjs');
  const { detectionsCsv, sharpnessCsv, framesCsv } = await import('../dist/exports.mjs');
  let reads = 0;
  const source = { seekTo: async () => {}, readGray: () => reads++ ? image('frame-555') : background };
  const config = { method: 'background', crop, expectedFish: 5, preferCenter: true,
    intervalMs: 200, thresholdPx: 45.9, pixelsPerInch: 30.6 };
  let frame;
  for await (const event of analyzeVideo({ config, source, duration: .1 })) {
    if (event.type === 'frame') frame = event.frame;
  }
  assert.equal(frame.detections.length, 5);
  assert.equal(frame.detections.filter(point => point.splitFromBlob).length, 2);
  assert.ok(frame.detections.filter(point => point.splitFromBlob).every(point => point.sharpness > 0));
  assert.equal(frame.rejectedDetections.length, 4);
  assert.equal(frame.metrics.randomSpacingUnavailableReason, 'center-selection');
  assert.match(detectionsCsv([frame]), /large-central-region/);
  assert.match(detectionsCsv([frame]), /source_blob_area_px/);
  assert.match(sharpnessCsv([frame], new Map()), /large-central-region/);
  assert.match(framesCsv([frame]), /splitCandidateCount/);
});
