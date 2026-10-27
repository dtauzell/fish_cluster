import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { backgroundVariation, medianBackground, detectBackgroundFish } from '../dist/background.mjs';
import { analyzeVideo } from '../dist/pipeline.mjs';
import { darkZoneMask } from '../dist/tank-zones.mjs';
import { analysisPixelMask } from '../dist/region.mjs';
import { lightDarkReport } from '../dist/light-dark.mjs';

test('single-fish learning removes sustained bright and dark visits but retains scattered flicker', () => {
  const samples = Array.from({ length: 25 }, (_, index) => Uint8Array.from([
    index >= 6 && index < 14 ? 48 : 20,
    index >= 9 && index < 17 ? 60 : 100,
    index % 2 ? 50 : 20,
    index % 8 === 0 ? 48 : 20
  ]));
  const ordinary = backgroundVariation(samples);
  const learned = backgroundVariation(samples, undefined, undefined, { excludeForegroundRuns: true });
  assert.equal(ordinary.upper[0], 48);
  assert.equal(ordinary.lower[1], 60);
  assert.deepEqual([...learned.lower], [20, 100, 20, 20]);
  assert.deepEqual([...learned.upper], [20, 100, 50, 48]);
  assert.deepEqual([...medianBackground(samples)], [20, 100, 20, 20]);
});

test('removing sustained visits still suppresses a rapidly moving bright ridge', () => {
  const width = 90, height = 60;
  const samples = Array.from({ length: 25 }, (_, index) => {
    const pixels = new Uint8Array(width * height).fill(20);
    const left = 20 + index % 3 * 8;
    for (let y = 15; y < 45; y++) for (let x = left; x < left + 5; x++) pixels[y * width + x] = 90;
    return pixels;
  });
  const background = medianBackground(samples), frame = samples[0].slice();
  const variation = backgroundVariation(samples, width, height, { excludeForegroundRuns: true });
  const options = { expectedFish: 1, darkZones: new Uint8Array(frame.length).fill(1), edgeX: 0, edgeY: 0 };
  assert.equal(detectBackgroundFish(frame, background, width, height, options).length, 1);
  assert.equal(detectBackgroundFish(frame, background, width, height, { ...options, backgroundVariation: variation }).length, 0);
  for (let y = 20; y < 36; y++) for (let x = 60; x < 72; x++) frame[y * width + x] = 60;
  const fish = detectBackgroundFish(frame, background, width, height, { ...options, backgroundVariation: variation });
  assert.equal(fish.length, 1);
  assert.ok(Math.hypot(fish[0].x - 65.5, fish[0].y - 27.5) < 1);
});

const crop = { x: 452, y: 111, width: 491, height: 182,
  polygon: [{ x: 452, y: 131 }, { x: 930, y: 111 }, { x: 943, y: 289 }, { x: 456, y: 293 }] };
const tankZones = [{ x: 686, y: 118, width: 256, height: 169, side: 'dark',
  polygon: [{ x: 688, y: 121 }, { x: 930, y: 118 }, { x: 942, y: 285 }, { x: 686, y: 287 }] }];
const base = readFileSync(new URL('./fixtures/lighter-dark-low-contrast/background.pgm', import.meta.url))
  .subarray(Buffer.from('P5\n491 182\n255\n').length);
function images(name, count) {
  const data = gunzipSync(readFileSync(new URL(`./fixtures/lighter-dark-lettering/${name}.pgm.gz`, import.meta.url)));
  const header = Buffer.from('P5\n100 115\n255\n'), size = 100 * 115, stride = header.length + size;
  assert.equal(data.length, count * stride);
  return Array.from({ length: count }, (_, index) => {
    const start = index * stride;
    assert.deepEqual(data.subarray(start, start + header.length), header);
    const roi = data.subarray(start + header.length, start + stride);
    const image = new Uint8Array(base);
    // Original video (800,160), crop-local (348,49). Preserve all image pixels
    // around the lettering; use the shared median for the surrounding tank.
    for (let y = 0; y < 115; y++) image.set(roi.subarray(y * 100, (y + 1) * 100), (y + 49) * 491 + 348);
    return image;
  });
}
const references = images('background-samples', 25);
const sequence = images('samples-169-266', 98);
const turn = images('samples-149-156', 8);
const background = medianBackground(references);
const ordinary = backgroundVariation(references, crop.width, crop.height);
const learned = backgroundVariation(references, crop.width, crop.height, { excludeForegroundRuns: true });
const options = { expectedFish: 1, darkZones: darkZoneMask(crop, tankZones), analysisMask: analysisPixelMask(crop),
  edgeX: 0, edgeTop: 0, edgeBottom: 0 };
