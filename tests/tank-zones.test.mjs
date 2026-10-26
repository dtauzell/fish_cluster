import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { tankSide, darkZoneMask } from '../dist/tank-zones.mjs';
import { detectBackgroundFish } from '../dist/background.mjs';
import { createSettings } from '../dist/settings.mjs';
import { analyzeVideo } from '../dist/pipeline.mjs';
import { applyManualCenters, restoreAutomaticCenters } from '../dist/review.mjs';
import { detectionsCsv, framesCsv } from '../dist/exports.mjs';

const crop = { x: 50, y: 100, width: 80, height: 40 };
const zones = [
  { x: 50, y: 100, width: 40, height: 40, side: 'light' },
  { x: 90, y: 100, width: 40, height: 40, side: 'dark' }
];
const values = { method: 'background', expectedFish: 1, intervalMs: 200, thresholdInches: 1, gridPixels: 15 };

test('region classification and pixel masks agree at overlaps, boundaries and crop offsets', () => {
  const overlapping = [...zones, { x: 100, y: 110, width: 10, height: 10, side: 'light' }];
  const mask = darkZoneMask(crop, overlapping);
  for (let y = 0; y < crop.height; y++) for (let x = 0; x < crop.width; x++) {
    assert.equal(Boolean(mask[y * crop.width + x]), tankSide({ x: x + crop.x, y: y + crop.y }, overlapping) === 'dark');
  }
  assert.equal(tankSide({ x: 95, y: 115 }, overlapping), 'dark');
  assert.equal(tankSide({ x: 100, y: 115 }, overlapping), 'light');
  assert.equal(tankSide({ x: 10, y: 10 }, overlapping), 'unmarked');
  const clipped = darkZoneMask(crop, [{ x: 0, y: 90, width: 55, height: 15, side: 'dark' }]);
  assert.equal(clipped[0], 1);
  assert.equal(clipped[6], 0);
  assert.equal(clipped[6 * crop.width], 0);
});

test('mixed floors detect bright dark-side fish and dark light-side fish, keeping masks effective', () => {
  const { width, height } = crop;
  const background = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) background[y * width + x] = x < 40 ? 220 : 30;
  const frame = background.slice();
  for (let y = 15; y < 22; y++) for (let x = 10; x < 25; x++) frame[y * width + x] = 80;
  for (let y = 15; y < 22; y++) for (let x = 55; x < 70; x++) frame[y * width + x] = 170;
  const options = { edgeX: 0, edgeY: 0, darkZones: darkZoneMask(crop, zones) };
  assert.equal(detectBackgroundFish(frame, background, width, height).length, 1);
  const detections = detectBackgroundFish(frame, background, width, height, options);
  assert.equal(detections.length, 2);
  assert.deepEqual(detections.map(point => point.x), [17, 62]);
  assert.equal(detectBackgroundFish(frame, background, width, height, { ...options,
    exclusions: [{ x: 50, y: 0, width: 30, height: 40 }] }).length, 1);
  // No movement: the stationary boundary must never become a fish.
  assert.equal(detectBackgroundFish(background, background, width, height, options).length, 0);
});

test('settings snapshot and validate tank regions', () => {
  const selected = zones.map(zone => ({ ...zone }));
  const config = createSettings(values, crop, 200, 200, [], selected);
  selected[0].x = 0;
  assert.equal(config.tankZones[0].x, 50);
  assert.throws(() => createSettings(values, crop, 200, 200, [], [{ ...zones[0], side: 'other' }]), /Tank regions/);
  assert.throws(() => createSettings(values, crop, 200, 200, [], [{ ...zones[0], width: -1 }]), /Tank regions/);
});

