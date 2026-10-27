import { usableRectangles, insideAnalysisArea } from './region.mjs';

// Geometry and statistics on point coordinates. These functions never read image pixels.
// Distances ending in Px are in original-video pixels; absent distances are null.

export function mapCanvasPoint(clientX, clientY, rect, frameWidth, frameHeight, origin = { x: 0, y: 0 }) {
  return {
    x: origin.x + Math.round(Math.max(0, Math.min(frameWidth, (clientX - rect.left) * frameWidth / rect.width))),
    y: origin.y + Math.round(Math.max(0, Math.min(frameHeight, (clientY - rect.top) * frameHeight / rect.height)))
  };
}

export function cropFitsFrame(box, frameWidth, frameHeight) {
  const { x, y, width, height } = box;
  return [x, y, width, height].every(Number.isInteger) && x >= 0 && y >= 0 &&
    width >= 30 && height >= 30 && x + width <= frameWidth && y + height <= frameHeight;
}

export function inchesToPixels(inches, pixelsPerHalfInch) {
  return inches * pixelsPerHalfInch * 2;
}

/** Calibrate in original-video coordinates, independently of preview size. */
export function calibrationFromLine(start, end, lengthInches) {
  if (![start?.x, start?.y, end?.x, end?.y].every(Number.isFinite)) throw new Error('Draw a calibration line on the preview first.');
  const distancePx = Math.hypot(end.x - start.x, end.y - start.y);
  if (distancePx < 1) throw new Error('Draw a line at least one video pixel long.');
  if (!Number.isFinite(lengthInches) || lengthInches <= 0) throw new Error('Enter a line length greater than zero inches.');
  const pixelsPerInch = distancePx / lengthInches;
  if (!Number.isFinite(pixelsPerInch) || pixelsPerInch <= 0) throw new Error('Enter a valid line length in inches.');
  return { distancePx, pixelsPerInch, gridPixels: pixelsPerInch / 2 };
}

/** Each point chooses its nearest other point; mutual pairs are returned once. */
export function nearestNeighborLinks(points) {
  const links = new Map();
  for (let i = 0; i < points.length; i++) {
    let nearest = -1, distancePx = Infinity;
    for (let j = 0; j < points.length; j++) {
      if (i === j) continue;
      const distance = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
      if (distance < distancePx) { nearest = j; distancePx = distance; }
    }
    if (nearest < 0) continue;
    const from = Math.min(i, nearest), to = Math.max(i, nearest);
    links.set(`${from}:${to}`, { from, to, distancePx });
  }
  return [...links.values()];
}

/** Maximum number of one-to-one center matches within a distance tolerance. */
export function matchPointsWithin(manual, automatic, tolerancePx) {
  const assigned = Array(automatic.length).fill(-1);
  function tryMatch(i, seen) {
    for (let j = 0; j < automatic.length; j++) {
      if (seen[j] || Math.hypot(manual[i].x - automatic[j].x, manual[i].y - automatic[j].y) > tolerancePx) continue;
      seen[j] = true;
      if (assigned[j] < 0 || tryMatch(assigned[j], seen)) { assigned[j] = i; return true; }
    }
    return false;
  }
  let matches = 0;
  for (let i = 0; i < manual.length; i++) if (tryMatch(i, Array(automatic.length).fill(false))) matches++;
  return matches;
}

/**
 * Measure distances and connected groups from detected centers, without image processing.
 * A chain A—B—C is one group when A is close to B and B is close to C,
 * even if A and C are farther apart than the threshold. Single fish have groups too.
 * groupIds[i] indexes groupSizes for detections[i]; these IDs apply to this frame only.
 */
export function analyzeFrame(detections, thresholdPx) {
  const fishCount = detections.length;
  const nearestDistances = Array(fishCount).fill(Infinity);

  // Union-find: each fish starts in its own group. Joining a close pair merges
  // their groups; following parent pointers finds the group's representative.
  const parent = Array.from({ length: fishCount }, (_, index) => index);
  function findGroup(index) {
    if (parent[index] !== index) parent[index] = findGroup(parent[index]);
    return parent[index];
  }
  function joinGroups(first, second) {
    parent[findGroup(first)] = findGroup(second);
  }

  let pairDistanceSum = 0;
  let pairCount = 0;
  for (let first = 0; first < fishCount; first++) {
    for (let second = first + 1; second < fishCount; second++) {
      const distance = Math.hypot(
        detections[first].x - detections[second].x,
        detections[first].y - detections[second].y
      );
      pairDistanceSum += distance;
      pairCount++;
      nearestDistances[first] = Math.min(nearestDistances[first], distance);
      nearestDistances[second] = Math.min(nearestDistances[second], distance);
      if (distance <= thresholdPx) joinGroups(first, second);
    }
  }

  // Replace internal representatives with consecutive IDs, in detection order.
  const groupNumbers = new Map();
  const groupIds = detections.map((_, index) => {
    const representative = findGroup(index);
    if (!groupNumbers.has(representative)) groupNumbers.set(representative, groupNumbers.size);
    return groupNumbers.get(representative);
  });
  const groupSizes = Array(groupNumbers.size).fill(0);
  for (const id of groupIds) groupSizes[id]++;

  return {
    fishCount,
    pairCount,
    meanPairDistancePx: pairCount ? pairDistanceSum / pairCount : null,
    meanNearestDistancePx: fishCount > 1
      ? nearestDistances.reduce((sum, distance) => sum + distance, 0) / fishCount : null,
    closeFishFraction: fishCount
      ? nearestDistances.filter(distance => distance <= thresholdPx).length / fishCount : null,
    clusterCount: groupSizes.filter(size => size >= 2).length,
    isolatedCount: groupSizes.filter(size => size === 1).length,
    groupSizes,
    groupIds
  };
}