function observedTurnReference() {
  let previous;
  for (const [i, image] of turn.slice(0, 4).entries()) {
    previous = detectBackgroundFish(image, background, crop.width, crop.height,
      { ...options, backgroundVariation: learned, previousDetections: previous ? [previous] : [],
        previousTimestampMs: (i - 1) * 200, timestampMs: i * 200 })[0];
  }
  return previous;
}

test('the stationary fish over lettering is image-supported after sustained foreground is excluded from learning', () => {
  const frame = sequence[200 - 169];
  assert.equal(detectBackgroundFish(frame, background, crop.width, crop.height, { ...options, backgroundVariation: ordinary }).length, 0);
  const points = detectBackgroundFish(frame, background, crop.width, crop.height, { ...options, backgroundVariation: learned });
  assert.equal(points.length, 1);
  assert.ok(Math.hypot(points[0].x + crop.x - 846, points[0].y + crop.y - 221) < 3);
});

test('all 93 lettering samples keep observed fish positions and one continuous track', async () => {
  let reads = 0, time = 0;
  const source = { seekTo: async value => { time = value; }, readGray: () => reads < 25
    ? references[reads++] : (reads++, sequence[Math.round(time * 5)]) };
  const config = { method: 'background', testType: 'light-dark', expectedFish: 1, trackFish: true,
    intervalMs: 200, crop, tankZones, exclusions: [], pixelsPerInch: 30.6, thresholdPx: 45 };
  const frames = [];
  for await (const event of analyzeVideo({ config, source, duration: 63.33,
    isStopped: () => frames.length === sequence.length })) if (event.frame) frames.push(event.frame);
  assert.equal(frames.length, sequence.length);
  // Frames in this focused replay start at original sample 169.
  const interval = frames.slice(172 - 169, 264 - 169 + 1);
  assert.equal(interval.length, 93);
  const trackId = frames[0].detections[0].trackId;
  for (const frame of interval) {
    assert.equal(frame.detections.length, 1, `missing original sample ${frame.frameIndex + 169}`);
    assert.equal(frame.selectionConfident, true);
    const point = frame.detections[0];
    assert.equal(point.trackId, trackId);
    assert.equal(point.positionSource, 'observed');
    assert.equal(point.positionUncertain, false);
    assert.ok(point.x > 830 && point.x < 875 && point.y > 190 && point.y < 245);
  }
  const report = lightDarkReport(interval, config);
  assert.ok(Math.abs(report.darkTimeSeconds - 18.4) < 1e-8);
  assert.equal(report.unknownTimeSeconds, 0);
});

test('the embossed lettering alone does not become a fish after foreground learning changes', () => {
  // Background reference 10 is 26.5986 s: the fish is to the left of this ROI.
  const frame = references[10];
  assert.equal(detectBackgroundFish(frame, background, crop.width, crop.height,
    { ...options, backgroundVariation: learned }).length, 0);
});

test('frame 153 retains the faint connected body after its ordinary outline suddenly shrinks', () => {
  const detect = extra => detectBackgroundFish(turn[153 - 149], background, crop.width, crop.height,
    { ...options, backgroundVariation: learned, timestampMs: 200, ...extra });
  const previous = observedTurnReference();
  const fragment = detect()[0];
  assert.ok(fragment.area < previous.area * .5);
  assert.ok(Math.hypot(fragment.x + crop.x - 842, fragment.y + crop.y - 214) < 2);
  const points = detect({ previousDetections: [previous], previousTimestampMs: 0 });
  assert.equal(points.length, 1);
  const point = points[0];
  assert.ok(Math.hypot(point.x + crop.x - 851, point.y + crop.y - 212) < 2);
  assert.ok(point.area > fragment.area * 2 && point.width > fragment.width * 2);
  assert.equal(point.nearbyFrameExpanded, true);
  assert.equal(point.foregroundThreshold, 10);
  assert.equal(point.foregroundCoreThreshold, 12);
  assert.equal(point.lowContrastReferenceTimestampMs, 0);
  for (const extra of [
    { previousTimestampMs: -600 }, { previousTimestampMs: 200 }, { previousTimestampMs: undefined },
    { previousDetections: [{ ...previous, positionUncertain: true }] },
    { previousDetections: [{ ...previous, splitFromBlob: true }] },
    { previousDetections: [{ ...previous, x: previous.x - 60 }] },
    { previousDetections: [{ ...previous, area: 10000 }] },
    { previousDetections: [{ ...previous, width: 1, height: 1 }] },
    { previousDetections: [], previousCandidates: [previous], previousCandidateTimestampMs: 0 },
  ]) {
    const result = detect({ previousDetections: [previous], previousTimestampMs: 0, ...extra });
    assert.equal(result[0].nearbyFrameExpanded, undefined);
    assert.equal(result[0].area, fragment.area);
  }
});

