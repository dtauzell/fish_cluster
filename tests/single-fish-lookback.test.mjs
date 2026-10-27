import test from 'node:test';
import assert from 'node:assert/strict';
import { selectSingleFishFromNextFrame, hasAmbiguousRejectedCandidates, frameCandidates,
  NEXT_FRAME_SINGLE_FISH_SELECTION_METHOD } from '../dist/candidate-selection.mjs';
import { analyzeVideo } from '../dist/pipeline.mjs';
import { createFishTracker } from '../dist/tracking.mjs';
import { lightDarkReport } from '../dist/light-dark.mjs';
import { lightDarkFramesCsv } from '../dist/exports.mjs';

const crop = { x: 200, y: 300, width: 180, height: 120 };
const candidate = (id, x, extra = {}) => ({ detectionId: id, x, y: 350,
  width: 12, height: 12, area: 144, foregroundContrast: 40, supportPixelCount: 144, ...extra });

test('a clear next fish can select a previously skipped, weaker-contrast candidate', () => {
  const candidates = [candidate(1, 240, { foregroundContrast: 100 }), candidate(2, 310)];
  const result = selectSingleFishFromNextFrame(candidates, crop, candidate(1, 316));
  assert.equal(result.detections[0].detectionId, 2);
  assert.equal(result.selectionMethod, NEXT_FRAME_SINGLE_FISH_SELECTION_METHOD);
  assert.equal(result.selectionConfident, true);
  assert.equal(result.detections[0].positionUncertain, false);
  assert.equal(result.rejectedDetections[0].rejectionReason, 'weaker-next-frame-continuity');
  assert.equal(hasAmbiguousRejectedCandidates(result), false);
  assert.deepEqual(frameCandidates(result).map(point => point.detectionId), [1, 2]);
  assert.equal(candidates[0].rejectionReason, undefined, 'Original candidate evidence stays intact');
});

test('lookback requires a supported nearby candidate and a clear distance margin', () => {
  const anchor = candidate(1, 310);
  for (const candidates of [
    [candidate(1, 300), candidate(2, 320)], // Equal distance.
    [candidate(1, 304), candidate(2, 320)], // Only a four-pixel advantage.
    [candidate(1, 240), candidate(2, 250)], // Both beyond 45 pixels.
    [candidate(1, 240), candidate(2, 310, { splitFromBlob: true })],
    [candidate(1, 240), candidate(2, 310, { supportPixelCount: 4 })],
    [candidate(1, 240), candidate(2, 310, { positionUncertain: true })],
    [candidate(1, 310)],
  ]) assert.equal(selectSingleFishFromNextFrame(candidates, crop, anchor), null);
  for (const extra of [{ positionUncertain: true }, { splitFromBlob: true }, { positionSource: 'overlap-estimate' },
    { supportPixelCount: 4 }, { foregroundContrast: null }]) {
    assert.equal(selectSingleFishFromNextFrame([candidate(1, 240), candidate(2, 310)], crop,
      { ...anchor, ...extra }), null);
  }
});

async function sequence(samples, options = {}) {
  const { intervalMs = 200, trackFish = true, filterExactCount = false, stopAfterFirst = false } = options;
  const background = new Uint8Array(crop.width * crop.height).fill(200);
  const config = { method: 'background', testType: 'light-dark', expectedFish: 1, crop,
    tankZones: [{ x: crop.x + 90, y: crop.y, width: 90, height: crop.height, side: 'dark' }],
    thresholdPx: 10, pixelsPerInch: 30, intervalMs, trackFish,
    filterExactCount, filterFrameCount: 2 };
  let time = 0, stopped = false;
  const source = {
    seekTo: async value => { time = value; },
    readGray: () => {
      // Analysis seeks use exact sample times; background seeks fall between them.
      const index = Math.round(time * 1000 / intervalMs);
      if (Math.abs(time * 1000 - index * intervalMs) > .01) return background.slice();
      const pixels = background.slice();
      for (const [x, contrast] of samples[index] ?? []) {
        for (let y = 45; y < 57; y++) for (let col = x - 5; col < x + 7; col++) {
          pixels[y * crop.width + col] = 200 - contrast;
        }
      }
      return pixels;
    },
  };
  const events = [];
  const duration = (samples.length - .2) * intervalMs / 1000;
  for await (const event of analyzeVideo({ config, duration, source, isStopped: () => stopped })) {
    if (event.frame) {
      events.push(event);
      if (stopAfterFirst) stopped = true;
    }
  }
  return { frames: events.map(event => event.frame), events, config };
}

