/**
 * Optionally keep the N centers nearest the rectangular crop's center.
 * This is a geometric heuristic, not evidence that a candidate is a reflection.
 * Preserve original order and IDs so groups, review labels, and exports agree.
 */
export function selectCentralCandidates(candidates, crop, maximumCount = null) {
  if (maximumCount != null && (!Number.isInteger(maximumCount) || maximumCount < 1)) {
    throw new Error('Candidate limit must be a positive integer.');
  }
  const centerX = crop.x + crop.width / 2;
  const centerY = crop.y + crop.height / 2;
  const measured = candidates.map(candidate => ({ ...candidate,
    distanceFromCenterPx: Math.hypot(candidate.x - centerX, candidate.y - centerY) }));
  if (maximumCount == null || measured.length <= maximumCount) {
    return { detections: measured, rejectedDetections: [] };
  }
  // Modern JS sorting is stable: equal distances retain detection order.
  const ranked = [...measured].sort((a, b) => a.distanceFromCenterPx - b.distanceFromCenterPx);
  const kept = new Set(ranked.slice(0, maximumCount));
  return {
    detections: measured.filter(candidate => kept.has(candidate)),
    rejectedDetections: measured.filter(candidate => !kept.has(candidate))
      .map(candidate => ({ ...candidate, rejectionReason: 'farther-from-crop-center' }))
  };
}

/** Review all candidates, including those omitted from counts and grouping. */
export function frameCandidates(frame) {
  return [...(frame.automaticDetections ?? frame.detections), ...(frame.rejectedDetections ?? [])]
    .sort((a, b) => a.detectionId - b.detectionId);
}

export const SINGLE_FISH_SELECTION_METHOD = 'foreground-contrast-margin-v1';
export const TRACKED_SINGLE_FISH_SELECTION_METHOD = 'foreground-track-continuity-v1';
export const BOUNDARY_SINGLE_FISH_SELECTION_METHOD = 'foreground-boundary-margin-v1';
export const MOTION_SINGLE_FISH_SELECTION_METHOD = 'foreground-motion-continuity-v1';
export const NEXT_FRAME_SINGLE_FISH_SELECTION_METHOD = 'foreground-next-frame-continuity-v1';

// A long, very thin region running along a tank wall is weak identity evidence,
// even when its brightness changes more than a faint fish farther inside.
function followsTankWall(point, crop) {
  if (!(point.width > 0) || !(point.height > 0)) return false;
  const short = Math.min(point.width, point.height), long = Math.max(point.width, point.height);
  if (short > 6 || long < 40 || long / short < 10) return false;
  const vertices = crop.polygon ?? [{ x: crop.x, y: crop.y }, { x: crop.x + crop.width, y: crop.y },
    { x: crop.x + crop.width, y: crop.y + crop.height }, { x: crop.x, y: crop.y + crop.height }];
  return vertices.some((start, index) => {
    const end = vertices[(index + 1) % vertices.length];
    const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy);
    if (!length) return false;
    const parallel = (point.height > point.width ? Math.abs(dy) : Math.abs(dx)) / length;
    if (parallel < .95) return false;
    const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length ** 2));
    return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy) <= 8;
  });
}

function supportedSingleFishCandidate(point) {
  return Number.isFinite(point?.foregroundContrast) && point.supportPixelCount >= 5 &&
    !point.splitFromBlob && !point.positionUncertain;
}

