import { connectedRegions } from './connected-regions.mjs';
import { splitLargeBlobs } from './blob-splitting.mjs';
import { maskExcludedPixels } from './region.mjs';

/** Convert browser ImageData to the grayscale pixels used by the detector. */
export function grayscale(imageData) {
  const rgba = imageData.data;
  const gray = new Uint8Array(imageData.width * imageData.height);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    gray[j] = Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
  }
  return gray;
}

/** A median across frames removes fish that move around a fixed tank. */
export function medianBackground(samples) {
  if (!samples.length) throw new Error('No video frames were available for the background.');
  const length = samples[0].length;
  if (samples.some(sample => sample.length !== length)) throw new Error('Background samples have different dimensions.');
  const result = new Uint8Array(length);
  const values = new Uint8Array(samples.length);
  const middle = Math.floor(values.length / 2);
  for (let pixel = 0; pixel < length; pixel++) {
    for (let sample = 0; sample < samples.length; sample++) values[sample] = samples[sample][pixel];
    values.sort();
    result[pixel] = values[middle];
  }
  return result;
}

// Erosion shrinks the mask: keep a pixel only when its four neighbors are also set.
function erode3(mask, width, height) {
  const result = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (mask[i] && mask[i - width] && mask[i + width] && mask[i - 1] && mask[i + 1]) result[i] = 1;
    }
  }
  return result;
}

// Dilation grows the mask by setting the four neighbors of each foreground pixel.
function dilate3(mask, width, height) {
  const result = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      result[i] = 1;
      if (y > 0) result[i - width] = 1;
      if (y < height - 1) result[i + width] = 1;
      if (x > 0) result[i - 1] = 1;
      if (x < width - 1) result[i + 1] = 1;
    }
  }
  return result;
}

// A mask is one byte per pixel: 1 means a possible fish, 0 means background.
function darkPixelMask(frame, background, width, height, threshold, exclusions) {
  let mask = new Uint8Array(frame.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const index = row + x;
      if (background[index] - frame[index] >= threshold) mask[index] = 1;
    }
  }
  maskExcludedPixels(mask, width, height, exclusions);
  // Opening (shrink then grow) removes isolated specks. Closing (grow then
  // shrink) fills small gaps. The two growth steps preserve the trial's tuning.
  mask = dilate3(erode3(mask, width, height), width, height);
  mask = dilate3(dilate3(mask, width, height), width, height);
  mask = erode3(erode3(mask, width, height), width, height);
  maskExcludedPixels(mask, width, height, exclusions);
  return mask;
}

// Ignore tank borders where reflections and fixed hardware often look like fish.
function excludeBorders(mask, width, height, edgeX, edgeTop, edgeBottom) {
  for (let y = 0; y < edgeTop; y++) mask.fill(0, y * width, (y + 1) * width);
  for (let y = height - edgeBottom; y < height; y++) mask.fill(0, y * width, (y + 1) * width);
  for (let y = edgeTop; y < height - edgeBottom; y++) {
    mask.fill(0, y * width, y * width + edgeX);
    mask.fill(0, (y + 1) * width - edgeX, (y + 1) * width);
  }
}

// The known count guides recovery; it does not guarantee that every fish is found.
function recoverEdgeFish(blobs, frame, background, width, height, options, edges, minArea) {
  const { edgeX, edgeTop, edgeBottom } = edges;
  const expectedFish = options.expectedFish;
  if (Number.isInteger(expectedFish) && blobs.length < expectedFish && options.recoverEdges !== false) {
    const relaxed = detectBackgroundFish(frame, background, width, height, {
      ...options, expectedFish: undefined, recoverEdges: false,
      edgeX: Math.min(edgeX, 4), edgeTop: Math.min(edgeTop, 4), edgeBottom: Math.min(edgeBottom, 4)
    });
    const areas = blobs.map(blob => blob.area).sort((a, b) => a - b);
    const typicalArea = areas[Math.floor(areas.length / 2)] ?? minArea;
    const minEdgeArea = Math.max(minArea, typicalArea * 0.35);
    const candidates = relaxed.filter(blob => {
      const nearExcludedEdge = blob.x - blob.width / 2 < edgeX + 2 ||
        blob.x + blob.width / 2 > width - edgeX - 2 ||
        blob.y - blob.height / 2 < edgeTop + 2 ||
        blob.y + blob.height / 2 > height - edgeBottom - 2;
      return nearExcludedEdge && blob.area >= minEdgeArea;
    }).sort((a, b) => b.area - a.area);
    for (const candidate of candidates) {
      if (blobs.length >= expectedFish) break;
      const duplicate = blobs.some(blob => Math.hypot(blob.x - candidate.x, blob.y - candidate.y) < 15);
      if (!duplicate) blobs.push({ ...candidate, edgeRecovered: true });
    }
  }
}

/**
 * Find dark moving regions in a cropped grayscale frame.
 * Input arrays are row-major: pixel (x, y) is at y * width + x, brightness 0–255.
 * Returned centers and bounding-box sizes are in crop pixels. These are candidate
 * fish, not tracked identities. Defaults reproduce the original tank experiment.
 */
export function detectBackgroundFish(frame, background, width, height, options = {}) {
  if (frame.length !== width * height || background.length !== frame.length) throw new Error('Background frame dimensions do not match.');
  const threshold = options.threshold ?? 24;
  const minArea = options.minArea ?? 45;
  const maxArea = options.maxArea ?? 2500;
  const edgeX = options.edgeX ?? Math.round(width * 12 / 420);
  const edgeTop = options.edgeTop ?? options.edgeY ?? Math.round(height * 10 / 290);
  const edgeBottom = options.edgeBottom ?? options.edgeY ?? Math.round(height * 20 / 290);
  const mask = darkPixelMask(frame, background, width, height, threshold, options.exclusions);
  excludeBorders(mask, width, height, edgeX, edgeTop, edgeBottom);
  const blobs = connectedRegions(mask, width, height, { minArea, maxArea, minLength: 10 });
  recoverEdgeFish(blobs, frame, background, width, height, options, { edgeX, edgeTop, edgeBottom }, minArea);
  const trackingSeeds = options.overlapSeedsFor?.(blobs) ?? new Map();
  splitLargeBlobs(blobs, width, height, { minArea, expectedFish: options.expectedFish, preferCenter: options.preferCenter,
    frame, background, threshold, previousDetections: options.previousDetections,
    previousTimestampMs: options.previousTimestampMs, trackingSeeds,
    observedSizeReference: options.observedSizeReference });
  // Pixel membership is needed only during splitting, so omit it from the result.
  return blobs.map(({ pixels, ...blob }) => blob);
}
