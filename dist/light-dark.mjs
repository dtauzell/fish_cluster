import { trackSingleFishSides } from './side-tracking.mjs';
import { singleFishVelocity } from './velocity.mjs';

/** Adjacent observed endpoints estimate occupancy; crossing intervals split equally. */
export function lightDarkReport(frames, config, options = {}) {
  const sides = trackSingleFishSides(frames, config);
  const velocity = singleFishVelocity(frames, config);
  const validEnds = new Set((velocity?.intervals ?? []).map(interval => interval.endFrameIndex));
  const samples = (sides?.samples ?? frames.map(frame => ({ frameIndex: frame.frameIndex, timestampMs: frame.timestampMs, side: 'unknown', changed: false })))
    .map(sample => ({ ...sample, intervalSeconds: 0, darkTimeSeconds: 0, lightTimeSeconds: 0, unknownTimeSeconds: 0 }));
  let observedDurationSeconds = 0, darkTimeSeconds = 0, lightTimeSeconds = 0, unknownTimeSeconds = 0;
  for (let i = 1; i < samples.length; i++) {
    const previous = samples[i - 1], current = samples[i];
    const elapsed = (current.timestampMs - previous.timestampMs) / 1000;
    if (!Number.isFinite(elapsed) || elapsed <= 0) continue;
    observedDurationSeconds += elapsed;
    current.intervalSeconds = elapsed;
    if (!validEnds.has(current.frameIndex) || previous.side === 'unknown' || current.side === 'unknown') {
      current.unknownTimeSeconds = elapsed;
    } else if (previous.side === current.side) {
      current[current.side === 'dark' ? 'darkTimeSeconds' : 'lightTimeSeconds'] = elapsed;
    } else {
      current.darkTimeSeconds = elapsed / 2;
      current.lightTimeSeconds = elapsed / 2;
    }
    darkTimeSeconds += current.darkTimeSeconds;
    lightTimeSeconds += current.lightTimeSeconds;
    unknownTimeSeconds += current.unknownTimeSeconds;
  }
  return { method: 'adjacent-observed-zone-intervals-v1', darkTimeSeconds, lightTimeSeconds, unknownTimeSeconds,
    observedDurationSeconds, zoneSwitchCount: sides?.changes.length ?? 0,
    averageSpeedPxPerSecond: velocity?.averagePxPerSecond ?? null,
    averageSpeedInchesPerSecond: velocity?.averageInchesPerSecond ?? null,
    velocityDurationSeconds: (velocity?.measuredDurationMs ?? 0) / 1000,
    // Summing the side intervals separately can exceed the total by a rounding
    // error. Keep complete coverage valid for saved-trial fraction validation.
    coverageFraction: observedDurationSeconds ? Math.min(1, (darkTimeSeconds + lightTimeSeconds) / observedDurationSeconds) : null,
    samples, velocity };
}
