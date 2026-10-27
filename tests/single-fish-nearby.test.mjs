import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { medianBackground, backgroundVariation, detectBackgroundFish } from '../dist/background.mjs';
import { selectSingleFishCandidate, hasAmbiguousRejectedCandidates } from '../dist/candidate-selection.mjs';
import { analyzeVideo } from '../dist/pipeline.mjs';
import { darkZoneMask } from '../dist/tank-zones.mjs';
import { analysisPixelMask } from '../dist/region.mjs';
import { lightDarkReport } from '../dist/light-dark.mjs';

const crop = { x: 452, y: 111, width: 491, height: 182,
  polygon: [{ x: 452, y: 131 }, { x: 930, y: 111 }, { x: 943, y: 289 }, { x: 456, y: 293 }] };
const tankZones = [{ x: 686, y: 118, width: 256, height: 169, side: 'dark',
  polygon: [{ x: 688, y: 121 }, { x: 930, y: 118 }, { x: 942, y: 285 }, { x: 686, y: 287 }] }];
const base = readFileSync(new URL('./fixtures/lighter-dark-low-contrast/background.pgm', import.meta.url))
  .subarray(Buffer.from('P5\n491 182\n255\n').length);
function images(name, count) {
  const data = gunzipSync(readFileSync(new URL(`./fixtures/lighter-dark-nearby/${name}.pgm.gz`, import.meta.url)));
  const header = Buffer.from('P5\n140 90\n255\n'), size = 140 * 90, stride = header.length + size;
  assert.equal(data.length, count * stride);
  return Array.from({ length: count }, (_, i) => {
    assert.deepEqual(data.subarray(i * stride, i * stride + header.length), header);
    const roi = data.subarray(i * stride + header.length, (i + 1) * stride);
    const image = new Uint8Array(base);
    for (let y = 0; y < 90; y++) image.set(roi.subarray(y * 140, (y + 1) * 140), (y + 79) * 491 + 308);
    return image;
  });
}
const references = images('background-samples', 25), samples = images('samples-303-313', 11);
const background = medianBackground(references);
const options = { expectedFish: 1, darkZones: darkZoneMask(crop, tankZones), analysisMask: analysisPixelMask(crop),
  backgroundVariation: backgroundVariation(references, crop.width, crop.height, { excludeForegroundRuns: true }),
  edgeX: 0, edgeTop: 0, edgeBottom: 0 };
const detect = (sample, extra = {}) => detectBackgroundFish(samples[sample - 303], background, crop.width, crop.height,
  { ...options, timestampMs: (sample - 303) * 200, ...extra });
const preceding = detect(306).map((point, i) => ({ ...point, detectionId: i + 1 }));

test('sample 307 can use the preceding rejected body candidate while the selected fragment is too far away', () => {
  assert.equal(detect(307).length, 0);
  assert.equal(preceding.length, 2);
  const selected = selectSingleFishCandidate(preceding, { x: 0, y: 0, width: 491, height: 182 });
  const previousTimestampMs = 600;
  assert.equal(detect(307, { previousTimestampMs, previousDetections: selected.detections }).length, 0);
  const recovered = detect(307, { previousTimestampMs, previousDetections: selected.detections,
    previousCandidates: preceding, previousCandidateTimestampMs: previousTimestampMs });
  assert.equal(recovered.length, 1);
  assert.ok(Math.hypot(recovered[0].x + crop.x - 818, recovered[0].y + crop.y - 247) < 2);
  assert.equal(recovered[0].nearbyFrameRecovered, true);
  assert.equal(recovered[0].foregroundThreshold, 12);
  assert.equal(recovered[0].foregroundCoreThreshold, 12);
  assert.equal(recovered[0].lowContrastReferenceTimestampMs, previousTimestampMs);
  assert.notEqual(recovered[0].lowContrastReferenceDetectionId, selected.detections[0].detectionId);
});

