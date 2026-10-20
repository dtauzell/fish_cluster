import { SHARPNESS_METHOD } from './sharpness.mjs';
import { TRACKING_METHOD } from './tracking.mjs';
import { analyzeFrame, cropFitsFrame, inchesToPixels, mapCanvasPoint, summarizeFrames } from './analysis.mjs';
import { createSettings } from './settings.mjs';
import { frameMetrics, groupSignature, changeFrames as findChangeFrames } from './measurements.mjs';
import { createModelService, modelIdentity, modelErrorMessage } from './model.mjs';
import { createVideoSource } from './video.mjs';
import { createPreview } from './preview.mjs';
import { fmt, timeLabel } from './format.mjs';
import { baseName, detectionsCsv, framesCsv, exportedSettings, exportedSharpnessLabels } from './exports.mjs';
import { download } from './download.mjs';
import { createHumanReview } from './human-ui.mjs';
import { analyzeVideo } from './pipeline.mjs';
import { createLabeling } from './labeling-ui.mjs';

const $ = id => document.getElementById(id);
const video = $('source-video');
const canvas = $('frame-canvas');
const humanCanvas = $('human-canvas');
const state = {
  file: null,
  url: null,
  frames: [],
  settings: null,
  crop: null,
  exclusions: [],
  drag: null,
  running: false,
  stopped: false,
  resultsReady: false,
  previewToken: 0,
  human: { marks: new Map(), candidateLabels: new Map(), reviewed: new Set(), index: null, loading: false }
};
let previewSeek = Promise.resolve();
// The entry point owns page state and translates UI actions into service calls.
const videoSource = createVideoSource(video);
const { showFirstFrame, seekToDrawableFrame } = videoSource;
const { prepare: prepareModel } = createModelService();
const preview = createPreview(canvas, video);
function drawFrame(frame) {
  const crop = state.drag && !state.drag.exclude ? state.drag.box : state.crop;
  const exclusions = state.drag?.exclude ? [...state.exclusions, state.drag.box] : state.exclusions;
  preview.drawFrame(frame, state.settings?.thresholdPx, crop, exclusions, $('show-sharpness').checked);
}
function changeFrames() { return findChangeFrames(state.frames); }
const { selectHumanFrame } = createHumanReview({ state, video, humanCanvas, queuePreviewSeek,
  onFrameCorrected: () => showResults(true) });
const labeling = createLabeling({ canvas: $('label-canvas'), source: videoSource, isRunning: () => state.running,
  queueSeek: (timestampMs, capture) => {
    const token = ++state.previewToken;
    previewSeek = previewSeek.catch(() => {}).then(async () => {
      if (token !== state.previewToken) return;
      await seekToDrawableFrame(timestampMs / 1000);
      if (token === state.previewToken) await capture();
    });
    return previewSeek;
  } });

$('open-labeler').addEventListener('click', async () => {
  if (!state.file || state.running || video.readyState < 2) return;
  const file = state.file;
  $('open-labeler').disabled = true;
  try {
    await labeling.start({ video: { name: file.name, size: file.size, lastModified: file.lastModified,
      width: video.videoWidth, height: video.videoHeight, duration: video.duration },
      crop: state.crop ?? { x: 0, y: 0, width: video.videoWidth, height: video.videoHeight },
      intervalMs: Number($('interval').value) });
    if (state.file === file) location.hash = '#labeling';
  } catch (error) { status(error.message, true); }
  finally { $('open-labeler').disabled = state.running || !state.file || video.readyState < 2; }
});

function status(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}
window.addEventListener('unhandledrejection', event => {
  const detail = event.reason?.message ?? String(event.reason);
  status(`Browser model error: ${detail}`, true);
});
function resetHuman() {
  state.human = { marks: new Map(), candidateLabels: new Map(), reviewed: new Set(), index: null, loading: false };
  $('human-link').hidden = true;
}

function clearResults() {
  ++state.previewToken;
  state.frames = [];
  state.resultsReady = false;
  resetHuman();
  $('results').hidden = true;
  $('frame-slider').disabled = true;
  $('frame-position').textContent = 'Frame —';
  $('frame-groups').hidden = true;
  $('timeline').hidden = true;
}

