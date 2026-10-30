import test from 'node:test';
import assert from 'node:assert/strict';
import { centimetersJson } from '../dist/json-units.mjs';
test('JSON converts nested results, speed intervals and thresholds while retaining inch calibration', () => {
 const input = { settings: { thresholdInches: 1, pixelsPerInch: 30.6, gridPixels: 15.3 },
  summary: { meanPairDistanceInches: 2, meanNearestDistanceInches: null },
  velocity: { pixelsPerInch: 30.6, averageInchesPerSecond: 3, intervals: [{ speedInchesPerSecond: 4, speedPxPerSecond: 122.4 }] },
  frames: [{ metrics: { meanPairDistanceInches: .5 } }],
  excludedFrames: [{ metrics: { meanPairDistanceInches: 0 } }] };
 const result = centimetersJson(input);
 assert.deepEqual(result.settings, { thresholdCentimeters: 2.54, pixelsPerInch: 30.6, gridPixels: 15.3 });
 assert.deepEqual(result.summary, { meanPairDistanceCentimeters: 5.08, meanNearestDistanceCentimeters: null });
 assert.equal(result.velocity.averageCentimetersPerSecond, 7.62);
 assert.equal(result.velocity.pixelsPerInch, 30.6);
 assert.deepEqual(result.velocity.intervals, [{ speedCentimetersPerSecond: 10.16, speedPxPerSecond: 122.4 }]);
 assert.equal(result.frames[0].metrics.meanPairDistanceCentimeters, 1.27);
 assert.equal(result.excludedFrames[0].metrics.meanPairDistanceCentimeters, 0);
 assert.equal(input.settings.thresholdInches, 1);
 assert.ok(!JSON.stringify(result).includes('Inches'));
});
