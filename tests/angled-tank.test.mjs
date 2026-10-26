import { analyzeVideo } from '../dist/pipeline.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { polygonBox } from '../dist/geometry.mjs';
import { insideAnalysisArea, insideCrop, localExclusions, maskExcludedPixels, analysisPixelMask } from '../dist/region.mjs';
import { tankSide, darkZoneMask } from '../dist/tank-zones.mjs';
import { createSettings } from '../dist/settings.mjs';
import { randomSpacingReference } from '../dist/analysis.mjs';
import { applyManualCenters } from '../dist/review.mjs';
import { detectBackgroundFish, backgroundVariation, medianBackground } from '../dist/background.mjs';

const shape = polygonBox([{ x: 50, y: 100 }, { x: 150, y: 120 }, { x: 140, y: 180 }, { x: 40, y: 160 }]);
const values = { method: 'background', expectedFish: 1, intervalMs: 200, thresholdInches: 1, gridPixels: 15 };

test('four corners preserve angled geometry, boundaries and either winding; crossed selections fail', () => {
  assert.deepEqual([shape.x, shape.y, shape.width, shape.height], [40, 100, 110, 80]);
  assert.equal(insideCrop({ x: 45, y: 105 }, shape), false);
  assert.equal(insideCrop({ x: 90, y: 140 }, shape), true);
  assert.equal(insideCrop({ x: 100, y: 110 }, shape), true);
  assert.equal(insideCrop({ x: 90, y: 140 }, polygonBox([...shape.polygon].reverse())), true);
  assert.throws(() => polygonBox([shape.polygon[0], shape.polygon[2], shape.polygon[1], shape.polygon[3]]), /convex/);
  assert.throws(() => polygonBox(Array(4).fill({ x: 1, y: 1 })), /convex/);
});

test('polygon settings snapshot corners and permit masks with a full bounding box but partial coverage', () => {
  const selected = structuredClone(shape);
  const config = createSettings(values, selected, 200, 200, [], [{ ...selected, side: 'dark' }]);
  selected.polygon[0].x = 0;
  assert.equal(config.crop.polygon[0].x, 50);
  assert.equal(config.tankZones[0].polygon[0].x, 50);
  const diamond = polygonBox([{ x: 90, y: 100 }, { x: 150, y: 140 }, { x: 90, y: 180 }, { x: 40, y: 140 }]);
  assert.doesNotThrow(() => createSettings(values, { x: 40, y: 100, width: 110, height: 80 }, 200, 200, [diamond]));
  assert.throws(() => createSettings(values, shape, 200, 200, [shape]), /entire tank/);
  assert.equal(applyManualCenters({ detections: [] }, [{ x: 45, y: 105 }, { x: 90, y: 140 }], config).detections.length, 1);
});

test('polygon masks and zones translate corners into crop coordinates and honor last drawn regions', () => {
  const box = { x: 40, y: 100, width: 110, height: 80 };
  const translated = localExclusions(box, [shape])[0];
  assert.deepEqual(translated.polygon[0], { x: 10, y: 0 });
  const mask = new Uint8Array(box.width * box.height).fill(1);
  maskExcludedPixels(mask, box.width, box.height, [translated]);
  const zones = [{ ...box, side: 'light' }, { ...shape, side: 'dark' }];
  const dark = darkZoneMask(box, zones);
  for (let y = 0; y < box.height; y++) for (let x = 0; x < box.width; x++) {
    const point = { x: box.x + x, y: box.y + y };
    const inside = insideCrop(point, shape);
    assert.equal(mask[y * box.width + x], inside ? 0 : 1);
    assert.equal(dark[y * box.width + x], inside ? 1 : 0);
    assert.equal(tankSide(point, zones), inside ? 'dark' : 'light');
    assert.equal(insideAnalysisArea(point, box, [shape]), !inside);
  }
});

test('angled tank rejects outside foreground pixels before they can join a real fish', () => {
  const crop = polygonBox([{ x: 20, y: 0 }, { x: 120, y: 30 }, { x: 100, y: 100 }, { x: 0, y: 70 }]);
  const background = new Uint8Array(crop.width * crop.height).fill(200);
  const frame = background.slice();
  for (const [left, top] of [[5, 5], [55, 45]]) {
    for (let y = top; y < top + 8; y++) for (let x = left; x < left + 18; x++) frame[y * crop.width + x] = 60;
  }
  const options = { edgeX: 0, edgeY: 0 };
  assert.equal(detectBackgroundFish(frame, background, crop.width, crop.height, options).length, 2);
  const detections = detectBackgroundFish(frame, background, crop.width, crop.height,
    { ...options, analysisMask: analysisPixelMask(crop) });
  assert.equal(detections.length, 1);
  assert.ok(detections[0].x > 50);
});

test('polygon random spacing is reproducible and handles a fully masked polygon', () => {
  const a = randomSpacingReference(3, shape, 50);
  assert.equal(a.length, 50);
  assert.deepEqual(a, randomSpacingReference(3, shape, 50));
  assert.equal(randomSpacingReference(2, shape, 5, [shape]), null);
});

test('learned fixture variation suppresses a flickering ridge while keeping a fish crossing it', () => {
  const width = 90, height = 50;
  const samples = Array.from({ length: 25 }, (_, i) => {
    const pixels = new Uint8Array(width * height).fill(25);
    // Bright ridge with alternating brightness; a transient fish sample must
    // not teach the background to ignore fish permanently.
    for (let y = 22; y < 28; y++) for (let x = 10; x < 80; x++) pixels[y * width + x] = i % 2 ? 135 : 165;
    if (i === 0) for (let y = 15; y < 35; y++) for (let x = 40; x < 47; x++) pixels[y * width + x] = 230;
    return pixels;
  });
  const background = medianBackground(samples), variation = backgroundVariation(samples);
  const flicker = samples[1].slice();
  const options = { edgeX: 0, edgeY: 0, darkZones: new Uint8Array(width * height).fill(1) };
  assert.equal(detectBackgroundFish(flicker, background, width, height, options).length, 1);
  assert.equal(detectBackgroundFish(flicker, background, width, height, { ...options, backgroundVariation: variation }).length, 0);
  for (let y = 15; y < 35; y++) for (let x = 40; x < 47; x++) flicker[y * width + x] = 230;
  const fish = detectBackgroundFish(flicker, background, width, height, { ...options, backgroundVariation: variation });
  assert.equal(fish.length, 1);
  assert.ok(Math.abs(fish[0].x - 43) < 2);
  assert.ok(Math.abs(fish[0].y - 24.5) < 2);
});


test('pipeline applies the angled tank to automatic and manual centers and snapshots corners', async () => {
  const config = createSettings(values, shape, 200, 200, [], [{ ...shape, side: 'dark' }]);
  let reads = 0;
  const source = { seekTo: async () => {}, readGray: () => {
    const frame = new Uint8Array(shape.width * shape.height).fill(30);
    if (reads++ >= 2) {
      for (const [left, top] of [[0, 0], [45, 35]]) {
        for (let y = top; y < top + 8; y++) for (let x = left; x < left + 18; x++) frame[y * shape.width + x] = 150;
      }
    }
    return frame;
  } };
  const frames = [];
  for await (const event of analyzeVideo({ config, duration: .65, source })) if (event.frame) frames.push(event.frame);
  assert.equal(frames.length, 4);
  assert.ok(frames.every(frame => frame.detections.length === 1));
  assert.ok(frames.every(frame => frame.detections[0].tankSide === 'dark'));
  assert.ok(frames.every(frame => insideCrop(frame.detections[0], shape)));
});
