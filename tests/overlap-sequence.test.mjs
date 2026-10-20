import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeVideo } from '../dist/pipeline.mjs';
import { frameMetrics } from '../dist/measurements.mjs';
import { darkBodySeeds, previousBodySeeds } from '../dist/overlap-evidence.mjs';
import { sharpnessCsv } from '../dist/exports.mjs';

const crop = { x: 50, y: 200, width: 420, height: 330 };
function image(name) {
  const bytes = readFileSync(new URL(`./fixtures/${name}.pgm`, import.meta.url));
  const header = Buffer.from('P5\n420 330\n255\n');
  assert.deepEqual(bytes.subarray(0, header.length), header);
  return bytes.subarray(header.length);
}
const background = image('tank-background');
const config = { method: 'background', crop, expectedFish: 5, preferCenter: true,
  intervalMs: 200, thresholdPx: 45.9, pixelsPerInch: 30.6 };
async function sequence(numbers, intervalMs = 200) {
  const duration = (numbers.length - 1) * intervalMs / 1000 + .01;
  const sampleCount = Math.min(25, Math.max(1, Math.ceil(duration * 2)));
  let reads = 0, time = 0;
  const source = {
    seekTo: async seconds => { time = seconds; },
    readGray: () => reads++ < sampleCount ? background : image(`frame-${numbers[Math.round(time * 1000 / intervalMs)]}`)
  };
  const frames = [];
  for await (const event of analyzeVideo({ config: { ...config, intervalMs }, source, duration })) {
    if (event.type === 'frame') frames.push(event.frame);
  }
  return frames;
}

test('frames 584–587 separate the overlap using observed context or two dark bodies', async () => {
  const frames = await sequence([583, 584, 585, 586, 587, 588]);
  for (const index of [1, 2, 4]) {
    assert.equal(frames[index].detections.length, 5);
    assert.equal(frames[index].detections.filter(point => point.splitFromBlob).length, 2);
    assert.ok(frames[index].detections.every(point => point.x < 390)); // Keep real fish, not wall reflections.
  }
  assert.ok(frames[1].detections.filter(point => point.splitFromBlob).every(point =>
    point.splitReason === 'previous-frame-overlap' && point.splitReferenceTimestampMs === 0));
  for (const index of [2, 4]) {
    assert.ok(frames[index].detections.filter(point => point.splitFromBlob).every(point => point.splitReason === 'separate-dark-bodies'));
  }
  assert.match(sharpnessCsv(frames, new Map()), /previous-frame-overlap/);
  assert.match(sharpnessCsv(frames, new Map()), /split_reference_timestamp_ms/);
});

test('an estimated split is not propagated as fresh observation in the next frame', async () => {
  const frames = await sequence([583, 584, 584]);
  assert.equal(frames[1].detections.filter(point => point.splitReason === 'previous-frame-overlap').length, 2);
  assert.equal(frames[2].detections.filter(point => point.splitReason === 'previous-frame-overlap').length, 0);
});

test('large sample gaps do not generate preceding-frame estimates', async () => {
  const frames = await sequence([583, 584], 300);
  assert.ok(frames[1].detections.every(point => point.splitReason !== 'previous-frame-overlap'));
});

test('temporal estimates omit the uniform-spacing percentile even without rejected candidates', () => {
  const metrics = frameMetrics([{ x: 10, y: 10, splitReason: 'previous-frame-overlap' }, { x: 20, y: 10 }], config);
  assert.equal(metrics.randomSpacingPercentile, null);
  assert.equal(metrics.randomSpacingUnavailableReason, 'temporal-overlap-estimate');
  assert.equal(metrics.meanPairDistancePx, 10);
});

test('dark-body evidence requires two substantial stable bodies, not a lone region', () => {
  const width = 60, height = 40;
  const tank = new Uint8Array(width * height).fill(200);
  const gray = tank.slice(), pixels = [];
  for (let y = 10; y <= 20; y++) for (let x = 10; x <= 45; x++) {
    pixels.push(y * width + x);
    gray[y * width + x] = x >= 23 && x <= 31 ? 165 : 80;
  }
  const blob = { area: pixels.length, pixels };
  assert.equal(darkBodySeeds(blob, gray, tank, width, 24, 20)?.length, 2);
  for (const index of pixels) gray[index] = 80;
  assert.equal(darkBodySeeds(blob, gray, tank, width, 24, 20), null);
});

test('a distant center or only one preceding center cannot establish a merge', () => {
  const width = 60;
  const blob = { pixels: Array.from({ length: 30 }, (_, i) => 15 * width + 10 + i) };
  assert.equal(previousBodySeeds([blob], [{ x: 15, y: 15 }], width).size, 0);
  assert.equal(previousBodySeeds([blob], [{ x: 15, y: 15 }, { x: 30, y: 35 }], width).size, 0);
  assert.equal(previousBodySeeds([blob], [{ x: 15, y: 15 }, { x: 30, y: 15 }], width).size, 1);
});
