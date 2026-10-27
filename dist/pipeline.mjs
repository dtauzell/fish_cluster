import { analysisTankSide, darkZoneMask } from './tank-zones.mjs';
import { selectCentralCandidates, selectSingleFishCandidate } from './candidate-selection.mjs';
import { candidateSharpness } from './sharpness.mjs';
import { insideAnalysisArea, localExclusions, analysisPixelMask } from './region.mjs';
import { normalizePredictions, sampleTimes } from './analysis.mjs';
import { detectBackgroundFish, medianBackground, backgroundVariation } from './background.mjs';
import { frameMetrics } from './measurements.mjs';
import { createFishTracker } from './tracking.mjs';
import { framePassesCountFilter } from './frame-selection.mjs';

// Let the browser paint progress and handle Cancel between expensive operations.
const yieldToBrowser = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * Run detection without knowing about buttons, charts, or page state.
 *
 * The source supplies decoded pixels; prepareModel supplies an optional model.
 * Yield progress messages and completed frames so callers can keep partial results.
 * Crop-local centers become original-video coordinates before any measurements.
 */
export async function* analyzeVideo({ config, duration, source, prepareModel, isStopped = () => false }) {
  const times = sampleTimes(duration, config.intervalMs);
  const { crop } = config;
  const exclusions = localExclusions(crop, config.exclusions);
  const darkZones = darkZoneMask(crop, config.tankZones);
  const analysisMask = analysisPixelMask(crop, config.exclusions);
  let variation = null;
  let previousFrame = null;
  let background = null;
  let model = null;
  const backgroundMode = config.method === 'background';
  const tracker = backgroundMode && config.trackFish !== false ? createFishTracker(config.expectedFish) : null;

  if (backgroundMode) {
    // At each pixel, the median of these samples estimates the stationary tank.
    const sampleCount = Math.min(25, Math.max(1, Math.ceil(duration * 2)));
    const samples = [];
    for (let i = 0; i < sampleCount; i++) {
      if (isStopped()) return;
      await source.seekTo((i + 0.5) * duration / sampleCount);
      samples.push(source.readGray(crop));
      yield { type: 'status', progress: (i + 1) / sampleCount * 10,
        message: `Building tank background · ${i + 1} of ${sampleCount} samples` };
      await yieldToBrowser();
    }
    yield { type: 'status', progress: 10, message: 'Finding the median tank background…' };
    background = medianBackground(samples);
    if (config.suppressFlicker !== false && darkZones.some(Boolean)) variation = backgroundVariation(samples, crop.width, crop.height);
  } else {
    yield { type: 'status', progress: 0, message: 'Preparing Roboflow model in this browser…' };
    model = await prepareModel(config);
  }

  for (const [frameIndex, timestampMs] of times.entries()) {
    if (isStopped()) return;
    await source.seekTo(timestampMs / 1000);
    let gray;
    let detections;
    let rawPredictionCount;

    if (backgroundMode) {
      gray = source.readGray(crop);
      // Only a complete, observed sample within 250 ms can support a merge.
      // Estimated/split centers are never fed back as fresh observations.
      const canReferencePrevious = previousFrame && timestampMs - previousFrame.timestampMs <= 250 &&
        previousFrame.detections.length === config.expectedFish &&
        previousFrame.detections.every(point => !point.splitFromBlob && !point.positionUncertain);
      const previousDetections = canReferencePrevious ? previousFrame.detections.map(point => ({
        ...point, x: point.x - crop.x, y: point.y - crop.y
      })) : [];
      const candidates = detectBackgroundFish(gray, background, crop.width, crop.height,
        { expectedFish: config.expectedFish, preferCenter: config.preferCenter, exclusions, darkZones, analysisMask, backgroundVariation: variation,
          ...(crop.polygon ? { edgeX: 0, edgeTop: 0, edgeBottom: 0 } : {}),
          previousDetections, previousTimestampMs: canReferencePrevious ? previousFrame.timestampMs : undefined,
          observedSizeReference: tracker?.sizeReference(timestampMs),
          overlapSeedsFor: tracker && config.preferCenter
            ? blobs => tracker.overlapSeeds(blobs, crop.width, timestampMs, crop) : undefined });
      detections = candidates.map((candidate, index) => ({
        detectionId: index + 1, className: 'fish candidate', confidence: 1, ...candidate
      }));
      rawPredictionCount = detections.length;
    } else {
      const bitmap = await source.readBitmap(crop);
      let predictions;
      try {
        predictions = await model.engine.infer(model.workerId, bitmap);
      } finally {
        bitmap.close();
      }
      rawPredictionCount = Array.isArray(predictions) ? predictions.length : (predictions?.predictions?.length ?? 0);
      detections = normalizePredictions(predictions, crop.width, crop.height, config.confidence);
    }

    // Score the same decoded frame used for detection, in crop coordinates.
    // Background mode reuses its grayscale image; model mode reads one on demand.
    if (detections.length) {
      gray ??= source.readGray(crop);
      detections = detections.map(candidate => ({ ...candidate,
        ...candidateSharpness(gray, crop.width, crop.height, candidate, exclusions) }));
    }
    detections = detections.map(point => ({ ...point, x: point.x + crop.x, y: point.y + crop.y,
      tankSide: analysisTankSide({ x: point.x + crop.x, y: point.y + crop.y }, config) }));
    // A split region's estimated center must also fall in the usable area.
    detections = detections.filter(point => insideAnalysisArea(point, crop, config.exclusions));
    const previousTrackPoint = previousFrame?.detections.length === 1 &&
      previousFrame.timestampMs < timestampMs && timestampMs - previousFrame.timestampMs <= 250 &&
      previousFrame.selectionConfident !== false && !previousFrame.detections[0].positionUncertain &&
      previousFrame.detections[0].positionSource !== 'overlap-estimate'
      ? previousFrame.detections[0] : undefined;
    const selected = backgroundMode && config.expectedFish === 1
      ? selectSingleFishCandidate(detections, crop, { previousPoint: previousTrackPoint })
      : selectCentralCandidates(detections, crop, backgroundMode && config.preferCenter ? config.expectedFish : null);
    selected.detections = tracker ? tracker.update(selected.detections, timestampMs)
      : selected.detections.map(point => ({ ...point,
        positionSource: point.splitFromBlob ? 'overlap-estimate' : 'observed',
        positionUncertain: Boolean(point.positionUncertain || point.splitFromBlob) }));
    const frame = { frameIndex, timestampMs, rawPredictionCount, ...selected,
      metrics: frameMetrics(selected.detections, config, selected.rejectedDetections.length) };
    previousFrame = frame;
    const preparationProgress = backgroundMode ? 10 : 0;
    const progress = preparationProgress + (frameIndex + 1) / times.length * (100 - preparationProgress);
    if (!framePassesCountFilter(frame, config)) {
      yield { type: 'skipped', frame, progress, frameIndex, total: times.length, fishCount: frame.detections.length,
        requiredFishCount: config.filterFrameCount };
      await yieldToBrowser();
      continue;
    }
    yield { type: 'frame', frame, total: times.length,
      progress };
    await yieldToBrowser();
  }
}
