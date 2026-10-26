import { framePassesCountFilter } from './frame-selection.mjs';
import { hasAmbiguousRejectedCandidates } from './candidate-selection.mjs';

export const VELOCITY_METHOD = 'single-fish-adjacent-centers-v1';

function observedCenter(frame, config) {
  if (!framePassesCountFilter(frame, config) || frame.detections.length !== 1 ||
    (!frame.manualCorrectionApplied && hasAmbiguousRejectedCandidates(frame))) return null;
  const point = frame.detections[0];
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.positionUncertain || point.splitFromBlob ||
    (point.positionSource && !['observed', 'manual'].includes(point.positionSource))) return null;
  return point;
}

/** Scalar speed; gaps and uncertain positions never become long displacement intervals. */
export function singleFishVelocity(frames, config) {
  if (config?.expectedFish !== 1) return null;
  const scale = Number.isFinite(config.pixelsPerInch) && config.pixelsPerInch > 0 ? config.pixelsPerInch : null;
  const intervals = [];
  for (let i = 1; i < frames.length; i++) {
    const previous = frames[i - 1], current = frames[i];
    const a = observedCenter(previous, config), b = observedCenter(current, config);
    const elapsedMs = current.timestampMs - previous.timestampMs;
    if (!a || !b || !Number.isFinite(elapsedMs) || elapsedMs <= 0 ||
      !Number.isInteger(previous.frameIndex) || current.frameIndex !== previous.frameIndex + 1 ||
      (Number.isFinite(config.intervalMs) && elapsedMs > config.intervalMs * 1.5)) continue;
    const manual = a.positionSource === 'manual' || b.positionSource === 'manual';
    if (!manual && a.trackId != null && b.trackId != null && a.trackId !== b.trackId) continue;
    const distancePx = Math.hypot(b.x - a.x, b.y - a.y);
    const speedPxPerSecond = distancePx / (elapsedMs / 1000);
    if (!Number.isFinite(speedPxPerSecond)) continue;
    intervals.push({ startFrameIndex: previous.frameIndex, endFrameIndex: current.frameIndex,
      startTimestampMs: previous.timestampMs, endTimestampMs: current.timestampMs,
      timestampMs: (previous.timestampMs + current.timestampMs) / 2, elapsedMs, distancePx, speedPxPerSecond,
      speedInchesPerSecond: scale ? speedPxPerSecond / scale : null });
  }
  let min = null, max = null, distance = 0, elapsedMs = 0;
  for (const interval of intervals) {
    min = min == null ? interval.speedPxPerSecond : Math.min(min, interval.speedPxPerSecond);
    max = max == null ? interval.speedPxPerSecond : Math.max(max, interval.speedPxPerSecond);
    distance += interval.distancePx; elapsedMs += interval.elapsedMs;
  }
  const average = elapsedMs ? distance / (elapsedMs / 1000) : null;
  const times = frames.map(frame => frame.timestampMs).filter(Number.isFinite);
  return { method: VELOCITY_METHOD, pixelsPerInch: scale,
    startTimestampMs: times[0] ?? 0, endTimestampMs: times.at(-1) ?? 0,
    validIntervalCount: intervals.length, possibleIntervalCount: Math.max(0, frames.length - 1),
    measuredDurationMs: elapsedMs, distancePx: distance,
    minPxPerSecond: min, maxPxPerSecond: max, averagePxPerSecond: average,
    minInchesPerSecond: min == null || !scale ? null : min / scale,
    maxInchesPerSecond: max == null || !scale ? null : max / scale,
    averageInchesPerSecond: average == null || !scale ? null : average / scale, intervals };
}

/** Generate a vector chart: disconnected valid intervals remain disconnected. */
export function velocityChart(report, units = 'pixels', selectedTimestampMs = null) {
  if (!report?.intervals.length) return '';
  const divisor = units === 'inches' ? report.pixelsPerInch : 1;
  if (!divisor) return '';
  const start = report.startTimestampMs, span = Math.max(1, report.endTimestampMs - start);
  const ymax = report.maxPxPerSecond / divisor || 1;
  const x = t => 54 + (t - start) / span * 280;
  const y = speed => 155 - speed / divisor / ymax * 120;
  const f = n => n.toFixed(2);
  let path = '', previous = null;
  for (const interval of report.intervals) {
    const joined = previous && previous.endFrameIndex === interval.startFrameIndex;
    path += `${joined ? 'L' : 'M'}${f(x(interval.startTimestampMs))},${f(y(interval.speedPxPerSecond))} L${f(x(interval.endTimestampMs))},${f(y(interval.speedPxPerSecond))} `;
    previous = interval;
  }
  const marker = Number.isFinite(selectedTimestampMs) && selectedTimestampMs >= start && selectedTimestampMs <= report.endTimestampMs
    ? `<line x1="${f(x(selectedTimestampMs))}" x2="${f(x(selectedTimestampMs))}" y1="30" y2="155" stroke="#f6d979" stroke-dasharray="4 4"/>` : '';
  const unit = units === 'inches' ? 'in/s' : 'px/s';
  return `<line x1="54" y1="155" x2="334" y2="155" stroke="#5d7880"/>
    <line x1="54" y1="30" x2="54" y2="155" stroke="#5d7880"/>
    <text x="54" y="20" fill="#a8c2c0" font-size="12">${unit}</text>
    <text x="48" y="39" text-anchor="end" fill="#a8c2c0" font-size="12">${ymax.toFixed(1)}</text>
    <text x="48" y="159" text-anchor="end" fill="#a8c2c0" font-size="12">0</text>
    <text x="54" y="178" fill="#a8c2c0" font-size="12">${(start / 1000).toFixed(1)} s</text>
    <text x="334" y="178" text-anchor="end" fill="#a8c2c0" font-size="12">${(report.endTimestampMs / 1000).toFixed(1)} s</text>
    <path d="${path}" fill="none" stroke="#8ce6ce" stroke-width="2" stroke-linecap="round"/>${marker}`;
}