/** Cap single-fish runs without presenting a near-tie as a reliable observation. */
export function selectSingleFishCandidate(candidates, crop, options = {}) {
  const measured = selectCentralCandidates(candidates, crop).detections;
  const supported = supportedSingleFishCandidate;
  const previousPoint = options.previousPoint;
  if (previousPoint && Number.isFinite(previousPoint.x) && Number.isFinite(previousPoint.y)) {
    const nearby = measured.filter(supported).map(point => ({ point,
      distance: Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y) }))
      .filter(entry => entry.distance <= (options.maxTrackDistancePx ?? 45))
      .sort((a, b) => a.distance - b.distance);
    if (nearby.length && (!nearby[1] || nearby[1].distance - nearby[0].distance >= 8)) {
      const winner = nearby[0].point;
      return { selectionMethod: TRACKED_SINGLE_FISH_SELECTION_METHOD, selectionConfident: true,
        detections: [{ ...winner, positionUncertain: false }],
        rejectedDetections: measured.filter(point => point !== winner).map(point => ({ ...point,
          rejectionReason: 'weaker-track-continuity' })) };
    }
    const predicted = options.predictedPoint;
    if (nearby.length > 1 && Number.isFinite(predicted?.x) && Number.isFinite(predicted?.y)) {
      const motion = nearby.map(({ point }) => ({ point,
        distance: Math.hypot(point.x - predicted.x, point.y - predicted.y) }))
        .sort((a, b) => a.distance - b.distance);
      if (motion[0].distance <= (options.maxTrackDistancePx ?? 45) && motion[1].distance - motion[0].distance >= 8) {
        const winner = motion[0].point;
        return { selectionMethod: MOTION_SINGLE_FISH_SELECTION_METHOD, selectionConfident: true,
          selectionPrediction: { ...predicted },
          detections: [{ ...winner, positionUncertain: false }],
          rejectedDetections: measured.filter(point => point !== winner).map(point => ({ ...point,
            rejectionReason: 'weaker-motion-continuity' })) };
      }
    }
  }
  const wallRegions = new Set(measured.filter(point => supported(point) && followsTankWall(point, crop)));
  const interior = measured.filter(point => !wallRegions.has(point));
  // Keep isolated wall candidates available, and let an existing observed track
  // above follow a fish near a wall. Apply this preference only with an alternative.
  const boundaryPreference = wallRegions.size > 0 && interior.some(supported);
  const ranked = [...(boundaryPreference ? interior : measured)]
    .sort((a, b) => (b.foregroundContrast ?? -Infinity) - (a.foregroundContrast ?? -Infinity));
  const winner = ranked[0], runnerUp = ranked[1];
  const confident = Boolean(winner && supported(winner) && (!runnerUp ||
    (ranked.slice(1).every(supported) && winner.foregroundContrast >= runnerUp.foregroundContrast * 1.5 &&
      winner.foregroundContrast - runnerUp.foregroundContrast >= 8)));
  return { selectionMethod: boundaryPreference ? BOUNDARY_SINGLE_FISH_SELECTION_METHOD : SINGLE_FISH_SELECTION_METHOD, selectionConfident: confident,
    detections: winner ? [{ ...winner, positionUncertain: !confident || Boolean(winner.positionUncertain) }] : [],
    rejectedDetections: measured.filter(point => point !== winner).map(point => ({ ...point,
      rejectionReason: confident ? boundaryPreference && wallRegions.has(point)
        ? 'wall-like-boundary-region' : 'weaker-foreground-contrast' : 'ambiguous-single-fish' })) };
}

/** Reconsider original candidates using one independently observed next center. */
export function selectSingleFishFromNextFrame(candidates, crop, nextPoint) {
  if (candidates.length < 2 || !supportedSingleFishCandidate(nextPoint) ||
    nextPoint.positionSource === 'overlap-estimate') return null;
  const selected = selectSingleFishCandidate(candidates, crop, { previousPoint: nextPoint });
  // A contrast fallback is not evidence from the next frame. Keep the original
  // choice when no candidate is close enough or the distance margin is unclear.
  if (selected.selectionMethod !== TRACKED_SINGLE_FISH_SELECTION_METHOD) return null;
  return { ...selected, selectionMethod: NEXT_FRAME_SINGLE_FISH_SELECTION_METHOD,
    rejectedDetections: selected.rejectedDetections.map(point => ({ ...point,
      rejectionReason: 'weaker-next-frame-continuity' })) };
}

/** Extra candidates are resolved only by the recorded, confident selection rule. */
export function hasAmbiguousRejectedCandidates(frame) {
  if (!frame.rejectedDetections?.length) return false;
  const reasons = frame.selectionMethod === SINGLE_FISH_SELECTION_METHOD ? ['weaker-foreground-contrast']
    : frame.selectionMethod === TRACKED_SINGLE_FISH_SELECTION_METHOD ? ['weaker-track-continuity']
    : frame.selectionMethod === MOTION_SINGLE_FISH_SELECTION_METHOD ? ['weaker-motion-continuity']
    : frame.selectionMethod === NEXT_FRAME_SINGLE_FISH_SELECTION_METHOD ? ['weaker-next-frame-continuity']
    : frame.selectionMethod === BOUNDARY_SINGLE_FISH_SELECTION_METHOD ? ['wall-like-boundary-region', 'weaker-foreground-contrast'] : [];
  return !(reasons.length && frame.selectionConfident === true &&
    frame.rejectedDetections.every(point => reasons.includes(point.rejectionReason)));
}
