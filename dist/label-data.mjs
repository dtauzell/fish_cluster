import { sampleTimes } from './analysis.mjs';
import { baseName } from './exports.mjs';

/** Label geometry uses pixels relative to the clean exported crop, not the preview size. */
export function createLabelProject({ video, crop, intervalMs }) {
  if (!Number.isInteger(intervalMs) || intervalMs < 1) throw new Error('Choose a positive frame interval.');
  if (![video.width, video.height, video.duration, video.size].every(Number.isFinite) || video.duration <= 0) {
    throw new Error('Load a readable video before labeling.');
  }
  if (![crop.x, crop.y, crop.width, crop.height].every(Number.isInteger) || crop.x < 0 || crop.y < 0 ||
    crop.width < 1 || crop.height < 1 || crop.x + crop.width > video.width || crop.y + crop.height > video.height) {
    throw new Error('The labeling crop must be inside the video.');
  }
  const identity = JSON.stringify([video.name, video.size, video.width, video.height, video.duration, crop, intervalMs]);
  let hash = 2166136261;
  for (const character of identity) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return { schemaVersion: 1, id: hash.toString(16).padStart(8, '0'), video: { ...video }, crop: { ...crop },
    intervalMs, frameCount: sampleTimes(video.duration, intervalMs).length, records: [] };
}

export function labelBoxAt(x, y, width, height, crop, id) {
  const boxWidth = Math.max(1, Math.min(crop.width, width));
  const boxHeight = Math.max(1, Math.min(crop.height, height));
  return { id, x: Math.max(0, Math.min(crop.width - boxWidth, x - boxWidth / 2)),
    y: Math.max(0, Math.min(crop.height - boxHeight, y - boxHeight / 2)), width: boxWidth, height: boxHeight };
}

export function validLabelBox(box, crop) {
  return Number.isInteger(box.id) && box.id > 0 && [box.x, box.y, box.width, box.height].every(Number.isFinite) &&
    box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0 &&
    box.x + box.width <= crop.width + .000001 && box.y + box.height <= crop.height + .000001;
}

/** Editing invalidates completion so a changed draft cannot silently enter training. */
export function editLabelRecord(record, boxes) {
  return { ...record, boxes: boxes.map(box => ({ ...box })), labeled: false };
}

export function yoloLabels(boxes, crop) {
  if (!boxes.every(box => validLabelBox(box, crop))) throw new Error('A fish box is outside the labeling crop.');
  return boxes.map(box => [0, (box.x + box.width / 2) / crop.width,
    (box.y + box.height / 2) / crop.height, box.width / crop.width, box.height / crop.height]
    .map((value, index) => index ? value.toFixed(8) : value).join(' ')).join('\n') + (boxes.length ? '\n' : '');
}

export function labelFrameName(project, record) {
  return `${baseName(project.video.name)}-${project.id}-frame-${String(record.frameIndex + 1).padStart(6, '0')}`;
}

/** Fail rather than exporting labels without their exact reviewed image. Empty labeled frames are valid negatives. */
export function completedLabelRecords(project) {
  return project.records.filter(record => record.labeled).sort((a, b) => a.frameIndex - b.frameIndex).map(record => {
    if (!(record.image instanceof Blob) || record.image.type !== 'image/png' || !record.image.size) {
      throw new Error(`Frame ${record.frameIndex + 1} has no saved image. Open it and mark it labeled again.`);
    }
    yoloLabels(record.boxes, project.crop);
    return record;
  });
}

export function labelManifest(project, records) {
  return { schemaVersion: 1, video: project.video, crop: project.crop, intervalMs: project.intervalMs,
    classes: ['fish'], coordinates: 'crop-local pixels; center_video_* includes crop offset',
    frames: records.map(record => ({ frameIndex: record.frameIndex, frameNumber: record.frameIndex + 1,
      timestampMs: record.timestampMs, image: `images/${labelFrameName(project, record)}.png`,
      boxes: record.boxes.map(box => ({ ...box, center_x: box.x + box.width / 2, center_y: box.y + box.height / 2,
        center_video_x: project.crop.x + box.x + box.width / 2,
        center_video_y: project.crop.y + box.y + box.height / 2 })) })) };
}

/** Validate portable progress before replacing any current work. */
export function validateLabelProject(value, expected) {
  if (value?.schemaVersion !== 1 || !Array.isArray(value.records)) throw new Error('This is not a Fish Cluster labeling progress file.');
  const metadata = createLabelProject(value);
  if (metadata.id !== expected.id || value.id !== metadata.id) {
    throw new Error('This progress belongs to a different video, crop, or frame interval. Restore those settings first.');
  }
  const indices = new Set();
  for (const record of value.records) {
    if (!Number.isInteger(record.frameIndex) || record.frameIndex < 0 || record.frameIndex >= expected.frameCount ||
      indices.has(record.frameIndex) || !Number.isFinite(record.timestampMs) || Math.abs(record.timestampMs - record.frameIndex * expected.intervalMs) > .001 ||
      typeof record.labeled !== 'boolean' || !Array.isArray(record.boxes) ||
      !record.boxes.every(box => validLabelBox(box, expected.crop)) ||
      new Set(record.boxes.map(box => box.id)).size !== record.boxes.length) {
      throw new Error('The progress file contains an invalid frame or fish box.');
    }
    indices.add(record.frameIndex);
  }
  return value;
}
