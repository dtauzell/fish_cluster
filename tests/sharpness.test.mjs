import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateSharpness, summarizeSharpnessLabels } from '../dist/sharpness.mjs';
import { detectionsCsv, sharpnessCsv, exportedSharpnessLabels } from '../dist/exports.mjs';

const width = 64, height = 48;
const candidate = { x: 32, y: 24, width: 20, height: 10 };
function fishImage() {
  const pixels = new Uint8Array(width * height).fill(200);
  for (let y = 19; y < 29; y++) for (let x = 22; x < 42; x++) pixels[y * width + x] = 60;
  return pixels;
}
function blur(pixels) {
  const result = pixels.slice();
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    let sum = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += pixels[(y + dy) * width + x + dx];
    result[y * width + x] = Math.round(sum / 9);
  }
  return result;
}

test('sharp outlines score above blurred versions of the same image', () => {
  const image = fishImage();
  const softened = blur(blur(image));
  const sharp = candidateSharpness(image, width, height, candidate);
  const blurry = candidateSharpness(softened, width, height, candidate);
  assert.ok(sharp.sharpness > blurry.sharpness * 3);
  assert.ok(sharp.localContrast > 0);
  assert.equal(sharp.sharpnessClipped, false);
  assert.ok(sharp.sharpnessPixelCount > 9);
  assert.deepEqual(image, fishImage()); // Scoring must not alter the detector's pixels.
});

test('flat patches score zero; tiny patches and missing boxes remain unavailable', () => {
  const flat = candidateSharpness(new Uint8Array(width * height).fill(100), width, height, candidate);
  assert.equal(flat.sharpness, 0);
  assert.equal(flat.localContrast, 0);
  assert.equal(candidateSharpness(new Uint8Array(9), 3, 3, { x: 1, y: 1, width: 1, height: 1 }).sharpness, null);
  assert.equal(candidateSharpness(fishImage(), width, height, { x: 32, y: 24 }).sharpness, null);
  assert.throws(() => candidateSharpness(new Uint8Array(3), width, height, candidate), /dimensions/);
});

test('brightness offsets preserve sharpness; contrast changes affect it', () => {
  const image = fishImage();
  const shifted = image.map(value => value - 20);
  const lowerContrast = image.map(value => 100 + (value - 100) / 2);
  const original = candidateSharpness(image, width, height, candidate);
  assert.equal(candidateSharpness(shifted, width, height, candidate).sharpness, original.sharpness);
  assert.equal(candidateSharpness(lowerContrast, width, height, candidate).sharpness, original.sharpness / 4);
});

test('crop and mask clipping are flagged; excluded pixels do not introduce edges', () => {
  const image = new Uint8Array(width * height).fill(200);
  const edge = { ...candidate, x: 1 };
  assert.equal(candidateSharpness(image, width, height, edge).sharpnessClipped, true);
  const masks = [{ x: 30, y: 0, width: 34, height }];
  const before = candidateSharpness(image, width, height, candidate, masks);
  for (let y = 0; y < height; y++) for (let x = 30; x < width; x++) image[y * width + x] = (x + y) % 2 * 255;
  const after = candidateSharpness(image, width, height, candidate, masks);
  assert.deepEqual(after, before);
  assert.equal(after.sharpness, 0);
  assert.equal(after.sharpnessClipped, true);
  assert.equal(candidateSharpness(image, width, height, candidate, [{ x: 0, y: 0, width, height }]).sharpness, null);
});

test('labeled summaries use frame-local IDs and do not infer a cutoff', () => {
  const frames = [
    { frameIndex: 0, detections: [{ detectionId: 1, sharpness: 10 }, { detectionId: 2, sharpness: 2 }] },
    { frameIndex: 1, detections: [{ detectionId: 1, sharpness: 20 }, { detectionId: 2, sharpness: null }] }
  ];
  const labels = new Map([[0, new Map([[1, 'fish'], [2, 'reflection']])], [1, new Map([[1, 'fish'], [2, 'reflection']])]]);
  assert.deepEqual(summarizeSharpnessLabels(frames, labels), { fish: { count: 2, median: 15 }, reflection: { count: 1, median: 2 } });
  assert.equal(frames[0].detections.length, 2);
  assert.deepEqual(exportedSharpnessLabels(labels), [
    { frameIndex: 0, detectionId: 1, label: 'fish' }, { frameIndex: 0, detectionId: 2, label: 'reflection' },
    { frameIndex: 1, detectionId: 1, label: 'fish' }, { frameIndex: 1, detectionId: 2, label: 'reflection' }
  ]);
});

test('CSV exports retain scores, flags, null values and labels without removing candidates', () => {
  const frame = { frameIndex: 0, timestampMs: 87200,
    metrics: { groupIds: [0, 1], groupSizes: [1, 1] }, detections: [
      { detectionId: 1, x: 30, y: 20, sharpness: 15.25, localContrast: 22, sharpnessPixelCount: 50, sharpnessClipped: true },
      { detectionId: 2, x: 40, y: 30, sharpness: null, localContrast: null, sharpnessPixelCount: 0, sharpnessClipped: false }
    ] };
  const labels = new Map([[0, new Map([[1, 'reflection']])]]);
  const csv = sharpnessCsv([frame], labels);
  const [columns, first, second] = csv.split('\r\n').map(line => line.split(',').map(cell => cell.slice(1, -1)));
  const record = Object.fromEntries(columns.map((key, index) => [key, first[index]]));
  assert.equal(record.sharpness, '15.25');
  assert.equal(record.human_label, 'reflection');
  assert.equal(record.sharpness_clipped, 'true');
  assert.equal(second[columns.indexOf('sharpness')], '');
  assert.equal(second[columns.indexOf('human_label')], '');
  assert.match(detectionsCsv([frame]), /sharpness_pixel_count/);
  assert.equal(frame.detections.length, 2);
});