test('samples 307–310 recover measured dark-side centers and retain one track through the gap', async () => {
  let reads = 0, time = 0;
  const source = { seekTo: async value => { time = value; }, readGray: () => reads < 25
    ? references[reads++] : (reads++, samples[Math.round(time * 5)]) };
  const config = { method: 'background', testType: 'light-dark', expectedFish: 1,
    intervalMs: 200, crop, tankZones, exclusions: [], trackFish: true, pixelsPerInch: 30.6, thresholdPx: 45 };
  const frames = [];
  for await (const event of analyzeVideo({ config, source, duration: 63.33,
    isStopped: () => frames.length === samples.length })) if (event.frame) frames.push(event.frame);
  assert.equal(frames[306 - 303].selectionMethod, 'foreground-next-frame-continuity-v1');
  const trackId = frames[306 - 303].detections[0].trackId;
  for (const [sample, x, y] of [[307, 818, 247], [308, 817, 247], [309, 806, 247], [310, 810, 247]]) {
    assert.equal(detect(sample).length, 0, `Reproduce the independent miss in sample ${sample}`);
    const frame = frames[sample - 303], point = frame.detections[0];
    assert.equal(frame.detections.length, 1);
    assert.equal(frame.selectionConfident, true);
    assert.equal(hasAmbiguousRejectedCandidates(frame), false);
    assert.ok(Math.hypot(point.x - x, point.y - y) < 2);
    assert.equal(point.trackId, trackId);
    assert.equal(point.positionSource, 'observed');
    assert.equal(point.positionUncertain, false);
    assert.ok(point.supportPixelCount >= 45);
    assert.equal(frame.metrics.darkSideCount, 1);
    assert.equal(point.lowContrastReferenceTimestampMs, frame.timestampMs - 200);
  }
  assert.equal(frames[310 - 303].detections[0].nearbyFrameRecovered, true);
  assert.equal(frames[310 - 303].detections[0].foregroundThreshold, 8);
  assert.equal(frames[310 - 303].detections[0].foregroundCoreThreshold, 12);
  const throughGap = frames.slice(306 - 303);
  assert.ok(throughGap.every(frame => frame.detections[0].trackId === trackId));
  const report = lightDarkReport(throughGap, config);
  assert.equal(report.unknownTimeSeconds, 0);
  assert.ok(Math.abs(report.darkTimeSeconds - 1.4) < 1e-9);
  assert.equal(report.velocity.validIntervalCount, throughGap.length - 1);
});

test('nearby recovery rejects stale, future, missing, uncertain, split, distant, and incompatible references', () => {
  const body = preceding.find(point => point.x + crop.x < 840);
  for (const extra of [
    { previousCandidateTimestampMs: 0 }, { previousCandidateTimestampMs: 800 },
    { previousCandidateTimestampMs: 1000 }, { previousCandidateTimestampMs: undefined },
    { previousCandidates: [{ ...body, positionUncertain: true }] },
    { previousCandidates: [{ ...body, splitFromBlob: true }] },
    { previousCandidates: [{ ...body, positionSource: 'overlap-estimate' }] },
    { previousCandidates: [{ ...body, x: 0, y: 0 }] },
    { previousCandidates: [{ ...body, area: 5, width: 2, height: 2 }] },
    { previousCandidates: [{ ...body, supportPixelCount: 4 }] },
    { previousCandidates: [{ ...body, foregroundContrast: null }] },
  ]) assert.equal(detect(307, { previousCandidates: [body], previousCandidateTimestampMs: 600, ...extra }).length, 0);
});

test('nearby recovery needs current contrast beyond learned variation and respects masks and detection settings', () => {
  const context = { previousCandidates: preceding, previousCandidateTimestampMs: 600 };
  const image = samples[307 - 303];
  const lower = image.map((value, i) => Math.min(value, background[i]));
  const upper = image.map((value, i) => Math.max(value, background[i]));
  for (const extra of [
    { backgroundVariation: { lower, upper } },
    { analysisMask: new Uint8Array(image.length) },
    { exclusions: [{ x: 300, y: 70, width: 160, height: 100 }] },
    { expectedFish: 2 }, { recoverLowContrast: false }, { backgroundVariation: undefined },
  ]) assert.equal(detect(307, { ...context, ...extra }).length, 0);
  assert.equal(detectBackgroundFish(background, background, crop.width, crop.height,
    { ...options, ...context, timestampMs: 800 }).length, 0, 'Never carry a fish into an empty image');
});

test('weak nearby pixels without the required stronger core cannot become fish', () => {
  const width = 100, height = 80, background = new Uint8Array(width * height).fill(20);
  const image = background.slice();
  for (let y = 30; y < 43; y++) for (let x = 35; x < 55; x++) image[y * width + x] = 30;
  const context = { expectedFish: 1, darkZones: new Uint8Array(image.length).fill(1),
    backgroundVariation: { lower: background, upper: background }, timestampMs: 200, previousCandidateTimestampMs: 0,
    previousCandidates: [{ x: 45, y: 36, area: 150, width: 20, height: 12, supportPixelCount: 100, foregroundContrast: 30 }] };
  assert.equal(detectBackgroundFish(image, background, width, height, context).length, 0);
});
