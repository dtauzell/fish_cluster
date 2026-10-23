import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrationFromLine, analyzeFrame, cropFitsFrame, inchesToPixels, mapCanvasPoint, matchPointsWithin, nearestNeighborLinks, sampleTimes, summarizeFrames, normalizePredictions, randomSpacingReference, spacingPercentile } from '../dist/analysis.mjs';

test('nearest links include each fish and draw mutual nearest pairs once', () => {
  const points = [{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 14 }];
  assert.deepEqual(nearestNeighborLinks(points), [
    { from: 0, to: 1, distancePx: 5 },
    { from: 1, to: 2, distancePx: 10 }
  ]);
  assert.deepEqual(nearestNeighborLinks([]), []);
  assert.deepEqual(nearestNeighborLinks([{ x: 0, y: 0 }]), []);
  assert.deepEqual(nearestNeighborLinks([{ x: 1, y: 1 }, { x: 1, y: 1 }]), [{ from: 0, to: 1, distancePx: 0 }]);
});

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
  assert.deepEqual(metrics.groupSizes, [3, 1]);
  assert.deepEqual(metrics.groupIds, [0, 0, 0, 1]);
});

test('group sizes change when the distance threshold joins groups', () => {
  const fish = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 20, y: 0 }, { x: 22, y: 0 }];
  assert.deepEqual(analyzeFrame(fish, 3).groupSizes, [2, 2]);
  assert.deepEqual(analyzeFrame(fish, 18).groupSizes, [4]);
});

test('inch threshold uses the entered half-inch grid calibration', () => {
  const fish = [{ x: 0, y: 0 }, { x: 31, y: 0 }];
  assert.equal(inchesToPixels(1, 15.3), 30.6);
  assert.equal(analyzeFrame(fish, inchesToPixels(1, 15.3)).clusterCount, 0);
  assert.equal(analyzeFrame(fish, inchesToPixels(1.02, 15.3)).clusterCount, 1);
});

test('manual center matching is one-to-one and finds the best assignment', () => {
  const manual = [{ x: 0, y: 0 }, { x: 4, y: 0 }];
  const automatic = [{ x: 2, y: 0 }, { x: -2, y: 0 }];
  assert.equal(matchPointsWithin(manual, automatic, 3), 2);
  assert.equal(matchPointsWithin(manual, automatic, 1), 0);
});

test('random spacing comparison is reproducible and recognizes tight spacing', () => {
  const crop = { width: 100, height: 100 };
  const reference = randomSpacingReference(5, crop);
  assert.deepEqual(reference, randomSpacingReference(5, crop));
  assert.equal(reference.length, 399);
  assert.ok(spacingPercentile(0, reference) <= .05);
  assert.ok(spacingPercentile(200, reference) > .95);
  assert.equal(randomSpacingReference(1, crop), null);
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

test('line calibration uses video pixels for horizontal, vertical, and reversed diagonal lines', () => {
  assert.equal(calibrationFromLine({x:0,y:0}, {x:153,y:0}, 5).gridPixels, 15.3);
  assert.equal(calibrationFromLine({x:10,y:110}, {x:10,y:10}, 2).pixelsPerInch, 50);
  const rect = {left:10, top:20, width:200, height:200};
  const start = mapCanvasPoint(110, 120, rect, 400, 400);
  const end = mapCanvasPoint(50, 40, rect, 400, 400);
  const scale = calibrationFromLine(start, end, 2);
  assert.equal(scale.distancePx, 200);
  assert.equal(scale.gridPixels, 50);
  assert.equal(inchesToPixels(2, scale.gridPixels), 200);
});

test('line calibration rejects missing, zero-length, and invalid measurements', () => {
  const start = {x:0,y:0}, end = {x:100,y:0};
  for (const length of [0, -1, NaN, Infinity]) assert.throws(() => calibrationFromLine(start, end, length));
  assert.throws(() => calibrationFromLine(start, start, 1));
  assert.throws(() => calibrationFromLine(null, end, 1));
  assert.throws(() => calibrationFromLine(start, {x:Infinity,y:0}, 1));
});
