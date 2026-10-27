import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { detectBackgroundFish, medianBackground, backgroundVariation } from '../dist/background.mjs';
import { analyzeVideo } from '../dist/pipeline.mjs';
import { darkZoneMask } from '../dist/tank-zones.mjs';
import { analysisPixelMask } from '../dist/region.mjs';

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
const references = images('background-samples', 25);
const config = { method: 'background', testType: 'light-dark', expectedFish: 1, crop, tankZones,
  intervalMs: 1000 / 30, exclusions: [], trackFish: true, thresholdPx: 45, pixelsPerInch: 30.6 };
const background = medianBackground(references);
const options = { expectedFish: 1, darkZones: darkZoneMask(crop, tankZones), analysisMask: analysisPixelMask(crop),
  backgroundVariation: backgroundVariation(references, 491, 182, { excludeForegroundRuns: true }),
  edgeX: 0, edgeTop: 0, edgeBottom: 0 };

for (const [first, last, missedFirst, missedLast, bounds] of [
  [120, 145, 138, 139, [840, 880, 190, 220]],
  [180, 212, 195, 203, [800, 880, 225, 260]],
  [370, 392, 380, 382, [780, 825, 160, 195]],
  [1750, 1810, 1776, 1795, [800, 880, 180, 215]],
]) {
  test(`native frames ${missedFirst}–${missedLast} retain observed fish while crossing lettering`, async () => {
    const samples = images(`source-${first}-${last}`, last - first + 1);
    let reads = 0;
    const source = { seekTo: async () => {}, readGray: () => reads < 25 ? references[reads++] : samples[reads++ - 25] };
    const frames = [];
    for await (const event of analyzeVideo({ config, source, duration: 63.33,
      isStopped: () => frames.length === samples.length })) if (event.frame) frames.push(event.frame);
    for (let n = missedFirst; n <= missedLast; n++) {
      const frame = frames[n - first], point = frame.detections[0];
      assert.equal(frame.detections.length, 1, `Source frame ${n}`);
      assert.ok(point.x > bounds[0] && point.x < bounds[1] && point.y > bounds[2] && point.y < bounds[3]);
      assert.equal(frame.selectionConfident, true);
      assert.equal(point.positionSource, 'observed');
      assert.equal(point.positionUncertain, false);
      assert.equal(point.splitFromBlob, undefined);
      assert.equal(point.trackId, frames[missedFirst - first - 1].detections[0].trackId);
    }
  });
}

test('a small head is recovered only with strong connected current pixels and a close selected observation', () => {
  const samples = images('source-370-392', 23);
  const previous = { x: 809.3 - crop.x, y: 176.1 - crop.y, area: 155, width: 22, height: 12,
    foregroundContrast: 12, supportPixelCount: 100 };
  const context = { timestampMs: 200, previousTimestampMs: 166.67, previousDetections: [previous] };
  const detect = extra => detectBackgroundFish(samples[381 - 370], background, 491, 182, { ...options, ...context, ...extra });
  const point = detect()[0];
  assert.ok(Math.hypot(point.x + crop.x - 791.2, point.y + crop.y - 178.7) < 1);
  assert.equal(point.smallCoreRecovered, true);
  assert.equal(point.area, 35);
  assert.equal(point.foregroundCoreThreshold, 12);
  for (const extra of [
    { previousDetections: [] }, { previousTimestampMs: -500 }, { minArea: 45 },
    { previousDetections: [{ ...previous, x: previous.x + 10 }] },
    { previousDetections: [{ ...previous, positionUncertain: true }] },
    { previousDetections: [], previousCandidates: [previous], previousCandidateTimestampMs: 166.67 },
    { backgroundVariation: { lower: new Uint8Array(background.length), upper: new Uint8Array(background.length).fill(255) } }
  ]) assert.equal(detect(extra).length, 0);
});

test('a 10-level core requires close selected history; rejected candidates and scattered pixels cannot lower the cutoff', () => {
  const width = 100, height = 80, background = new Uint8Array(width * height).fill(20);
  const image = background.slice();
  for (let y = 30; y < 45; y++) for (let x = 35; x < 55; x++) image[y * width + x] = 30;
  const previous = { x: 44.5, y: 37, area: 300, width: 20, height: 15, supportPixelCount: 100, foregroundContrast: 20 };
  const base = { expectedFish: 1, darkZones: new Uint8Array(image.length).fill(1),
    backgroundVariation: { lower: background, upper: background }, timestampMs: 200, previousTimestampMs: 166.67,
    previousDetections: [previous] };
  const detect = (pixels, extra = {}) => detectBackgroundFish(pixels, background, width, height, { ...base, ...extra });
  assert.equal(detect(image)[0].foregroundCoreThreshold, 10);
  for (const extra of [
    { previousDetections: [] }, { previousTimestampMs: -500 },
    { previousDetections: [{ ...previous, x: previous.x - 20 }] },
    { previousDetections: [{ ...previous, area: 100 }] },
    { previousDetections: [{ ...previous, positionUncertain: true }] },
    { previousDetections: [], previousCandidates: [previous], previousCandidateTimestampMs: 166.67 }
  ]) assert.equal(detect(image, extra).length, 0);
  const scattered = image.map(value => value === 30 ? 29 : value);
  for (const [x, y] of [[38, 33], [42, 33], [46, 33], [50, 33], [38, 38], [42, 38]]) scattered[y * width + x] = 30;
  assert.equal(detect(scattered).length, 0);
});

test('empty recorded lettering cannot inherit nearby fish history', () => {
  // Reference 10 has no fish in original-video rectangle (800,160,100,115).
  // Preserve its real lettering pixels; hold the surrounding tank at the median.
  const image = background.slice();
  for (let y = 49; y < 164; y++) for (let x = 348; x < 448; x++) image[y * 491 + x] = references[10][y * 491 + x];
  for (const [x, y, area, width, height] of [[854, 202, 168, 23, 30], [813, 241, 91, 16, 9],
    [809, 176, 155, 22, 12], [829, 195, 128, 29, 7]]) {
    const previous = { x: x - crop.x, y: y - crop.y, area, width, height, foregroundContrast: 20, supportPixelCount: 100 };
    assert.equal(detectBackgroundFish(image, background, 491, 182, { ...options, timestampMs: 200,
      previousTimestampMs: 166.67, previousDetections: [previous] }).length, 0);
  }
});
