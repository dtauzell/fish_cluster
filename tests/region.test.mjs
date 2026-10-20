import test from 'node:test';
import assert from 'node:assert/strict';
import { insideAnalysisArea, localExclusions, maskExcludedPixels, usableRectangles } from '../dist/region.mjs';
import { randomSpacingReference } from '../dist/analysis.mjs';
import { createSettings } from '../dist/settings.mjs';
import { detectBackgroundFish } from '../dist/background.mjs';

const crop = { x: 50, y: 200, width: 100, height: 100 };

test('analysis area includes elevated fish while excluding separately masked reflections', () => {
  const masks = [{ x: 50, y: 200, width: 100, height: 15 }];
  assert.equal(insideAnalysisArea({ x: 80, y: 225 }, crop, masks), true);
  assert.equal(insideAnalysisArea({ x: 80, y: 210 }, crop, masks), false);
  assert.equal(insideAnalysisArea({ x: 40, y: 225 }, crop, masks), false);
  assert.deepEqual(localExclusions(crop, masks), [{ x: 0, y: 0, width: 100, height: 15 }]);
});

test('pixel masks clip to the crop without wrapping into other rows', () => {
  const mask = new Uint8Array(20).fill(1);
  maskExcludedPixels(mask, 5, 4, [{ x: -2, y: 1, width: 3, height: 1 }, { x: 9, y: 0, width: 4, height: 4 }]);
  assert.deepEqual([...mask], [1,1,1,1,1, 0,0,1,1,1, 0,0,1,1,1, 1,1,1,1,1]);
});

test('usable rectangles account for overlapping masks and leave tiny usable areas', () => {
  const boxes = [{ x: 50, y: 200, width: 50, height: 100 }, { x: 75, y: 200, width: 50, height: 100 }];
  assert.deepEqual(usableRectangles(crop, boxes), [{ x: 125, y: 200, width: 25, height: 100 }]);
  assert.deepEqual(usableRectangles(crop, [crop]), []);
  assert.deepEqual(usableRectangles(crop, [{ x: 50, y: 200, width: 99, height: 100 }]), [{ x: 149, y: 200, width: 1, height: 100 }]);
});

test('random spacing uses only unmasked area and handles a fully masked crop', () => {
  const masks = [{ x: 50, y: 200, width: 96, height: 100 }, { x: 50, y: 210, width: 100, height: 90 }];
  const reference = randomSpacingReference(2, crop, 399, masks);
  assert.equal(reference.length, 399);
  assert.ok(reference.every(distance => distance <= Math.hypot(4, 10)));
  assert.deepEqual(reference, randomSpacingReference(2, crop, 399, masks));
  assert.equal(randomSpacingReference(2, crop, 399, [crop]), null);
});

test('settings snapshot masks and reject masks that jointly cover the crop', () => {
  const values = { method: 'background', intervalMs: 200, thresholdInches: 1, gridPixels: 15, expectedFish: 5 };
  const masks = [{ x: 50, y: 200, width: 20, height: 100 }];
  const settings = createSettings(values, crop, 540, 960, masks);
  masks[0].x = 10;
  assert.equal(settings.exclusions[0].x, 50);
  assert.throws(() => createSettings(values, crop, 540, 960, [crop]), /entire crop/);
});

test('background detection suppresses a wall reflection while retaining an elevated fish', () => {
  const width = 100, height = 80;
  const background = new Uint8Array(width * height).fill(200);
  const frame = background.slice();
  const paint = (x0, y0, x1, y1) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) frame[y * width + x] = 60;
  };
  paint(20, 12, 38, 18); // Reflection on the wall.
  paint(20, 25, 38, 31); // Real fish above the floor (floor starts at y=40).
  paint(60, 50, 78, 56); // Another fish over the floor.
  const options = { minArea: 20, edgeX: 0, edgeY: 0, expectedFish: 2 };
  assert.equal(detectBackgroundFish(frame, background, width, height, options).length, 3);
  const detections = detectBackgroundFish(frame, background, width, height,
    { ...options, exclusions: [{ x: 0, y: 0, width: 100, height: 20 }] });
  assert.equal(detections.length, 2);
  assert.ok(detections.some(point => point.y > 25 && point.y < 31));
  assert.ok(detections.every(point => point.y > 20));
});
