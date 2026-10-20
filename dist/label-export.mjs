import { completedLabelRecords, labelFrameName, labelManifest, validateLabelProject, yoloLabels } from './label-data.mjs';
import { createZip } from './zip.mjs';

export async function labelDatasetZip(project) {
  const records = completedLabelRecords(project);
  if (!records.length) throw new Error('Mark at least one frame labeled before exporting a dataset.');
  const entries = records.flatMap(record => {
    const name = labelFrameName(project, record);
    return [{ name: `images/${name}.png`, content: record.image },
      { name: `labels/${name}.txt`, content: yoloLabels(record.boxes, project.crop) }];
  });
  entries.push({ name: 'classes.txt', content: 'fish\n' },
    { name: 'data.yaml', content: '# Assign training and validation recordings before training.\nnc: 1\nnames: [fish]\n' },
    { name: 'annotations.json', content: JSON.stringify(labelManifest(project, records), null, 2) },
    { name: 'README.txt', content: 'Fish Cluster labeling export\n\nOnly frames explicitly marked labeled are included.\nPNG images are the clean crops reviewed while labeling. No overlays or reflection masks are burned into them.\nLabels use YOLO detection format: class x_center y_center width height, normalized to the image dimensions. Class 0 is fish. Empty label files mean explicitly labeled frames with no fish.\n\nUpload images and matching labels to an object-detection project, or arrange separate training and validation folders before using YOLO. data.yaml identifies the class; add train and val paths after splitting by recording or separate time blocks. Avoid splitting neighboring frames randomly.\n\nannotations.json includes pixel boxes, centers, source-video metadata, crop, and timestamps. It is an audit file, not a resumable project. Use Save progress JSON in the labeler for a portable backup that can be imported later.\n' });
  return createZip(entries);
}

async function imageDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 16384) text += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
  return `data:image/png;base64,${btoa(text)}`;
}

/** A portable backup includes draft marks and exact images, independently of browser storage. */
export async function labelProgressJson(project) {
  const records = [];
  for (const { image, ...record } of project.records) records.push({ ...record,
    imageDataUrl: image ? await imageDataUrl(image) : null });
  return JSON.stringify({ ...project, records }, null, 2);
}

export function importLabelProgress(text, expected) {
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('The progress file is not valid JSON.'); }
  validateLabelProject(value, expected);
  const records = value.records.map(({ imageDataUrl, ...record }) => {
    let image = null;
    if (imageDataUrl != null) {
      if (typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image/png;base64,')) throw new Error('A saved frame image is invalid.');
      let binary;
      try { binary = atob(imageDataUrl.slice('data:image/png;base64,'.length)); }
      catch { throw new Error('A saved frame image could not be decoded.'); }
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      if (bytes.length < 24 || [137, 80, 78, 71, 13, 10, 26, 10].some((byte, index) => bytes[index] !== byte)) {
        throw new Error('A saved frame is not a PNG image.');
      }
      const header = new DataView(bytes.buffer);
      if (header.getUint32(16) !== expected.crop.width || header.getUint32(20) !== expected.crop.height) {
        throw new Error('A saved frame image has the wrong crop dimensions.');
      }
      image = new Blob([bytes], { type: 'image/png' });
    }
    if ((record.labeled || record.boxes.length) && !image) throw new Error('An annotated frame has no saved image.');
    return { ...record, image };
  });
  return { ...expected, records };
}