function loadMetadata(file) {
  if (!file || state.running) return;
  labeling.reset();
  ++state.previewToken;
  if (state.url) URL.revokeObjectURL(state.url);
  state.file = file;
  state.url = URL.createObjectURL(file);
  clearResults();
  state.crop = null;
  state.exclusions = [];
  $('crop-tool').value = 'crop';
  updateMaskControls();
  state.drag = null;
  $('canvas-wrap').style.aspectRatio = '16 / 10';
  $('crop-fields').disabled = true;
  $('mask-tools').disabled = true;
  $('clear-crop').disabled = true;
  $('crop-label').textContent = 'Drag on the preview to select the tank area.';
  video.src = state.url;
  video.load();
  $('file-label').textContent = file.name;
  $('video-meta').hidden = true;
  $('empty-preview').hidden = false;
  $('empty-preview').querySelector('strong').textContent = 'Loading first frame…';
  $('analyze').disabled = true;
  $('open-labeler').disabled = true;
  status('Reading video metadata…');
}

$('video-file').addEventListener('change', e => loadMetadata(e.target.files[0]));
function updateMethod() {
  const background = $('method').value === 'background';
  $('background-settings').hidden = !background;
  $('model-settings').hidden = background;
  clearResults();
  if (state.file && !state.running) status(background ? 'Video ready. Check the tank crop, then analyze.' : 'Video ready. The Roboflow model will load when you analyze.');
}
$('method').addEventListener('change', updateMethod);
updateMethod();
const dropzone = $('dropzone');
for (const type of ['dragenter', 'dragover']) dropzone.addEventListener(type, e => { e.preventDefault(); dropzone.classList.add('dragging'); });
for (const type of ['dragleave', 'drop']) dropzone.addEventListener(type, e => { e.preventDefault(); dropzone.classList.remove('dragging'); });
dropzone.addEventListener('drop', e => loadMetadata(e.dataTransfer.files[0]));
video.addEventListener('loadedmetadata', async () => {
  const selectedFile = state.file;
  if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth) { status('This video has no readable duration or dimensions.', true); return; }
  $('video-meta').hidden = false;
  $('video-meta').textContent = `${video.videoWidth} × ${video.videoHeight} px · ${timeLabel(video.duration * 1000)} · ${(state.file.size / 1048576).toFixed(1)} MB`;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  $('canvas-wrap').style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
  $('crop-fields').disabled = false;
  $('mask-tools').disabled = false;
  if (state.file?.name.toLowerCase() === 'fish.mov' && video.videoWidth === 540 && video.videoHeight === 960) {
    state.crop = { x: 50, y: 240, width: 420, height: 290 };
    $('clear-crop').disabled = false;
    $('crop-label').textContent = 'Tested tank crop: 420 × 290 px. Drag to adjust.';
  }
  setCropInputs(state.crop ?? { x: 0, y: 0, width: video.videoWidth, height: video.videoHeight });
  try {
    await showFirstFrame();
    if (state.file !== selectedFile) return;
    drawFrame(null);
    $('empty-preview').hidden = true;
    $('frame-time').textContent = timeLabel(video.currentTime * 1000);
  } catch (error) {
    if (state.file === selectedFile) status(`Could not show the first frame: ${error.message}`, true);
    return;
  }
  $('analyze').disabled = false;
  $('open-labeler').disabled = false;
  if ($('method').value === 'background') { status('Video ready. Check the tank crop, then analyze.'); return; }
  status('Preparing model while you choose the tank area…');
  try {
    const config = settings();
    prepareModel(config).then(model => {
      const currentIdentity = modelIdentity({ projectSlug: $('model-slug').value.trim(), version: Number($('model-version').value), key: $('publishable-key').value.trim() });
      if (!state.running && state.file === selectedFile && model.identity === currentIdentity) status('Model ready. Drag around the tank or analyze the full frame.');
    }).catch(error => {
      if (!state.running && state.file === selectedFile && $('method').value === 'roboflow') status(modelErrorMessage(error, config), true);
    });
  } catch (error) { status(error.message, true); }
});
video.addEventListener('error', () => status('The browser could not decode this video. Try an MP4 or WebM file.', true));

function pointOnCanvas(event) {
  const rect = canvas.getBoundingClientRect();
  return mapCanvasPoint(event.clientX, event.clientY, rect, canvas.width, canvas.height);
}

function setCropInputs(box) {
  $('crop-x').value = box.x;
  $('crop-y').value = box.y;
  $('crop-width').value = box.width;
  $('crop-height').value = box.height;
}

