import { darkBodySeeds, previousBodySeeds } from './overlap-evidence.mjs';

/**
 * Estimate two centers inside an unusually large blob, which may contain touching fish.
 * Start along its longest axis (from the pixel covariance), then repeatedly assign
 * pixels to the nearest center and average them: two-cluster k-means.
 */
function principalAxisSeeds(blob, frameWidth) {
  const pixels = blob.pixels;
  let varianceX = 0, covarianceXY = 0, varianceY = 0;
  for (const index of pixels) {
    const x = index % frameWidth - blob.x;
    const y = Math.floor(index / frameWidth) - blob.y;
    varianceX += x * x;
    covarianceXY += x * y;
    varianceY += y * y;
  }
  // The eigenvector of this 2D covariance points along the blob's longest axis.
  const angle = Math.atan2(2 * covarianceXY, varianceX - varianceY) / 2;
  const axisX = Math.cos(angle), axisY = Math.sin(angle);
  let low = Infinity, high = -Infinity;
  for (const index of pixels) {
    const projection = (index % frameWidth) * axisX + Math.floor(index / frameWidth) * axisY;
    low = Math.min(low, projection);
    high = Math.max(high, projection);
  }
  const centerProjection = blob.x * axisX + blob.y * axisY;
  const firstOffset = low + (high - low) / 4 - centerProjection;
  const secondOffset = low + 3 * (high - low) / 4 - centerProjection;
  return [
    { x: blob.x + axisX * firstOffset, y: blob.y + axisY * firstOffset },
    { x: blob.x + axisX * secondOffset, y: blob.y + axisY * secondOffset }
  ];
}

function splitJoinedBlob(blob, frameWidth, minArea, seeds = null) {
  const pixels = blob.pixels;
  let centers = seeds ?? principalAxisSeeds(blob, frameWidth);
  for (let step = 0; step < 8; step++) {
    const sums = [{ x: 0, y: 0, area: 0 }, { x: 0, y: 0, area: 0 }];
    for (const index of pixels) {
      const x = index % frameWidth, y = Math.floor(index / frameWidth);
      const distanceToFirst = (x - centers[0].x) ** 2 + (y - centers[0].y) ** 2;
      const distanceToSecond = (x - centers[1].x) ** 2 + (y - centers[1].y) ** 2;
      const group = sums[distanceToFirst <= distanceToSecond ? 0 : 1];
      group.x += x; group.y += y; group.area++;
    }
    if (sums.some(group => group.area < minArea)) return null;
    centers = sums.map(group => ({ x: group.x / group.area, y: group.y / group.area, area: group.area }));
  }
  if (Math.hypot(centers[0].x - centers[1].x, centers[0].y - centers[1].y) < 10) return null;
  const groups = [
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, area: 0, sumX: 0, sumY: 0 },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, area: 0, sumX: 0, sumY: 0 }
  ];
  for (const index of pixels) {
    const x = index % frameWidth, y = Math.floor(index / frameWidth);
    const distanceToFirst = (x - centers[0].x) ** 2 + (y - centers[0].y) ** 2;
    const distanceToSecond = (x - centers[1].x) ** 2 + (y - centers[1].y) ** 2;
    const group = groups[distanceToFirst <= distanceToSecond ? 0 : 1];
    group.area++;
    group.sumX += x;
    group.sumY += y;
    group.minX = Math.min(group.minX, x); group.maxX = Math.max(group.maxX, x);
    group.minY = Math.min(group.minY, y); group.maxY = Math.max(group.maxY, y);
  }
  if (groups.some(group => group.area < minArea)) return null;
  return groups.map(group => ({
    x: group.sumX / group.area,
    y: group.sumY / group.area,
    area: group.area,
    width: group.maxX - group.minX + 1,
    height: group.maxY - group.minY + 1,
    splitFromBlob: true,
    sourceBlobArea: blob.sourceBlobArea ?? blob.area,
    ...(blob.edgeRecovered ? { edgeRecovered: true } : {})
  }));
}

function centralBlobs(blobs, width, height, count) {
  const distance = blob => Math.hypot(blob.x - width / 2, blob.y - height / 2);
  return [...blobs].sort((a, b) => distance(a) - distance(b)).slice(0, count);
}

