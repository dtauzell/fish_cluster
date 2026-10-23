import { frameCandidates } from './candidate-selection.mjs';
import { insideAnalysisArea } from './region.mjs';
// Plain-data export formatting. These functions have no browser or page-state dependencies.
import { csv } from './analysis.mjs';
import { groupSignature } from './measurements.mjs';
import { compareFrame, insideCrop } from './review.mjs';
import { framePassesCountFilter, automaticCandidateCount } from './frame-selection.mjs';

export function baseName(fileName) { return (fileName ?? 'fish-video').replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-') || 'fish-video'; }
export function exportedSettings(settings, frameWidth, frameHeight) {
  const { key, ...safe } = settings;
  return { ...safe, frameWidth, frameHeight, modelReference: safe.projectSlug === 'zebrafish_in_aquarium' && safe.version === 9 ? 'https://universe.roboflow.com/zebrafish-zxjvh/zebrafish_in_aquarium' : null };
}
const positionColumns = ['position_source', 'position_uncertain', 'track_id',
  'track_last_observed_timestamp_ms', 'track_reacquired', 'track_reacquired_timestamp_ms', 'split_size_reference_area_px'];
function positionFields(point) {
  return { position_source: point.positionSource ?? (point.splitFromBlob ? 'overlap-estimate' : 'observed'),
    position_uncertain: point.positionUncertain ?? Boolean(point.splitFromBlob),
    track_id: point.trackId, track_last_observed_timestamp_ms: point.trackLastObservedTimestampMs,
    track_reacquired: point.trackReacquired ?? false,
    track_reacquired_timestamp_ms: point.trackReacquiredTimestampMs,
    split_size_reference_area_px: point.splitSizeReferenceArea };
}
function detectionsRows(frames) {
  return frames.flatMap(frame => frame.detections.map((detection, index) => {
    const groupId = frame.metrics.groupIds[index];
    return {
      frame_index: frame.frameIndex,
      timestamp_ms: frame.timestampMs,
      detection_id: detection.detectionId,
      group_id: groupId + 1,
      group_size: frame.metrics.groupSizes[groupId],
      class: detection.className,
      confidence: detection.confidence,
      x_px: detection.x,
      y_px: detection.y,
      box_width_px: detection.width,
      box_height_px: detection.height,
      blob_area_px: detection.area,
      split_from_blob: detection.splitFromBlob ?? false,
      split_reason: detection.splitReason,
      split_reference_timestamp_ms: detection.splitReferenceTimestampMs,
      source_blob_area_px: detection.sourceBlobArea,
      edge_recovered: detection.edgeRecovered ?? false,
      distance_from_center_px: detection.distanceFromCenterPx,
      sharpness: detection.sharpness,
      local_contrast: detection.localContrast,
      sharpness_pixel_count: detection.sharpnessPixelCount,
      sharpness_clipped: detection.sharpnessClipped,
      ...positionFields(detection)
    };
  }));
}

export function detectionsCsv(frames) {
  return csv(detectionsRows(frames), ['frame_index', 'timestamp_ms', 'detection_id', 'group_id', 'group_size', 'class', 'confidence', 'x_px', 'y_px', 'box_width_px', 'box_height_px', 'blob_area_px', 'split_from_blob', 'edge_recovered', 'sharpness', 'local_contrast', 'sharpness_pixel_count', 'sharpness_clipped', 'distance_from_center_px', 'split_reason', 'source_blob_area_px', 'split_reference_timestamp_ms', ...positionColumns]);
}

function framesRows(frames) {
  return frames.map((frame, index) => ({
    frame_index: frame.frameIndex,
    timestamp_ms: frame.timestampMs,
    rawPredictionCount: frame.rawPredictionCount,
    rejectedCandidateCount: frame.rejectedDetections?.length ?? 0,
    splitCandidateCount: frame.detections.filter(point => point.splitFromBlob).length,
    manualCorrectionApplied: frame.manualCorrectionApplied ?? false,
    automaticFishCount: (frame.automaticDetections ?? frame.detections).length,
    ...frame.metrics,
    groupSizes: groupSignature(frame),
    groupChanged: index > 0 && groupSignature(frame) !== groupSignature(frames[index - 1])
  }));
}

export function framesCsv(frames) {
  return csv(framesRows(frames), ['frame_index', 'timestamp_ms', 'rawPredictionCount', 'fishCount', 'countDifference', 'pairCount', 'meanPairDistancePx', 'meanPairDistanceInches', 'meanNearestDistancePx', 'meanNearestDistanceInches', 'closeFishFraction', 'clusterCount', 'isolatedCount', 'groupSizes', 'groupChanged', 'randomSpacingPercentile', 'randomSpacingUnavailableReason', 'rejectedCandidateCount', 'splitCandidateCount', 'uncertainPositionCount', 'manualPositionCount', 'manualCorrectionApplied', 'automaticFishCount']);
}

function humanRows(frames, marksByFrame, reviewed, config) {
  return frames.flatMap((frame, index) => {
    const marks = marksByFrame.get(index) ?? [];
    const { within: inCrop, manual: metrics, automatic, matched } = compareFrame(frame, marks, config);
    const common = { frame_index: frame.frameIndex, frame_number: frame.frameIndex + 1, timestamp_ms: frame.timestampMs,
      included_in_results: framePassesCountFilter(frame, config),
      automatic_candidate_count: automaticCandidateCount(frame),
      reviewed: reviewed.has(index), manual_fish_count_in_crop: marks.filter(mark => insideCrop(mark, config.crop)).length,
      manual_fish_count_in_analysis: inCrop.length,
      manual_fish_count_outside_crop: marks.filter(mark => !insideCrop(mark, config.crop)).length,
      automatic_fish_count: automatic.fishCount, manual_cluster_count: metrics.clusterCount,
      automatic_cluster_count: automatic.clusterCount,
      manual_correction_applied: frame.manualCorrectionApplied ?? false,
      result_fish_count: frame.metrics.fishCount,
      matched_center_count: matched,
      manual_group_sizes: [...metrics.groupSizes].sort((a, b) => b - a).join('+'),
      automatic_group_sizes: groupSignature({ metrics: automatic }), close_distance_inches: config.thresholdInches };
    return marks.length ? marks.map((mark, markIndex) => ({ ...common, mark_number: markIndex + 1,
      x_px: mark.x.toFixed(2), y_px: mark.y.toFixed(2), inside_crop: insideCrop(mark, config.crop),
      included_in_analysis: insideAnalysisArea(mark, config.crop, config.exclusions),
      manual_group_id: insideAnalysisArea(mark, config.crop, config.exclusions) ? metrics.groupIds[inCrop.indexOf(mark)] + 1 : null })) : [common];
  });
}

export function humanCsv(frames, marksByFrame, reviewed, config) {
  return csv(humanRows(frames, marksByFrame, reviewed, config), ['frame_index', 'frame_number', 'timestamp_ms', 'reviewed', 'manual_fish_count_in_crop', 'manual_fish_count_outside_crop', 'automatic_fish_count', 'matched_center_count', 'manual_cluster_count', 'automatic_cluster_count', 'manual_group_sizes', 'automatic_group_sizes', 'close_distance_inches', 'mark_number', 'x_px', 'y_px', 'inside_crop', 'included_in_analysis', 'manual_group_id', 'manual_fish_count_in_analysis', 'manual_correction_applied', 'result_fish_count', 'included_in_results', 'automatic_candidate_count']);
}


/** Labels are diagnostic annotations only; every saved detection is still exported. */
export function sharpnessCsv(frames, labelsByFrame) {
  const rows = frames.flatMap(frame => frameCandidates(frame).map(candidate => ({
    frame_index: frame.frameIndex,
    frame_number: frame.frameIndex + 1,
    timestamp_ms: frame.timestampMs,
    detection_id: candidate.detectionId,
    x_px: candidate.x,
    y_px: candidate.y,
    sharpness: candidate.sharpness,
    local_contrast: candidate.localContrast,
    sharpness_pixel_count: candidate.sharpnessPixelCount,
    sharpness_clipped: candidate.sharpnessClipped,
    included_in_analysis: !candidate.rejectionReason,
    rejection_reason: candidate.rejectionReason,
    distance_from_center_px: candidate.distanceFromCenterPx,
    human_label: labelsByFrame.get(frame.frameIndex)?.get(candidate.detectionId) ?? '',
    split_from_blob: candidate.splitFromBlob ?? false,
    split_reason: candidate.splitReason,
    split_reference_timestamp_ms: candidate.splitReferenceTimestampMs,
    source_blob_area_px: candidate.sourceBlobArea,
    edge_recovered: candidate.edgeRecovered ?? false,
    ...positionFields(candidate)
  })));
  return csv(rows, ['frame_index', 'frame_number', 'timestamp_ms', 'detection_id', 'x_px', 'y_px',
    'sharpness', 'local_contrast', 'sharpness_pixel_count', 'sharpness_clipped', 'human_label',
    'split_from_blob', 'edge_recovered', 'included_in_analysis', 'rejection_reason', 'distance_from_center_px', 'split_reason', 'source_blob_area_px', 'split_reference_timestamp_ms', ...positionColumns]);
}

export function exportedSharpnessLabels(labelsByFrame) {
  return [...labelsByFrame].flatMap(([frameIndex, labels]) =>
    [...labels].map(([detectionId, label]) => ({ frameIndex, detectionId, label })));
}
