import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectBackgroundFish } from '../dist/background.mjs';
import { darkZoneMask } from '../dist/tank-zones.mjs';
import { selectSingleFishCandidate } from '../dist/candidate-selection.mjs';
import { createFishTracker } from '../dist/tracking.mjs';
import { observedFishSide } from '../dist/side-tracking.mjs';

const crop = { x: 452, y: 111, width: 491, height: 182 };
const tankZones = [{ x: 686, y: 118, width: 256, height: 169, side: 'dark' }];
const read = name => {
  const data = readFileSync(new URL(`./fixtures/lighter-dark-low-contrast/safari/${name}.pgm`, import.meta.url));
  const header = Buffer.from('P5\n491 182\n255\n');
  assert.deepEqual(data.subarray(0, header.length), header);
  assert.equal(data.length - header.length, crop.width * crop.height);
  return data.subarray(header.length);
};
const background = read('background');
const options = { expectedFish: 1, darkZones: darkZoneMask(crop, tankZones),
  backgroundVariation: { lower: read('variation-lower'), upper: read('variation-upper') } };
const detect = (sample, extra = {}) => detectBackgroundFish(read(`sample-${sample}`), background,
  crop.width, crop.height, { ...options, timestampMs: (sample - 1) * 200, ...extra });

for (const [target, x, y] of [[34, 821, 239], [64, 809, 177]]) {
  test(`Safari sample ${target} keeps the faint fish with current image evidence and recent observations`, () => {
    assert.equal(detect(target).length, 0);
    const tracker = createFishTracker(1);
    let previous, trackId;
    for (const sample of [target - 1, target, target + 1]) {
      const points = detect(sample, { previousDetections: previous ? [previous] : [],
        previousTimestampMs: previous ? (sample - 2) * 200 : undefined });
      assert.equal(points.length, 1);
      if (sample === target) {
        assert.ok(Math.hypot(points[0].x + crop.x - x, points[0].y + crop.y - y) < 2);
        assert.equal(points[0].foregroundCoreThreshold, 12);
        assert.equal(points[0].lowContrastReferenceTimestampMs, (sample - 2) * 200);
        assert.ok(points[0].supportPixelCount >= 45);
      }
      const selected = selectSingleFishCandidate(points.map(p => ({ ...p, x: p.x + crop.x, y: p.y + crop.y })), crop);
      selected.detections = tracker.update(selected.detections, (sample - 1) * 200);
      trackId ??= selected.detections[0].trackId;
      assert.equal(selected.detections[0].trackId, trackId);
      assert.equal(selected.detections[0].positionUncertain, false);
      assert.equal(observedFishSide(selected, { expectedFish: 1, crop, tankZones }), 'dark');
      previous = { ...selected.detections[0], x: points[0].x, y: points[0].y };
    }
  });
}

test('a very faint region cannot use stale, distant, uncertain, or incompatible history', () => {
  for (const target of [34, 64]) {
    const previous = detect(target - 1)[0];
    const previousTimestampMs = (target - 2) * 200;
    for (const extra of [
      { previousTimestampMs: previousTimestampMs - 600 },
      { previousTimestampMs: undefined },
      { previousTimestampMs: (target - 1) * 200 },
      { previousDetections: [{ ...previous, x: 10, y: 10 }] },
      { previousDetections: [{ ...previous, area: 5 }] },
      { previousDetections: [{ ...previous, positionUncertain: true }] },
      { previousDetections: [{ ...previous, splitFromBlob: true }] }
    ]) {
      assert.equal(detect(target, { previousDetections: [previous], previousTimestampMs, ...extra }).length, 0);
    }
    // History alone must not make foreground out of ordinary background changes.
    const frame = read(`sample-${target}`);
    const lower = frame.map((value, i) => Math.min(value, background[i]));
    const upper = frame.map((value, i) => Math.max(value, background[i]));
    assert.equal(detect(target, { previousDetections: [previous], previousTimestampMs,
      backgroundVariation: { lower, upper } }).length, 0);
  }
});
