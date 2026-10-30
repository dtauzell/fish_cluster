import { analysisTankSide, darkZoneMask } from './tank-zones.mjs';
import { selectCentralCandidates, preferOutsideReflectionAreas, selectSingleFishCandidate, selectSingleFishFromNextFrame } from './candidate-selection.mjs';
import { candidateSharpness } from './sharpness.mjs';
import { insideAnalysisArea, localExclusions, analysisPixelMask } from './region.mjs';
import { sampleTimes } from './analysis.mjs';
import { detectBackgroundFish, medianBackground, backgroundVariation } from './background.mjs';
import { frameMetrics } from './measurements.mjs';
import { createFishTracker } from './tracking.mjs';
import { framePassesCountFilter } from './frame-selection.mjs';

// Let the browser paint progress and handle Cancel between expensive operations.
const yieldToBrowser = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * Run detection without knowing about buttons, charts, or page state.
 *
 * The source supplies decoded pixels from the local video.
 * Yield progress messages and completed frames so callers can keep partial results.
 * Crop-local centers become original-video coordinates before any measurements.
 */
export async function* analyzeVideo({ config, duration, source, isStopped = () => false }) {
  const times = sampleTimes(duration, config.intervalMs);
  const { crop } = config;
  const exclusions = localExclusions(crop, (config.exclusions ?? []).filter(area => !area.preferenceOnly));
  const darkZones = darkZoneMask(crop, config.tankZones);
  const analysisMask = analysisPixelMask(crop, config.exclusions);
  let variation = null;
  let previousFrame = null;
  let previousCandidates = null;
  let background = null;
  const tracker = config.trackFish !== false ? createFishTracker(config.expectedFish,
    { minimumObservationSpanMs: config.interveningFrames ? Math.min(250, config.intervalMs) : 0 }) : null;
  let previousOutputs = [];
  let emittedSamples = 0;
  let processedVideoFrames = 0;
  async function* processingFrames() {
    if (!config.interveningFrames) {
      for (const [index, timestampMs] of times.entries()) {
        if (isStopped()) return;
        await source.seekTo(timestampMs / 1000);
        yield { timestampMs, gray: source.readGray(crop), outputIndices: [index] };
      }
      return;
    }
    if (!source.nativeFrames) throw new Error('Intervening-frame processing is unavailable for this video source.');
    let next = 0;
    for await (const decoded of source.nativeFrames(crop, isStopped)) {
      const outputIndices = [];
      while (next < times.length && times[next] <= decoded.timestampMs + .001) outputIndices.push(next++);
      yield { ...decoded, outputIndices };
      if (next === times.length) return;
    }
  }

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
  if (config.suppressFlicker !== false && darkZones.some(Boolean)) variation = backgroundVariation(samples, crop.width, crop.height,
    { excludeForegroundRuns: config.expectedFish === 1 });

  for await (const decoded of processingFrames()) {
    if (isStopped()) return;
    const { timestampMs, outputIndices } = decoded;
    processedVideoFrames++;
    const frameIndex = outputIndices[0] ?? -1;
    let gray;
    let detections;
    let rawPredictionCount;

    gray = decoded.gray;
    // Only a complete, observed sample within 250 ms can support a merge.
    // Estimated/split centers are never fed back as fresh observations.
    const canReferencePrevious = previousFrame && timestampMs - previousFrame.timestampMs <= 250 &&
      previousFrame.detections.length === config.expectedFish &&
      previousFrame.detections.every(point => !point.splitFromBlob && !point.positionUncertain);
    const previousDetections = canReferencePrevious ? previousFrame.detections.map(point => ({
      ...point, x: point.x - crop.x, y: point.y - crop.y
    })) : [];
    const candidates = detectBackgroundFish(gray, background, crop.width, crop.height,
      { expectedFish: config.expectedFish, thresholdOverlap: config.thresholdOverlap === true, preferCenter: config.preferCenter, exclusions, darkZones, analysisMask, backgroundVariation: variation, timestampMs,
        ...(crop.polygon ? { edgeX: 0, edgeTop: 0, edgeBottom: 0 } : {}),
        previousDetections, previousTimestampMs: canReferencePrevious ? previousFrame.timestampMs : undefined,
        previousCandidates: (previousCandidates ?? []).map(point => ({ ...point,
          x: point.x - crop.x, y: point.y - crop.y })),
        previousCandidateTimestampMs: previousFrame?.timestampMs,
        observedSizeReference: tracker?.sizeReference(timestampMs),
        overlapSeedsFor: tracker && config.preferCenter
          ? blobs => tracker.overlapSeeds(blobs, crop.width, timestampMs, crop) : undefined });
    detections = candidates.map((candidate, index) => ({
      detectionId: index + 1, className: 'fish candidate', confidence: 1, ...candidate
    }));
    rawPredictionCount = detections.length;

    // Score the same decoded frame used for detection, in crop coordinates.
    if (detections.length && outputIndices.length) {
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
    const preferred = preferOutsideReflectionAreas(detections,
      (config.exclusions ?? []).filter(area => area.preferenceOnly), config.expectedFish, crop, config.preferCenter);
    const selected = config.expectedFish === 1
      ? selectSingleFishCandidate(preferred.detections, crop, { previousPoint: previousTrackPoint,
        predictedPoint: previousTrackPoint ? tracker?.selectionPrediction(timestampMs) : undefined })
      : selectCentralCandidates(preferred.detections, crop, config.preferCenter ? config.expectedFish : null);
    selected.rejectedDetections.push(...preferred.rejectedDetections);
    // A unique current observation can disambiguate the preceding sample. Use
    // its original candidates, before selection introduced uncertainty flags.
    // Frames already yielded remain shared objects, as with track reacquisition.
    if (config.expectedFish === 1 && previousFrame &&
      timestampMs > previousFrame.timestampMs &&
      timestampMs - previousFrame.timestampMs <= 250 && previousCandidates?.length > 1 &&
      detections.length === 1 && selected.selectionConfident === true &&
      selected.rejectedDetections.length === 0) {
      const resolved = selectSingleFishFromNextFrame(previousCandidates, crop, selected.detections[0]);
      if (resolved) {
        const originalSelection = { method: previousFrame.selectionMethod,
          confident: previousFrame.selectionConfident, detectionId: previousFrame.detections[0]?.detectionId };
        resolved.detections = tracker ? tracker.reviseLastUpdate(resolved.detections, previousFrame.timestampMs)
          : resolved.detections.map(point => ({ ...point, positionSource: 'observed' }));
        resolved.rejectedDetections.push(...previousFrame.rejectedDetections.filter(point => point.rejectionReason === 'reflection-area-excess'));
        delete previousFrame.selectionPrediction;
        Object.assign(previousFrame, resolved, { selectionReferenceTimestampMs: timestampMs,
          selectionBeforeLookback: originalSelection,
          metrics: previousOutputs.length ? frameMetrics(resolved.detections, config, resolved.rejectedDetections.length) : null });
        for (const output of previousOutputs) if (output !== previousFrame) Object.assign(output, resolved, { metrics: previousFrame.metrics, selectionReferenceTimestampMs: timestampMs, selectionBeforeLookback: originalSelection });
      }
    }
    selected.detections = tracker ? tracker.update(selected.detections, timestampMs)
      : selected.detections.map(point => ({ ...point,
        positionSource: point.splitFromBlob ? 'overlap-estimate' : 'observed',
        positionUncertain: Boolean(point.positionUncertain || point.splitFromBlob) }));
    const frame = { frameIndex, timestampMs, rawPredictionCount, ...selected,
      metrics: outputIndices.length ? frameMetrics(selected.detections, config, selected.rejectedDetections.length) : null };
    previousFrame = frame;
    previousCandidates = preferred.detections;
    previousOutputs = [];
    if (!outputIndices.length) {
      yield { type: 'status', progress: 10 + timestampMs / (duration * 1000) * 90,
        message: `Processing intervening frames · ${(timestampMs / 1000).toFixed(1)} seconds` };
    }
    for (const index of outputIndices) {
      const output = config.interveningFrames ? { ...frame, frameIndex: index,
        timestampMs: times[index], sourceTimestampMs: timestampMs, processedVideoFrames } : frame;
      previousOutputs.push(output);
      emittedSamples++;
      const progress = 10 + (index + 1) / times.length * 90;
      if (!framePassesCountFilter(output, config)) {
        yield { type: 'skipped', frame: output, progress, frameIndex: index, total: times.length,
          fishCount: output.detections.length, requiredFishCount: config.filterFrameCount };
      } else yield { type: 'frame', frame: output, total: times.length, progress };
    }
    await yieldToBrowser();
  }
  // A requested sample can lie after the final native frame but before duration.
  // Retain that final decoded image rather than silently dropping the sample.
  if (config.interveningFrames && !isStopped() && previousFrame) {
    for (let index = emittedSamples; index < times.length; index++) {
      const output = { ...previousFrame, frameIndex: index, timestampMs: times[index],
        sourceTimestampMs: previousFrame.timestampMs, processedVideoFrames,
        metrics: frameMetrics(previousFrame.detections, config, previousFrame.rejectedDetections.length) };
      yield { type: framePassesCountFilter(output, config) ? 'frame' : 'skipped', frame: output,
        frameIndex: index, total: times.length, progress: 10 + (index + 1) / times.length * 90,
        fishCount: output.detections.length, requiredFishCount: config.filterFrameCount };
    }
  }
}
