import test from 'node:test';
import assert from 'node:assert/strict';
import { selectSingleFishCandidate, hasAmbiguousRejectedCandidates } from '../dist/candidate-selection.mjs';
import { detectBackgroundFish } from '../dist/background.mjs';
import { analyzeVideo } from '../dist/pipeline.mjs';
import { observedFishSide } from '../dist/side-tracking.mjs';
import { singleFishVelocity } from '../dist/velocity.mjs';
import { createFishTracker } from '../dist/tracking.mjs';
import { readFileSync } from 'node:fs';
import { darkZoneMask } from '../dist/tank-zones.mjs';
import { lightDarkFramesCsv } from '../dist/exports.mjs';

const crop = { x: 0, y: 0, width: 100, height: 100 };
const config = { method: 'background', expectedFish: 1, intervalMs: 200, crop, thresholdPx: 10,
  pixelsPerInch: 10, tankZones: [{ ...crop, side: 'dark' }], trackFish: true };
const candidate = (id, contrast, extra = {}) => ({ detectionId: id, x: id * 20, y: 30,
  width: 10, height: 12, area: 120, foregroundContrast: contrast, supportPixelCount: 40, ...extra });

test('single-fish selection uses contrast margins and keeps all rejected evidence', () => {
  const selected = selectSingleFishCandidate([candidate(1, 35), candidate(2, 80)], crop);
  assert.equal(selected.detections.length, 1);
  assert.equal(selected.detections[0].detectionId, 2);
  assert.equal(selected.selectionConfident, true);
  assert.equal(selected.rejectedDetections[0].rejectionReason, 'weaker-foreground-contrast');
  assert.equal(hasAmbiguousRejectedCandidates(selected), false);
  const frames = [0, 1].map(frameIndex => ({ ...selected, frameIndex, timestampMs: frameIndex * 200 }));
  assert.equal(observedFishSide(frames[0], config), 'dark');
  assert.equal(singleFishVelocity(frames, config).averagePxPerSecond, 0);
});

test('near ties, unsupported scores and split candidates stay uncertain despite maximum one', () => {
  for (const candidates of [[candidate(1, 70), candidate(2, 80)],
    [candidate(1, 40), candidate(2, 80, { supportPixelCount: 4 })],
    [candidate(1, 40), candidate(2, 80, { splitFromBlob: true })],
    [candidate(1, null), candidate(2, 80)]]) {
    const selected = selectSingleFishCandidate(candidates, crop);
    assert.equal(selected.detections.length, 1);
    assert.equal(selected.selectionConfident, false);
    assert.equal(selected.detections[0].positionUncertain, true);
    assert.equal(hasAmbiguousRejectedCandidates(selected), true);
    assert.equal(observedFishSide(selected, config), 'unknown');
  }
  assert.equal(hasAmbiguousRejectedCandidates({ rejectedDetections: [{ rejectionReason: 'farther-from-crop-center' }] }), true);
});

test('ambiguous candidates never establish or refresh observed tracking evidence', () => {
  const tracker = createFishTracker(1);
  const initial = tracker.update([candidate(1, 80, { positionUncertain: true })], 0)[0];
  assert.equal(initial.positionUncertain, true);
  assert.equal(initial.trackId, undefined);
  const observed = tracker.update([candidate(1, 80)], 200)[0];
  const uncertain = tracker.update([candidate(1, 80, { positionUncertain: true })], 400)[0];
  assert.equal(uncertain.trackId, undefined);
  assert.equal(tracker.update([candidate(1, 80)], 600)[0].trackId, observed.trackId);
});

function image(backgroundValue, firstValue, secondValue) {
  const pixels = new Uint8Array(10000).fill(backgroundValue);
  for (const [left, value] of [[20, firstValue], [60, secondValue]]) {
    for (let y = 30; y < 45; y++) for (let x = left; x < left + 10; x++) pixels[y * 100 + x] = value;
  }
  return pixels;
}

