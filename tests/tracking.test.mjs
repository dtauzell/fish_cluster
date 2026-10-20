import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { minimumCostAssignment } from '../dist/point-assignment.mjs';
import { createFishTracker } from '../dist/tracking.mjs';
import { analyzeVideo } from '../dist/pipeline.mjs';
import { detectBackgroundFish } from '../dist/background.mjs';
import { detectionsCsv, framesCsv, sharpnessCsv } from '../dist/exports.mjs';

const point = (x, y = 20) => ({ x, y, area: 100 });
function mergedRegion() {
  const pixels = [];
  for (let y = 15; y <= 25; y++) for (let x = 15; x <= 45; x++) pixels.push(y * 80 + x);
  return { x: 30, y: 20, area: pixels.length, pixels };
}
function establishedTracker() {
  const tracker = createFishTracker(2);
  tracker.update([point(15), point(45)], 0);
  const observed = tracker.update([point(17), point(43)], 200);
  return { tracker, observed };
}

test('assignment resolves competing matches globally and permits unmatched tracks', () => {
  assert.deepEqual(minimumCostAssignment([[1, 2], [2, 40]], 45), [1, 0]);
  assert.deepEqual(minimumCostAssignment([[50], [2]], 45), [-1, 0]);
  assert.deepEqual(minimumCostAssignment([[], []], 45), [-1, -1]);
  assert.deepEqual(minimumCostAssignment([], 45), []);
});

test('track IDs follow motion when detection order changes', () => {
  const { tracker, observed } = establishedTracker();
  const next = tracker.update([point(41), point(19)], 400);
  assert.deepEqual(next.map(p => p.trackId), [observed[1].trackId, observed[0].trackId]);
  assert.ok(next.every(p => p.positionSource === 'observed' && !p.positionUncertain));
});

test('two established paths entering one current region support an uncertain overlap', () => {
  const { tracker, observed } = establishedTracker();
  const blob = mergedRegion();
  const context = tracker.overlapSeeds([blob], 80, 400).get(blob);
  assert.deepEqual(context.trackIds, observed.map(p => p.trackId));
  assert.equal(context.referenceTimestampMs, 200);
  const estimates = tracker.update([17, 43].map(x => ({ ...point(x), splitFromBlob: true,
    splitReason: 'tracking-overlap', sourceTrackIds: context.trackIds })), 400);
  assert.ok(estimates.every(p => p.positionUncertain && p.trackLastObservedTimestampMs === 200));
  const reacquired = tracker.update([point(19), point(41)], 600);
  assert.deepEqual(reacquired.map(p => p.trackId), observed.map(p => p.trackId));
  assert.ok(estimates.every(p => p.trackReacquiredTimestampMs === 600 && p.positionUncertain));
  assert.ok(reacquired.every(p => p.trackReacquired && p.positionSource === 'observed'));
});

test('carried estimates never renew their observation deadline or invent fish without foreground', () => {
  const { tracker } = establishedTracker();
  const blob = mergedRegion();
  for (let time = 400; time <= 1200; time += 200) {
    assert.equal(tracker.overlapSeeds([blob], 80, time).size, 1);
    tracker.update([point(17), point(43)].map(p => ({ ...p, splitFromBlob: true })), time);
  }
  assert.equal(tracker.overlapSeeds([blob], 80, 1400).size, 0);
  assert.deepEqual(tracker.update([], 1400), []);
  assert.equal(establishedTracker().tracker.overlapSeeds([], 80, 400).size, 0);
});

test('isolated, unestablished, tiny, distant, and stale regions cannot establish an overlap', () => {
  const blob = mergedRegion();
  const tracker = createFishTracker(2);
  tracker.update([point(17), point(43)], 0);
  assert.equal(tracker.overlapSeeds([blob], 80, 200).size, 0);
  const { tracker: ready } = establishedTracker();
  assert.equal(ready.overlapSeeds([{ ...blob, area: 40 }], 80, 400).size, 0);
  assert.equal(ready.overlapSeeds([{ ...blob, pixels: [60 * 80 + 60] }], 80, 400).size, 0);
  assert.equal(ready.overlapSeeds([blob], 80, 600).size, 0); // Sample gap exceeds 250 ms.
  const fresh = ready.update([point(17), point(43)], 600);
  assert.ok(fresh.every(p => p.trackId > 2));
  const lone = createFishTracker(2);
  lone.update([point(17)], 0); lone.update([point(19)], 200);
  assert.equal(lone.overlapSeeds([blob], 80, 400).size, 0);
});

test('crop offsets are removed only for foreground matching', () => {
  const tracker = createFishTracker(2), crop = { x: 50, y: 240 };
  tracker.update([point(65, 260), point(95, 260)], 0);
  tracker.update([point(67, 260), point(93, 260)], 200);
  const blob = mergedRegion();
  assert.equal(tracker.overlapSeeds([blob], 80, 400, crop).get(blob).seeds.length, 2);
});

test('size references need three established observed paths and expire without fresh observations', () => {
  const tracker = createFishTracker(3);
  const fish = [100, 200, 300].map((area, i) => ({ ...point(10 + i * 20), area }));
  tracker.update(fish, 0);
  assert.equal(tracker.sizeReference(200), null);
  tracker.update(fish, 200);
  assert.deepEqual(tracker.sizeReference(400), { area: 200, referenceTimestampMs: 200 });
  for (let time = 400; time <= 1200; time += 200) {
    tracker.update(fish.map(p => ({ ...p, splitFromBlob: true, area: 500 })), time);
    if (time < 1200) assert.equal(tracker.sizeReference(time + 200).area, 200);
  }
  assert.equal(tracker.sizeReference(1400), null);
});

