import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestChooser } from '../dist/test-chooser.mjs';

class Button extends EventTarget { click() { this.dispatchEvent(new Event('click')); } }
function harness(approve = true) {
  const original = { detections: [{ x: 10, y: 20 }], manualCorrectionApplied: true };
  const state = { testType: 'shoaling', running: false, settings: { thresholdInches: 1.5 },
    reviewFrames: [original], human: { marks: new Map([[0, [{ x: 10, y: 20 }]]]), reviewed: new Set([0]) } };
  const dialog = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  const trigger = new Button(), choices = { shoaling: new Button(), 'light-dark': new Button() };
  let confirmations = 0, changes = 0;
  const chooser = createTestChooser({ state, dialog, trigger, choices,
    confirmChange: () => { confirmations++; return approve; },
    apply: next => { changes++; state.testType = next; state.reviewFrames = []; state.settings = null;
      state.human = { marks: new Map(), reviewed: new Set() }; } });
  return { state, dialog, trigger, choices, chooser, original, confirmations: () => confirmations, changes: () => changes };
}

test('opening and cancelling Change test preserves analyzed frames, settings, and corrections', () => {
  const app = harness();
  const settings = app.state.settings, marks = app.state.human.marks;
  app.trigger.click();
  assert.equal(app.dialog.open, true);
  app.dialog.close(); // Native Cancel or Escape closes the dialog.
  assert.equal(app.state.testType, 'shoaling');
  assert.equal(app.state.settings, settings);
  assert.equal(app.state.reviewFrames[0], app.original);
  assert.equal(app.state.human.marks, marks);
  assert.equal(app.state.human.reviewed.has(0), true);
  assert.equal(app.confirmations(), 0);
  assert.equal(app.changes(), 0);
});

test('keeping the same test closes the chooser and preserves all review work', () => {
  const app = harness();
  app.trigger.click();
  app.choices.shoaling.click();
  assert.equal(app.dialog.open, false);
  assert.equal(app.state.reviewFrames[0], app.original);
  assert.equal(app.state.human.marks.size, 1);
  assert.equal(app.confirmations(), 0);
  assert.equal(app.changes(), 0);
});

test('declining a different test keeps the chooser and current review intact', () => {
  const app = harness(false);
  app.trigger.click();
  app.choices['light-dark'].click();
  assert.equal(app.dialog.open, true);
  assert.equal(app.state.reviewFrames[0], app.original);
  assert.equal(app.state.testType, 'shoaling');
  assert.equal(app.state.human.reviewed.has(0), true);
  assert.equal(app.confirmations(), 1);
  assert.equal(app.changes(), 0);
});

test('only confirming a different test commits the switch and clears the old session', () => {
  const app = harness();
  app.trigger.click();
  app.choices['light-dark'].click();
  assert.equal(app.dialog.open, false);
  assert.equal(app.state.testType, 'light-dark');
  assert.equal(app.state.reviewFrames.length, 0);
  assert.equal(app.state.human.marks.size, 0);
  assert.equal(app.confirmations(), 1);
  assert.equal(app.changes(), 1);
});

test('initial choice requires no confirmation and a running analysis cannot change test', () => {
  const app = harness();
  app.state.testType = null; app.state.reviewFrames = []; app.state.human.marks.clear(); app.state.human.reviewed.clear();
  assert.equal(app.chooser.select('light-dark'), true);
  assert.equal(app.confirmations(), 0);
  app.state.running = true;
  app.trigger.click();
  assert.equal(app.dialog.open, false);
  assert.equal(app.chooser.select('shoaling'), false);
  assert.equal(app.state.testType, 'light-dark');
});
