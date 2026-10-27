import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectBackgroundFish } from '../dist/background.mjs';
import { darkZoneMask } from '../dist/tank-zones.mjs';
import { selectSingleFishCandidate } from '../dist/candidate-selection.mjs';
import { observedFishSide } from '../dist/side-tracking.mjs';

const crop = { x: 452, y: 111, width: 491, height: 182 };
const tankZones = [{ x: 686, y: 118, width: 256, height: 169, side: 'dark' }];
const read = name => {
  const data = readFileSync(new URL(`./fixtures/lighter-dark-low-contrast/${name}.pgm`, import.meta.url));
  const header = Buffer.from('P5\n491 182\n255\n');
  assert.deepEqual(data.subarray(0, header.length), header);
  assert.equal(data.length - header.length, crop.width * crop.height);
  return data.subarray(header.length);
};
const recordedBackground = read('background');
const recordedOptions = { expectedFish: 1, darkZones: darkZoneMask(crop, tankZones),
  backgroundVariation: { lower: read('variation-lower'), upper: read('variation-upper') } };
const recordedDetect = (sample, extra = {}) => detectBackgroundFish(read(`sample-${sample}`), recordedBackground,
  crop.width, crop.height, { ...recordedOptions, ...extra });

test('sample 1 selects the user-confirmed fish rather than the left-wall reflection', () => {
  // User marks: fish (863, 257), reflection (461.1, 257.4), original video pixels.
  // Check both decodes without a previous track or a coordinate hint to selection.
  for (const directory of ['', 'safari/']) {
    const candidates = detectBackgroundFish(read(`${directory}sample-1`), read(`${directory}background`),
      crop.width, crop.height, { expectedFish: 1, darkZones: recordedOptions.darkZones,
        backgroundVariation: { lower: read(`${directory}variation-lower`), upper: read(`${directory}variation-upper`) } })
      .map(point => ({ ...point, x: point.x + crop.x, y: point.y + crop.y }));
    const selected = selectSingleFishCandidate(candidates, crop);
    assert.equal(selected.detections.length, 1);
    assert.equal(selected.selectionConfident, true);
    const point = selected.detections[0];
    assert.ok(Math.hypot(point.x - 863, point.y - 257) < 10, `${directory || 'FFmpeg'}: select the confirmed fish`);
    assert.ok(Math.hypot(point.x - 461.1, point.y - 257.4) > 350, 'do not select the reflection');
    assert.equal(observedFishSide(selected, { expectedFish: 1, crop, tankZones }), 'dark');
  }
});

test('sample 1 still selects the confirmed fish when weaker contrast triggers border recovery', () => {
  const background = read('safari/background');
  const original = read('safari/sample-1');
  const darkZones = recordedOptions.darkZones;
  // Keep the recorded fish and its location, reduce its contrast by 15%, and
  // introduce a wall-darkening pulse at the user's reported reflection location.
  const frame = Uint8Array.from(original, (value, index) => darkZones[index]
    ? background[index] + Math.round((value - background[index]) * .85) : value);
  for (let y = 135; y < 157; y++) for (let x = 5; x < 13; x++) {
    const pixel = y * crop.width + x;
    frame[pixel] = Math.max(0, background[pixel] - 60);
  }
  const options = { expectedFish: 1, darkZones,
    backgroundVariation: { lower: read('safari/variation-lower'), upper: read('safari/variation-upper') } };
  const detect = extra => detectBackgroundFish(frame, background, crop.width, crop.height, { ...options, ...extra });
  const borderOnly = detect({ recoverLowContrast: false });
  assert.equal(borderOnly.length, 1);
  assert.equal(borderOnly[0].edgeRecovered, true);
  assert.ok(Math.hypot(borderOnly[0].x + crop.x - 461.1, borderOnly[0].y + crop.y - 257.4) < 3);
  const selected = selectSingleFishCandidate(detect().map(point => ({ ...point,
    x: point.x + crop.x, y: point.y + crop.y })), crop);
  assert.equal(selected.detections.length, 1);
  assert.equal(selected.selectionConfident, true);
  assert.ok(Math.hypot(selected.detections[0].x - 862.4, selected.detections[0].y - 256.5) < 10);
  assert.equal(selected.detections[0].edgeRecovered, undefined);
});

