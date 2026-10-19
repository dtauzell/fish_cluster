import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFrame, cropFitsFrame, mapCanvasPoint, sampleTimes, summarizeFrames, normalizePredictions } from '../dist/analysis.mjs';

test('portrait preview maps its right edge to the full video width', () => {
  const rect = { left: 100, top: 50, width: 405, height: 720 };
  assert.deepEqual(mapCanvasPoint(505, 410, rect, 540, 960), { x: 540, y: 480 });
  assert.deepEqual(mapCanvasPoint(100, 50, rect, 540, 960), { x: 0, y: 0 });
  assert.equal(cropFitsFrame({ x: 380, y: 270, width: 150, height: 260 }, 540, 960), true);
  assert.equal(cropFitsFrame({ x: 420, y: 270, width: 150, height: 260 }, 540, 960), false);
});

test('sampling stops before the video ends', () => {
  assert.deepEqual(sampleTimes(0.65, 200), [0, 200, 400, 600]);
});

test('clusters count connected groups of two or more fish', () => {
  const detections = [{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 8, y: 4 }, { x: 100, y: 100 }];
  const metrics = analyzeFrame(detections, 5);
  assert.equal(metrics.clusterCount, 1);
  assert.equal(metrics.isolatedCount, 1);
  assert.equal(metrics.closeFishFraction, .75);
  assert.equal(metrics.pairCount, 6);
});

test('empty and single-fish frames do not invent distances', () => {
  assert.equal(analyzeFrame([], 10).meanPairDistancePx, null);
  assert.equal(analyzeFrame([{ x: 1, y: 1 }], 10).meanNearestDistancePx, null);
  assert.equal(summarizeFrames([{ metrics: analyzeFrame([], 10) }]).meanPairDistancePx, null);
});

test('only valid fish center coordinates are recorded', () => {
  const predictions = [{ class: 'zebrafish', bbox: { x: 10, y: 20, width: 5, height: 8 }, confidence: .8 }, { class: 'tank', x: 2, y: 2 }, { class: 'fish', x: 200, y: 2 }];
  assert.equal(normalizePredictions(predictions, 100, 100, .5).length, 1);
});

test('multiple Roboflow boxes remain separate fish', () => {
  const predictions = [
    { class: 'zebrafish', confidence: .4, bbox: { x: 25, y: 40, width: 12, height: 8 } },
    { class: 'zebrafish', confidence: .3, bbox: { x: 75, y: 60, width: 13, height: 7 } }
  ];
  assert.deepEqual(normalizePredictions(predictions, 100, 100, .15).map(p => p.x), [25, 75]);
});
