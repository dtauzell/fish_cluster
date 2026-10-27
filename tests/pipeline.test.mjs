import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeVideo } from '../dist/pipeline.mjs';
import { createSettings } from '../dist/settings.mjs';

const crop = { x: 50, y: 100, width: 60, height: 40 };
const values = {
  intervalMs: 200, thresholdInches: 1, gridPixels: 15,
  expectedFish: 1
};
const config = createSettings(values, crop, 200, 200);

function tankSource(counts, duration = .65) {
  const seeks = [], references = Math.min(25, Math.max(1, Math.ceil(duration * 2)));
  let reads = 0;
  return { seeks, source: {
    seekTo: async time => { seeks.push(time); },
    readGray: () => {
      const pixels = new Uint8Array(crop.width * crop.height).fill(200);
      const sample = reads++ - references;
      if (sample >= 0) for (let fish = 0; fish < (counts[sample] ?? 0); fish++) {
        for (let y = 14; y < 24; y++) for (let x = 10 + fish * 22; x < 20 + fish * 22; x++) pixels[y * crop.width + x] = 60;
      }
      return pixels;
    }
  } };
}

async function collect(options) {
  const events = [];
  for await (const event of analyzeVideo(options)) events.push(event);
  return events;
}

test('count-filter skips retain complete frames for review with original sample identities', async () => {
  const io = tankSource([1, 2, 0, 2]);
  const events = (await collect({ ...io, config: { ...config, expectedFish: 2,
    filterExactCount: true, filterFrameCount: 2 }, duration: .65 })).filter(e => e.frame);
  assert.deepEqual(events.map(e => e.type), ['skipped', 'frame', 'skipped', 'frame']);
  assert.deepEqual(events.map(e => e.frame.frameIndex), [0, 1, 2, 3]);
  assert.deepEqual(events.map(e => e.frame.timestampMs), [0, 200, 400, 600]);
  assert.deepEqual(events.map(e => e.frame.detections.length), [1, 2, 0, 2]);
  assert.ok(events.every(e => e.frame.metrics && Array.isArray(e.frame.rejectedDetections)));
});

test('settings validate units and snapshot the selected crop', () => {
  const selected = { ...crop };
  const settings = createSettings(values, selected, 200, 200);
  selected.x = 0;
  assert.equal(settings.crop.x, 50);
  assert.equal(settings.thresholdPx, 30);
  assert.equal(settings.pixelsPerInch, 30);
  assert.throws(() => createSettings({ ...values, intervalMs: 0 }, crop, 200, 200), /interval/);
  assert.throws(() => createSettings({ ...values, expectedFish: 0 }, crop, 200, 200), /fish count/);
});

test('results retain the recording fish count independently of the inclusion override', () => {
  const settings = createSettings({ ...values, expectedFish: 8,
    filterExactCount: true, filterFrameCount: 3 }, crop, 200, 200);
  assert.equal(settings.expectedFish, 8);
  assert.equal(settings.filterFrameCount, 3);
});

test('background pipeline samples a tank, detects a region, and exports full-frame centers', async () => {
  let reads = 0;
  const seeks = [];
  const source = {
    seekTo: async time => { seeks.push(time); },
    readGray: () => {
      const pixels = new Uint8Array(crop.width * crop.height).fill(200);
      // First two reads build the background; later reads contain one moving region.
      if (reads++ >= 2) {
        for (let y = 15; y < 22; y++) {
          for (let x = 20; x < 35; x++) pixels[y * crop.width + x] = 60;
        }
      }
      return pixels;
    }
  };
  const events = await collect({ config, duration: .65, source });
  const frames = events.filter(event => event.type === 'frame').map(event => event.frame);
  assert.deepEqual(seeks, [.1625, .48750000000000004, 0, .2, .4, .6]);
  assert.deepEqual(frames.map(frame => frame.timestampMs), [0, 200, 400, 600]);
  assert.ok(frames.every(frame => frame.detections.length === 1));
  assert.equal(frames[0].detections[0].x, 77);
  assert.equal(frames[0].detections[0].y, 118);
  assert.equal(frames[0].metrics.countDifference, 0);
  assert.ok(frames[0].detections[0].sharpness > 0);
  assert.equal(events.at(-1).progress, 100);
});