test('lighter-dark sample 7 recovers the low-contrast fish with the supplied crops', () => {
  const background = read('background'), frame = read('sample-7');
  const options = { expectedFish: 1, darkZones: darkZoneMask(crop, tankZones),
    backgroundVariation: { lower: read('variation-lower'), upper: read('variation-upper') } };
  const detect = extra => detectBackgroundFish(frame, background, crop.width, crop.height, { ...options, ...extra });
  assert.equal(detect({ recoverLowContrast: false }).length, 0);
  const points = detect();
  assert.equal(points.length, 1);
  const point = points[0];
  assert.equal(point.lowContrastRecovered, true);
  assert.equal(point.foregroundThreshold, 12);
  assert.equal(point.foregroundCoreThreshold, 18);
  assert.equal(point.foregroundContrast, 18);
  assert.ok(point.supportPixelCount >= 45);
  assert.ok(Math.hypot(point.x + crop.x - 832, point.y + crop.y - 210) < 2);
  const selected = selectSingleFishCandidate(points.map(p => ({ ...p, x: p.x + crop.x, y: p.y + crop.y })), crop);
  assert.equal(selected.selectionConfident, true);
  assert.equal(observedFishSide(selected, { expectedFish: 1, crop, tankZones }), 'dark');
});

test('sample 9 retains the curved body and keeps the observed track across its neighbors', async () => {
  const { createFishTracker } = await import('../dist/tracking.mjs');
  assert.equal(recordedDetect(9, { recoverLowContrast: false }).length, 0);
  const tracker = createFishTracker(1);
  let previous, trackId;
  for (const sample of [7, 8, 9, 10]) {
    const points = recordedDetect(sample, { previousDetections: previous ? [previous] : [] });
    assert.equal(points.length, 1);
    if (sample === 9) {
      assert.ok(Math.hypot(points[0].x + crop.x - 852, points[0].y + crop.y - 192) < 2);
      assert.ok(points[0].width >= 40 && points[0].area >= 200);
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

const width = 80, height = 60;
const background = new Uint8Array(width * height).fill(20);
const frame = background.slice();
for (let y = 20; y < 36; y++) for (let x = 20; x < 32; x++) frame[y * width + x] = 42;
const options = { expectedFish: 1, darkZones: new Uint8Array(frame.length).fill(1),
  backgroundVariation: { lower: background, upper: background } };
const detect = extra => detectBackgroundFish(frame, background, width, height, { ...options, ...extra });

test('low-contrast recovery requires a single fish, learned variation and an automatic threshold', () => {
  assert.equal(detect().length, 1);
  for (const extra of [{ expectedFish: 2 }, { backgroundVariation: null }, { threshold: 24 },
    { recoverLowContrast: false }, { darkZones: new Uint8Array(frame.length) }]) {
    assert.equal(detect(extra).length, 0);
  }
});

test('the low-contrast retry stays inside the dark region and honors excluded pixels', () => {
  const rightSide = new Uint8Array(frame.length);
  for (let y = 0; y < height; y++) rightSide.fill(1, y * width + 40, (y + 1) * width);
  assert.equal(detect({ darkZones: rightSide }).length, 0);
  assert.equal(detect({ exclusions: [{ x: 18, y: 18, width: 16, height: 20 }] }).length, 0);
  assert.equal(detect({ analysisMask: new Uint8Array(frame.length) }).length, 0);
});

test('ordinary background variation cannot establish a low-contrast fish', () => {
  assert.equal(detect({ backgroundVariation: { lower: background, upper: frame } }).length, 0);
  assert.equal(detectBackgroundFish(background, background, width, height, options).length, 0);
  const weakOnly = frame.map(value => value === 42 ? 35 : value);
  assert.equal(detectBackgroundFish(weakOnly, background, width, height, options).length, 0);
});

test('an existing strong detection keeps the ordinary cutoff', () => {
  const strongFrame = background.slice();
  for (let y = 17; y < 39; y++) for (let x = 17; x < 35; x++) strongFrame[y * width + x] = 35;
  for (let y = 20; y < 36; y++) for (let x = 20; x < 32; x++) strongFrame[y * width + x] = 70;
  const points = detectBackgroundFish(strongFrame, background, width, height, options);
  assert.equal(points.length, 1);
  assert.equal(points[0].lowContrastRecovered, undefined);
  assert.equal(points[0].foregroundContrast, 50);
  assert.ok(points[0].width < 18 && points[0].height < 22);
});

test('a bright wall reflection cannot block detection of a faint dark-side fish at startup', () => {
  const width = 120, height = 80;
  const background = new Uint8Array(width * height).fill(200);
  const darkZones = new Uint8Array(background.length);
  for (let y = 0; y < height; y++) for (let x = 60; x < width; x++) {
    background[y * width + x] = 20;
    darkZones[y * width + x] = 1;
  }
  const reflectionOnly = background.slice();
  for (let y = 30; y < 50; y++) for (let x = 5; x < 13; x++) reflectionOnly[y * width + x] = 250;
  const frame = reflectionOnly.slice();
  for (let y = 30; y < 46; y++) for (let x = 85; x < 97; x++) frame[y * width + x] = 42;
  const options = { expectedFish: 1, edgeX: 14, darkZones,
    backgroundVariation: { lower: background, upper: background } };
  assert.equal(detectBackgroundFish(reflectionOnly, background, width, height, options).length, 0);
  const points = detectBackgroundFish(frame, background, width, height, options);
  assert.equal(points.length, 1);
  assert.ok(Math.hypot(points[0].x - 90.5, points[0].y - 37.5) < 1);
  assert.equal(points[0].lowContrastRecovered, true);
});

test('startup searches for a faint interior fish before a darker border reflection fills the count', () => {
  const width = 120, height = 80;
  const background = new Uint8Array(width * height).fill(200);
  const darkZones = new Uint8Array(background.length);
  for (let y = 0; y < height; y++) for (let x = 60; x < width; x++) {
    background[y * width + x] = 20;
    darkZones[y * width + x] = 1;
  }
  const frame = background.slice();
  // This stronger reflection is inside the relaxed edge pass, outside the
  // ordinary usable border. Previously it prevented discovery of the real fish.
  for (let y = 30; y < 50; y++) for (let x = 5; x < 13; x++) frame[y * width + x] = 140;
  for (let y = 30; y < 46; y++) for (let x = 85; x < 97; x++) frame[y * width + x] = 42;
  const options = { expectedFish: 1, edgeX: 14, darkZones,
    backgroundVariation: { lower: background, upper: background } };
  const points = detectBackgroundFish(frame, background, width, height, options);
  assert.equal(points.length, 1);
  assert.ok(Math.hypot(points[0].x - 90.5, points[0].y - 37.5) < 1);
  assert.equal(points[0].edgeRecovered, undefined);
  assert.equal(points[0].lowContrastRecovered, true);
  const selected = selectSingleFishCandidate(points, { x: 0, y: 0, width, height });
  assert.equal(selected.selectionConfident, true);
  assert.ok(selected.detections[0].x > 60);
});

test('genuine edge fish keep measured contrast and support from the relaxed pass', () => {
  const width = 100, height = 70;
  const background = new Uint8Array(width * height).fill(200), frame = background.slice();
  for (let y = 25; y < 41; y++) for (let x = 5; x < 13; x++) frame[y * width + x] = 100;
  const points = detectBackgroundFish(frame, background, width, height, { expectedFish: 1, edgeX: 14 });
  assert.equal(points.length, 1);
  assert.equal(points[0].edgeRecovered, true);
  assert.equal(points[0].foregroundContrast, 100);
  assert.ok(points[0].supportPixelCount >= 45);
  assert.equal(selectSingleFishCandidate(points, { x: 0, y: 0, width, height }).selectionConfident, true);
});
