import test from 'node:test';
import assert from 'node:assert/strict';
import { createVideoSource } from '../dist/video.mjs';

test('overlapping video requests wait for their own decoded frame', async () => {
  const previousDocument = globalThis.document;
  const previousAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.document = { createElement: () => ({ getContext: () => ({}) }) };
  globalThis.requestAnimationFrame = callback => queueMicrotask(callback);
  try {
    let time = 0;
    const video = new EventTarget();
    video.readyState = 2;
    Object.defineProperty(video, 'currentTime', {
      get: () => time,
      set(value) { time = value; queueMicrotask(() => video.dispatchEvent(new Event('seeked'))); }
    });
    const source = createVideoSource(video);
    const first = source.seekToDrawableFrame(9).then(() => video.currentTime);
    const second = source.seekTo(1).then(() => video.currentTime);
    assert.deepEqual(await Promise.all([first, second]), [9, 1]);
  } finally {
    globalThis.document = previousDocument;
    globalThis.requestAnimationFrame = previousAnimationFrame;
  }
});

test('frame PNG capture uses the requested original-video crop dimensions', async () => {
  const previousDocument = globalThis.document;
  const drawings = [];
  const canvases = [];
  globalThis.document = { createElement: () => {
    const canvas = { width: 0, height: 0,
      getContext: () => ({ drawImage: (...args) => drawings.push(args) }),
      toBlob: callback => callback(new Blob(['png'], { type: 'image/png' })) };
    canvases.push(canvas);
    return canvas;
  } };
  try {
    const video = { videoWidth: 540, videoHeight: 960 };
    const source = createVideoSource(video);
    const blob = await source.readPng({ x: 50, y: 240, width: 420, height: 290 });
    assert.equal(blob.type, 'image/png');
    assert.deepEqual([canvases[2].width, canvases[2].height], [420, 290]);
    assert.deepEqual(drawings[1].slice(1), [50, 240, 420, 290, 0, 0, 420, 290]);
  } finally {
    globalThis.document = previousDocument;
  }
});
