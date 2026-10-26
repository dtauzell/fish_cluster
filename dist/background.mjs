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

/** Robust background range ignores isolated fish visits while learning fixture flicker. */
export function backgroundVariation(samples, width, height) {
  if (!samples.length || samples.some(sample => sample.length !== samples[0].length)) {
    throw new Error('Background samples must have matching dimensions.');
  }
  const lower = new Uint8Array(samples[0].length), upper = new Uint8Array(lower.length);
  const values = new Uint8Array(samples.length);
  const low = Math.floor((samples.length - 1) * 0.1), high = Math.ceil((samples.length - 1) * 0.9);
  for (let pixel = 0; pixel < lower.length; pixel++) {
    for (let i = 0; i < samples.length; i++) values[i] = samples[i][pixel];
    values.sort();
    lower[pixel] = values[low]; upper[pixel] = values[high];
  }
  if (width && height) {
    if (width * height !== lower.length) throw new Error('Background variation dimensions do not match.');
    // Nearby reference pixels account for a ridge moving a pixel or two due to
    // camera vibration, water refraction, or decoding. Keep this tolerance local.
    const horizontalLow = lower.slice(), horizontalHigh = upper.slice();
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x;
      for (let dx = Math.max(0, x - 2); dx <= Math.min(width - 1, x + 2); dx++) {
        horizontalLow[i] = Math.min(horizontalLow[i], lower[y * width + dx]);
        horizontalHigh[i] = Math.max(horizontalHigh[i], upper[y * width + dx]);
      }
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x;
      for (let dy = Math.max(0, y - 2); dy <= Math.min(height - 1, y + 2); dy++) {
        lower[i] = Math.min(lower[i], horizontalLow[dy * width + x]);
        upper[i] = Math.max(upper[i], horizontalHigh[dy * width + x]);
      }
    }
  }
  return { lower, upper };
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
function darkPixelMask(frame, background, width, height, threshold, exclusions, darkZones, analysisMask) {
  let mask = new Uint8Array(frame.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const index = row + x;
      const difference = background[index] - frame[index];
      // A pale fish can brighten a dark floor; preserve the original rule elsewhere.
      if ((darkZones?.[index] ? Math.abs(difference) : difference) >= threshold) mask[index] = 1;
    }
  }
  if (analysisMask) for (let i = 0; i < mask.length; i++) if (!analysisMask[i]) mask[i] = 0;
  maskExcludedPixels(mask, width, height, exclusions);
  // Opening (shrink then grow) removes isolated specks. Closing (grow then
  // shrink) fills small gaps. The two growth steps preserve the trial's tuning.
  mask = dilate3(erode3(mask, width, height), width, height);
  mask = dilate3(dilate3(mask, width, height), width, height);
  mask = erode3(erode3(mask, width, height), width, height);
  if (analysisMask) for (let i = 0; i < mask.length; i++) if (!analysisMask[i]) mask[i] = 0;
  maskExcludedPixels(mask, width, height, exclusions);
  return mask;
}

// Verify whole regions instead of eroding a fish away where it crosses a ridge.
// A region needs a small core beyond the background's ordinary variation.
function hasStableForegroundEvidence(blob, frame, background, threshold, options) {
  const variation = options.backgroundVariation;
  if (!variation || !options.darkZones) return true;
  let touchesDark = false, evidence = 0;
  for (const pixel of blob.pixels) {
    if (options.darkZones[pixel]) {
      touchesDark = true;
      if (frame[pixel] <= variation.lower[pixel] - threshold || frame[pixel] >= variation.upper[pixel] + threshold) evidence++;
    } else if (background[pixel] - frame[pixel] >= threshold) evidence++;
  }
  return !touchesDark || evidence >= Math.max(5, Math.ceil(blob.area * 0.08));
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
 * Find moving regions in a cropped grayscale frame, using either contrast sign in marked dark zones.
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
  const mask = darkPixelMask(frame, background, width, height, threshold, options.exclusions, options.darkZones, options.analysisMask);
  excludeBorders(mask, width, height, edgeX, edgeTop, edgeBottom);
  const blobs = connectedRegions(mask, width, height, { minArea, maxArea, minLength: 10 })
    .filter(blob => hasStableForegroundEvidence(blob, frame, background, threshold, options));
  recoverEdgeFish(blobs, frame, background, width, height, options, { edgeX, edgeTop, edgeBottom }, minArea);
  // Score real foreground pixels, excluding pixels introduced by morphology.
  // Absolute contrast supports pale fish on dark floors; light floors use darkening.
  for (const blob of blobs) {
    const evidence = (blob.pixels ?? []).map(index => options.darkZones?.[index]
      ? Math.abs(background[index] - frame[index]) : background[index] - frame[index])
      .filter(value => value >= threshold).sort((a, b) => a - b);
    const middle = Math.floor(evidence.length / 2);
    blob.foregroundContrast = evidence.length ? (evidence.length % 2 ? evidence[middle]
      : (evidence[middle - 1] + evidence[middle]) / 2) : null;
    blob.supportPixelCount = evidence.length;
  }
  const trackingSeeds = options.overlapSeedsFor?.(blobs) ?? new Map();
  splitLargeBlobs(blobs, width, height, { minArea, expectedFish: options.expectedFish, preferCenter: options.preferCenter,
    frame, background, threshold, previousDetections: options.previousDetections,
    previousTimestampMs: options.previousTimestampMs, trackingSeeds,
    observedSizeReference: options.observedSizeReference });
  // Pixel membership is needed only during splitting, so omit it from the result.
  return blobs.map(({ pixels, ...blob }) => blob);
}
