import { frameCandidates } from './candidate-selection.mjs';

/** Applied centers control result inclusion; original candidates control review. */
export function framePassesCountFilter(frame, config) {
  return !config.filterExactCount || frame.detections.length === config.filterFrameCount;
}

export function automaticCandidateCount(frame) {
  return frameCandidates(frame).length;
}

/** Return stable collection indices so filtering never reassigns marks or labels. */
export function reviewFrameIndices(frames, mode, knownFishCount) {
  return frames.flatMap((frame, index) => mode !== 'mismatches' || automaticCandidateCount(frame) !== knownFishCount ? [index] : []);
}