/**
 * Split regions large enough to plausibly contain more than one fish.
 * Mutates the working blob list while pixel membership is still available.
 *
 * Without the center rule, preserve count-based recovery. With it, inspect the
 * provisional central candidates even when reflections have filled the count.
 * Otherwise a merged pair plus a reflection can look like a complete five fish.
 */
export function splitLargeBlobs(blobs, width, height, {
  minArea, expectedFish, preferCenter = false, frame, background, threshold = 24,
  previousDetections = [], previousTimestampMs, trackingSeeds = new Map(), observedSizeReference = null
}) {
  if (!Number.isInteger(expectedFish) || expectedFish < 1 || blobs.length < 2) return;

  const reference = preferCenter ? centralBlobs(blobs, width, height, expectedFish) : blobs;
  const areas = reference.map(blob => blob.area).sort((a, b) => a - b);
  const middle = Math.floor(areas.length / 2);
  const typicalArea = areas.length % 2 ? areas[middle] : (areas[middle - 1] + areas[middle]) / 2;
  // Same conservative size gate as count recovery. Keep this estimate fixed:
  // splitting one region must not change the reference size for the next split.
  const originalJoinedArea = Math.max(400, typicalArea * 1.5);
  // Multiple merged pairs can inflate this frame's median and hide every merge.
  // Only a count deficit permits a smaller reference from recent observed fish;
  // the absolute 400-pixel gate and all child-size checks still apply.
  const useObservedSize = blobs.length < expectedFish && observedSizeReference?.area > 0;
  const referenceArea = useObservedSize ? Math.min(typicalArea, observedSizeReference.area) : typicalArea;
  const minimumJoinedArea = Math.max(400, referenceArea * 1.5);
  const minimumEvidenceArea = Math.max(minArea * 2, typicalArea);
  const previousSeeds = preferCenter && previousDetections.length === expectedFish
    ? previousBodySeeds(blobs, previousDetections, width) : new Map();
  const examined = new Set();

  while (preferCenter || blobs.length < expectedFish) {
    const eligible = preferCenter ? centralBlobs(blobs, width, height, expectedFish) : blobs;
    const candidate = eligible.filter(blob => blob.pixels && !examined.has(blob) &&
      (blob.area >= minimumJoinedArea || (preferCenter && blob.area >= minimumEvidenceArea)))
      .sort((a, b) => b.area - a.area)[0];
    if (!candidate) break;
    examined.add(candidate);
    let seeds = null;
    let reason = preferCenter ? 'large-central-region' : 'known-count-recovery';
    if (candidate.area >= minimumJoinedArea && candidate.area < originalJoinedArea) reason = 'recent-observed-size';
    if (candidate.area < minimumJoinedArea) {
      seeds = darkBodySeeds(candidate, frame, background, width, threshold, minArea);
      if (seeds) reason = 'separate-dark-bodies';
      else {
        seeds = trackingSeeds.get(candidate)?.seeds;
        if (seeds) reason = 'tracking-overlap';
        else {
          seeds = previousSeeds.get(candidate);
          reason = 'previous-frame-overlap';
        }
        if (!seeds) continue;
      }
    }
    // One two-center estimate per original region. Never repeatedly subdivide
    // its parts to force the known fish count.
    const halves = splitJoinedBlob(candidate, width, minArea, seeds);
    if (!halves) continue;
    for (const half of halves) {
      half.splitReason = reason;
      if (reason === 'previous-frame-overlap') half.splitReferenceTimestampMs = previousTimestampMs;
      if (reason === 'tracking-overlap') {
        half.sourceTrackIds = trackingSeeds.get(candidate).trackIds;
        half.splitReferenceTimestampMs = trackingSeeds.get(candidate).referenceTimestampMs;
      }
      if (reason === 'recent-observed-size') {
        half.splitReferenceTimestampMs = observedSizeReference.referenceTimestampMs;
        half.splitSizeReferenceArea = observedSizeReference.area;
      }
    }
    blobs.splice(blobs.indexOf(candidate), 1, ...halves);
  }
}
