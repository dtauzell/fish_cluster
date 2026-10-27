import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { detectBackgroundFish, medianBackground, backgroundVariation } from '../dist/background.mjs';
import { darkZoneMask } from '../dist/tank-zones.mjs';
import { analysisPixelMask } from '../dist/region.mjs';
import { analyzeVideo } from '../dist/pipeline.mjs';

const crop = { x: 452, y: 111, width: 491, height: 182,
  polygon: [{ x: 452, y: 131 }, { x: 930, y: 111 }, { x: 943, y: 289 }, { x: 456, y: 293 }] };
const tankZones = [{ x: 686, y: 118, width: 256, height: 169, side: 'dark',
  polygon: [{ x: 688, y: 121 }, { x: 930, y: 118 }, { x: 942, y: 285 }, { x: 686, y: 287 }] }];
function images(name, count) {
  const data = gunzipSync(readFileSync(new URL(`./fixtures/lighter-dark-corner/${name}.pgm.gz`, import.meta.url)));
  const header = Buffer.from('P5\n491 182\n255\n'), size = 491 * 182, stride = header.length + size;
  assert.equal(data.length, count * stride);
  return Array.from({ length: count }, (_, i) => {
    assert.deepEqual(data.subarray(i * stride, i * stride + header.length), header);
    return data.subarray(i * stride + header.length, (i + 1) * stride);
  });
}
const references = images('background-samples', 25), samples = images('source-001-024', 24);
const background = medianBackground(references);
const options = { expectedFish: 1, darkZones: darkZoneMask(crop, tankZones), analysisMask: analysisPixelMask(crop),
  backgroundVariation: backgroundVariation(references, 491, 182, { excludeForegroundRuns: true }),
  edgeX: 0, edgeTop: 0, edgeBottom: 0 };
const previous = detectBackgroundFish(samples[18], background, 491, 182, options).find(point => point.x > 350);
const context = { timestampMs: 19 * 1000 / 30, previousTimestampMs: 600, previousDetections: [previous] };
const detect = (sample, extra = {}) => detectBackgroundFish(samples[sample - 1], background, 491, 182,
  { ...options, ...context, ...extra });
const isCornerFish = point => Math.hypot(point.x + crop.x - 863, point.y + crop.y - 269) < 15;

test('source frames 20 and 21 recover the corner fish alongside stronger edge candidates', () => {
  assert.ok(previous, 'The fish is observed in source frame 19');
  for (const sample of [20, 21]) {
    const withoutHistory = detect(sample, { previousDetections: [] });
    assert.ok(withoutHistory.length >= 2);
    assert.ok(!withoutHistory.some(isCornerFish), 'Reproduce the missing faint body');
    const points = detect(sample);
    const fish = points.find(isCornerFish);
    assert.ok(fish, `Source frame ${sample} must retain the visible fish`);
    assert.ok(fish.supportPixelCount >= 45);
    assert.equal(fish.lowContrastRecovered, true);
    assert.equal(fish.foregroundCoreThreshold, 18);
    assert.ok(points.some(point => point.x < 250), 'Keep the competing edge evidence');
  }
});

test('corner recovery requires recent compatible history and current stable image evidence', () => {
  for (const extra of [
    { previousDetections: [] }, { previousTimestampMs: 0 }, { previousTimestampMs: 700 },
    { previousDetections: [{ ...previous, positionUncertain: true }] },
    { previousDetections: [{ ...previous, splitFromBlob: true }] },
    { previousDetections: [{ ...previous, x: 10, y: 10 }] },
    { previousDetections: [{ ...previous, area: 5, width: 2, height: 2 }] },
    { expectedFish: 2 }, { recoverLowContrast: false },
    { analysisMask: new Uint8Array(background.length) },
    { backgroundVariation: { lower: new Uint8Array(background.length), upper: new Uint8Array(background.length).fill(255) } }
  ]) assert.ok(!detect(20, extra).some(isCornerFish));
  const noFish = Uint8Array.from(samples[19]);
  for (let y = 140; y < 182; y++) for (let x = 370; x < 450; x++) noFish[y * 491 + x] = background[y * 491 + x];
  assert.ok(!detectBackgroundFish(noFish, background, 491, 182, { ...options, ...context }).some(isCornerFish),
    'History must never carry a position into pixels without a fish');
});

test('the pipeline follows the visible corner fish through source frames 19–22', async () => {
  let reads = 0;
  const source = { seekTo: async () => {}, readGray: () => reads < 25 ? references[reads++] : samples[reads++ - 25] };
  const frames = [];
  const config = { method: 'background', testType: 'light-dark', expectedFish: 1,
    intervalMs: 1000 / 30, crop, tankZones, exclusions: [], trackFish: true, thresholdPx: 45, pixelsPerInch: 30.6 };
  for await (const event of analyzeVideo({ config, source, duration: 63.33,
    isStopped: () => frames.length === 24 })) if (event.frame) frames.push(event.frame);
  const track = frames[18].detections[0].trackId;
  for (const sample of [19, 20, 21, 22]) {
    const frame = frames[sample - 1], point = frame.detections[0];
    assert.ok(Math.hypot(point.x - 863, point.y - 269) < 15, `Source frame ${sample} selects the fish`);
    assert.equal(frame.selectionConfident, true);
    assert.equal(point.positionUncertain, false);
    assert.equal(point.positionSource, 'observed');
    assert.equal(point.trackId, track);
    assert.equal(frame.metrics.darkSideCount, 1);
  }
});

test('a nearby existing region prevents adding disconnected faint fragments as alternative fish', () => {
  const width = 160, height = 100, background = new Uint8Array(width * height).fill(20);
  const image = background.slice();
  for (let y = 45; y < 57; y++) for (let x = 75; x < 87; x++) image[y * width + x] = 80;
  for (let y = 45; y < 57; y++) for (let x = 105; x < 117; x++) image[y * width + x] = 40;
  const points = detectBackgroundFish(image, background, width, height, {
    expectedFish: 1, darkZones: new Uint8Array(image.length).fill(1),
    backgroundVariation: { lower: background, upper: background }, timestampMs: 200, previousTimestampMs: 0,
    previousDetections: [{ x: 105, y: 51, area: 144, width: 12, height: 12 }] });
  assert.equal(points.length, 1);
  assert.ok(points[0].x < 90);
});
