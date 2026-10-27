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
const references = images('background-samples', 25), samples = images('source-120-145', 26);
const background = medianBackground(references);
const options = { expectedFish: 1, darkZones: darkZoneMask(crop, tankZones), analysisMask: analysisPixelMask(crop),
  backgroundVariation: backgroundVariation(references, 491, 182, { excludeForegroundRuns: true }),
  edgeX: 0, edgeTop: 0, edgeBottom: 0 };
const previous = { x: 846.055 - crop.x, y: 237.377 - crop.y, area: 289, width: 36, height: 60,
  foregroundContrast: 12, supportPixelCount: 262, detectionId: 1, positionSource: 'observed' };
const context = { timestampMs: 131 * 1000 / 30, previousTimestampMs: 130 * 1000 / 30,
  previousDetections: [previous] };
const detect = extra => detectBackgroundFish(samples[132 - 120], background, 491, 182,
  { ...options, ...context, ...extra });
const isFish = point => Math.hypot(point.x + crop.x - 853, point.y + crop.y - 224) < 12;

test('native frame 132 retains its faint body using a connected stable core and a recent observation', () => {
  assert.equal(detect({ previousDetections: [] }).length, 0, 'Reproduce the independent miss');
  const point = detect().find(isFish);
  assert.ok(point);
  assert.ok(point.area >= 200 && point.area <= 300);
  assert.equal(point.foregroundThreshold, 8);
  assert.equal(point.foregroundCoreThreshold, 12);
  assert.equal(point.connectedCoreRecovered, true);
  assert.equal(point.lowContrastReferenceTimestampMs, context.previousTimestampMs);
});

test('connected-core recovery rejects invalid history, ordinary variation and absent fish pixels', () => {
  for (const extra of [
    { previousTimestampMs: 0 }, { previousTimestampMs: context.timestampMs + 1 },
    { previousDetections: [{ ...previous, positionUncertain: true }] },
    { previousDetections: [{ ...previous, splitFromBlob: true }] },
    { previousDetections: [{ ...previous, positionSource: 'overlap-estimate' }] },
    { previousDetections: [{ ...previous, x: 0, y: 0 }] },
    { previousDetections: [{ ...previous, area: 5, width: 2, height: 2 }] },
    { expectedFish: 2 }, { recoverLowContrast: false }, { threshold: 24 },
    { analysisMask: new Uint8Array(background.length) },
    { exclusions: [{ x: 370, y: 90, width: 100, height: 80 }] },
    { backgroundVariation: { lower: new Uint8Array(background.length), upper: new Uint8Array(background.length).fill(255) } }
  ]) assert.ok(!detect(extra).some(isFish));
  assert.equal(detectBackgroundFish(background, background, 491, 182, { ...options, ...context }).length, 0);
});

test('the native pipeline identifies the dark-side fish in source frames 132–136', async () => {
  let reads = 0;
  const source = { seekTo: async () => {}, readGray: () => reads < 25 ? references[reads++] : samples[reads++ - 25] };
  const frames = [];
  const config = { method: 'background', testType: 'light-dark', expectedFish: 1, intervalMs: 1000 / 30,
    crop, tankZones, exclusions: [], trackFish: true, thresholdPx: 45, pixelsPerInch: 30.6 };
  for await (const event of analyzeVideo({ config, source, duration: 63.33,
    isStopped: () => frames.length === samples.length })) if (event.frame) frames.push(event.frame);
  const track = frames[131 - 120].detections[0].trackId;
  for (const sample of [132, 133, 134, 135, 136]) {
    const frame = frames[sample - 120], point = frame.detections[0];
    assert.equal(frame.detections.length, 1, `Source frame ${sample}`);
    assert.ok(point.x > 840 && point.x < 880 && point.y > 195 && point.y < 240);
    assert.equal(frame.selectionConfident, true);
    assert.equal(point.positionUncertain, false);
    assert.equal(point.positionSource, 'observed');
    assert.equal(point.trackId, track);
    assert.equal(frame.metrics.darkSideCount, 1);
  }
});

test('scattered bright pixels cannot seed recovery of a larger faint region', () => {
  const width = 100, height = 80, background = new Uint8Array(width * height).fill(20);
  function detectCore(core) {
    const image = background.slice();
    for (let y = 30; y < 45; y++) for (let x = 35; x < 55; x++) image[y * width + x] = 29;
    for (const [x, y] of core) image[y * width + x] = 34;
    return detectBackgroundFish(image, background, width, height, { expectedFish: 1,
      darkZones: new Uint8Array(image.length).fill(1), backgroundVariation: { lower: background, upper: background },
      timestampMs: 200, previousTimestampMs: 0,
      previousDetections: [{ x: 45, y: 37, width: 20, height: 15, area: 300, foregroundContrast: 20, supportPixelCount: 100 }] });
  }
  assert.equal(detectCore([[38, 33], [42, 33], [46, 33], [50, 33], [38, 38], [42, 38]]).length, 0);
  assert.equal(detectCore([[40, 35], [41, 35], [42, 35], [40, 36], [41, 36], [42, 36]]).length, 1);
});
