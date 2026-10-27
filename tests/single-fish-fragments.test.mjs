import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectBackgroundFish } from '../dist/background.mjs';
import { darkZoneMask } from '../dist/tank-zones.mjs';
import { selectSingleFishCandidate, hasAmbiguousRejectedCandidates } from '../dist/candidate-selection.mjs';
import { createFishTracker } from '../dist/tracking.mjs';
import { observedFishSide } from '../dist/side-tracking.mjs';

const crop = { x: 167, y: 372, width: 538, height: 209 };
const tankZones = [{ x: 408, y: 377, width: 289, height: 190, side: 'dark' }];
const image = name => {
  const data = readFileSync(new URL(`./fixtures/single-fish-ridge/${name}.pgm`, import.meta.url));
  const header = Buffer.from('P5\n538 209\n255\n');
  assert.deepEqual(data.subarray(0, header.length), header);
  assert.equal(data.length - header.length, crop.width * crop.height);
  return data.subarray(header.length);
};
const background = image('background');
const options = { expectedFish: 1, darkZones: darkZoneMask(crop, tankZones),
  backgroundVariation: { lower: image('variation-lower'), upper: image('variation-upper') } };
const detect = (sample, extra = {}) => detectBackgroundFish(image(`sample-${sample}`), background,
  crop.width, crop.height, { ...options, ...extra });

test('sample 61 rejoins the observed body and tail over tank markings and retains its track', () => {
  assert.equal(detect(61).length, 2);
  const tracker = createFishTracker(1);
  let previous = null, trackId;
  for (const sample of [60, 61, 62]) {
    const blobs = detect(sample, { previousDetections: previous ? [previous] : [] });
    assert.equal(blobs.length, 1);
    if (sample === 61) {
      assert.equal(blobs[0].joinedForegroundFragments, 2);
      assert.ok(Math.hypot(blobs[0].x + crop.x - 581, blobs[0].y + crop.y - 471) < 2);
      assert.ok(blobs[0].supportPixelCount >= 5);
    }
    const selected = selectSingleFishCandidate(blobs.map(blob => ({ ...blob,
      x: blob.x + crop.x, y: blob.y + crop.y })), crop);
    const points = tracker.update(selected.detections, (sample - 1) * 200);
    trackId ??= points[0].trackId;
    assert.equal(points[0].trackId, trackId);
    assert.equal(points[0].positionUncertain, false);
    assert.equal(observedFishSide({ ...selected, detections: points }, { expectedFish: 1, crop, tankZones }), 'dark');
    previous = { ...points[0], x: points[0].x - crop.x, y: points[0].y - crop.y };
  }
});

test('fragment joining requires one observed fish, a compatible size, and contrast across the gap', () => {
  const previous = detect(60)[0];
  for (const extra of [
    { expectedFish: 2 },
    { previousDetections: [{ ...previous, positionUncertain: true }] },
    { previousDetections: [{ ...previous, area: 10 }] },
    { previousDetections: [{ ...previous, width: 5, height: 5 }] }
  ]) {
    assert.equal(detect(61, { previousDetections: [previous], ...extra }).length, 2);
  }
  const frame = image('sample-61').slice();
  // Remove the faint connecting image evidence while keeping the two cores.
  for (let y = 94; y <= 99; y++) for (let x = 417; x <= 425; x++) {
    frame[y * crop.width + x] = background[y * crop.width + x];
  }
  const separate = detectBackgroundFish(frame, background, crop.width, crop.height,
    { ...options, previousDetections: [previous] });
  assert.equal(separate.length, 2);
  assert.ok(separate.every(point => !point.joinedForegroundFragments));
});

test('a recorded confident continuity selection makes side occupancy known', () => {
  const candidates = [{ x: 543, y: 512, foregroundContrast: 36, supportPixelCount: 82 },
    { x: 194, y: 428, foregroundContrast: 56, supportPixelCount: 18 }];
  const selected = selectSingleFishCandidate(candidates, crop, { previousPoint: { x: 532, y: 510 } });
  assert.equal(selected.detections[0].x, 543);
  assert.equal(hasAmbiguousRejectedCandidates(selected), false);
  assert.equal(observedFishSide(selected, { expectedFish: 1, crop, tankZones }), 'dark');
  assert.equal(hasAmbiguousRejectedCandidates({ ...selected, selectionConfident: false }), true);
});
