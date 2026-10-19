export function mapCanvasPoint(clientX, clientY, rect, frameWidth, frameHeight) {
  return {
    x: Math.round(Math.max(0, Math.min(frameWidth, (clientX - rect.left) * frameWidth / rect.width))),
    y: Math.round(Math.max(0, Math.min(frameHeight, (clientY - rect.top) * frameHeight / rect.height)))
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

export function normalizePredictions(predictions, width, height, minConfidence = 0) {
  const list = Array.isArray(predictions) ? predictions : predictions?.predictions;
  if (!Array.isArray(list)) throw new Error('The model returned an unexpected prediction format.');
  return list.filter(p => {
    const label = String(p.class ?? p.className ?? '').toLowerCase();
    return !label || label.includes('fish');
  }).map((p, index) => ({
    detectionId: index + 1,
    className: String(p.class ?? p.className ?? 'fish'),
    confidence: Number(p.confidence ?? p.score ?? 1),
    x: Number(p.bbox?.x ?? p.x), y: Number(p.bbox?.y ?? p.y),
    width: Number(p.bbox?.width ?? p.width ?? 0), height: Number(p.bbox?.height ?? p.height ?? 0)
  })).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) &&
    p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height &&
    Number.isFinite(p.confidence) && p.confidence >= minConfidence);
}

export function analyzeFrame(detections, thresholdPx) {
  const n = detections.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const nearest = Array(n).fill(Infinity);
  const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  const join = (a, b) => { parent[find(a)] = find(b); };
  let pairSum = 0, pairCount = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const d = Math.hypot(detections[i].x - detections[j].x, detections[i].y - detections[j].y);
    pairSum += d; pairCount++;
    nearest[i] = Math.min(nearest[i], d);
    nearest[j] = Math.min(nearest[j], d);
    if (d <= thresholdPx) join(i, j);
  }
  const groups = new Map();
  const groupIds = [];
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, groups.size);
    groupIds.push(groups.get(root));
  }
  const groupSizes = Array(groups.size).fill(0);
  for (const id of groupIds) groupSizes[id]++;
  return {
    fishCount: n,
    pairCount,
    meanPairDistancePx: pairCount ? pairSum / pairCount : null,
    meanNearestDistancePx: n > 1 ? nearest.reduce((a, b) => a + b, 0) / n : null,
    closeFishFraction: n ? nearest.filter(d => d <= thresholdPx).length / n : null,
    clusterCount: groupSizes.filter(size => size >= 2).length,
    isolatedCount: groupSizes.filter(size => size === 1).length,
    groupSizes,
    groupIds
  };
}

// Compare the observed nearest-neighbor spacing with fish placed uniformly in the crop.
// A fixed seed makes the comparison reproducible across redraws and exports.
export function randomSpacingReference(count, crop, samples = 399) {
  if (count < 2 || !crop?.width || !crop?.height) return null;
  let seed = (Math.imul(count, 2654435761) ^ Math.imul(crop.width, 2246822519) ^ Math.imul(crop.height, 3266489917)) >>> 0;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const distances = [];
  for (let sample = 0; sample < samples; sample++) {
    const points = Array.from({ length: count }, () => ({ x: random() * crop.width, y: random() * crop.height }));
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