function commitCrop(box) {
  const { x, y, width, height } = box;
  if (!cropFitsFrame(box, video.videoWidth, video.videoHeight)) {
    throw new Error(`Crop must be at least 30 × 30 px and fit inside ${video.videoWidth} × ${video.videoHeight} px.`);
  }
  const full = x === 0 && y === 0 && width === video.videoWidth && height === video.videoHeight;
  state.crop = full ? null : { x, y, width, height };
  clearResults();
  $('clear-crop').disabled = full;
  $('crop-label').textContent = full ? 'Using the full video frame.' : `Tank crop: ${width} × ${height} px at (${x}, ${y}).`;
  setCropInputs(box);
  drawFrame(null);
  status(full ? 'Using the full video frame.' : 'Tank area selected. Analyze to use the crop.');
}

canvas.addEventListener('pointerdown', event => {
  if (!state.file || state.running || video.readyState < 2 || !canvas.width) return;
  const point = pointOnCanvas(event);
  state.drag = { start: point, exclude: $('crop-tool').value === 'exclude', box: { x: point.x, y: point.y, width: 0, height: 0 } };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', event => {
  if (!state.drag) return;
  const point = pointOnCanvas(event);
  const start = state.drag.start;
  state.drag.box = { x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) };
  drawFrame(null);
});
canvas.addEventListener('pointerup', () => {
  if (!state.drag) return;
  const { box, exclude } = state.drag;
  state.drag = null;
  if (exclude && box.width >= 4 && box.height >= 4) {
    state.exclusions.push(box);
    clearResults();
    updateMaskControls();
    drawFrame(null);
    status('Reflection area masked. Analyze again to apply it to all frames.');
    return;
  }
  if (!exclude && box.width >= 30 && box.height >= 30) {
    try { commitCrop(box); } catch (error) { status(error.message, true); }
  } else {
    drawFrame(null);
  }
});
canvas.addEventListener('pointercancel', () => { state.drag = null; drawFrame(null); });
$('apply-crop').addEventListener('click', () => {
  if (state.running || !video.videoWidth) return;
  try {
    commitCrop({ x: Number($('crop-x').value), y: Number($('crop-y').value), width: Number($('crop-width').value), height: Number($('crop-height').value) });
  } catch (error) { status(error.message, true); }
});
$('clear-crop').addEventListener('click', () => {
  if (state.running) return;
  commitCrop({ x: 0, y: 0, width: video.videoWidth, height: video.videoHeight });
});

function updateMaskControls() {
  const count = state.exclusions.length;
  $('mask-count').textContent = count ? `${count} reflection mask${count === 1 ? '' : 's'}.` : 'No reflection masks.';
  $('undo-mask').disabled = count === 0;
  $('clear-masks').disabled = count === 0;
}

for (const id of ['undo-mask', 'clear-masks']) {
  $(id).addEventListener('click', () => {
    if (state.running) return;
    if (id === 'undo-mask') state.exclusions.pop();
    else state.exclusions = [];
    clearResults();
    updateMaskControls();
    drawFrame(null);
    status('Reflection masks changed. Analyze again to update results.');
  });
}

function settings() {
  return createSettings({
    intervalMs: Number($('interval').value),
    thresholdInches: Number($('threshold').value),
    gridPixels: Number($('grid-pixels').value),
    method: $('method').value,
    expectedFish: Number($('expected-fish').value),
    preferCenter: $('prefer-center').checked,
    trackFish: $('track-fish').checked,
    confidence: Number($('confidence').value),
    versionText: $('model-version').value.trim(),
    projectSlug: $('model-slug').value.trim(),
    key: $('publishable-key').value.trim()
  }, state.crop, video.videoWidth, video.videoHeight, state.exclusions);
}

$('prefer-center').addEventListener('change', () => {
  if (state.running) return;
  clearResults();
  drawFrame(null);
  status('Candidate selection changed. Analyze again to apply it.');
});
$('track-fish').addEventListener('change', () => {
  if (state.running) return;
  clearResults();
  drawFrame(null);
  status('Tracking changed. Analyze again to apply it.');
});