test('pipeline replaces a confident wrong winner and updates sides, metrics, speed and exports', async () => {
  for (const trackFish of [true, false]) {
    const { frames, config } = await sequence([[[40, 100], [110, 40]], [[116, 40]], [[122, 40]]], { trackFish });
    assert.equal(frames.length, 3);
    const first = frames[0];
    assert.equal(first.rawPredictionCount, 2);
    assert.equal(first.selectionMethod, NEXT_FRAME_SINGLE_FISH_SELECTION_METHOD);
    assert.equal(first.selectionBeforeLookback.detectionId, 1);
    assert.equal(first.selectionBeforeLookback.confident, true);
    assert.equal(first.detections[0].detectionId, 2);
    assert.ok(Math.abs(first.detections[0].x - 310.5) < 1);
    assert.equal(first.detections[0].tankSide, 'dark');
    assert.equal(first.metrics.darkSideCount, 1);
    assert.equal(first.metrics.lightSideCount, 0);
    assert.equal(first.metrics.uncertainPositionCount, 0);
    assert.equal(first.selectionReferenceTimestampMs, 200);
    assert.equal(first.rejectedDetections[0].detectionId, 1);
    if (trackFish) assert.ok(frames.every(frame => frame.detections[0].trackId === first.detections[0].trackId));
    const report = lightDarkReport(frames, config);
    assert.equal(report.darkTimeSeconds, .4);
    assert.equal(report.unknownTimeSeconds, 0);
    assert.equal(report.velocity.validIntervalCount, 2);
    assert.ok(Math.abs(report.averageSpeedPxPerSecond - 30) < .01);
    const csv = lightDarkFramesCsv(frames, config);
    assert.ok(csv.includes(NEXT_FRAME_SINGLE_FISH_SELECTION_METHOD));
    const restored = JSON.parse(JSON.stringify(first));
    assert.equal(restored.selectionReferenceTimestampMs, 200);
    assert.equal(frameCandidates(restored).length, 2);
  }
});

test('pipeline replays the earlier tracking update so corrected motion keeps the established fish identity', async () => {
  const { frames, config } = await sequence([[[80, 40]], [[45, 100], [110, 40]], [[130, 40]]]);
  assert.equal(frames[1].selectionBeforeLookback.detectionId, 1);
  assert.equal(frames[1].detections[0].detectionId, 2);
  assert.equal(frames[1].selectionMethod, NEXT_FRAME_SINGLE_FISH_SELECTION_METHOD);
  assert.ok(frames.every(frame => frame.detections[0].trackId === frames[0].detections[0].trackId));
  const report = lightDarkReport(frames, config);
  assert.equal(report.velocity.validIntervalCount, 2);
  assert.equal(report.averageSpeedPxPerSecond, 125);
  assert.ok(Math.abs(report.darkTimeSeconds - .3) < 1e-9);
  assert.equal(report.lightTimeSeconds, .1);
  assert.equal(report.unknownTimeSeconds, 0);
});

test('pipeline resolves an uncertain earlier frame using its original unmodified candidates', async () => {
  const { frames } = await sequence([[[40, 40], [110, 40]], [[116, 40]]]);
  assert.equal(frames[0].selectionBeforeLookback.confident, false);
  assert.equal(frames[0].selectionConfident, true);
  assert.equal(frames[0].detections[0].detectionId, 2);
  assert.equal(frames[0].detections[0].positionUncertain, false);
  assert.equal(hasAmbiguousRejectedCandidates(frames[0]), false);
});

test('lookback can confirm the original uncertain winner without retaining its uncertainty flag', async () => {
  const { frames } = await sequence([[[40, 40], [110, 40]], [[46, 40]]]);
  assert.equal(frames[0].selectionBeforeLookback.confident, false);
  assert.equal(frames[0].detections[0].detectionId, 1);
  assert.equal(frames[0].detections[0].positionUncertain, false);
  assert.equal(frames[0].metrics.uncertainPositionCount, 0);
});

test('competing or missing next detections, distance ties, large jumps, and long sample gaps do not resolve earlier frames', async () => {
  for (const [next, options] of [
    [[[112, 40], [145, 40]], {}],
    [[], {}],
    [[[75, 40]], {}],
    [[[165, 40]], {}],
    [[[116, 40]], { intervalMs: 400 }],
  ]) {
    const { frames } = await sequence([[[40, 40], [110, 40]], next], options);
    assert.equal(frames[0].selectionBeforeLookback, undefined);
    assert.equal(frames[0].selectionConfident, false);
  }
});

test('lookback revises only the immediately preceding sample and retains count-filtered frames', async () => {
  const { frames, events } = await sequence([[[30, 40], [100, 40]], [[40, 40], [110, 40]], [[116, 40]]],
    { filterExactCount: true });
  assert.equal(frames[0].selectionBeforeLookback, undefined);
  assert.equal(frames[1].selectionMethod, NEXT_FRAME_SINGLE_FISH_SELECTION_METHOD);
  assert.ok(events.every(event => event.type === 'skipped'));
  assert.deepEqual(frames.map(frame => frame.frameIndex), [0, 1, 2]);
});

test('cancellation preserves the last completed sample without inventing next-frame evidence', async () => {
  const { frames } = await sequence([[[40, 40], [110, 40]], [[116, 40]]], { stopAfterFirst: true });
  assert.equal(frames.length, 1);
  assert.equal(frames[0].selectionConfident, false);
  assert.equal(frames[0].selectionReferenceTimestampMs, undefined);
});

test('replaying the last tracking update restores motion and identity before applying the next fish', () => {
  const tracker = createFishTracker(1);
  const first = tracker.update([candidate(1, 280)], 0)[0];
  tracker.update([candidate(1, 240)], 200);
  const revised = tracker.reviseLastUpdate([candidate(2, 310)], 200)[0];
  assert.equal(revised.trackId, first.trackId);
  assert.equal(revised.trackLastObservedTimestampMs, 200);
  assert.equal(tracker.selectionPrediction(400).x, 340);
  const current = tracker.update([candidate(1, 330)], 400)[0];
  assert.equal(current.trackId, first.trackId);
  assert.equal(tracker.selectionPrediction(600).x, 350);
  assert.throws(() => tracker.reviseLastUpdate([], 200), /last single-fish/);
  assert.throws(() => createFishTracker(2).reviseLastUpdate([], 0), /last single-fish/);
});