// Compare the observed nearest-neighbor spacing with fish placed uniformly in the crop.
// A fixed seed makes the comparison reproducible across redraws and exports.
export function randomSpacingReference(count, crop, samples = 399, exclusions = []) {
  if (count < 2 || !crop?.width || !crop?.height) return null;
  const origin = { ...crop, x: crop.x ?? 0, y: crop.y ?? 0 };
  // Polygon runs use uniform rejection from the bounding box. Keep the original
  // rectangle sequence unchanged for existing recordings and regression results.
  const polygonArea = Boolean(crop.polygon || exclusions.some(box => box.polygon));
  const rectangles = usableRectangles(origin, exclusions.filter(box => !box.polygon));
  const area = rectangles.reduce((sum, box) => sum + box.width * box.height, 0);
  if (!area) return null;
  let seed = (Math.imul(count, 2654435761) ^ Math.imul(crop.width, 2246822519) ^ Math.imul(crop.height, 3266489917)) >>> 0;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  function randomPoint() {
    if (polygonArea) {
      for (let attempt = 0; attempt < 10000; attempt++) {
        const point = { x: origin.x + random() * crop.width, y: origin.y + random() * crop.height };
        if (insideAnalysisArea(point, origin, exclusions)) return point;
      }
      return null;
    }
    // Preserve the original reference sequence when there are no exclusions.
    if (!exclusions.length) return { x: random() * crop.width, y: random() * crop.height };
    let target = random() * area;
    let chosen = rectangles.at(-1);
    for (const box of rectangles) {
      target -= box.width * box.height;
      if (target < 0) { chosen = box; break; }
    }
    return { x: chosen.x + random() * chosen.width, y: chosen.y + random() * chosen.height };
  }
  const distances = [];
  for (let sample = 0; sample < samples; sample++) {
    const points = Array.from({ length: count }, randomPoint);
    if (points.some(point => !point)) return null;
    const nearest = Array(count).fill(Infinity);
    for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
      const distance = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
      nearest[i] = Math.min(nearest[i], distance);
      nearest[j] = Math.min(nearest[j], distance);
    }
    distances.push(nearest.reduce((sum, distance) => sum + distance, 0) / count);
  }
  distances.sort((a, b) => a - b);
  return distances;
}

export function spacingPercentile(observed, reference) {
  if (!Number.isFinite(observed) || !reference?.length) return null;
  const below = reference.filter(distance => distance <= observed).length;
  return (below + 1) / (reference.length + 1);
}

export function summarizeFrames(frames) {
  const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const valid = key => frames.map(f => f.metrics[key]).filter(Number.isFinite);
  return {
    frameCount: frames.length,
    meanFishCount: mean(valid('fishCount')),
    meanPairDistancePx: mean(valid('meanPairDistancePx')),
    meanPairDistanceInches: mean(valid('meanPairDistanceInches')),
    meanNearestDistancePx: mean(valid('meanNearestDistancePx')),
    meanNearestDistanceInches: mean(valid('meanNearestDistanceInches')),
    meanCloseFishFraction: mean(valid('closeFishFraction')),
    meanClusterCount: mean(valid('clusterCount'))
  };
}

export function sampleTimes(durationSeconds, intervalMs) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isFinite(intervalMs) || intervalMs <= 0) return [];
  const durationMs = durationSeconds * 1000;
  const count = Math.ceil(durationMs / intervalMs);
  return Array.from({ length: count }, (_, i) => i * intervalMs).filter(ms => ms < durationMs);
}

export function csv(rows, columns) {
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return [columns.map(quote).join(','), ...rows.map(row => columns.map(key => quote(row[key])).join(','))].join('\r\n');
}