test('background scores support dark fish on light and pale fish on dark floors', () => {
  for (const [backgroundValue, first, second, darkZones] of [[200, 160, 100, undefined],
    [20, 60, 120, new Uint8Array(10000).fill(1)]]) {
    const detections = detectBackgroundFish(image(backgroundValue, first, second), new Uint8Array(10000).fill(backgroundValue),
      100, 100, { expectedFish: 1, darkZones });
    assert.equal(detections.length, 2);
    assert.deepEqual(detections.map(point => point.foregroundContrast), [40, 100]);
    assert.ok(detections.every(point => point.supportPixelCount >= 5));
    assert.ok(selectSingleFishCandidate(detections, crop).detections[0].x > 50);
  }
});

test('background pipeline caps one without center preference and preserves confident reject audit', async () => {
  let seeks = 0;
  const source = { seekTo: async () => { seeks++; }, readGray: () => seeks <= 1
    ? new Uint8Array(10000).fill(20) : image(20, 60, 120) };
  const frames = [];
  for await (const event of analyzeVideo({ config: { ...config, preferCenter: false }, duration: .2, source })) {
    if (event.frame) frames.push(event.frame);
  }
  assert.equal(frames.length, 1);
  assert.equal(frames[0].detections.length, 1);
  assert.equal(frames[0].selectionConfident, true);
  assert.equal(frames[0].rejectedDetections.length, 1);
  assert.equal(observedFishSide(frames[0], config), 'dark');
});

test('recorded competing wall candidate loses to the stronger foreground fish with export audit', () => {
  const region = { x: 200, y: 400, width: 490, height: 170 };
  const image = name => {
    const data = readFileSync(new URL(`./fixtures/light-dark/${name}.pgm`, import.meta.url));
    const header = Buffer.from('P5\n490 170\n255\n');
    assert.deepEqual(data.subarray(0, header.length), header);
    assert.equal(data.length - header.length, region.width * region.height);
    return data.subarray(header.length);
  };
  const zones = [{ x: 403, y: 400, width: 287, height: 170, side: 'dark' }];
  const options = { expectedFish: 1, darkZones: darkZoneMask(region, zones),
    backgroundVariation: { lower: image('variation-lower'), upper: image('variation-upper') } };
  const detect = name => detectBackgroundFish(image(name), image('background'), region.width, region.height, options)
    .map((point, index) => ({ ...point, detectionId: index + 1, x: point.x + region.x, y: point.y + region.y }));
  const competing = detect('competing-candidates');
  assert.equal(competing.length, 2);
  const selected = selectSingleFishCandidate(competing, region);
  assert.equal(selected.selectionConfident, true);
  assert.equal(selected.detections.length, 1);
  assert.ok(Math.hypot(selected.detections[0].x - 248.5, selected.detections[0].y - 498.8) < 2);
  assert.equal(selected.detections[0].foregroundContrast, 80);
  assert.equal(selected.rejectedDetections[0].foregroundContrast, 33);
  const frame = { frameIndex: 27, timestampMs: 5400, ...selected };
  const rows = lightDarkFramesCsv([frame], { ...config, crop: region, tankZones: zones })
    .split('\r\n').map(line => line.split(',').map(value => value.slice(1, -1)));
  const field = name => rows[1][rows[0].indexOf(name)];
  assert.equal(field('automatic_candidate_count'), '2');
  assert.equal(field('rejected_candidate_count'), '1');
  assert.equal(field('foreground_contrast'), '80');
  assert.equal(field('selection_method'), 'foreground-contrast-margin-v1');
  assert.equal(field('selection_confident'), 'true');
  const single = detect('single-5.6s');
  assert.equal(single.length, 1);
  const retained = selectSingleFishCandidate(single, region);
  assert.equal(retained.selectionConfident, true);
  assert.equal(retained.rejectedDetections.length, 0);
  assert.equal(retained.detections[0].x, single[0].x);
  assert.equal(retained.detections[0].y, single[0].y);
  assert.ok(Math.hypot(single[0].x - 250.4, single[0].y - 507.2) < 2);
});
