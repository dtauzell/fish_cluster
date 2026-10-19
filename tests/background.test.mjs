import test from 'node:test';
import assert from 'node:assert/strict';
import { detectBackgroundFish, medianBackground } from '../dist/background.mjs';

test('a median background removes fish at different positions', () => {
  const samples = [
    Uint8Array.from([20, 200, 200]),
    Uint8Array.from([200, 20, 200]),
    Uint8Array.from([200, 200, 20])
  ];
  assert.deepEqual([...medianBackground(samples)], [200, 200, 200]);
});

test('separate dark fish remain separate detections', () => {
  const width = 40, height = 30;
  const background = new Uint8Array(width * height).fill(200);
  const frame = background.slice();
  for (let y = 8; y < 11; y++) for (let x = 5; x < 16; x++) frame[y * width + x] = 80;
  for (let y = 18; y < 21; y++) for (let x = 23; x < 34; x++) frame[y * width + x] = 80;
  frame[3 * width + 3] = 80;
  const detections = detectBackgroundFish(frame, background, width, height, { minArea: 5, edgeX: 0, edgeY: 0 });
  assert.equal(detections.length, 2);
  assert.deepEqual(detections.map(d => Math.round(d.x)), [10, 28]);
});

test('known fish count splits a joined pair while preserving other fish', () => {
  const width = 120, height = 70;
  const background = new Uint8Array(width * height).fill(200);
  const frame = background.slice();
  const paint = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) frame[y * width + x] = 70;
  };
  paint(10, 14, 41, 24);
  paint(34, 23, 65, 33);
  paint(65, 12, 81, 19);
  paint(67, 37, 83, 44);
  paint(17, 47, 33, 54);
  const options = { minArea: 20, edgeX: 0, edgeY: 0 };
  assert.equal(detectBackgroundFish(frame, background, width, height, options).length, 4);
  const detections = detectBackgroundFish(frame, background, width, height, { ...options, expectedFish: 5 });
  assert.equal(detections.length, 5);
  assert.equal(detections.filter(d => d.splitFromBlob).length, 2);
  assert.ok(detections.filter(d => d.splitFromBlob).every(d => d.x >= 10 && d.x <= 65));
});

test('a fish against the top of the crop can be recovered', () => {
  const width = 120, height = 80;
  const background = new Uint8Array(width * height).fill(200);
  const frame = background.slice();
  const paint = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) frame[y * width + x] = 60;
  };
  paint(12, 5, 27, 16);
  paint(45, 26, 60, 33);
  paint(80, 27, 95, 34);
  paint(15, 50, 30, 57);
  paint(65, 51, 80, 58);
  const options = { minArea: 20, edgeX: 0, edgeTop: 18, edgeBottom: 0, expectedFish: 5 };
  assert.equal(detectBackgroundFish(frame, background, width, height, { ...options, recoverEdges: false }).length, 4);
  const detections = detectBackgroundFish(frame, background, width, height, options);
  assert.equal(detections.length, 5);
  assert.ok(detections.some(d => d.edgeRecovered && d.y < 20));
});
