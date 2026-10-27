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
      // Pale fish can brighten the marked dark floor; light floors use darkening.
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

// Hysteresis keeps faint body pixels connected to a stronger, stable core.
// Dark-side learning is required so ordinary changes in ridges cannot seed it.
function recoverLowContrastFish(blobs, frame, background, width, height, options, edges, threshold, minArea, maxArea) {
  if (options.expectedFish !== 1 || options.threshold != null || options.recoverLowContrast === false ||
    !options.backgroundVariation || !options.darkZones?.some(Boolean)) return;
  const weakThreshold = threshold * .5, coreThreshold = threshold * .75;
  const darkAnalysisMask = options.darkZones.map((value, index) =>
    value && (!options.analysisMask || options.analysisMask[index]) ? 1 : 0);
  const mask = darkPixelMask(frame, background, width, height, weakThreshold,
    options.exclusions, options.darkZones, darkAnalysisMask);
  excludeBorders(mask, width, height, edges.edgeX, edges.edgeTop, edges.edgeBottom);
  const candidates = connectedRegions(mask, width, height, { minArea, maxArea, minLength: 10 });
  const original = [...blobs];
  for (const candidate of candidates) {
    let requiredCore = coreThreshold;
    if (!hasStableForegroundEvidence(candidate, frame, background, requiredCore, options)) {
      const previous = options.previousDetections?.length === 1 ? options.previousDetections[0] : null;
      // A recent observed path can support a faint body, but only where current
      // pixels still exceed the learned range and have compatible size/motion.
      if (!previous || previous.positionUncertain || previous.splitFromBlob ||
        !Number.isFinite(options.timestampMs) || !Number.isFinite(options.previousTimestampMs) ||
        options.timestampMs <= options.previousTimestampMs || options.timestampMs - options.previousTimestampMs > 250 ||
        !(previous.area > 0) || !(previous.width > 0) || !(previous.height > 0) ||
        Math.hypot(candidate.x - previous.x, candidate.y - previous.y) > 45 ||
        candidate.area < previous.area * .35 || candidate.area > previous.area * 3 ||
        Math.hypot(candidate.width, candidate.height) > Math.hypot(previous.width, previous.height) * 2 ||
        !hasStableForegroundEvidence(candidate, frame, background, weakThreshold, options)) continue;
      requiredCore = weakThreshold;
    }
    const pixels = new Set(candidate.pixels);
    const seeds = original.filter(blob => blob.pixels?.some(pixel => pixels.has(pixel)));
    if (original.length) {
      if (seeds.length !== 1) continue;
      const seed = seeds[0];
      if (candidate.area <= seed.area || candidate.area > seed.area * 5 ||
        Math.hypot(candidate.width, candidate.height) > Math.hypot(seed.width, seed.height) * 3 ||
        seed.pixels.filter(pixel => pixels.has(pixel)).length < seed.area * .8) continue;
      const contrasts = seed.pixels.map(pixel => Math.abs(frame[pixel] - background[pixel]))
        .filter(value => value >= threshold).sort((a, b) => a - b);
      // Ordinary high-contrast detections keep their original segmentation.
      if (!contrasts.length || contrasts[Math.floor(contrasts.length / 2)] > threshold * 1.25) continue;
    }
    const recovered = { ...candidate, lowContrastRecovered: true,
      foregroundThreshold: weakThreshold, foregroundCoreThreshold: requiredCore,
      ...(requiredCore < coreThreshold ? { lowContrastReferenceTimestampMs: options.previousTimestampMs } : {}),
      ...(seeds[0]?.edgeRecovered ? { edgeRecovered: true } : {}) };
    if (seeds.length) blobs.splice(blobs.indexOf(seeds[0]), 1, recovered);
    else blobs.push(recovered);
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

// Tank markings can erase contrast across a single fish, leaving separate body
// and tail regions. Join only a bounded pair supported by the previous observed
// fish's size and position and by current contrast in the gap.
function joinSingleFishFragments(blobs, frame, background, width, threshold, options) {
  if (options.expectedFish !== 1 || options.previousDetections?.length !== 1) return;
  const previous = options.previousDetections[0];
  if (previous.positionUncertain || previous.splitFromBlob || !(previous.area > 0) ||
    !(previous.width > 0) || !(previous.height > 0)) return;
  const nearby = blobs.filter(blob => Math.hypot(blob.x - previous.x, blob.y - previous.y) <= 45);
  if (nearby.length !== 2) return;
  const [a, b] = nearby;
  // Faint regions already grew along connected image evidence; keep any
  // remaining disconnected pieces separate rather than joining them by history.
  if (a.lowContrastRecovered || b.lowContrastRecovered) return;
  const area = a.area + b.area;
  if (area < previous.area * .5 || area > previous.area * 2) return;
  const pixels = [...a.pixels, ...b.pixels];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pixel of pixels) {
    const x = pixel % width, y = Math.floor(pixel / width);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  if (Math.hypot(maxX - minX + 1, maxY - minY + 1) > Math.hypot(previous.width, previous.height) * 1.75) return;
  let gap = Infinity, start, end;
  for (const i of a.pixels) for (const j of b.pixels) {
    const distance = Math.hypot(i % width - j % width, Math.floor(i / width) - Math.floor(j / width));
    if (distance < gap) { gap = distance; start = i; end = j; }
  }
  if (gap > 20) return;
  const steps = Math.ceil(gap);
  let evidence = 0, weakRun = 0;
  for (let step = 0; step <= steps; step++) {
    const x = Math.round(start % width + (end % width - start % width) * step / steps);
    const y = Math.round(Math.floor(start / width) + (Math.floor(end / width) - Math.floor(start / width)) * step / steps);
    const pixel = y * width + x;
    if ((options.analysisMask && !options.analysisMask[pixel]) ||
      options.exclusions?.some(box => x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height)) return;
    if (Math.abs(frame[pixel] - background[pixel]) >= threshold / 2) { evidence++; weakRun = 0; }
    else if (++weakRun > 6) return;
  }
  if (evidence < (steps + 1) * .5) return;
  const joined = { x: (a.x * a.area + b.x * b.area) / area,
    y: (a.y * a.area + b.y * b.area) / area, area, pixels,
    width: maxX - minX + 1, height: maxY - minY + 1,
    joinedForegroundFragments: 2,
    ...(a.edgeRecovered || b.edgeRecovered ? { edgeRecovered: true } : {}) };
  blobs.splice(blobs.indexOf(a), 1, joined);
  blobs.splice(blobs.indexOf(b), 1);
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
  // Look for supported faint fish inside the tank before relaxing its borders.
  // Otherwise a wall reflection can fill the count and block faint-fish recovery.
  recoverLowContrastFish(blobs, frame, background, width, height, options,
    { edgeX, edgeTop, edgeBottom }, threshold, minArea, maxArea);
  recoverEdgeFish(blobs, frame, background, width, height, options, { edgeX, edgeTop, edgeBottom }, minArea);
  joinSingleFishFragments(blobs, frame, background, width, threshold, options);
  // Score real foreground pixels, excluding pixels introduced by morphology.
  // Absolute contrast supports pale fish on dark floors; light floors use darkening.
  for (const blob of blobs) {
    // Edge recovery returns candidates already scored by its relaxed pass.
    // Their pixel membership has been removed; retain the measured evidence.
    if (!blob.pixels) continue;
    const evidenceThreshold = blob.foregroundThreshold ?? threshold;
    const evidence = (blob.pixels ?? []).map(index => options.darkZones?.[index]
      ? Math.abs(background[index] - frame[index]) : background[index] - frame[index])
      .filter(value => value >= evidenceThreshold).sort((a, b) => a - b);
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
