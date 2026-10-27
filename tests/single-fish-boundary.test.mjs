import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectBackgroundFish } from '../dist/background.mjs';
import { selectSingleFishCandidate, hasAmbiguousRejectedCandidates } from '../dist/candidate-selection.mjs';
import { darkZoneMask } from '../dist/tank-zones.mjs';
import { analysisPixelMask } from '../dist/region.mjs';
import { observedFishSide } from '../dist/side-tracking.mjs';
import { analyzeVideo } from '../dist/pipeline.mjs';
import { lightDarkFramesCsv } from '../dist/exports.mjs';

// Bounding boxes supplied by the user; corner positions reconstructed from the
// screenshot. This reproduces the reported reflection center to 0.1 pixels.
const crop = { x: 452, y: 111, width: 491, height: 182,
  polygon: [{ x: 452, y: 131 }, { x: 930, y: 111 }, { x: 943, y: 289 }, { x: 456, y: 293 }] };
const tankZones = [{ x: 686, y: 118, width: 256, height: 169, side: 'dark',
  polygon: [{ x: 688, y: 121 }, { x: 930, y: 118 }, { x: 942, y: 285 }, { x: 686, y: 287 }] }];
const read = name => {
  const data = readFileSync(new URL(`./fixtures/lighter-dark-low-contrast/${name}.pgm`, import.meta.url));
  return data.subarray(Buffer.from('P5\n491 182\n255\n').length);
};

for (const directory of ['', 'safari/']) {
  test(`first frame with angled crop selects the confirmed fish over the stronger wall region (${directory || 'FFmpeg'})`, () => {
    const candidates = detectBackgroundFish(read(`${directory}sample-1`), read(`${directory}background`), 491, 182,
      { expectedFish: 1, darkZones: darkZoneMask(crop, tankZones), analysisMask: analysisPixelMask(crop),
        edgeX: 0, edgeTop: 0, edgeBottom: 0,
        backgroundVariation: { lower: read(`${directory}variation-lower`), upper: read(`${directory}variation-upper`) } })
      .map((point, index) => ({ ...point, detectionId: index + 1, x: point.x + crop.x, y: point.y + crop.y }));
    assert.equal(candidates.length, 2);
    const wall = candidates.find(point => point.x < 500), fish = candidates.find(point => point.x > 800);
    assert.ok(Math.hypot(wall.x - 461.1, wall.y - 257.4) < .2);
    assert.ok(wall.foregroundContrast >= fish.foregroundContrast * 1.5, 'contrast alone wrongly favors the wall');
    const selected = selectSingleFishCandidate(candidates, crop);
    assert.equal(selected.selectionConfident, true);
    assert.equal(selected.detections[0].detectionId, fish.detectionId);
    assert.ok(Math.hypot(selected.detections[0].x - 862.4, selected.detections[0].y - 256.5) < 10);
    assert.equal(selected.rejectedDetections[0].detectionId, wall.detectionId);
    assert.equal(selected.rejectedDetections[0].rejectionReason, 'wall-like-boundary-region');
    assert.equal(hasAmbiguousRejectedCandidates(selected), false);
    assert.equal(observedFishSide(selected, { expectedFish: 1, crop, tankZones }), 'dark');
    const rows = lightDarkFramesCsv([{ frameIndex: 0, timestampMs: 0, ...selected }],
      { expectedFish: 1, intervalMs: 200, crop, tankZones }).split('\r\n');
    assert.match(rows[1], /foreground-boundary-margin-v1/);
  });
}

const rectangle = { x: 0, y: 0, width: 200, height: 150 };
const wall = { detectionId: 1, x: 5, y: 80, width: 4, height: 60, area: 200, foregroundContrast: 80, supportPixelCount: 200 };
const fish = { detectionId: 2, x: 100, y: 80, width: 14, height: 22, area: 180, foregroundContrast: 25, supportPixelCount: 150 };

test('wall preference requires a long thin parallel region at the boundary and a supported alternative', () => {
  assert.equal(selectSingleFishCandidate([wall, fish], rectangle).detections[0].detectionId, 2);
  for (const candidate of [
    { ...wall, width: 12, height: 24 },
    { ...wall, x: 50 },
    { ...wall, width: 60, height: 4 }
  ]) assert.equal(selectSingleFishCandidate([candidate, fish], rectangle).detections[0].detectionId, 1);
  assert.equal(selectSingleFishCandidate([wall], rectangle).detections[0].detectionId, 1);
  const uncertain = selectSingleFishCandidate([wall, { ...fish, supportPixelCount: 0 }], rectangle);
  assert.equal(uncertain.detections[0].detectionId, 1);
  assert.equal(uncertain.selectionConfident, false);
});

test('an existing observed path can follow a real thin fish near a wall', () => {
  const selected = selectSingleFishCandidate([wall, fish], rectangle, { previousPoint: { x: 5, y: 78 } });
  assert.equal(selected.detections[0].detectionId, 1);
  assert.equal(selected.selectionConfident, true);
  assert.equal(hasAmbiguousRejectedCandidates(selected), false);
});

test('competing interior candidates remain uncertain after setting aside a wall region', () => {
  const selected = selectSingleFishCandidate([wall, fish, { ...fish, detectionId: 3, x: 130, foregroundContrast: 27 }], rectangle);
  assert.equal(selected.selectionConfident, false);
  assert.equal(selected.detections[0].positionUncertain, true);
  assert.equal(hasAmbiguousRejectedCandidates(selected), true);
});

test('the first pipeline sample uses the fish position and preserves the rejected wall candidate', async () => {
  const width = 100, height = 80;
  const crop = { x: 100, y: 200, width, height,
    polygon: [{ x: 100, y: 205 }, { x: 195, y: 200 }, { x: 200, y: 275 }, { x: 105, y: 280 }] };
  const tankZones = [{ x: 150, y: 200, width: 50, height: 80, side: 'dark' }];
  const background = new Uint8Array(width * height).fill(200);
  for (let y = 0; y < height; y++) for (let x = 50; x < width; x++) background[y * width + x] = 20;
  const frame = background.slice();
  for (let y = 20; y < 65; y++) for (let x = 5; x < 8; x++) frame[y * width + x] = 130;
  for (let y = 40; y < 54; y++) for (let x = 70; x < 82; x++) frame[y * width + x] = 50;
  let reads = 0;
  const source = { seekTo: async () => {}, readGray: () => reads++ === 0 ? background : frame };
  const frames = [];
  for await (const event of analyzeVideo({ source, duration: .2, config: {
    method: 'background', testType: 'light-dark', expectedFish: 1, intervalMs: 200,
    crop, tankZones, exclusions: [], thresholdPx: 10, pixelsPerInch: 30
  } })) if (event.frame) frames.push(event.frame);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].rawPredictionCount, 2);
  assert.ok(frames[0].detections[0].x > 150);
  assert.equal(frames[0].detections[0].positionUncertain, false);
  assert.equal(frames[0].detections[0].trackId, 1);
  assert.equal(frames[0].rejectedDetections[0].rejectionReason, 'wall-like-boundary-region');
  assert.equal(observedFishSide(frames[0], { expectedFish: 1, crop, tankZones }), 'dark');
});
