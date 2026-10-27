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

/** Cap single-fish runs without presenting a near-tie as a reliable observation. */
export function selectSingleFishCandidate(candidates, crop, options = {}) {
  const measured = selectCentralCandidates(candidates, crop).detections;
  const supported = point => Number.isFinite(point?.foregroundContrast) && point.supportPixelCount >= 5 &&
    !point.splitFromBlob && !point.positionUncertain;
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
  }
  const ranked = [...measured].sort((a, b) => (b.foregroundContrast ?? -Infinity) - (a.foregroundContrast ?? -Infinity));
  const winner = ranked[0], runnerUp = ranked[1];
  const confident = Boolean(winner && supported(winner) && (!runnerUp ||
    (ranked.slice(1).every(supported) && winner.foregroundContrast >= runnerUp.foregroundContrast * 1.5 &&
      winner.foregroundContrast - runnerUp.foregroundContrast >= 8)));
  return { selectionMethod: SINGLE_FISH_SELECTION_METHOD, selectionConfident: confident,
    detections: winner ? [{ ...winner, positionUncertain: !confident || Boolean(winner.positionUncertain) }] : [],
    rejectedDetections: measured.filter(point => point !== winner).map(point => ({ ...point,
      rejectionReason: confident ? 'weaker-foreground-contrast' : 'ambiguous-single-fish' })) };
}

/** Extra candidates are resolved only by the recorded, confident selection rule. */
export function hasAmbiguousRejectedCandidates(frame) {
  if (!frame.rejectedDetections?.length) return false;
  const reason = frame.selectionMethod === SINGLE_FISH_SELECTION_METHOD ? 'weaker-foreground-contrast'
    : frame.selectionMethod === TRACKED_SINGLE_FISH_SELECTION_METHOD ? 'weaker-track-continuity' : null;
  return !(reason && frame.selectionConfident === true &&
    frame.rejectedDetections.every(point => point.rejectionReason === reason));
}
