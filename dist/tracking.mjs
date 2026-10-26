import { minimumCostAssignment } from './point-assignment.mjs';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const TRACKING_METHOD = { version: 2, maxSampleGapMs: 250, maxObservationAgeMs: 1000,
  maxMatchDistancePx: 45, foregroundTolerancePx: 8 };

/**
 * Short-lived, provisional fish identities, in original-video coordinates.
 * Observations update motion; split estimates only carry a position forward.
 * A carried position can never renew the one-second observation deadline.
 * No missing fish is created without a current foreground region to split.
 */
export function createFishTracker(expectedFish) {
  let tracks = [], nextId = 1, lastTimestamp = null;

  function expire(timestampMs) {
    if (lastTimestamp != null && (timestampMs <= lastTimestamp || timestampMs - lastTimestamp > TRACKING_METHOD.maxSampleGapMs)) tracks = [];
    tracks = tracks.filter(track => timestampMs - track.observedAt <= TRACKING_METHOD.maxObservationAgeMs);
  }

  function predict(track, timestampMs) {
    // During overlap the last visible velocity can become misleading as fish
    // turn. Use the current joined-region estimate without extrapolating it.
    if (track.pending.length) return { ...track.position };
    const elapsed = Math.min(250, timestampMs - track.seenAt);
    return { x: track.position.x + track.velocity.x * elapsed, y: track.position.y + track.velocity.y * elapsed };
  }

  /** Recent separately observed fish provide a size baseline when several pairs merge at once. */
  function sizeReference(timestampMs) {
    expire(timestampMs);
    const observed = tracks.filter(track => track.observations >= 2 &&
      timestampMs - track.seenAt <= TRACKING_METHOD.maxSampleGapMs && track.area > 0);
    if (observed.length < 3) return null;
    const areas = observed.map(track => track.area).sort((a, b) => a - b);
    const middle = Math.floor(areas.length / 2);
    const area = areas.length % 2 ? areas[middle] : (areas[middle - 1] + areas[middle]) / 2;
    return { area, referenceTimestampMs: Math.min(...observed.map(track => track.observedAt)) };
  }

  /** Exactly two established paths entering one foreground region can seed a split. */
  function overlapSeeds(blobs, frameWidth, timestampMs, crop = { x: 0, y: 0 }) {
    expire(timestampMs);
    const groups = new Map();
    for (const track of tracks) {
      if (track.observations < 2 || timestampMs - track.seenAt > TRACKING_METHOD.maxSampleGapMs) continue;
      const prediction = predict(track, timestampMs);
      const predicted = { x: prediction.x - crop.x, y: prediction.y - crop.y };
      let nearest = null, nearestDistance = Infinity;
      for (const blob of blobs) for (const index of blob.pixels ?? []) {
        const gap = distance(predicted, { x: index % frameWidth, y: Math.floor(index / frameWidth) });
        if (gap < nearestDistance) { nearest = blob; nearestDistance = gap; }
      }
      if (!nearest || nearestDistance > TRACKING_METHOD.foregroundTolerancePx) continue;
      if (!groups.has(nearest)) groups.set(nearest, []);
      groups.get(nearest).push({ track, predicted });
    }
    const result = new Map();
    for (const [blob, entries] of groups) {
      if (entries.length !== 2 || distance(entries[0].predicted, entries[1].predicted) < 10) continue;
      // A small fragment or reflection must not inherit two full fish paths.
      if (blob.area < .6 * entries.reduce((sum, entry) => sum + entry.track.area, 0)) continue;
      result.set(blob, { seeds: entries.map(entry => entry.predicted),
        trackIds: entries.map(entry => entry.track.id),
        referenceTimestampMs: Math.min(...entries.map(entry => entry.track.observedAt)) });
    }
    return result;
  }

  /** Attach identities to kept detections, then update only the supported paths. */
  function update(detections, timestampMs) {
    expire(timestampMs);
    const unmatchedCost = TRACKING_METHOD.maxMatchDistancePx;
    const costs = tracks.map(track => detections.map(point => {
      if (point.positionUncertain && !point.splitFromBlob) return unmatchedCost + 1;
      if (point.sourceTrackIds && !point.sourceTrackIds.includes(track.id)) return unmatchedCost + 1;
      return distance(predict(track, timestampMs), point);
    }));
    const assignment = minimumCostAssignment(costs, unmatchedCost);
    const matched = new Set();
    const output = detections.map(point => ({ ...point,
      positionSource: point.splitFromBlob ? 'overlap-estimate' : 'observed',
      positionUncertain: Boolean(point.positionUncertain || point.splitFromBlob) }));
    for (const [index, track] of tracks.entries()) {
      const column = assignment[index];
      if (column < 0) continue;
      const point = output[column];
      matched.add(column);
      point.trackId = track.id;
      point.trackLastObservedTimestampMs = track.observedAt;
      if (!point.positionUncertain) {
        const elapsed = timestampMs - track.observedAt;
        const velocity = { x: (point.x - track.observed.x) / elapsed, y: (point.y - track.observed.y) / elapsed };
        const speed = Math.hypot(velocity.x, velocity.y);
        const factor = speed > .15 ? .15 / speed : 1; // At most 30 pixels per 200 ms.
        track.velocity = { x: velocity.x * factor, y: velocity.y * factor };
        if (track.pending.length) {
          point.trackReacquired = true;
          // Later visibility supports continuity, but never makes a hidden center observed.
          for (const estimate of track.pending) estimate.trackReacquiredTimestampMs = timestampMs;
          track.pending = [];
        }
        track.observed = { x: point.x, y: point.y };
        track.observedAt = timestampMs;
        track.observations++;
        track.area = point.area ?? track.area;
        point.trackLastObservedTimestampMs = timestampMs;
      } else track.pending.push(point);
      track.position = { x: point.x, y: point.y };
      track.seenAt = timestampMs;
    }
    for (const [index, point] of output.entries()) {
      if (matched.has(index) || point.positionUncertain) continue;
      if (tracks.length >= expectedFish) {
        // Reuse capacity only from an unmatched path; it gets a new identity.
        const unused = tracks.findIndex((track, i) => assignment[i] < 0);
        if (unused < 0) continue;
        tracks.splice(unused, 1);
        assignment.splice(unused, 1);
      }
      const track = { id: nextId++, position: { x: point.x, y: point.y },
        observed: { x: point.x, y: point.y }, observedAt: timestampMs, seenAt: timestampMs,
        velocity: { x: 0, y: 0 }, observations: 1, area: point.area ?? 0, pending: [] };
      tracks.push(track);
      assignment.push(index);
      point.trackId = track.id;
      point.trackLastObservedTimestampMs = timestampMs;
    }
    lastTimestamp = timestampMs;
    return output;
  }

  return { overlapSeeds, sizeReference, update };
}
