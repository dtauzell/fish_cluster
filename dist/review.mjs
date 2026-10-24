import { analyzeFrame, matchPointsWithin } from './analysis.mjs';
import { frameMetrics, groupSignature } from './measurements.mjs';
import { insideAnalysisArea } from './region.mjs';
export { insideCrop } from './region.mjs';

export function compareFrame(frame, marks, config) {
  const within = marks.filter(point => insideAnalysisArea(point, config.crop, config.exclusions));
  const manual = analyzeFrame(within, config.thresholdPx);
  // Match centers within half an inch, allowing each center to be used only once.
  const detections = frame.automaticDetections ?? frame.detections;
  const automatic = analyzeFrame(detections, config.thresholdPx);
  const matched = matchPointsWithin(within, detections, config.pixelsPerInch * 0.5);
  return { within, manual, automatic, matched, outside: marks.length - within.length };
}

/** An absent draft accepts the current result; an explicit empty draft can remove centers. */
export function hasPendingCenters(frame, marks, config) {
  if (!marks) return false;
  const within = marks.filter(point => insideAnalysisArea(point, config.crop, config.exclusions));
  return within.length !== frame.detections.length || within.some((point, index) =>
    point.x !== frame.detections[index].x || point.y !== frame.detections[index].y);
}

/** Apply a complete set of manual centers to this frame; preserve the automatic result for audit/undo. */
export function applyManualCenters(frame, marks, config) {
  const automaticDetections = frame.automaticDetections ?? frame.detections;
  const detections = marks.filter(point => insideAnalysisArea(point, config.crop, config.exclusions))
    .map((point, index) => ({ x: point.x, y: point.y, detectionId: index + 1,
      className: 'manually marked fish', positionSource: 'manual', positionUncertain: false }));
  return { ...frame, automaticDetections, detections, manualCorrectionApplied: true,
    metrics: frameMetrics(detections, config) };
}

export function restoreAutomaticCenters(frame, config) {
  if (!frame.automaticDetections) return frame;
  const { automaticDetections, manualCorrectionApplied, ...rest } = frame;
  return { ...rest, detections: automaticDetections,
    metrics: frameMetrics(automaticDetections, config, frame.rejectedDetections?.length ?? 0) };
}

export function summarizeReview(frames, marks, reviewed, config) {
  let countMatches = 0;
  let centerMatches = 0;
  let groupMatches = 0;
  for (const index of reviewed) {
    const frame = frames[index];
    const { manual, automatic, matched } = compareFrame(frame, marks.get(index) ?? [], config);
    if (manual.fishCount === automatic.fishCount) countMatches++;
    if (matched === manual.fishCount && matched === automatic.fishCount) centerMatches++;
    if (groupSignature({ metrics: manual }) === groupSignature({ metrics: automatic })) groupMatches++;
  }
  return { countMatches, centerMatches, groupMatches };
}