$('analyze').addEventListener('click', async () => {
  if (state.running || !state.file) return;
  let config;
  try { config = settings(); } catch (error) { status(error.message, true); return; }
  if (Math.ceil(video.duration * 1000 / config.intervalMs) > 10000) { status('This setting would analyze over 10,000 frames. Increase the frame interval.', true); return; }
  state.running = true;
  state.stopped = false;
  state.settings = config;
  state.frames = [];
  state.resultsReady = false;
  resetHuman();
  $('timeline').hidden = true;
  $('frame-groups').hidden = true;
  $('analyze').disabled = true;
  $('cancel').hidden = false;
  $('results').hidden = true;
  $('video-file').disabled = true;
  $('open-labeler').disabled = true;
  $('method').disabled = true;
  $('prefer-center').disabled = true;
  $('track-fish').disabled = true;
  $('crop-fields').disabled = true;
  $('mask-tools').disabled = true;
  $('progress').hidden = false;
  $('progress').value = 0;
  $('frame-slider').disabled = true;
  try {
    const events = analyzeVideo({
      config, duration: video.duration, source: videoSource, prepareModel,
      isStopped: () => state.stopped
    });
    for await (const event of events) {
      $('progress').value = event.progress;
      if (event.type === 'status') {
        status(event.message);
        continue;
      }
      const { frame, total } = event;
      state.frames.push(frame);
      drawFrame(frame);
      $('empty-preview').hidden = true;
      $('frame-position').textContent = `${frame.frameIndex + 1} / ${total}`;
      $('frame-time').textContent = timeLabel(frame.timestampMs);
      status(config.method === 'background'
        ? `Analyzed ${frame.frameIndex + 1} of ${total} frames · ${frame.detections.length} fish candidates (known count ${config.expectedFish})${frame.rejectedDetections.length ? ` · ${frame.rejectedDetections.length} outer candidates excluded` : ''}`
        : `Analyzed ${frame.frameIndex + 1} of ${total} frames · ${frame.detections.length} fish in current frame (${frame.rawPredictionCount} model boxes)`);
    }
    if (state.stopped && !state.frames.length) return;
    if (state.frames.length) showResults();
    const maxRawCount = Math.max(0, ...state.frames.map(frame => frame.rawPredictionCount));
    status(state.stopped ? `Stopped after ${state.frames.length} frames. Partial results are available.` :
      config.method === 'background' ? `Complete: ${state.frames.length} frames analyzed with background subtraction.` :
      maxRawCount <= 1 ? `Complete: ${state.frames.length} frames. Roboflow returned at most one box per frame; try a tank crop or lower confidence.` :
      `Complete: ${state.frames.length} frames analyzed. Up to ${maxRawCount} model boxes in a frame.`);
  } catch (error) {
    if (state.frames.length) showResults();
    status(config.method === 'background' ? `Analysis stopped: ${error.message}` : modelErrorMessage(error, config), true);
  } finally {
    state.running = false;
    $('analyze').disabled = false;
    $('cancel').hidden = true;
    $('progress').hidden = true;
    $('video-file').disabled = false;
    $('open-labeler').disabled = video.readyState < 2;
    $('method').disabled = false;
    $('prefer-center').disabled = false;
    $('track-fish').disabled = false;
    $('crop-fields').disabled = false;
    $('mask-tools').disabled = false;
  }
});
$('cancel').addEventListener('click', () => { state.stopped = true; status('Stopping after the current frame…'); });

