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
  for (let i = 0; i < n; i++) groups.set(find(i), (groups.get(find(i)) ?? 0) + 1);
  return {
    fishCount: n,
    pairCount,
    meanPairDistancePx: pairCount ? pairSum / pairCount : null,
    meanNearestDistancePx: n > 1 ? nearest.reduce((a, b) => a + b, 0) / n : null,
    closeFishFraction: n ? nearest.filter(d => d <= thresholdPx).length / n : null,
    clusterCount: [...groups.values()].filter(size => size >= 2).length,
    isolatedCount: [...groups.values()].filter(size => size === 1).length
  };
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