test('cancellation retains completed frames and stops before another seek', async () => {
  const io = tankSource([1], 1);
  let stopped = false;
  const frames = [];
  for await (const event of analyzeVideo({ ...io, config, duration: 1, isStopped: () => stopped })) {
    if (event.type === 'frame') { frames.push(event.frame); stopped = true; }
  }
  assert.equal(frames.length, 1);
  assert.deepEqual(io.seeks, [.25, .75, 0]);
});

test('cancel during background preparation skips detection', async () => {
  let stopped = false;
  let reads = 0;
  const source = { seekTo: async () => {}, readGray: () => { reads++; return new Uint8Array(2400); } };
  for await (const event of analyzeVideo({ config, duration: 2, source, isStopped: () => stopped })) {
    assert.equal(event.type, 'status');
    stopped = true;
  }
  assert.equal(reads, 1);
});

test('video decoding failure preserves earlier yielded frames', async () => {
  const io = tankSource([1, 1]);
  const seek = io.source.seekTo;
  io.source.seekTo = async time => {
    if (time === .2) throw new Error('Could not decode frame');
    await seek(time);
  };
  const frames = [];
  await assert.rejects(async () => {
    for await (const event of analyzeVideo({ ...io, config, duration: .65 })) if (event.frame) frames.push(event.frame);
  }, /Could not decode frame/);
  assert.equal(frames.length, 1);
});

test('pipeline excludes masked fish while retaining original-video coordinates', async () => {
  const io = tankSource([2], .1);
  const events = await collect({ ...io, config: { ...config, expectedFish: 2,
    exclusions: [{ x: 55, y: 110, width: 20, height: 20 }] }, duration: .1 });
  assert.equal(events.at(-1).frame.detections.length, 1);
  assert.equal(events.at(-1).frame.detections[0].x, 86.5);
});

test('background pipeline translates masks to crop pixels and keeps recovery out of them', async () => {
  let reads = 0;
  const source = {
    seekTo: async () => {},
    readGray: () => {
      const pixels = new Uint8Array(crop.width * crop.height).fill(200);
      if (reads++ >= 1) {
        for (let y = 15; y < 22; y++) {
          for (let x = 20; x < 35; x++) pixels[y * crop.width + x] = 60;
        }
      }
      return pixels;
    }
  };
  const events = await collect({ config: { ...config,
    exclusions: [{ x: crop.x + 18, y: crop.y + 13, width: 20, height: 12 }] },
    duration: .1, source });
  assert.equal(events.at(-1).frame.detections.length, 0);
  assert.equal(events.at(-1).frame.metrics.countDifference, -1);
});

test('background center preference limits only excess candidates and retains scored rejects', async () => {
  function source() {
    let reads = 0;
    return { seekTo: async () => {}, readGray: () => {
      const image = new Uint8Array(crop.width * crop.height).fill(200);
      if (reads++ > 0) {
        for (const [x0, y0] of [[6, 17], [24, 17], [39, 6]]) {
          for (let y = y0; y < y0 + 7; y++) for (let x = x0; x < x0 + 13; x++) image[y * crop.width + x] = 60;
        }
      }
      return image;
    } };
  }
  const selected = (await collect({ config: { ...config, expectedFish: 2, preferCenter: true }, duration: .1, source: source() })).at(-1).frame;
  const original = (await collect({ config: { ...config, expectedFish: 2, preferCenter: false }, duration: .1, source: source() })).at(-1).frame;
  assert.equal(original.detections.length, 3);
  assert.equal(selected.rawPredictionCount, 3);
  assert.equal(selected.detections.length, 2);
  assert.equal(selected.rejectedDetections.length, 1);
  assert.ok(selected.rejectedDetections[0].sharpness > 0);
  assert.equal(selected.metrics.countDifference, 0);
  assert.equal(selected.metrics.randomSpacingPercentile, null);
  assert.ok(Number.isFinite(original.metrics.randomSpacingPercentile));
});