test('frame 174 separates simultaneous merges including the X-shaped pair using observed fish sizes', async () => {
  const read = number => {
    const file = readFileSync(new URL(`./fixtures/${number === 'background' ? 'tank-background' : `frame-${number}`}.pgm`, import.meta.url));
    return file.subarray(Buffer.byteLength('P5\n420 330\n255\n') + 40 * 420);
  };
  async function run(trackFish) {
    let reads = 0, time = 0;
    const frames = [], duration = 1.41;
    const source = { seekTo: async seconds => { time = seconds; },
      readGray: () => reads++ < 3 ? read('background') : read(169 + Math.round(time * 5)) };
    const config = { method: 'background', expectedFish: 5, trackFish, preferCenter: true, intervalMs: 200,
      thresholdPx: 45.9, pixelsPerInch: 30.6, crop: { x: 50, y: 240, width: 420, height: 290 } };
    for await (const event of analyzeVideo({ config, duration, source })) if (event.frame) frames.push(event.frame);
    return frames;
  }
  const frames = await run(true), crossing = frames[5];
  assert.equal(crossing.detections.length, 5);
  const pair = crossing.detections.filter(p => p.sourceBlobArea === 456);
  assert.equal(pair.length, 2);
  assert.ok(pair.every(p => p.x > 125 && p.x < 165 && p.y > 355 && p.y < 400));
  const estimates = crossing.detections.filter(p => p.splitReason === 'recent-observed-size');
  assert.equal(estimates.length, 4);
  assert.ok(estimates.every(p => p.positionUncertain && p.splitSizeReferenceArea === 286 && p.splitReferenceTimestampMs === 800));
  assert.equal(crossing.metrics.uncertainPositionCount, 4);
  assert.equal(crossing.metrics.randomSpacingPercentile, null);
  assert.equal(crossing.rejectedDetections.length, 0);
  assert.ok(frames.slice(6).every(frame => frame.detections.length === 5));
  assert.match(detectionsCsv([crossing]), /split_size_reference_area_px/);
  assert.match(detectionsCsv([crossing]), /recent-observed-size/);
  assert.equal((await run(false))[5].detections.length, 3); // Reproduces the missed X without tracking.
  const noDeficit = detectBackgroundFish(read(174), read('background'), 420, 290, {
    expectedFish: 3, preferCenter: true, observedSizeReference: { area: 100, referenceTimestampMs: 800 }
  });
  assert.ok(noDeficit.every(p => p.splitReason !== 'recent-observed-size'));
});

function safariImage(name) {
  const file = readFileSync(new URL(`./fixtures/safari/${name}.pgm`, import.meta.url));
  const header = Buffer.from('P5\n420 290\n255\n');
  assert.deepEqual(file.subarray(0, header.length), header);
  return file.subarray(header.length);
}
async function safariSequence(trackFish) {
  const duration = 2.01, background = safariImage('tank-background');
  const backgroundReads = Math.ceil(duration * 2);
  let reads = 0, time = 0;
  const frames = [];
  const config = { method: 'background', trackFish, expectedFish: 5, preferCenter: true, intervalMs: 200,
    thresholdPx: 45.9, pixelsPerInch: 30.6, crop: { x: 50, y: 240, width: 420, height: 290 } };
  const source = { seekTo: async seconds => { time = seconds; },
    readGray: () => reads++ < backgroundReads ? background : safariImage(`frame-${580 + Math.round(time * 5)}`) };
  for await (const event of analyzeVideo({ source, duration, config })) if (event.frame) frames.push(event.frame);
  return frames;
}

test('Safari frames 584–587 retain five real fish, with tracked overlap estimates and export provenance', async () => {
  const frames = await safariSequence(true);
  for (const number of [584, 585, 586, 587]) {
    const frame = frames[number - 580];
    assert.equal(frame.detections.length, 5);
    assert.ok(frame.detections.every(p => p.x < 390), `frame ${number} retained a wall reflection`);
  }
  const frame587 = frames[7];
  const estimates = frame587.detections.filter(p => p.splitReason === 'tracking-overlap');
  assert.equal(estimates.length, 2);
  assert.ok(estimates.every(p => p.positionUncertain && p.positionSource === 'overlap-estimate' && p.trackId));
  assert.equal(frame587.metrics.uncertainPositionCount, 2);
  assert.ok(estimates.some(p => p.trackReacquiredTimestampMs > frame587.timestampMs));
  assert.ok(frames[9].detections.some(p => estimates.some(estimate => p.trackId === estimate.trackId)));
  for (const output of [detectionsCsv(frames), sharpnessCsv(frames, new Map())]) {
    assert.match(output, /track_id/); assert.match(output, /position_uncertain/);
    assert.match(output, /tracking-overlap/); assert.match(output, /track_reacquired_timestamp_ms/);
  }
  assert.match(framesCsv(frames), /uncertainPositionCount/);
  const disabled = await safariSequence(false);
  assert.ok(disabled[7].detections.some(p => p.x > 390)); // Reproduces the browser failure without tracking.
  assert.ok(disabled.every(frame => frame.detections.every(p => p.trackId === undefined)));
});