test('pipeline records both sides for a crossing and manual corrections update counts and exports', async () => {
  const config = createSettings(values, crop, 200, 200, [], zones);
  let reads = 0;
  const source = {
    seekTo: async () => {},
    readGray: () => {
      const frame = new Uint8Array(crop.width * crop.height);
      for (let y = 0; y < crop.height; y++) for (let x = 0; x < crop.width; x++) frame[y * crop.width + x] = x < 40 ? 220 : 30;
      // One background sample, then the fish on light, boundary, and dark pixels.
      const left = [null, 10, 32, 55][reads++];
      if (left != null) for (let y = 15; y < 22; y++) for (let x = left; x < left + 18; x++) frame[y * crop.width + x] = x < 40 ? 80 : 170;
      return frame;
    }
  };
  const frames = [];
  for await (const event of analyzeVideo({ config, duration: .45, source })) if (event.frame) frames.push(event.frame);
  assert.deepEqual(frames.map(frame => frame.detections.length), [1, 1, 1]);
  assert.deepEqual(frames.map(frame => frame.detections[0].tankSide), ['light', 'dark', 'dark']);
  assert.deepEqual(frames.map(frame => frame.metrics.darkSideCount), [0, 1, 1]);
  assert.ok(frames.every(frame => frame.detections[0].trackId === frames[0].detections[0].trackId));
  const corrected = applyManualCenters(frames[2], [{ x: 70, y: 120 }], config);
  assert.equal(corrected.detections[0].tankSide, 'light');
  assert.equal(corrected.metrics.darkSideCount, 0);
  assert.equal(corrected.metrics.lightSideCount, 1);
  assert.equal(restoreAutomaticCenters(corrected, config).metrics.darkSideCount, 1);
  const csv = detectionsCsv([corrected]).trim().split('\r\n').map(line => line.split(',').map(value => value.slice(1, -1)));
  assert.equal(csv[1][csv[0].indexOf('tank_side')], 'light');
  const counts = framesCsv([corrected]).trim().split('\r\n').map(line => line.split(',').map(value => value.slice(1, -1)));
  assert.equal(counts[1][counts[0].indexOf('darkSideCount')], '0');
  assert.equal(counts[1][counts[0].indexOf('lightSideCount')], '1');
  const unmarked = applyManualCenters(frames[0], [{ x: 70, y: 120 }], { ...config, tankZones: [] });
  assert.equal(unmarked.metrics.unmarkedSideCount, 1);
});


test('new recording detects a bright fish on dark and preserves detection on light', () => {
  const region = { x: 200, y: 400, width: 490, height: 170 };
  const image = name => {
    const data = readFileSync(new URL(`./fixtures/light-dark/${name}.pgm`, import.meta.url));
    const header = Buffer.from('P5\n490 170\n255\n');
    assert.deepEqual(data.subarray(0, header.length), header);
    assert.equal(data.length - header.length, region.width * region.height);
    return data.subarray(header.length);
  };
  const background = image('background');
  const options = { expectedFish: 1, darkZones: darkZoneMask(region,
    [{ x: 403, y: 400, width: 287, height: 170, side: 'dark' }]) };
  const dark = image('dark-0s');
  assert.equal(detectBackgroundFish(dark, background, region.width, region.height, { expectedFish: 1 }).length, 0);
  const detectedDark = detectBackgroundFish(dark, background, region.width, region.height, options);
  assert.equal(detectedDark.length, 1);
  assert.ok(Math.hypot(detectedDark[0].x + region.x - 533, detectedDark[0].y + region.y - 509) < 10);
  const light = image('light-15s');
  const detectedLight = detectBackgroundFish(light, background, region.width, region.height, options);
  assert.equal(detectedLight.length, 1);
  assert.ok(Math.hypot(detectedLight[0].x + region.x - 285, detectedLight[0].y + region.y - 479) < 10);
  assert.deepEqual(detectedLight, detectBackgroundFish(light, background, region.width, region.height, { expectedFish: 1 }));
});


test('recorded ridge jitter is rejected without losing the nearby fish or a fish crossing the ridge', () => {
  const crop = { x: 200, y: 400, width: 490, height: 170 };
  const image = name => readFileSync(new URL(`./fixtures/light-dark/${name}.pgm`, import.meta.url))
    .subarray(Buffer.byteLength('P5\n490 170\n255\n'));
  const background = image('background');
  const options = { expectedFish: 1, darkZones: darkZoneMask(crop,
    [{ x: 403, y: 400, width: 287, height: 170, side: 'dark' }]) };
  const backgroundVariation = { lower: image('variation-lower'), upper: image('variation-upper') };
  const jitter = image('ridge-jitter-2s');
  assert.equal(detectBackgroundFish(jitter, background, 490, 170, options).length, 6);
  const filtered = detectBackgroundFish(jitter, background, 490, 170, { ...options, backgroundVariation });
  assert.equal(filtered.length, 1);
  assert.ok(Math.hypot(filtered[0].x + crop.x - 489, filtered[0].y + crop.y - 516) < 10);
  // At 0 seconds the fish crosses the bright ridge. Keep its original region
  // instead of retaining only a small fragment beyond the learned range.
  assert.deepEqual(detectBackgroundFish(image('dark-0s'), background, 490, 170, { ...options, backgroundVariation }),
    detectBackgroundFish(image('dark-0s'), background, 490, 170, options));
  assert.deepEqual(detectBackgroundFish(image('light-15s'), background, 490, 170, { ...options, backgroundVariation }),
    detectBackgroundFish(image('light-15s'), background, 490, 170, options));
});
