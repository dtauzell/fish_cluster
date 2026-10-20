import test from 'node:test';
import assert from 'node:assert/strict';
import { createLabelProject, labelBoxAt, validLabelBox, editLabelRecord, completedLabelRecords,
  labelManifest, yoloLabels, validateLabelProject } from '../dist/label-data.mjs';
import { importLabelProgress, labelDatasetZip, labelProgressJson } from '../dist/label-export.mjs';
import { createZip } from '../dist/zip.mjs';

const config = { video: { name: 'tank.mov', size: 1234, duration: 2, width: 540, height: 960 },
  crop: { x: 50, y: 200, width: 420, height: 330 }, intervalMs: 200 };
const project = () => createLabelProject(config);
const png = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA1sAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' });
const box = { id: 1, x: 10, y: 20, width: 30, height: 40 };

// Read stored ZIP entries with the published file-header layout; CRC has a known-vector check below.
async function zipEntries(blob) {
  const bytes = Buffer.from(await blob.arrayBuffer()), files = new Map();
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(bytes.readUInt16LE(offset + 8), 0);
    const length = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28), start = offset + 30 + nameLength + extraLength;
    files.set(bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8'), bytes.subarray(start, start + length));
    offset = start + length;
  }
  assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
  assert.equal(bytes.readUInt32LE(bytes.length - 22), 0x06054b50);
  assert.equal(bytes.readUInt16LE(bytes.length - 12), files.size);
  return files;
}

test('label projects are independent of analysis and distinguish video, crop, and interval', () => {
  const first = project();
  assert.equal(first.frameCount, 10);
  assert.equal(first.id, project().id);
  assert.notEqual(first.id, createLabelProject({ ...config, intervalMs: 1000 }).id);
  assert.notEqual(first.id, createLabelProject({ ...config, crop: { ...config.crop, y: 240, height: 290 } }).id);
  assert.notEqual(first.id, createLabelProject({ ...config, video: { ...config.video, name: 'another.mov' } }).id);
  assert.throws(() => createLabelProject({ ...config, intervalMs: 0 }), /interval/);
  assert.throws(() => createLabelProject({ ...config, crop: { ...config.crop, x: 500 } }), /inside/);
});

test('fish boxes clip to crop edges and YOLO uses normalized crop-local geometry', () => {
  const crop = { width: 100, height: 80 };
  const edge = labelBoxAt(99, 79, 30, 20, crop, 2);
  assert.deepEqual(edge, { id: 2, x: 70, y: 60, width: 30, height: 20 });
  assert.equal(validLabelBox(edge, crop), true);
  assert.equal(yoloLabels([edge], crop), '0 0.85000000 0.87500000 0.30000000 0.25000000\n');
  assert.equal(yoloLabels([], crop), '');
  assert.deepEqual(labelBoxAt(0, 0, 200, 200, crop, 1), { id: 1, x: 0, y: 0, width: 100, height: 80 });
  assert.throws(() => yoloLabels([{ ...edge, width: 31 }], crop), /outside/);
});

test('editing a completed frame invalidates completion without mutating its previous snapshot', () => {
  const record = { frameIndex: 0, timestampMs: 0, labeled: true, boxes: [box], image: png };
  const edited = editLabelRecord(record, [{ ...box, width: 50 }]);
  assert.equal(edited.labeled, false);
  assert.equal(record.labeled, true);
  assert.equal(record.boxes[0].width, 30);
  assert.equal(edited.image, png);
});

