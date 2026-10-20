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
