import test from 'node:test';
import assert from 'node:assert/strict';
import { centimetersCsv } from '../dist/csv-units.mjs';
import { recordsCsv } from '../dist/experiment-storage.mjs';
import { lightDarkSummaryCsv } from '../dist/exports.mjs';

test('CSV converts physical values and column names without changing pixels, nulls, or source data', () => {
  const row = { meanPairDistanceInches: 2, speed_inches_per_second: 3, close_distance_inches: .5, x_px: 12, meanNearestDistanceInches: null };
  const text = centimetersCsv([row]);
  assert.equal(text, '"meanPairDistanceCentimeters","speed_centimeters_per_second","close_distance_centimeters","x_px","meanNearestDistanceCentimeters"\r\n"5.08","7.62","1.27","12",""');
  assert.equal(row.meanPairDistanceInches, 2);
});
test('trial CSV converts mean speeds while retaining sample counts', () => {
  const text = recordsCsv([{ averageSpeedInchesPerSecondMean: 2, averageSpeedInchesPerSecondN: 10 }]);
  assert.equal(text, '"averageSpeedCentimetersPerSecondMean","averageSpeedCentimetersPerSecondN"\r\n"5.08","10"');
});
test('Light / Dark summary exports speed in centimeters per second', () => {
  const text = lightDarkSummaryCsv({ averageSpeedInchesPerSecond: 2, averageSpeedPxPerSecond: 40 });
  const [head, row] = text.split('\r\n').map(line => line.split(',').map(cell => cell.slice(1,-1)));
  assert.equal(row[head.indexOf('averageSpeedCentimetersPerSecond')], '5.08');
  assert.equal(row[head.indexOf('averageSpeedPxPerSecond')], '40');
  assert.ok(!text.includes('Inches'));
});
