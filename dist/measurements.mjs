// Measurements use centers in original video pixels; no image or DOM access is needed.
import { analyzeFrame, randomSpacingReference, spacingPercentile } from './analysis.mjs';

const referenceCache = new Map();

function referenceFor(count, crop, exclusions = []) {
  const key = JSON.stringify([count, crop, exclusions]);
  if (!referenceCache.has(key)) referenceCache.set(key, randomSpacingReference(count, crop, 399, exclusions));
  return referenceCache.get(key);
}

export function frameMetrics(detections, config, rejectedCount = 0) {
  const metrics = analyzeFrame(detections, config.thresholdPx);
  // Selecting central candidates biases spacing inward. A uniform placement of
  // only the kept count is no longer a fair reference for these frames.
  const previousFrameEstimate = detections.some(point =>
    ['previous-frame-overlap', 'tracking-overlap', 'recent-observed-size'].includes(point.splitReason));
  metrics.randomSpacingPercentile = rejectedCount || previousFrameEstimate ? null
    : spacingPercentile(metrics.meanNearestDistancePx, referenceFor(detections.length, config.crop, config.exclusions));
  metrics.randomSpacingUnavailableReason = rejectedCount ? 'center-selection'
    : previousFrameEstimate ? 'temporal-overlap-estimate' : null;
  metrics.uncertainPositionCount = detections.filter(point => point.positionUncertain || point.splitFromBlob).length;
  metrics.manualPositionCount = detections.filter(point => point.positionSource === 'manual').length;
  metrics.meanPairDistanceInches = metrics.meanPairDistancePx == null ? null : metrics.meanPairDistancePx / config.pixelsPerInch;
  metrics.meanNearestDistanceInches = metrics.meanNearestDistancePx == null ? null : metrics.meanNearestDistancePx / config.pixelsPerInch;
  if (config.method === 'background') metrics.countDifference = detections.length - config.expectedFish;
  return metrics;
}

export function groupSignature(frame) {
  return [...frame.metrics.groupSizes].sort((a, b) => b - a).join('+');
}

export function changeFrames(frames) {
  const changes = [];
  for (let i = 1; i < frames.length; i++) {
    if (groupSignature(frames[i]) !== groupSignature(frames[i - 1])) changes.push(i);
  }
  return changes;
}