function showResults(preserveSelection = false) {
  const selected = preserveSelection ? Number($('frame-slider').value) : state.frames.length - 1;
  const summary = summarizeFrames(state.frames);
  state.resultsReady = true;
  $('results').hidden = false;
  $('human-link').hidden = false;
  $('stat-fish').textContent = fmt(summary.meanFishCount);
  $('stat-distance').textContent = Number.isFinite(summary.meanPairDistanceInches) ? `${fmt(summary.meanPairDistanceInches, 2)} in` : '—';
  $('distance-note').textContent = `approximate · ${fmt(summary.meanPairDistancePx)} px · ${fmt(state.settings.pixelsPerInch)} px/in`;
  $('stat-close').textContent = Number.isFinite(summary.meanCloseFishFraction) ? `${fmt(summary.meanCloseFishFraction * 100, 0)}%` : '—';
  $('stat-clusters').textContent = fmt(summary.meanClusterCount);
  $('frame-slider').max = state.frames.length - 1;
  $('frame-slider').value = selected;
  $('frame-slider').disabled = false;
  if (!preserveSelection) {
    const cropDiagonalInches = Math.hypot(state.settings.crop.width, state.settings.crop.height) / state.settings.pixelsPerInch;
    $('cluster-distance').max = Math.max(5, Math.min(cropDiagonalInches, state.settings.thresholdInches * 2), state.settings.thresholdInches);
  }
  $('cluster-distance').value = state.settings.thresholdInches;
  $('timeline').hidden = false;
  updateSelectedFrameDetails();
  drawClusterChart();
  drawTimeline();
  const valid = state.frames.map(frame => frame.metrics.randomSpacingPercentile).filter(Number.isFinite);
  const tight = valid.filter(percentile => percentile <= .05).length;
  $('random-summary').textContent = valid.length
    ? `${tight} of ${valid.length} frames (${fmt(100 * tight / valid.length, 0)}%) had mean nearest-neighbor spacing in the tightest 5% of random placements with the same detection count and unmasked tank area. This is a per-frame comparison, not a video-wide significance test.`
    : 'No frames have an available random-spacing comparison; each needs at least two detections and no center-rule exclusions.';
  const centerFiltered = state.frames.filter(frame => frame.metrics.randomSpacingUnavailableReason === 'center-selection').length;
  if (centerFiltered) $('random-summary').textContent += ` ${centerFiltered} frame(s) omitted from this comparison because excluding outer candidates can make spacing artificially tight.`;
  const temporal = state.frames.filter(frame => frame.metrics.randomSpacingUnavailableReason === 'temporal-overlap-estimate').length;
  if (temporal) $('random-summary').textContent += ` ${temporal} frame(s) omitted because some centers use temporal overlap estimates.`;
  const uncertain = state.frames.filter(frame => frame.metrics.uncertainPositionCount).length;
  if (uncertain) $('random-summary').textContent += ` Distances and groups include uncertain overlap estimates in ${uncertain} frame(s). Check these in Human analysis; dashed rings and † mark estimated positions.`;
}

function drawTimeline() {
  const canvas = $('change-timeline');
  const context = canvas.getContext('2d');
  const changes = changeFrames();
  const last = Math.max(1, state.frames.length - 1);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#24444c'; context.fillRect(0, 10, canvas.width, 6);
  context.fillStyle = '#f6d979';
  for (const index of changes) context.fillRect(index / last * (canvas.width - 2), 4, 2, 18);
  const selected = Number($('frame-slider').value);
  context.fillStyle = '#8ce6ce'; context.fillRect(selected / last * (canvas.width - 3), 0, 3, 26);
  $('change-count').textContent = `${changes.length} change${changes.length === 1 ? '' : 's'} in group sizes`;
  $('previous-change').disabled = !changes.some(index => index < selected);
  $('next-change').disabled = !changes.some(index => index > selected);
}

function updateSelectedFrameDetails() {
  const frame = state.frames[Number($('frame-slider').value)];
  if (!frame) return;
  const sizes = frame.metrics.groupSizes;
  const groups = sizes.map((size, index) => `Group ${index + 1}: ${size}`).join(' · ') || 'No detections';
  const percentile = frame.metrics.randomSpacingPercentile;
  $('frame-groups').textContent = `${groups} · ${frame.metrics.clusterCount} group${frame.metrics.clusterCount === 1 ? '' : 's'} of 2+ · ${frame.metrics.isolatedCount} single · ${Number.isFinite(percentile) ? `spacing percentile ${fmt(percentile * 100, 1)}% vs random` : 'random comparison unavailable'}${frame.metrics.uncertainPositionCount ? ` · ${frame.metrics.uncertainPositionCount} uncertain centers` : ''}${frame.manualCorrectionApplied ? ' · manual centers applied' : frame.rejectedDetections?.length ? ` · ${frame.rejectedDetections.length} outer candidates excluded; random comparison skipped` : ''}`;
  $('frame-groups').hidden = false;
  drawTimeline();
}