test('frame 153 expansion uses current connected pixels instead of copying the previous outline', () => {
  const frame = turn[153 - 149];
  const previous = observedTurnReference();
  const context = { ...options, backgroundVariation: learned, timestampMs: 200, previousTimestampMs: 0,
    previousDetections: [previous] };
  const fragment = detectBackgroundFish(frame, background, crop.width, crop.height,
    { ...options, backgroundVariation: learned })[0];
  const cropped = background.slice();
  for (let y = 208 - crop.y; y < 221 - crop.y; y++) {
    for (let x = 830 - crop.x; x < 854 - crop.x; x++) cropped[y * crop.width + x] = frame[y * crop.width + x];
  }
  const result = detectBackgroundFish(cropped, background, crop.width, crop.height, context);
  assert.equal(result.length, 1);
  assert.equal(result[0].nearbyFrameExpanded, undefined);
  assert.ok(result[0].area <= fragment.area);
  assert.equal(detectBackgroundFish(background, background, crop.width, crop.height, context).length, 0);
  assert.equal(detectBackgroundFish(frame, background, crop.width, crop.height,
    { ...context, exclusions: [{ x: 348, y: 49, width: 100, height: 115 }] }).length, 0);
});

test('frame 153 pipeline uses the fuller current-image center while retaining one observed track', async () => {
  let reads = 0, time = 0;
  const source = { seekTo: async value => { time = value; }, readGray: () => reads < 25
    ? references[reads++] : (reads++, turn[Math.round(time * 5)]) };
  const config = { method: 'background', testType: 'light-dark', expectedFish: 1, trackFish: true,
    intervalMs: 200, crop, tankZones, exclusions: [], pixelsPerInch: 30.6, thresholdPx: 45 };
  const frames = [];
  for await (const event of analyzeVideo({ config, source, duration: 63.33,
    isStopped: () => frames.length === turn.length })) if (event.frame) frames.push(event.frame);
  const frame = frames[153 - 149], point = frame.detections[0];
  assert.equal(frame.selectionConfident, true);
  assert.equal(point.nearbyFrameExpanded, true);
  assert.ok(Math.hypot(point.x - 851, point.y - 212) < 2);
  assert.equal(point.positionSource, 'observed');
  assert.equal(point.positionUncertain, false);
  assert.equal(point.lowContrastReferenceTimestampMs, frames[152 - 149].timestampMs);
  assert.ok(frames.every(sample => sample.detections[0].trackId === point.trackId));
  const report = lightDarkReport(frames, config);
  assert.equal(report.unknownTimeSeconds, 0);
  assert.equal(report.velocity.validIntervalCount, frames.length - 1);
});

test('a small bright core can retain a faint body matching a recent full observation', () => {
  const width = 120, height = 100, background = new Uint8Array(width * height).fill(20);
  const frame = background.slice();
  for (let y = 25; y < 75; y++) for (let x = 70; x < 82; x++) frame[y * width + x] = 35;
  for (let y = 40; y < 50; y++) for (let x = 72; x < 79; x++) frame[y * width + x] = 65;
  const options = { expectedFish: 1, darkZones: new Uint8Array(frame.length).fill(1),
    backgroundVariation: { lower: background, upper: background }, timestampMs: 200, previousTimestampMs: 0 };
  const previous = { x: 75.5, y: 49.5, width: 12, height: 50, area: 596 };
  const core = detectBackgroundFish(frame, background, width, height, options);
  assert.equal(core.length, 1);
  assert.ok(core[0].height < 20);
  const complete = detectBackgroundFish(frame, background, width, height, { ...options, previousDetections: [previous] });
  assert.equal(complete.length, 1);
  assert.ok(complete[0].height >= 48 && complete[0].area > core[0].area * 5);
  for (const extra of [{ previousTimestampMs: -600 }, { previousDetections: [{ ...previous, x: 20 }] },
    { previousDetections: [{ ...previous, positionUncertain: true }] }]) {
    const points = detectBackgroundFish(frame, background, width, height, { ...options, previousDetections: [previous], ...extra });
    assert.ok(points[0].height < 20);
  }
});
