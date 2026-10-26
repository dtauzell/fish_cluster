import { analysisTankSide, usesSingleFishSides } from './tank-zones.mjs';
import { framePassesCountFilter } from './frame-selection.mjs';

export const SIDE_TRACKING_METHOD = 'single-fish-marked-dark-complement-light-v1';

/** Known sampled side, distinct from the geometric side of an uncertain center. */
export function observedFishSide(frame, config) {
  if (!usesSingleFishSides(config) || !framePassesCountFilter(frame, config) || frame.detections.length !== 1 ||
    (!frame.manualCorrectionApplied && frame.rejectedDetections?.length)) return 'unknown';
  const point = frame.detections[0];
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.positionUncertain || point.splitFromBlob ||
    (point.positionSource && !['observed', 'manual'].includes(point.positionSource))) return 'unknown';
  const side = analysisTankSide(point, config);
  return side === 'unmarked' ? 'unknown' : side;
}

/** Keep every original sample: review filters must never invent crossings across gaps. */
export function trackSingleFishSides(frames, config) {
  if (!usesSingleFishSides(config)) return null;
  const changes = [];
  const samples = frames.map((frame, index) => {
    const side = observedFishSide(frame, config);
    const previous = frames[index - 1];
    const from = previous ? observedFishSide(previous, config) : 'unknown';
    const elapsed = previous ? frame.timestampMs - previous.timestampMs : 0;
    const a = previous?.detections[0], b = frame.detections[0];
    const trackChanged = a?.trackId != null && b?.trackId != null && a.trackId !== b.trackId &&
      a.positionSource !== 'manual' && b.positionSource !== 'manual';
    const changed = side !== 'unknown' && from !== 'unknown' && side !== from && !trackChanged &&
      Number.isInteger(previous?.frameIndex) && frame.frameIndex === previous.frameIndex + 1 &&
      Number.isFinite(elapsed) && elapsed > 0 && (!Number.isFinite(config.intervalMs) || elapsed <= config.intervalMs * 1.5);
    if (changed) changes.push({ sampleIndex: index, frameIndex: frame.frameIndex, timestampMs: frame.timestampMs, from, to: side });
    return { frameIndex: frame.frameIndex, timestampMs: frame.timestampMs, side, changed };
  });
  return { method: SIDE_TRACKING_METHOD, samples, changes,
    darkSampleCount: samples.filter(sample => sample.side === 'dark').length,
    lightSampleCount: samples.filter(sample => sample.side === 'light').length,
    unknownSampleCount: samples.filter(sample => sample.side === 'unknown').length };
}

export function visibleSideChanges(report, indices) {
  const changed = new Set(report.changes.map(change => change.sampleIndex));
  return indices.flatMap((sampleIndex, position) => changed.has(sampleIndex) ? [position] : []);
}