function drawClusterChart() {
  const frame = state.frames[Number($('frame-slider').value)];
  if (!frame) return;
  const maxInches = Number($('cluster-distance').max);
  const points = Array.from({ length: 101 }, (_, i) => analyzeFrame(frame.detections, maxInches * state.settings.pixelsPerInch * i / 100));
  const ymax = Math.max(1, frame.detections.length);
  const path = key => points.map((point, i) => `${i ? 'L' : 'M'}${30 + i * 5.5},${130 - point[key] * 110 / ymax}`).join(' ');
  const marker = 30 + state.settings.thresholdInches / maxInches * 550;
  $('cluster-chart').innerHTML = `<line x1="30" y1="130" x2="580" y2="130" stroke="#5d7880"/><line x1="30" y1="20" x2="30" y2="130" stroke="#5d7880"/><path d="${path('clusterCount')}" fill="none" stroke="#8ce6ce" stroke-width="3"/><path d="${path('isolatedCount')}" fill="none" stroke="#f6d979" stroke-width="3"/><line x1="${marker}" y1="18" x2="${marker}" y2="130" stroke="#ffffff" stroke-dasharray="4 4"/><text x="30" y="151" fill="#a8c2c0" font-size="12">0 in</text><text x="535" y="151" fill="#a8c2c0" font-size="12">${fmt(maxInches, 1)} in</text><text x="5" y="24" fill="#a8c2c0" font-size="12">${ymax}</text>`;
  $('cluster-distance-label').textContent = `${fmt(state.settings.thresholdInches, 2)} in (${fmt(state.settings.thresholdPx)} px)`;
}

function queuePreviewSeek(token, timestampMs, render) {
  previewSeek = previewSeek.catch(() => {}).then(async () => {
    if (token !== state.previewToken) return;
    await seekToDrawableFrame(timestampMs / 1000);
    if (token === state.previewToken) render();
  }).catch(error => {
    if (token !== state.previewToken) return;
    state.human.loading = false;
    status(error.message, true);
  });
  return previewSeek;
}

function selectFrame(index) {
  const frame = state.frames[index];
  if (!frame || state.running) return;
  $('frame-slider').value = index;
  updateSelectedFrameDetails();
  drawClusterChart();
  const token = ++state.previewToken;
  return queuePreviewSeek(token, frame.timestampMs, () => {
    drawFrame(frame);
    $('frame-position').textContent = state.settings.method === 'background'
      ? `${frame.frameIndex + 1} / ${state.frames.length} · ${frame.detections.length} kept / ${state.settings.expectedFish} expected${frame.rejectedDetections?.length ? ` · ${frame.rejectedDetections.length} outer candidates excluded` : ''}`
      : `${frame.frameIndex + 1} / ${state.frames.length} · ${frame.detections.length} fish / ${frame.rawPredictionCount} boxes`;
    $('frame-time').textContent = timeLabel(frame.timestampMs);
  });
}

$('frame-slider').addEventListener('input', event => selectFrame(Number(event.target.value)));
$('show-sharpness').addEventListener('change', () => {
  if (!state.running) drawFrame(state.frames[Number($('frame-slider').value)] ?? null);
});
function refreshDistanceResults() {
  if (!state.frames.length || state.running) return;
  state.settings.thresholdPx = inchesToPixels(state.settings.thresholdInches, state.settings.gridPixels);
  state.settings.pixelsPerInch = state.settings.gridPixels * 2;
  for (const frame of state.frames) frame.metrics = frameMetrics(frame.detections, state.settings,
    frame.manualCorrectionApplied ? 0 : frame.rejectedDetections?.length ?? 0);
  showResults(true);
  drawFrame(state.frames[Number($('frame-slider').value)]);
}
$('cluster-distance').addEventListener('input', event => {
  if (!state.settings || state.running || !state.frames.length) return;
  state.settings.thresholdInches = Number(event.target.value);
  $('threshold').value = state.settings.thresholdInches;
  refreshDistanceResults();
});
$('threshold').addEventListener('change', event => {
  const thresholdInches = Number(event.target.value);
  if (!Number.isFinite(thresholdInches) || thresholdInches < 0.01 || !state.settings || state.running || !state.frames.length) return;
  state.settings.thresholdInches = thresholdInches;
  $('cluster-distance').max = Math.max(Number($('cluster-distance').max), thresholdInches);
  refreshDistanceResults();
});
$('grid-pixels').addEventListener('change', event => {
  const gridPixels = Number(event.target.value);
  if (!Number.isFinite(gridPixels) || gridPixels <= 0 || !state.settings || state.running || !state.frames.length) return;
  state.settings.gridPixels = gridPixels;
  refreshDistanceResults();
});
$('change-timeline').addEventListener('click', event => {
  const changes = changeFrames();
  if (!changes.length) return;
  const rect = event.currentTarget.getBoundingClientRect();
  const target = (event.clientX - rect.left) / rect.width * (state.frames.length - 1);
  selectFrame(changes.reduce((best, index) => Math.abs(index - target) < Math.abs(best - target) ? index : best));
});
$('previous-change').addEventListener('click', () => {
  const selected = Number($('frame-slider').value);
  const previous = changeFrames().filter(index => index < selected).at(-1);
  if (previous != null) selectFrame(previous);
});
$('next-change').addEventListener('click', () => {
  const selected = Number($('frame-slider').value);
  const next = changeFrames().find(index => index > selected);
  if (next != null) selectFrame(next);
});

