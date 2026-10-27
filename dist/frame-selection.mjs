import { frameCandidates, hasAmbiguousRejectedCandidates } from './candidate-selection.mjs';

/** Applied centers control result inclusion; original candidates control review. */
export function framePassesCountFilter(frame, config) {
  return !config.filterExactCount || frame.detections.length === config.filterFrameCount;
}

export function automaticCandidateCount(frame) {
  return frameCandidates(frame).length;
}

/** Current applied results determine review flags; corrected history stays in exports. */
export function reviewFrameFlags(frame) {
  const missing = frame.detections.length === 0;
  const ambiguous = !missing && !frame.manualCorrectionApplied &&
    (frame.selectionConfident === false || hasAmbiguousRejectedCandidates(frame));
  const uncertain = frame.detections.some(point => point.positionUncertain || point.splitFromBlob ||
    (point.positionSource && !['observed', 'manual'].includes(point.positionSource)));
  return { missing, ambiguous, uncertain, flagged: missing || ambiguous || uncertain };
}

/** Return stable collection indices so filtering never reassigns marks or labels. */
export function reviewFrameIndices(frames, mode, knownFishCount, config = {}) {
  return frames.flatMap((frame, index) => {
    if (mode === 'included' && !framePassesCountFilter(frame, config)) return [];
    if (mode === 'mismatches' && automaticCandidateCount(frame) === knownFishCount) return [];
    if (['missing', 'ambiguous', 'uncertain', 'flagged'].includes(mode) && !reviewFrameFlags(frame)[mode]) return [];
    return [index];
  });
}
