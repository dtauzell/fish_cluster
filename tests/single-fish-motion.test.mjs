import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectBackgroundFish } from '../dist/background.mjs';
import { selectSingleFishCandidate, hasAmbiguousRejectedCandidates } from '../dist/candidate-selection.mjs';
import { createFishTracker } from '../dist/tracking.mjs';
import { darkZoneMask } from '../dist/tank-zones.mjs';
import { analysisPixelMask } from '../dist/region.mjs';
import { observedFishSide } from '../dist/side-tracking.mjs';
import { analyzeVideo } from '../dist/pipeline.mjs';

const crop = { x: 452, y: 111, width: 491, height: 182,
  polygon: [{ x: 452, y: 131 }, { x: 930, y: 111 }, { x: 943, y: 289 }, { x: 456, y: 293 }] };
const tankZones = [{ x: 686, y: 118, width: 256, height: 169, side: 'dark',
  polygon: [{ x: 688, y: 121 }, { x: 930, y: 118 }, { x: 942, y: 285 }, { x: 686, y: 287 }] }];
const read = name => {
  const data = readFileSync(new URL(`./fixtures/lighter-dark-low-contrast/${name}.pgm`, import.meta.url));
  const header = Buffer.from('P5\n491 182\n255\n');
  assert.deepEqual(data.subarray(0, header.length), header);
  assert.equal(data.length - header.length, crop.width * crop.height);
  return data.subarray(header.length);
};
const background = read('background');
const options = { expectedFish: 1, darkZones: darkZoneMask(crop, tankZones), analysisMask: analysisPixelMask(crop),
  edgeX: 0, edgeTop: 0, edgeBottom: 0,
  backgroundVariation: { lower: read('variation-lower'), upper: read('variation-upper') } };
const candidate = (x, y, contrast = 20) => ({ x, y, width: 25, height: 15, area: 100,
  foregroundContrast: contrast, supportPixelCount: 90 });

test('sample 144 follows the recorded fish motion when the reported competing center is present', () => {
  const tracker = createFishTracker(1);
  let previous, trackId;
  for (const sample of [142, 143, 144, 145]) {
    const timestampMs = (sample - 1) * 200;
    const candidates = detectBackgroundFish(read(`sample-${sample}`), background, crop.width, crop.height,
      { ...options, timestampMs, previousTimestampMs: previous ? timestampMs - 200 : undefined,
        previousDetections: previous ? [{ ...previous, x: previous.x - crop.x, y: previous.y - crop.y }] : [] })
      .map(point => ({ ...point, x: point.x + crop.x, y: point.y + crop.y }));
    assert.equal(candidates.length, 1);
    if (sample === 144) {
      assert.ok(Math.hypot(candidates[0].x - 810.7, candidates[0].y - 168.6) < 6);
      // The competing position is user-confirmed. Its evidence scores are a
      // deliberate stress case, not claimed measurements of a Safari decode.
      candidates.push(candidate(786.2, 144, 35));
      const oldChoice = selectSingleFishCandidate(candidates, crop, { previousPoint: previous });
      assert.equal(oldChoice.detections[0].x, 786.2);
    }
    const selected = selectSingleFishCandidate(candidates, crop, {
      previousPoint: previous, predictedPoint: tracker.selectionPrediction(timestampMs)
    });
    if (sample === 144) {
      assert.equal(selected.selectionMethod, 'foreground-motion-continuity-v1');
      assert.ok(Math.hypot(selected.detections[0].x - 810.7, selected.detections[0].y - 168.6) < 6);
      assert.equal(selected.rejectedDetections[0].x, 786.2);
      assert.equal(selected.rejectedDetections[0].rejectionReason, 'weaker-motion-continuity');
      assert.equal(selected.selectionPrediction.referenceTimestampMs, 28400);
    }
    assert.equal(selected.selectionConfident, true);
    assert.equal(hasAmbiguousRejectedCandidates(selected), false);
    selected.detections = tracker.update(selected.detections, timestampMs);
    trackId ??= selected.detections[0].trackId;
    assert.equal(selected.detections[0].trackId, trackId);
    assert.equal(observedFishSide(selected, { expectedFish: 1, crop, tankZones }), 'dark');
    previous = selected.detections[0];
  }
});