test('dataset exports only explicitly labeled frames, including empty negative examples', async () => {
  const data = { ...project(), records: [
    { frameIndex: 0, timestampMs: 0, labeled: true, boxes: [box, { ...box, id: 2 }], image: png },
    { frameIndex: 2, timestampMs: 400, labeled: false, boxes: [box], image: png },
    { frameIndex: 4, timestampMs: 800, labeled: true, boxes: [], image: png }
  ] };
  const records = completedLabelRecords(data);
  assert.deepEqual(records.map(record => record.frameIndex), [0, 4]);
  const manifest = labelManifest(data, records);
  assert.equal(manifest.frames[0].boxes[0].center_video_x, 75);
  assert.equal(manifest.frames[0].boxes[0].center_video_y, 240);
  const files = await zipEntries(await labelDatasetZip(data));
  assert.equal([...files.keys()].filter(name => name.startsWith('images/')).length, 2);
  assert.ok([...files.keys()].every(name => !name.includes('frame-000003')));
  const labels = [...files].filter(([name]) => name.endsWith('.txt') && name.startsWith('labels/'));
  assert.equal(labels[0][1].toString().trim().split('\n').length, 2);
  assert.equal(labels[1][1].length, 0);
  assert.deepEqual([...files].find(([name]) => name.startsWith('images/'))[1], Buffer.from(await png.arrayBuffer()));
  assert.equal(JSON.parse(files.get('annotations.json')).frames.length, 2);
  assert.equal(files.get('classes.txt').toString(), 'fish\n');
  assert.ok(files.has('data.yaml'));
  await assert.rejects(labelDatasetZip({ ...data, records: [] }), /at least one/);
  assert.throws(() => completedLabelRecords({ ...data, records: [{ ...data.records[0], image: null }] }), /no saved image/);
});

test('portable progress round-trips exact images, draft boxes, and labeled empty frames', async () => {
  const metadata = createLabelProject({ ...config, crop: { x: 50, y: 200, width: 1, height: 1 } });
  const data = { ...metadata, records: [
    { frameIndex: 0, timestampMs: 0, labeled: false, boxes: [{ id: 1, x: 0, y: 0, width: 1, height: 1 }], image: png },
    { frameIndex: 4, timestampMs: 800, labeled: true, boxes: [], image: png }
  ] };
  const text = await labelProgressJson(data);
  const restored = importLabelProgress(text, metadata);
  assert.deepEqual(restored.records.map(record => [record.frameIndex, record.labeled]), [[0, false], [4, true]]);
  assert.deepEqual(restored.records[0].boxes, data.records[0].boxes);
  assert.deepEqual(await restored.records[0].image.arrayBuffer(), await png.arrayBuffer());
  assert.throws(() => importLabelProgress(text, project()), /different video, crop/);
  assert.throws(() => importLabelProgress('broken', metadata), /valid JSON/);
  assert.throws(() => importLabelProgress(text.replace('data:image/png;base64,', 'data:text/plain;base64,'), metadata), /image is invalid/);
  const missing = JSON.parse(text); missing.records[0].imageDataUrl = null;
  assert.throws(() => importLabelProgress(JSON.stringify(missing), metadata), /no saved image/);
});

test('invalid progress cannot replace annotations or silently label duplicate or out-of-range frames', () => {
  const data = { ...project(), records: [{ frameIndex: 0, timestampMs: 0, labeled: true, boxes: [box] }] };
  for (const record of [
    { ...data.records[0], frameIndex: 100 }, { ...data.records[0], timestampMs: null },
    { ...data.records[0], timestampMs: 200 }, { ...data.records[0], labeled: 'yes' },
    { ...data.records[0], boxes: [box, box] }, { ...data.records[0], boxes: [{ ...box, x: -1 }] }
  ]) assert.throws(() => validateLabelProject({ ...data, records: [record] }, project()), /invalid frame or fish box/);
  assert.throws(() => validateLabelProject({ ...data, records: [data.records[0], data.records[0]] }, project()), /invalid frame/);
});

test('ZIP has standard CRC, UTF-8 names, empty files, and rejects duplicate paths', async () => {
  const blob = await createZip([{ name: 'fish.txt', content: 'hello' }, { name: 'empty.txt', content: '' },
    { name: 'poisson-é.txt', content: new Uint8Array([1, 2, 3]) }]);
  const bytes = Buffer.from(await blob.arrayBuffer());
  assert.equal(bytes.readUInt32LE(14), 0x3610a686); // Published CRC-32 check value for "hello".
  assert.equal(bytes.readUInt16LE(6), 0x0800);
  const files = await zipEntries(blob);
  assert.equal(files.get('fish.txt').toString(), 'hello');
  assert.equal(files.get('empty.txt').length, 0);
  assert.deepEqual(files.get('poisson-é.txt'), Buffer.from([1, 2, 3]));
  await assert.rejects(createZip([{ name: '../escape', content: '' }]), /filename/);
  await assert.rejects(createZip([{ name: 'same', content: '' }, { name: 'same', content: '' }]), /filename/);
});
