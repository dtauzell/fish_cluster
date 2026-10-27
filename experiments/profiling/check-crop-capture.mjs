import { createVideoSource } from '/video.mjs?crop-capture-check=1';
import { createVideoSource as createBaselineSource } from '/profile-video-baseline.mjs';
import { sampleTimes } from '/analysis.mjs';

/** Browser regression check against a pre-change video.mjs served separately. */
export async function checkCropCapture(videoUrl = '/profile-source.mov') {
  if (document.visibilityState !== 'visible') throw new Error('Select this tab before checking capture.');
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.style.cssText = 'position:fixed;width:2px;height:2px;opacity:.01';
  const response = await fetch(videoUrl);
  if (!response.ok) throw new Error(`Video fetch failed: ${response.status}`);
  const blobUrl = URL.createObjectURL(new Blob([await response.arrayBuffer()], { type: 'video/quicktime' }));
  const loaded = new Promise((resolve, reject) => {
    video.addEventListener('loadedmetadata', resolve, { once: true });
    video.addEventListener('error', () => reject(new Error('Could not decode video')), { once: true });
  });
  video.src = blobUrl;
  document.body.append(video);
  await loaded;
  const baseline = createBaselineSource(video);
  const candidate = createVideoSource(video);
  const result = { videoSeconds: video.duration, grayComparisons: 0,
    pngComparisons: 0, comparedBytes: 0, differingBytes: 0, failures: [] };
  function compare(a, b, label) {
    let differences = 0;
    if (a.length !== b.length) result.failures.push({ label, lengths: [a.length, b.length] });
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) differences++;
    }
    result.comparedBytes += Math.max(a.length, b.length);
    result.differingBytes += differences;
    if (differences) result.failures.push({ label, differences });
  }
  function bitmapPixels(bitmap) {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    const result = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    bitmap.close();
    return result;
  }
  const crop = { x: 50, y: 240, width: 420, height: 290 };
  try {
    await baseline.showFirstFrame();
    const times = [
      ...Array.from({ length: 25 }, (_, i) => (i + .5) * video.duration * 1000 / 25),
      ...sampleTimes(video.duration, 200)
    ];
    for (const [index, timestampMs] of times.entries()) {
      await baseline.seekTo(timestampMs / 1000);
      compare(baseline.readGray(crop), candidate.readGray(crop), `gray:${timestampMs}`);
      result.grayComparisons++;
      if (index % 50 === 0) globalThis.cropCaptureCheckProgress = { compared: index + 1, total: times.length };
    }
    // Include full-frame, odd-position, narrow, and edge-touching crops. Exercise
    // resizing between grayscale capture and the PNG export path.
    const crops = [crop, { x: 0, y: 0, width: video.videoWidth, height: video.videoHeight },
      { x: 51, y: 241, width: 225, height: 301 },
      { x: 0, y: 0, width: 1, height: video.videoHeight },
      { x: video.videoWidth - 30, y: video.videoHeight - 30, width: 30, height: 30 }];
    for (const timestampMs of [0, 3400, 35000, 117600]) {
      await baseline.seekTo(timestampMs / 1000);
      for (const region of crops) {
        const label = `${timestampMs}:${JSON.stringify(region)}`;
        compare(baseline.readGray(region), candidate.readGray(region), `gray:${label}`);
        result.grayComparisons++;
        const originalPng = await baseline.readPng(region);
        const croppedPng = await candidate.readPng(region);
        compare(bitmapPixels(await createImageBitmap(originalPng)), bitmapPixels(await createImageBitmap(croppedPng)), `png:${label}`);
        result.pngComparisons++;
      }
    }
    result.passed = result.failures.length === 0;
    return result;
  } finally {
    video.remove();
    URL.revokeObjectURL(blobUrl);
  }
}
