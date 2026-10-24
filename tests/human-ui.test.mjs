import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHumanReview } from '../dist/human-ui.mjs';
import { frameMetrics } from '../dist/measurements.mjs';
import { framePassesCountFilter } from '../dist/frame-selection.mjs';

// Event-capable controls let the real controller run without decoding video or painting pixels.
class Control extends EventTarget {
  constructor() {
    super();
    Object.assign(this, { style: {}, dataset: {}, hidden: false, disabled: false,
      checked: false, open: false, value: '', clientWidth: 600, clientHeight: 400,
      options: [{}, {}, {}], attributes: new Map() });
  }
  click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
  setAttribute(key, value) { this.attributes.set(key, value); }
  closest(selector) { return selector === 'label' ? this : null; }
  querySelectorAll() { return []; }
  querySelector() { return new Control(); }
  focus() {}
  scrollIntoView() {}
  getBoundingClientRect() {
    return { left: 0, top: 0, width: parseFloat(this.style.width) || 400,
      height: parseFloat(this.style.height) || 400 };
  }
  getContext() {
    return new Proxy({ measureText: text => ({ width: text.length * 7 }) }, {
      get: (context, key) => context[key] ?? (() => {})
    });
  }
}

async function withReview(run) {
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  const controls = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(match => [match[1], new Control()]));
  const $ = id => {
    assert.ok(controls.has(id), `Control ${id} exists in the page`);
    return controls.get(id);
  };
  const saved = Object.fromEntries(['document', 'window', 'ResizeObserver'].map(key => [key, globalThis[key]]));
  const document = new Control();
  document.getElementById = $;
  Object.assign(globalThis, { document, window: Object.assign(new Control(), { devicePixelRatio: 1 }),
    ResizeObserver: class { observe() {} } });
  try {
    const settings = { method: 'background', expectedFish: 2, filterExactCount: false,
      thresholdPx: 15, pixelsPerInch: 30, crop: { x: 0, y: 0, width: 100, height: 100 }, exclusions: [] };
    const frames = Array.from({ length: 3 }, (_, frameIndex) => {
      const detections = [{ detectionId: 1, x: 20, y: 20 }, { detectionId: 2, x: 40, y: 20 }];
      return { frameIndex, timestampMs: frameIndex * 200, detections, rejectedDetections: [],
        metrics: frameMetrics(detections, settings) };
    });
    const state = { settings, reviewFrames: frames, frames: [...frames], running: false, previewToken: 0,
      human: { index: null, marks: new Map(), candidateLabels: new Map(), reviewed: new Set(), loading: false } };
    let changes = 0;
    const downloadedFrames = [];
    const review = createHumanReview({ state, video: { videoWidth: 100, videoHeight: 100 },
      humanCanvas: $('human-canvas'), queuePreviewSeek: async (_token, _time, render) => render(),
      downloadFramePng: async (frame, view, fullFrame) => downloadedFrames.push({ frame, view, fullFrame }),
      onFrameSelected() {}, onFrameCorrected() {
        changes++;
        state.frames = state.reviewFrames.filter(frame => framePassesCountFilter(frame, settings));
        review.refresh();
      } });
    const edit = value => {
      $('human-edit-centers').checked = value;
      $('human-edit-centers').dispatchEvent(new Event('change'));
    };
    const addCenter = () => {
      const event = new Event('click');
      Object.assign(event, { clientX: 320, clientY: 320 });
      $('human-canvas').dispatchEvent(event);
    };
    await run({ $, state, review, edit, addCenter, changes: () => changes, downloadedFrames, document });
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
}

test('Done applies pending edits, Apply & stay keeps selection, and completion requires all frames', async () => {
  await withReview(async ({ $, state, review, edit, addCenter, changes, document }) => {
    await review.selectHumanFrame(0);
    edit(true);
    assert.equal($('human-apply-centers').hidden, true);
    $('human-done').click();
    assert.equal(state.human.index, 1);
    assert.equal(changes(), 0, 'accepting unchanged detections does not invent a manual correction');
    assert.equal(state.human.reviewed.has(0), true);
    assert.equal($('human-edit-centers').checked, true);

    addCenter();
    assert.equal($('human-apply-centers').hidden, false);
    edit(false); // A retained draft must still be applied by Done.
    $('human-done').click();
    assert.equal(state.human.index, 2);
    assert.equal(changes(), 1);
    assert.equal(state.reviewFrames[1].detections.length, 3);
    assert.equal(state.reviewFrames[1].automaticDetections.length, 2);
    assert.equal(state.human.reviewed.has(1), true);

    edit(true);
    $('human-clear').click();
    $('human-apply-centers').click();
    assert.equal(state.human.index, 2, 'Apply & stay does not advance');
    assert.equal(state.reviewFrames[2].detections.length, 0, 'an explicitly empty correction is applied');
    assert.equal(changes(), 2);
    assert.equal($('human-apply-centers').hidden, true);
    assert.match($('human-edit-status').textContent, /Correction applied/);
    assert.equal($('human-review-complete').hidden, false);
    assert.equal($('human-done').disabled, true);
    assert.equal($('human-progress').textContent, '3 of 3 frames done in this view');

    addCenter();
    assert.equal(state.human.reviewed.has(2), false);
    assert.equal($('human-review-complete').hidden, true);
    assert.equal($('human-done').disabled, false);
    const doneKey = new Event('keydown', { cancelable: true });
    Object.assign(doneKey, { key: 'r' });
    document.dispatchEvent(doneKey);
    assert.equal(state.reviewFrames[2].detections.length, 1, 'R uses the same apply-and-done action');
    assert.equal($('human-review-complete').hidden, false);

    $('human-restore-auto').click();
    const afterRestore = changes();
    assert.equal(state.reviewFrames[2].detections.length, 2);
    $('human-done').click();
    assert.equal(changes(), afterRestore, 'Done must not silently reapply a correction after Restore');
    assert.equal(state.reviewFrames[2].manualCorrectionApplied, undefined);
    assert.equal($('human-review-complete').hidden, false);

    await review.selectHumanFrame(0);
    $('human-reviewed').click();
    await review.selectHumanFrame(2);
    $('human-done').click();
    assert.equal(state.human.index, 0, 'finishing at the last frame returns to an earlier unfinished frame');
    $('human-done').click();
    assert.equal($('human-review-complete').hidden, false);
  });
});

test('download exports the selected sample using the current crop or full-frame view', async () => {
  await withReview(async ({ $, state, review, downloadedFrames }) => {
    await review.selectHumanFrame(1);
    $('human-download-frame').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(downloadedFrames.length, 1);
    assert.equal(downloadedFrames[0].frame, state.reviewFrames[1]);
    assert.deepEqual(downloadedFrames[0].view, state.settings.crop);
    assert.equal(downloadedFrames[0].fullFrame, false);
    assert.match($('human-download-status').textContent, /sample 2 PNG/);

    $('human-show-full').checked = true;
    $('human-download-frame').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(downloadedFrames[1].view, { x: 0, y: 0, width: 100, height: 100 });
    assert.equal(downloadedFrames[1].fullFrame, true);
    await review.selectHumanFrame(2);
    assert.equal($('human-download-status').textContent, '');
  });
});