test('recent motion breaks a distance tie between the two user-supplied centers', () => {
  const tracker = createFishTracker(1);
  tracker.update([candidate(747.07, 179.67)], 28200);
  const previous = tracker.update([candidate(770.607, 173.579)], 28400)[0];
  const prediction = tracker.selectionPrediction(28600);
  const selected = selectSingleFishCandidate([candidate(786.2, 144, 35), candidate(810.7, 168.6)], crop,
    { previousPoint: previous, predictedPoint: prediction });
  assert.equal(selected.detections[0].x, 810.7);
  assert.equal(selected.selectionMethod, 'foreground-motion-continuity-v1');
});

test('prediction never enlarges the matching radius or overrules an unambiguous nearest observation', () => {
  const previousPoint = { x: 100, y: 100 };
  const predictedPoint = { x: 125, y: 100 };
  const close = candidate(102, 100), ahead = candidate(125, 100);
  assert.equal(selectSingleFishCandidate([close, ahead], crop, { previousPoint, predictedPoint }).detections[0].x, 102);
  const outside = candidate(150, 100, 100);
  const selected = selectSingleFishCandidate([candidate(110, 100), candidate(114, 100), outside], crop,
    { previousPoint, predictedPoint: { x: 150, y: 100 } });
  assert.notEqual(selected.selectionMethod, 'foreground-motion-continuity-v1');
});

test('motion hints require consecutive observed centers and remain speed limited', () => {
  const tracker = createFishTracker(1);
  tracker.update([candidate(0, 0)], 0);
  assert.equal(tracker.selectionPrediction(200), null);
  tracker.update([candidate(40, 0)], 200);
  const prediction = tracker.selectionPrediction(400);
  assert.ok(prediction.x <= 70);
  assert.equal(tracker.selectionPrediction(200), null);
  assert.equal(tracker.selectionPrediction(600), null);
});

test('uncertain samples and overlap estimates cannot supply motion continuity', () => {
  for (const uncertain of [{ positionUncertain: true }, { splitFromBlob: true }]) {
    const tracker = createFishTracker(1);
    tracker.update([candidate(20, 20)], 0);
    tracker.update([candidate(25, 20)], 200);
    tracker.update([{ ...candidate(30, 20), ...uncertain }], 400);
    assert.equal(tracker.selectionPrediction(600), null);
    tracker.update([candidate(35, 20)], 600);
    assert.equal(tracker.selectionPrediction(800), null, 'reacquisition needs another fresh observation');
    tracker.update([candidate(40, 20)], 800);
    assert.ok(tracker.selectionPrediction(1000));
  }
});

test('pipeline uses motion to break a close match without losing observed track continuity', async () => {
  const width = 180, height = 150, background = new Uint8Array(width * height).fill(20);
  const paint = (image, x, y, value) => {
    for (let row = y - 5; row < y + 7; row++) for (let column = x - 5; column < x + 7; column++) {
      image[row * width + column] = value;
    }
  };
  const images = [[40, 100], [60, 94], [90, 90]].map(([x, y]) => {
    const image = background.slice(); paint(image, x, y, 50); return image;
  });
  paint(images[2], 75, 64, 70);
  const crop = { x: 0, y: 0, width, height }, tankZones = [{ ...crop, side: 'dark' }];
  let reads = 0;
  const source = { seekTo: async () => {}, readGray: () => reads++ < 2 ? background : images[reads - 3] };
  const frames = [];
  for await (const event of analyzeVideo({ source, duration: .6, config: {
    method: 'background', testType: 'light-dark', expectedFish: 1, trackFish: true,
    intervalMs: 200, crop, tankZones, thresholdPx: 10, pixelsPerInch: 30
  } })) if (event.frame) frames.push(event.frame);
  assert.equal(frames.length, 3);
  assert.equal(frames[2].rawPredictionCount, 2);
  assert.equal(frames[2].selectionMethod, 'foreground-motion-continuity-v1');
  assert.ok(Math.hypot(frames[2].detections[0].x - 90.5, frames[2].detections[0].y - 90.5) < 1);
  assert.ok(frames.every(frame => frame.detections[0].trackId === frames[0].detections[0].trackId));
  assert.ok(frames.every(frame => observedFishSide(frame, { expectedFish: 1, crop, tankZones }) === 'dark'));
  assert.equal(frames[2].rejectedDetections[0].rejectionReason, 'weaker-motion-continuity');
});
