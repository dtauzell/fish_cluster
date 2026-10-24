import test from 'node:test';
import assert from 'node:assert/strict';
import { createLabeling } from '../dist/labeling-ui.mjs';
import { createLabelProject } from '../dist/label-data.mjs';
import { labelProgressJson } from '../dist/label-export.mjs';

class Control extends EventTarget {
  constructor() {
    super();
    Object.assign(this, { classList: { toggle() {} }, parentElement: {}, hidden: false,
      disabled: false, checked: false, value: '', files: [] });
  }
  getContext() { return {}; }
  querySelectorAll() { return []; }
  replaceChildren() {}
}

test('a label import finishing after a project switch cannot replace the new project’s records', async () => {
  const controls = new Map();
  const $ = id => {
    if (!controls.has(id)) controls.set(id, new Control());
    return controls.get(id);
  };
  $('label-page').hidden = true;
  const previousDocument = globalThis.document;
  const previousResizeObserver = globalThis.ResizeObserver;
  const previousCreateImageBitmap = globalThis.createImageBitmap;
  globalThis.document = Object.assign(new EventTarget(), { getElementById: $ });
  globalThis.ResizeObserver = class { observe() {} };
  globalThis.createImageBitmap = async () => ({ close() {} });
  try {
    const config = name => ({ video: { name, size: 1234, duration: 2, width: 1, height: 1 },
      crop: { x: 0, y: 0, width: 1, height: 1 }, intervalMs: 200 });
    const original = createLabelProject(config('original.mov'));
    const png = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA1sAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' });
    const backup = await labelProgressJson({ ...original, records: [
      { frameIndex: 0, timestampMs: 0, labeled: true, boxes: [], image: png }
    ] });
    let beginReplace;
    const replacing = new Promise(resolve => { beginReplace = resolve; });
    let finishReplace;
    const replaceGate = new Promise(resolve => { finishReplace = resolve; });
    const storage = { load: async () => [], saveProject: async () => {}, replace: async () => {
      beginReplace();
      await replaceGate;
    } };
    const labeling = createLabeling({ canvas: $('label-canvas'), source: {},
      queueSeek: async () => {}, isRunning: () => false, storageFactory: () => storage });
    await labeling.start(config('original.mov'));
    const input = $('label-progress-import');
    input.files = [{ text: async () => backup }];
    input.dispatchEvent(new Event('change'));
    await new Promise(resolve => setImmediate(resolve));
    assert.doesNotMatch($('label-status').textContent, /invalid|could not|wrong|failed/i);
    await replacing;
    await labeling.start(config('new.mov'));
    assert.equal($('label-progress').textContent, '0 of 10 frames labeled · 0 fish boxes');
    finishReplace();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal($('label-progress').textContent, '0 of 10 frames labeled · 0 fish boxes');
    assert.match($('label-source').textContent, /new\.mov/);
  } finally {
    globalThis.document = previousDocument;
    globalThis.ResizeObserver = previousResizeObserver;
    globalThis.createImageBitmap = previousCreateImageBitmap;
  }
});