let activeView = null;
let aboutLoading = null;
const viewScroll = new Map();

function loadAbout() {
  if (aboutLoading) return aboutLoading;
  aboutLoading = fetch('./about.html').then(response => {
    if (!response.ok) throw new Error(`About page returned ${response.status}`);
    return response.text();
  }).then(html => {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const main = document.querySelector('.about-main');
    if (!main) throw new Error('About page content is missing.');
    const content = $('about-content');
    content.innerHTML = main.innerHTML;
    for (const link of content.querySelectorAll('a[href="./index.html"]')) link.href = '#analysis';
    content.addEventListener('click', event => {
      const link = event.target.closest('a[href^="#"]');
      if (!link || link.hash === '#analysis') return;
      const target = content.querySelector(link.hash);
      if (target) { event.preventDefault(); target.scrollIntoView({ behavior: 'smooth' }); }
    });
  }).catch(error => {
    $('about-content').innerHTML = `<h1>Could not load the method guide</h1><p>${error.message}</p><p><a href="./about.html" target="_blank" rel="noopener">Open it in a new tab</a> to keep this analysis available.</p>`;
  });
  return aboutLoading;
}

function showPage() {
  if (location.hash === '#human-analysis' && !state.resultsReady) history.replaceState(null, '', `${location.pathname}${location.search}#analysis`);
  if (location.hash === '#labeling' && !labeling.hasProject()) history.replaceState(null, '', `${location.pathname}${location.search}#analysis`);
  const nextView = location.hash === '#about' ? 'about' : location.hash === '#human-analysis' ? 'human'
    : location.hash === '#labeling' ? 'label' : 'analysis';
  if (activeView === 'label' && nextView !== 'label') labeling.leave();
  if (activeView) viewScroll.set(activeView, window.scrollY);
  activeView = nextView;
  const human = nextView === 'human', about = nextView === 'about', label = nextView === 'label';
  $('workspace').hidden = human || about || label;
  $('results').hidden = human || about || label || !state.resultsReady;
  $('human-page').hidden = !human;
  $('about-page').hidden = !about;
  $('label-page').hidden = !label;
  document.title = label ? 'Label training frames — Fish Cluster' : about ? 'About the analysis — Fish Cluster' : human ? 'Human analysis — Fish Cluster' : 'Fish Cluster — zebrafish video analysis';
  if (about) loadAbout();
  else if (label) labeling.show();
  else if (human) {
    $('human-slider').max = state.frames.length - 1;
    $('human-frame-number').max = state.frames.length;
    const crop = state.settings.crop;
    humanCanvas.width = crop.width;
    humanCanvas.height = crop.height;
    selectHumanFrame(state.human.index ?? Number($('frame-slider').value));
  } else if (state.resultsReady && !state.running) {
    selectFrame(Number($('frame-slider').value));
  }
  requestAnimationFrame(() => window.scrollTo(0, viewScroll.get(nextView) ?? 0));
}
window.addEventListener('hashchange', showPage);

showPage();

$('download-csv').addEventListener('click', () => {
  download(`${baseName(state.file?.name)}-detections.csv`, detectionsCsv(state.frames), 'text/csv');
});
$('download-frames').addEventListener('click', () => {
  download(`${baseName(state.file?.name)}-frames.csv`, framesCsv(state.frames), 'text/csv');
});
$('download-json').addEventListener('click', () => {
  const result = {
    videoName: state.file.name,
    sharpnessMethod: SHARPNESS_METHOD,
    trackingMethod: state.settings.trackFish ? TRACKING_METHOD : null,
    sharpnessLabels: exportedSharpnessLabels(state.human.candidateLabels),
    settings: exportedSettings(state.settings, video.videoWidth, video.videoHeight),
    summary: summarizeFrames(state.frames),
    frames: state.frames
  };
  download(`${baseName(state.file?.name)}-analysis.json`, JSON.stringify(result, null, 2), 'application/json');
});
