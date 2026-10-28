import { lightDarkReport } from './light-dark.mjs';
import { createExperimentTools } from './experiment-ui.mjs';
import { lightDarkFramesCsv, lightDarkSummaryCsv } from './exports.mjs';
import { trackSingleFishSides, visibleSideChanges } from './side-tracking.mjs';
import { createVelocityView } from './velocity-ui.mjs';
import { polygonBox, copyShape } from './geometry.mjs';
import { drawTankZones } from './tank-zones.mjs';
import { createCanvasViewport } from './canvas-viewport.mjs';
import { SHARPNESS_METHOD } from './sharpness.mjs';
import { TRACKING_METHOD } from './tracking.mjs';
import { analyzeFrame, calibrationFromLine, cropFitsFrame, inchesToPixels, mapCanvasPoint, summarizeFrames } from './analysis.mjs';
import { createSettings } from './settings.mjs';
import { frameMetrics, groupSignature, changeFrames as findChangeFrames } from './measurements.mjs';
import { createVideoSource } from './video.mjs';
import { createPreview } from './preview.mjs';
import { fmt, timeLabel } from './format.mjs';
import { baseName, detectionsCsv, framesCsv, exportedSettings, exportedSharpnessLabels } from './exports.mjs';
import { download } from './download.mjs';
import { createHumanReview } from './human-ui.mjs';
import { analyzeVideo } from './pipeline.mjs';
import { initializeInputHelp } from './input-help.mjs';
import { framePassesCountFilter } from './frame-selection.mjs';
import { createDistanceControls, distanceFromInches, distanceToInches } from './distance-controls.mjs';
import { createTestChooser } from './test-chooser.mjs';
import { renderExportPreview } from './data-preview.mjs';

initializeInputHelp();

const $ = id => document.getElementById(id);
const video = $('source-video');
const canvas = $('frame-canvas');
const humanCanvas = $('human-canvas');
const state = {
  testType: null,
  analysisComplete: false,
  file: null,
  url: null,
  frames: [],
  reviewFrames: [],
  settings: null,
  crop: null,
  focusTank: true,
  exclusions: [],
  tankZones: [],
  drag: null,
  corners: [],
  areaTool: 'crop',
  calibrationLine: null,
  running: false,
  stopped: false,
  resultsReady: false,
  previewToken: 0,
  human: { marks: new Map(), candidateLabels: new Map(), reviewed: new Set(), index: null, loading: false }
};
const velocity = createVelocityView({ getFrames: () => state.reviewFrames, getSettings: () => state.settings,
  getSelectedTime: () => selectedResultFrame()?.timestampMs });
let previewSeek = Promise.resolve();
// The entry point owns page state and translates UI actions into service calls.
const videoSource = createVideoSource(video);
const { showFirstFrame, seekToDrawableFrame } = videoSource;
const preview = createPreview(canvas, video);
let lastPreviewFrame = null;
const previewViewport = createCanvasViewport({ canvas, viewport: $('canvas-wrap'),
  controls: { fit: $('preview-fit'), in: $('preview-zoom-in'), out: $('preview-zoom-out'), output: $('preview-zoom') },
  dimensions: previewViewBox,
  onChange: () => drawFrame(lastPreviewFrame) });
function previewViewBox() {
  return state.focusTank && state.crop ? state.crop : { x: 0, y: 0, width: video.videoWidth || 1600, height: video.videoHeight || 1000 };
}
function drawFrame(frame) {
  $('preview-instruction').textContent = $('selection-shape').value === 'polygon' && $('crop-tool').value !== 'calibrate' ? `Click corner ${state.corners.length + 1} of 4, continuing around the edge.` : state.crop && state.focusTank ? 'Tank area enlarged. Use Full frame to adjust the crop.'
    : 'Drag around the swimming area to enlarge it, then check the scale.';
  $('preview-focus').disabled = !state.crop;
  $('preview-focus').setAttribute('aria-pressed', String(Boolean(state.focusTank && state.crop)));
  $('preview-full').setAttribute('aria-pressed', String(!state.focusTank || !state.crop));
  lastPreviewFrame = frame;
  previewViewport.resize();
  const crop = state.drag && !state.drag.exclude && !state.drag.calibration && !state.drag.side ? state.drag.box : state.crop;
  const exclusions = state.drag?.exclude ? [...state.exclusions, state.drag.box] : state.exclusions;
  preview.drawFrame(frame, state.settings?.thresholdPx, crop, exclusions, false, previewViewBox(), state.testType);
  drawTankZones(canvas.getContext('2d'), state.drag?.side ? [...state.tankZones, { ...state.drag.box, side: state.drag.side }] : state.tankZones,
    { x: 0, y: 0 }, canvas.width / Math.max(1, canvas.getBoundingClientRect().width));
  if (state.corners.length) {
    const ctx = canvas.getContext('2d');
    const scale = canvas.width / Math.max(1, canvas.getBoundingClientRect().width);
    ctx.save(); ctx.strokeStyle = '#f6d979'; ctx.fillStyle = '#f6d979'; ctx.lineWidth = 2 * scale;
    ctx.beginPath(); state.corners.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](p.x, p.y)); ctx.stroke();
    for (const p of state.corners) { ctx.beginPath(); ctx.arc(p.x, p.y, 4 * scale, 0, 2 * Math.PI); ctx.fill(); }
    ctx.restore();
  }
  preview.drawCalibrationLine(state.drag?.calibration ? state.drag : state.calibrationLine);
}
function sideTracking() { return state.testType === 'light-dark' ? trackSingleFishSides(state.reviewFrames, state.settings) : null; }
function changeFrames() {
  const indices = visibleResultIndices();
  const sides = sideTracking();
  return sides ? visibleSideChanges(sides, indices) : findChangeFrames(indices.map(index => state.reviewFrames[index]));
}
function selectedResultFrame() { return state.human.index == null ? null : state.reviewFrames[state.human.index]; }
const { selectHumanFrame, indices: visibleResultIndices, refresh: refreshHumanFrame, stopPlayback } = createHumanReview({
  state, video, humanCanvas, queuePreviewSeek,
  downloadFramePng: async (frame, view, fullFrame) => {
    const sample = String(frame.frameIndex + 1).padStart(6, '0');
    const name = `${baseName(state.file?.name)}-sample-${sample}-${frame.timestampMs}ms-${fullFrame ? 'full' : 'crop'}.png`;
    const image = await videoSource.readPng(view);
    download(name, image, 'image/png');
  },
  onFrameSelected: () => { updateSelectedFrameDetails(); drawClusterChart(); velocity.select(); },
  onFrameCorrected: () => {
    state.frames = state.reviewFrames.filter(frame => framePassesCountFilter(frame, state.settings));
    // Keep an excluded correction visible so it can be inspected or undone.
    if (state.human.filter === 'included' && !framePassesCountFilter(selectedResultFrame(), state.settings)) state.human.filter = 'all';
    showResults(true);
    refreshHumanFrame();
    status(`Results updated: ${state.frames.length} of ${state.reviewFrames.length} sampled frames included.`);
  } });
function status(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}
window.addEventListener('unhandledrejection', event => {
  const detail = event.reason?.message ?? String(event.reason);
  status(`Browser error: ${detail}`, true);
});
function resetHuman() {
  stopPlayback();
  state.human = { marks: new Map(), candidateLabels: new Map(), reviewed: new Set(), index: null, loading: false };
  $('human-edit-centers').checked = false;
  $('human-review-link').hidden = true;
}

function clearResults() {
  ++state.previewToken;
  state.frames = [];
  state.reviewFrames = [];
  state.resultsReady = false;
  state.analysisComplete = false;
  resetHuman();
  $('results').hidden = true;
  updateWorkflow();
  $('data-preview').textContent = '';
  if (['#results', '#data'].includes(location.hash)) location.hash = '#analysis';
  $('frame-groups').hidden = true;
  $('timeline').hidden = true;
}

function loadMetadata(file) {
  if (!file || state.running) return;
  if (state.file) experimentTools.refresh();
  ++state.previewToken;
  if (state.url) URL.revokeObjectURL(state.url);
  state.file = file;
  state.url = URL.createObjectURL(file);
  clearResults();
  state.crop = null;
  state.corners = [];
  updateCornerControls();
  state.focusTank = true;
  state.exclusions = [];
  state.tankZones = [];
  updateZoneControls();
  $('crop-tool').value = 'crop';
  state.areaTool = 'crop';
  updateMaskControls();
  state.drag = null;
  state.calibrationLine = null;
  $('calibration-tools').disabled = true;
  updateCalibrationControls();
  previewViewport.reset();
  $('crop-fields').disabled = true;
  $('mask-tools').disabled = true;
  $('clear-crop').disabled = true;
  $('crop-label').textContent = 'Drag on the preview to select the tank area.';
  video.src = state.url;
  video.load();
  $('file-label').textContent = file.name;
  $('dropzone').classList.add('has-video');
  $('video-meta').hidden = true;
  $('empty-preview').hidden = false;
  $('empty-preview').querySelector('strong').textContent = 'Loading first frame…';
  $('analyze').disabled = true;
  status('Reading video metadata…');
}

$('video-file').addEventListener('change', e => loadMetadata(e.target.files[0]));
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
  previewViewport.reset();
  updateSamplingSummary();
  updateWorkflow();
  $('workspace').dataset.loaded = 'true';
  $('crop-fields').disabled = false;
  $('mask-tools').disabled = false;
  if (state.file?.name.toLowerCase() === 'fish.mov' && video.videoWidth === 540 && video.videoHeight === 960) {
    state.crop = { x: 50, y: 240, width: 420, height: 290 };
    $('clear-crop').disabled = false;
    $('crop-label').textContent = 'Tested tank crop: 420 × 290 px. Drag to adjust.';
  }
  if (state.testType === 'light-dark') {
    $('expected-fish').value = 1;
    $('filter-frame-count').value = 1;
    filterCountOverridden = false;
  }
  setCropInputs(state.crop ?? { x: 0, y: 0, width: video.videoWidth, height: video.videoHeight });
  try {
    await showFirstFrame();
    if (state.file !== selectedFile) return;
    drawFrame(null);
    $('empty-preview').hidden = true;
    $('calibration-tools').disabled = false;
  } catch (error) {
    if (state.file === selectedFile) status(`Could not show the first frame: ${error.message}`, true);
    return;
  }
  $('analyze').disabled = false;
  status('Video ready. Check the tank crop, then analyze.');
});
video.addEventListener('error', () => status('The browser could not decode this video. Try an MP4 or WebM file.', true));

function pointOnCanvas(event) {
  const rect = canvas.getBoundingClientRect();
  const view = previewViewBox();
  return mapCanvasPoint(event.clientX, event.clientY, rect, view.width, view.height, view);
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
  const full = !box.polygon && x === 0 && y === 0 && width === video.videoWidth && height === video.videoHeight;
  state.crop = full ? null : copyShape(box);
  state.corners = [];
  updateCornerControls();
  state.focusTank = !full;
  clearResults();
  $('clear-crop').disabled = full;
  $('crop-label').textContent = full ? 'Using the full video frame.' : `${box.polygon ? 'Four-corner tank' : 'Tank crop'}: ${width} × ${height} px at (${x}, ${y}).`;
  setCropInputs(box);
  drawFrame(null);
  status(full ? 'Using the full video frame.' : 'Tank area selected. Analyze to use the crop.');
}

canvas.addEventListener('pointerdown', event => {
  if (!state.file || state.running || video.readyState < 2 || !canvas.width) return;
  if (event.button !== 0 || state.drag) return;
  if ($('selection-shape').value === 'polygon' && $('crop-tool').value !== 'calibrate') {
    return; // Four-corner areas are placed on completed clicks, not drags.
  }
  const point = pointOnCanvas(event);
  state.drag = { start: point, end: point, side: ['dark', 'light'].includes($('crop-tool').value) ? $('crop-tool').value : null, calibration: $('crop-tool').value === 'calibrate', exclude: $('crop-tool').value === 'exclude', box: { x: point.x, y: point.y, width: 0, height: 0 } };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('click', event => {
  if (!state.file || state.running || video.readyState < 2 || event.button !== 0 || state.drag ||
    $('selection-shape').value !== 'polygon' || $('crop-tool').value === 'calibrate') return;
  const point = pointOnCanvas(event);
  state.corners.push(point);
  if (state.corners.length === 4) {
    try {
      const shape = polygonBox(state.corners);
      const tool = $('crop-tool').value;
      if (tool === 'crop') commitCrop(shape);
      else {
        if (shape.width < 4 || shape.height < 4) throw new Error('Select a larger area.');
        if (tool === 'exclude') { state.exclusions.push(shape); updateMaskControls(); }
        else { state.tankZones.push({ ...shape, side: tool }); updateZoneControls(); }
        clearResults();
        state.corners = [];
        status('Four-corner area selected. Analyze again to apply it.');
      }
    } catch (error) { state.corners.pop(); status(error.message, true); }
  }
  updateCornerControls(); drawFrame(null);
});
canvas.addEventListener('pointermove', event => {
  if (!state.drag) return;
  const point = pointOnCanvas(event);
  const start = state.drag.start;
  state.drag.end = point;
  state.drag.box = { x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) };
  drawFrame(null);
});
canvas.addEventListener('pointerup', event => {
  if (!state.drag) return;
  if (state.drag.calibration) {
    const line = { start: state.drag.start, end: pointOnCanvas(event) };
    state.drag = null;
    if (Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y) >= 1) {
      state.calibrationLine = line;
      updateCalibrationControls();
    } else $('calibration-status').textContent = 'Draw a longer line along a known distance.';
    drawFrame(null);
    return;
  }
  const { box, exclude, side } = state.drag;
  state.drag = null;
  if (side) {
    if (box.width >= 4 && box.height >= 4) {
      state.tankZones.push({ ...box, side });
      clearResults();
      updateZoneControls();
      status(`${side === 'dark' ? 'Dark' : 'Light'} region marked. Analyze again to apply it.`);
    }
    drawFrame(null);
    return;
  }
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

function updateCalibrationControls() {
  const line = state.calibrationLine;
  $('apply-calibration').disabled = !line;
  $('clear-calibration').disabled = !line;
  const unit = $('distance-units').value === 'cm' ? 'centimeters' : 'inches';
  $('calibration-status').textContent = line
    ? `Line: ${fmt(Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y), 2)} video pixels. Enter its length in ${unit}, then click Use this scale.`
    : `Draw along a known distance in the preview, enter its length in ${unit}, then use the scale.`;
}
$('draw-calibration').addEventListener('click', () => {
  $('crop-tool').value = 'calibrate';
  $('crop-tool').dispatchEvent(new Event('change'));
  $('calibration-status').textContent = 'Drag from one end of a known distance to the other in the preview.';
  canvas.scrollIntoView({ block: 'nearest' });
});
$('apply-calibration').addEventListener('click', () => {
  if (state.running || !state.calibrationLine) return;
  try {
    const { start, end } = state.calibrationLine;
    const length = distanceToInches($('calibration-length').value, $('distance-units').value);
    const scale = calibrationFromLine(start, end, length);
    $('grid-pixels').value = Number(scale.gridPixels.toPrecision(12));
    $('grid-pixels').dispatchEvent(new Event('change'));
    const cm = $('distance-units').value === 'cm';
    $('calibration-status').textContent = `Scale applied: ${fmt(scale.pixelsPerInch / (cm ? 2.54 : 1), 3)} pixels/${cm ? 'cm' : 'inch'} (${fmt(scale.gridPixels, 3)} pixels per 0.5-inch square).`;
  } catch (error) { $('calibration-status').textContent = error.message; }
});
$('clear-calibration').addEventListener('click', () => {
  if (state.running) return;
  state.calibrationLine = null;
  updateCalibrationControls();
  drawFrame(null);
});
$('calibration-length').addEventListener('input', updateCalibrationControls);
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

function updateZoneControls() {
  const zones = state.tankZones;
  $('zone-count').textContent = zones.length
    ? `${zones.filter(zone => zone.side === 'dark').length} dark / ${zones.filter(zone => zone.side === 'light').length} light regions.`
    : 'No light/dark regions marked.';
  $('undo-zone').disabled = !zones.length;
  $('clear-zones').disabled = !zones.length;
}
for (const id of ['undo-zone', 'clear-zones']) {
  $(id).addEventListener('click', () => {
    if (state.running) return;
    if (id === 'undo-zone') state.tankZones.pop();
    else state.tankZones = [];
    clearResults();
    updateZoneControls();
    drawFrame(null);
    status('Tank regions changed. Analyze again to update results.');
  });
}

const distanceControls = createDistanceControls({ input: $('threshold'), units: $('distance-units'), slider: $('cluster-distance'),
  getSettings: () => state.reviewFrames.length ? state.settings : null, isRunning: () => state.running,
  refresh: refreshDistanceResults, unitsChanged: updateDistanceUnits });

function settings() {
  return createSettings({
    testType: state.testType,
    intervalMs: Number($('interval').value),
    filterExactCount: $('filter-exact-count').checked,
    filterFrameCount: Number($('filter-frame-count').value),
    thresholdInches: distanceControls.readInches(),
    gridPixels: Number($('grid-pixels').value),
    expectedFish: state.testType === 'light-dark' ? 1 : Number($('expected-fish').value),
    preferCenter: $('prefer-center').checked,
    trackFish: $('track-fish').checked,
    suppressFlicker: $('suppress-flicker').checked
  }, state.crop, video.videoWidth, video.videoHeight, state.exclusions, state.tankZones);
}

function displayDistance(inches, digits = 2) {
  const cm = $('distance-units').value === 'cm';
  return `${fmt(distanceFromInches(inches, $('distance-units').value), digits)} ${cm ? 'cm' : 'in'}`;
}
function updateDistanceUnits(previousUnits) {
  const cm = $('distance-units').value === 'cm';
  $('threshold-unit').textContent = cm ? 'cm' : 'inches';
  $('threshold').step = cm ? '0.1' : '0.01';
  $('calibration-unit').textContent = cm ? 'cm' : 'inches';
  const calibrationInches = distanceToInches($('calibration-length').value, previousUnits);
  if (Number.isFinite(calibrationInches)) $('calibration-length').value = Number(distanceFromInches(calibrationInches, $('distance-units').value).toPrecision(12));
  $('scale-summary').textContent = `${fmt(Number($('grid-pixels').value) * 2 / (cm ? 2.54 : 1), 2)} px/${cm ? 'cm' : 'in'}`;
  if (state.settings && !state.running && state.reviewFrames.length) {
    $('cluster-distance').value = state.settings.thresholdInches;
    drawClusterChart();
    $('stat-distance').textContent = Number.isFinite(summarizeFrames(state.frames).meanPairDistanceInches)
      ? displayDistance(summarizeFrames(state.frames).meanPairDistanceInches) : '—';
    $('distance-note').textContent = `approximate · ${fmt(summarizeFrames(state.frames).meanPairDistancePx)} px · ${fmt(state.settings.pixelsPerInch / (cm ? 2.54 : 1))} px/${cm ? 'cm' : 'in'}`;
    refreshHumanFrame();
  }
}

let filterCountOverridden = false;
$('expected-fish').addEventListener('change', () => {
  if (state.running) return;
  const count = Number($('expected-fish').value);
  // Keep the default inclusion count in sync, while preserving deliberate overrides.
  if (!filterCountOverridden) $('filter-frame-count').value = count;
  clearResults();
  drawFrame(null);
  status('Fish count changed. Analyze again to apply it.');
});
$('prefer-center').addEventListener('change', () => {
  if (state.running) return;
  clearResults();
  drawFrame(null);
  status('Candidate selection changed. Analyze again to apply it.');
});
$('filter-exact-count').addEventListener('change', () => {
  $('filter-frame-count').disabled = !$('filter-exact-count').checked;
  if (state.running) return;
  clearResults();
  status($('filter-exact-count').checked
    ? `Analysis will keep frames with exactly ${$('filter-frame-count').value} detected fish.`
    : 'Frame filtering is off. Analysis will keep every sampled frame.');
});
$('filter-frame-count').addEventListener('change', () => {
  if (state.running || !$('filter-exact-count').checked) return;
  filterCountOverridden = Number($('filter-frame-count').value) !== Number($('expected-fish').value);
  clearResults();
  status(`Analysis will keep frames with exactly ${$('filter-frame-count').value} detected fish.`);
});
$('suppress-flicker').addEventListener('change', () => {
  if (state.running) return;
  clearResults();
  status('Background flicker setting changed. Analyze again to apply it.');
});
$('track-fish').addEventListener('change', () => {
  if (state.running) return;
  clearResults();
  drawFrame(null);
  status('Tracking changed. Analyze again to apply it.');
});

$('analyze').addEventListener('click', async () => {
  if (state.running || !state.file || !state.testType) return;
  if (state.corners.length) { status('Finish the four corners or cancel the unfinished selection before analyzing.', true); return; }
  let config;
  try { config = settings(); } catch (error) { status(error.message, true); return; }
  if (Math.ceil(video.duration * 1000 / config.intervalMs) > 10000) { status('This setting would analyze over 10,000 frames. Increase the frame interval.', true); return; }
  state.running = true;
  // An earlier Results seek can still be in flight. Invalidate its
  // queued work and let the active seek finish before detection reads the video.
  ++state.previewToken;
  updateWorkflow();
  state.stopped = false;
  state.analysisComplete = false;
  state.settings = config;
  state.frames = [];
  state.reviewFrames = [];
  state.resultsReady = false;
  let skippedFrames = 0;
  let totalSamples = 0;
  let analysisFailed = false;
  resetHuman();
  $('timeline').hidden = true;
  $('frame-groups').hidden = true;
  $('analyze').disabled = true;
  $('cancel').hidden = false;
  $('results').hidden = true;
  $('video-file').disabled = true;
  $('prefer-center').disabled = true;
  $('track-fish').disabled = true;
  $('suppress-flicker').disabled = true;
  $('filter-exact-count').disabled = true;
  $('filter-frame-count').disabled = true;
  $('crop-fields').disabled = true;
  $('mask-tools').disabled = true;
  $('calibration-tools').disabled = true;
  $('progress').hidden = false;
  $('progress').value = 0;
  for (const id of ['expected-fish', 'interval', 'threshold', 'grid-pixels']) $(id).disabled = true;
  try {
    await previewSeek.catch(() => {});
    const events = analyzeVideo({
      config, duration: video.duration, source: videoSource,
      isStopped: () => state.stopped
    });
    for await (const event of events) {
      $('progress').value = event.progress;
      if (event.frame) state.reviewFrames.push(event.frame);
      if (event.type === 'skipped') {
        skippedFrames++;
        totalSamples = event.total;
        status(`Skipped sample ${event.frameIndex + 1} of ${event.total} · found ${event.fishCount}, required ${event.requiredFishCount}.`);
        continue;
      }
      if (event.type === 'status') {
        status(event.message);
        continue;
      }
      const { frame, total } = event;
      totalSamples = total;
      state.frames.push(frame);
      drawFrame(frame);
      $('empty-preview').hidden = true;
      status(`Analyzed ${frame.frameIndex + 1} of ${total} frames · ${frame.detections.length} fish candidates (known count ${config.expectedFish})${frame.rejectedDetections.length ? ` · ${frame.rejectedDetections.length} candidates excluded` : ''}`);
    }
    state.analysisComplete = !state.stopped;
    if (state.reviewFrames.length) showResults();
    status(state.settings.filterExactCount && !state.frames.length && !state.stopped
      ? `No frames matched exactly ${state.settings.filterFrameCount} fish. Skipped all ${totalSamples} sampled frames.`
      : state.settings.filterExactCount && !state.stopped
        ? `Complete: kept ${state.frames.length} frames with exactly ${state.settings.filterFrameCount} fish; skipped ${skippedFrames} of ${totalSamples} samples.`
        : state.stopped ? `Stopped after ${state.frames.length} frames. Partial results are available.` :
      `Complete: ${state.frames.length} frames analyzed with background subtraction.`);
  } catch (error) {
    analysisFailed = true;
    if (state.reviewFrames.length) showResults();
    status(`Analysis stopped: ${error.message}`, true);
  } finally {
    state.running = false;
    $('human-review-link').hidden = !state.reviewFrames.length;
    $('analyze').disabled = false;
    $('cancel').hidden = true;
    $('progress').hidden = true;
    $('video-file').disabled = false;
    $('prefer-center').disabled = false;
    $('track-fish').disabled = false;
    $('suppress-flicker').disabled = false;
    $('filter-exact-count').disabled = false;
    $('filter-frame-count').disabled = !$('filter-exact-count').checked;
    $('crop-fields').disabled = false;
    $('mask-tools').disabled = false;
    $('calibration-tools').disabled = video.readyState < 2;
    for (const id of ['expected-fish', 'interval', 'threshold', 'grid-pixels']) $(id).disabled = false;
    updateTestControls();
    experimentTools.refresh();
    updateWorkflow();
    if (state.resultsReady && !analysisFailed && ['', '#analysis'].includes(location.hash)) location.hash = '#results';
  }
});
$('cancel').addEventListener('click', () => { state.stopped = true; status('Stopping after the current frame…'); });

function showResults(preserveSelection = false) {
  if (!state.reviewFrames.length) {
    state.resultsReady = false;
    $('results').hidden = true;
    $('timeline').hidden = true;
    $('frame-groups').hidden = true;
    updateWorkflow();
    return;
  }
  if (!preserveSelection) state.human.index = visibleResultIndices()[0] ?? null;
  const summary = summarizeFrames(state.frames);
  renderResultCropCoordinates();
  $('cluster-distance').value = state.settings.thresholdInches;
  velocity.refresh();
  state.resultsReady = true;
  $('results').hidden = location.hash !== '#results';
  updateWorkflow();
  $('stat-fish').textContent = fmt(summary.meanFishCount);
  $('stat-distance').textContent = Number.isFinite(summary.meanPairDistanceInches) ? displayDistance(summary.meanPairDistanceInches) : '—';
  const cmUnits = $('distance-units').value === 'cm';
  $('distance-note').textContent = `approximate · ${fmt(summary.meanPairDistancePx)} px · ${fmt(state.settings.pixelsPerInch / (cmUnits ? 2.54 : 1))} px/${cmUnits ? 'cm' : 'in'}`;
  $('stat-close').textContent = Number.isFinite(summary.meanCloseFishFraction) ? `${fmt(summary.meanCloseFishFraction * 100, 0)}%` : '—';
  $('stat-clusters').textContent = fmt(summary.meanClusterCount);
  $('results-inclusion').textContent = `${state.frames.length} of ${state.reviewFrames.length} samples included${!state.frames.length ? '. Choose All sampled frames or Count mismatches to correct excluded samples.' : '. Corrections update these measurements and exports.'}`;
  if (state.testType === 'light-dark') {
    const report = lightDarkReport(state.reviewFrames, state.settings);
    for (const [id,key] of [['ld-dark','darkTimeSeconds'],['ld-light','lightTimeSeconds'],['ld-unknown','unknownTimeSeconds']]) $(id).textContent = `${fmt(report[key], 2)} s`;
    $('ld-switches').textContent = report.zoneSwitchCount;
    $('ld-speed').textContent = report.averageSpeedPxPerSecond == null ? '—' : `${fmt(report.averageSpeedPxPerSecond, 2)} px/s · ${displayDistance(report.averageSpeedInchesPerSecond).replace(' ', '')}/s`;
    $('ld-coverage').textContent = `${fmt(report.observedDurationSeconds, 2)} s sampled window · ${fmt((report.coverageFraction ?? 0) * 100, 1)}% side coverage · ${fmt(report.velocityDurationSeconds, 2)} s measured for speed${state.analysisComplete ? '' : ' · Partial analysis'}.`;
    $('results-inclusion').textContent = `All ${state.reviewFrames.length} sampled frames contribute to this report. Unknown intervals remain in the time totals. Corrections update measurements and exports.`;
    updateSelectedFrameDetails(); drawTimeline(); experimentTools.refresh(); return;
  }
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
  if (uncertain) $('random-summary').textContent += ` Distances and groups include uncertain overlap estimates in ${uncertain} frame(s). Check these in this view; dashed rings and † mark estimated positions.`;
}

function resultCropEntries() {
  const crop = state.settings?.crop;
  if (!crop) return [];
  return [
    { name: 'Tank crop', shape: crop },
    ...(state.settings.tankZones ?? []).map((shape, index) => ({ name: `${shape.side ?? 'Tank'} region ${index + 1}`, shape })),
    ...(state.settings.exclusions ?? []).map((shape, index) => ({ name: `Reflection mask ${index + 1}`, shape }))
  ];
}

function cropCoordinateText(shape) {
  const bounds = `x=${shape.x}, y=${shape.y}, width=${shape.width}, height=${shape.height}`;
  return shape.polygon ? `${bounds}; corners=${JSON.stringify(shape.polygon)}` : bounds;
}

function renderResultCropCoordinates() {
  const container = $('results-crop-list');
  container.replaceChildren();
  for (const { name, shape } of resultCropEntries()) {
    const row = document.createElement('div');
    row.className = 'results-crop-row';
    const label = document.createElement('strong');
    label.textContent = name;
    const value = document.createElement('code');
    value.textContent = cropCoordinateText(shape);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary';
    button.dataset.copyCrop = cropCoordinateText(shape);
    button.textContent = 'Copy';
    row.append(label, value, button);
    container.append(row);
  }
}

async function copyCropCoordinates(value) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
    else {
      const input = document.createElement('textarea');
      input.value = value;
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.append(input);
      input.select();
      const copied = document.execCommand('copy');
      input.remove();
      if (!copied) throw new Error('Clipboard copy was unavailable');
    }
    $('crop-copy-status').textContent = 'Coordinates copied.';
  } catch {
    $('crop-copy-status').textContent = 'Copy was blocked. Select and copy the coordinate text above.';
  }
}

$('results-crop-list').addEventListener('click', event => {
  const button = event.target.closest('[data-copy-crop]');
  if (button) copyCropCoordinates(button.dataset.copyCrop);
});
$('copy-all-crops').addEventListener('click', () => {
  copyCropCoordinates(resultCropEntries().map(({ name, shape }) => `${name}: ${cropCoordinateText(shape)}`).join('\n'));
});

function drawTimeline() {
  const canvas = $('change-timeline');
  const context = canvas.getContext('2d');
  const changes = changeFrames();
  const indices = visibleResultIndices();
  const sides = sideTracking();
  const selected = indices.indexOf(state.human.index);
  $('timeline').hidden = !indices.length;
  $('timeline').dataset.mode = sides ? 'side' : 'group';
  $('timeline-title').textContent = sides ? 'Light / dark changes' : 'Group changes';
  $('side-timeline-details').hidden = !sides;
  canvas.setAttribute('aria-label', sides
    ? 'Fish side over video time: purple dark, cyan light, gray unknown; click to jump to an observed side change'
    : 'Timeline of changes in group sizes; click to jump to a change');
  for (const [id, direction] of [['previous-change', 'Previous'], ['next-change', 'Next']]) {
    const label = `${direction} ${sides ? 'side' : 'group'} change`;
    $(id).setAttribute('aria-label', label); $(id).title = label;
  }
  const last = Math.max(1, indices.length - 1);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#24444c'; context.fillRect(0, 10, canvas.width, 6);
  if (sides) {
    const start = sides.samples[0]?.timestampMs ?? 0;
    const span = Math.max(1, (sides.samples.at(-1)?.timestampMs ?? start) - start);
    const x = time => (time - start) / span * (canvas.width - 3);
    const colors = { dark: '#bdadff', light: '#69e3e9', unknown: '#52666f' };
    sides.samples.forEach((sample, index) => {
      const left = x(sample.timestampMs);
      const right = index + 1 < sides.samples.length ? x(sides.samples[index + 1].timestampMs) : canvas.width;
      context.fillStyle = colors[sample.side]; context.fillRect(left, 8, Math.max(2, right - left), 12);
    });
    context.fillStyle = '#f6d979';
    for (const change of sides.changes) context.fillRect(x(change.timestampMs), 4, 2, 20);
    const frame = selectedResultFrame();
    if (frame) { context.fillStyle = '#ffffff'; context.fillRect(x(frame.timestampMs), 0, 3, 26); }
    const side = sides.samples[state.human.index]?.side ?? 'unknown';
    $('side-timeline-current').textContent = `Selected frame: ${side === 'dark' ? 'Dark side' : side === 'light' ? 'Light side' : 'Unknown'}`;
    $('side-timeline-summary').textContent = `All samples: ${sides.darkSampleCount} dark · ${sides.lightSampleCount} light · ${sides.unknownSampleCount} unknown. Gray gaps have no reliable position; crossings are marked only between adjacent known samples.`;
    $('change-count').textContent = `${sides.changes.length} observed side change${sides.changes.length === 1 ? '' : 's'} · ${changes.length} in this frame view`;
  } else {
    context.fillStyle = '#f6d979';
    for (const index of changes) context.fillRect(index / last * (canvas.width - 2), 4, 2, 18);
    context.fillStyle = '#8ce6ce'; context.fillRect(selected / last * (canvas.width - 3), 0, 3, 26);
    $('change-count').textContent = `${changes.length} change${changes.length === 1 ? '' : 's'} in group sizes`;
  }
  $('previous-change').disabled = !changes.some(index => index < selected);
  $('next-change').disabled = !changes.some(index => index > selected);
}

function updateSelectedFrameDetails() {
  const frame = selectedResultFrame();
  if (!frame) { $('frame-groups').hidden = true; drawTimeline(); return; }
  if (state.testType === 'light-dark') {
    const sample = sideTracking()?.samples[state.human.index];
    $('frame-groups').textContent = `${frame.detections.length} detected · ${sample?.side ?? 'unknown'} side`;
    $('frame-groups').hidden = false; drawTimeline(); return;
  }
  const sizes = frame.metrics.groupSizes;
  const groups = sizes.slice().sort((a, b) => b - a).join('+') || 'none';
  $('frame-groups').textContent = `${frame.detections.length} fish · groups ${groups} · ${frame.metrics.clusterCount} cluster${frame.metrics.clusterCount === 1 ? '' : 's'} · ${frame.metrics.isolatedCount} single${frame.metrics.uncertainPositionCount ? ` · ${frame.metrics.uncertainPositionCount} uncertain centers` : ''}`;
  if (state.settings.tankZones?.length) $('frame-groups').textContent += ` · ${frame.metrics.darkSideCount} dark / ${frame.metrics.lightSideCount} light / ${frame.metrics.unmarkedSideCount} unmarked`;
  $('frame-groups').hidden = false;
  drawTimeline();
}

function drawClusterChart() {
  if (state.testType === 'light-dark') { $('cluster-chart').replaceChildren(); return; }
  const frame = selectedResultFrame();
  if (!frame) { $('cluster-chart').replaceChildren(); return; }
    const maxInches = Number($('cluster-distance').max);
  const points = Array.from({ length: 101 }, (_, i) => analyzeFrame(frame.detections, maxInches * state.settings.pixelsPerInch * i / 100));
  const ymax = Math.max(1, frame.detections.length);
  const path = key => points.map((point, i) => `${i ? 'L' : 'M'}${30 + i * 5.5},${130 - point[key] * 110 / ymax}`).join(' ');
  const marker = 30 + state.settings.thresholdInches / maxInches * 550;
  const cm = $('distance-units').value === 'cm';
  $('cluster-chart').innerHTML = `<line x1="30" y1="130" x2="580" y2="130" stroke="#5d7880"/><line x1="30" y1="20" x2="30" y2="130" stroke="#5d7880"/><path d="${path('clusterCount')}" fill="none" stroke="#8ce6ce" stroke-width="3"/><path d="${path('isolatedCount')}" fill="none" stroke="#f6d979" stroke-width="3"/><line x1="${marker}" y1="18" x2="${marker}" y2="130" stroke="#ffffff" stroke-dasharray="4 4"/><text x="30" y="151" fill="#a8c2c0" font-size="12">0 ${cm ? 'cm' : 'in'}</text><text x="535" y="151" fill="#a8c2c0" font-size="12">${fmt(maxInches * (cm ? 2.54 : 1), 1)} ${cm ? 'cm' : 'in'}</text><text x="5" y="24" fill="#a8c2c0" font-size="12">${ymax}</text>`;
  $('cluster-distance-label').textContent = `${displayDistance(state.settings.thresholdInches)} (${fmt(state.settings.thresholdPx)} px)`;
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
    return false;
  });
  return previewSeek;
}

function selectFrame(position) {
  const index = visibleResultIndices()[position];
  if (index != null && !state.running) return selectHumanFrame(index);
}

function refreshDistanceResults() {
  if (!state.reviewFrames.length || state.running) return;
  state.settings.thresholdPx = inchesToPixels(state.settings.thresholdInches, state.settings.gridPixels);
  state.settings.pixelsPerInch = state.settings.gridPixels * 2;
  for (const frame of state.reviewFrames) frame.metrics = frameMetrics(frame.detections, state.settings,
    frame.manualCorrectionApplied ? 0 : frame.rejectedDetections?.length ?? 0);
  showResults(true);
  refreshHumanFrame();
  if (!$('workspace').hidden) drawFrame(null);
}
$('grid-pixels').addEventListener('change', event => {
  const gridPixels = Number(event.target.value);
  if (!Number.isFinite(gridPixels) || gridPixels <= 0 || !state.settings || state.running || !state.reviewFrames.length) return;
  state.settings.gridPixels = gridPixels;
  refreshDistanceResults();
});
$('change-timeline').addEventListener('click', event => {
  const changes = changeFrames();
  if (!changes.length) return;
  const rect = event.currentTarget.getBoundingClientRect();
  const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  const indices = visibleResultIndices();
  const sides = sideTracking();
  const start = sides?.samples[0]?.timestampMs ?? 0;
  const end = sides?.samples.at(-1)?.timestampMs ?? start;
  const target = sides ? start + fraction * (end - start) : fraction * (indices.length - 1);
  const location = position => sides ? state.reviewFrames[indices[position]].timestampMs : position;
  selectFrame(changes.reduce((best, index) => Math.abs(location(index) - target) < Math.abs(location(best) - target) ? index : best));
});
$('previous-change').addEventListener('click', () => {
  const selected = visibleResultIndices().indexOf(state.human.index);
  const previous = changeFrames().filter(index => index < selected).at(-1);
  if (previous != null) selectFrame(previous);
});
$('next-change').addEventListener('click', () => {
  const selected = visibleResultIndices().indexOf(state.human.index);
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

function updateWorkflow() {
  for (const id of ['nav-results', 'nav-data']) $(id).setAttribute('aria-disabled', String(!state.resultsReady || state.running));
  $('workflow-summary').textContent = state.running ? 'Analyzing video…'
    : state.reviewFrames.length ? `${state.frames.length} of ${state.reviewFrames.length} samples included`
    : state.file?.name ?? 'Add a video to begin';
}
for (const id of ['nav-results', 'nav-data']) $(id).addEventListener('click', event => {
  if ($(id).getAttribute('aria-disabled') === 'true') event.preventDefault();
});
function updateSamplingSummary() {
  const interval = Number($('interval').value);
  $('sampling-summary').textContent = interval > 0
    ? `Every ${Number(fmt(interval / 1000, 3))} seconds · ${Number(fmt(1000 / interval, 1))} samples/sec${Number.isFinite(video.duration) ? ` · about ${Math.ceil(video.duration * 1000 / interval)} samples` : ''}`
    : 'Enter a positive sampling interval.';
}
$('interval').addEventListener('input', updateSamplingSummary);
function updateScaleSummary() {
  const cm = $('distance-units').value === 'cm';
  $('scale-summary').textContent = `${fmt(Number($('grid-pixels').value) * 2 / (cm ? 2.54 : 1), 2)} px/${cm ? 'cm' : 'in'}`;
}
$('grid-pixels').addEventListener('input', updateScaleSummary);
$('grid-pixels').addEventListener('change', updateScaleSummary);
$('apply-calibration').addEventListener('click', updateScaleSummary);
$('open-scale').addEventListener('click', () => {
  $('preview-tools').open = true;
  $('scale-panel').open = true;
  $('crop-tool').value = 'calibrate';
  $('crop-tool').dispatchEvent(new Event('change'));
  $('calibration-tools').scrollIntoView({ block: 'nearest' });
  $('draw-calibration').focus({ preventScroll: true });
});
function updateCornerControls() {
  const visible = $('selection-shape').value === 'polygon' && $('crop-tool').value !== 'calibrate';
  for (const id of ['corner-status', 'undo-corner', 'cancel-corners']) $(id).hidden = !visible;
  $('corner-status').textContent = state.corners.length ? `${state.corners.length}/4 corners. Click around the edge.` : 'Four-corner mode: click each corner in order around the edge.';
  $('undo-corner').disabled = !state.corners.length;
  $('cancel-corners').disabled = !state.corners.length;
}
for (const id of ['undo-corner', 'cancel-corners']) $(id).addEventListener('click', () => {
  if (state.running) return;
  if (id === 'undo-corner') state.corners.pop(); else state.corners = [];
  updateCornerControls(); drawFrame(null);
});
$('selection-shape').addEventListener('change', () => {
  state.corners = []; state.drag = null;
  if ($('selection-shape').value === 'polygon') {
    if ($('crop-tool').value === 'calibrate') $('crop-tool').value = state.areaTool;
  }
  updateCornerControls(); drawFrame(null);
});
$('crop-tool').addEventListener('change', () => {
  state.drag = null;
  if ($('crop-tool').value !== 'calibrate') state.areaTool = $('crop-tool').value;
  state.corners = []; updateCornerControls();
  if ($('crop-tool').value === 'calibrate') {
    $('selection-shape').value = 'rectangle';
    updateCornerControls();
    $('scale-panel').open = true;
  }
  if ($('crop-tool').value === 'crop') { state.focusTank = false; previewViewport.reset(); }
  drawFrame(null);
});
updateCornerControls();
$('preview-focus').addEventListener('click', () => { state.focusTank = true; previewViewport.reset(); });
$('preview-full').addEventListener('click', () => { state.focusTank = false; previewViewport.reset(); });

function showPage() {
  // Existing review bookmarks lead to the unified results workspace.
  if (location.hash === '#human-analysis') history.replaceState(null, '', `${location.pathname}${location.search}#results`);
  if (['#results', '#data'].includes(location.hash) && (!state.resultsReady || state.running)) {
    history.replaceState(null, '', `${location.pathname}${location.search}#analysis`);
  }
  const nextView = ['#about', '#results', '#data'].includes(location.hash) ? location.hash.slice(1) : 'analysis';
  if (activeView) viewScroll.set(activeView, window.scrollY);
  activeView = nextView;
  const results = nextView === 'results', about = nextView === 'about';
  $('test-chooser').hidden = Boolean(state.testType) || about;
  $('workspace').hidden = nextView !== 'analysis' || !state.testType;
  $('workspace').dataset.view = 'setup';
  document.querySelector('.setup').hidden = nextView !== 'analysis';
  $('results').hidden = !results;
  $('human-page').hidden = !results;
  $('data-page').hidden = nextView !== 'data';
  $('about-page').hidden = !about;
  for (const [id, view] of [['nav-setup', 'analysis'], ['nav-results', 'results'], ['nav-data', 'data']]) {
    if (nextView === view) $(id).setAttribute('aria-current', 'page');
    else $(id).removeAttribute('aria-current');
  }
  updateWorkflow();
  document.title = about ? 'About the analysis — Fish Cluster'
    : nextView === 'data' ? 'Data — Fish Cluster' : results ? 'Results & corrections — Fish Cluster' : 'Fish Cluster — zebrafish video analysis';
  if (about) loadAbout();
  else if (results) selectHumanFrame(state.human.index ?? visibleResultIndices()[0]);
  else if (nextView === 'data') renderData();
  else if (video.readyState >= 2) drawFrame(null);
  requestAnimationFrame(() => window.scrollTo(0, viewScroll.get(nextView) ?? 0));
}
window.addEventListener('hashchange', showPage);

function updateTestControls() {
  const lightDark = state.testType === 'light-dark';
  if (state.testType) document.documentElement.dataset.testType = state.testType;
  else delete document.documentElement.dataset.testType;
  $('test-name').textContent = state.testType ? (lightDark ? 'Light / dark' : 'Shoaling') : '';
  $('change-test').hidden = !state.testType;
  $('change-test').disabled = state.running;
  $('expected-fish').disabled = state.running || lightDark;
  $('human-expected-fish').disabled = lightDark;
  if (lightDark) { $('expected-fish').value = 1; $('filter-frame-count').value = 1; $('human-show-nearest').checked = false; }
  $('csv-guide').href = `./csv-guide.html#${state.testType ?? 'shoaling'}`;
  $('setup-title').textContent = lightDark ? 'Set up light / dark test' : 'Set up shoaling test';
  $('preview-tools').querySelector('summary').textContent = lightDark ? 'Tank area, light/dark sides, reflection masks & scale' : 'Tank area, reflection masks & scale';
  for (const value of ['dark','light']) $('crop-tool').querySelector(`option[value="${value}"]`).hidden = !lightDark;
  for (const id of ['undo-zone','clear-zones','zone-count']) $(id).hidden = !lightDark;
}
function applyTest(testType) {
  const previous = state.testType;
  state.testType = testType;
  state.drag = null; state.corners = [];
  if (testType === 'shoaling' && ['dark', 'light'].includes($('crop-tool').value)) { $('crop-tool').value = 'crop'; state.areaTool = 'crop'; }
  updateCornerControls();
  if (testType === 'shoaling' && previous !== 'shoaling') { $('expected-fish').value = 5; $('filter-frame-count').value = 5; }
  state.settings = null; clearResults(); updateTestControls();
  if (testType === 'light-dark') { $('preview-tools').open = true; }
  location.hash = '#analysis'; showPage(); experimentTools.refresh();
}
const testChooser = createTestChooser({ state, dialog: $('test-change-dialog'), trigger: $('change-test'),
  choices: { shoaling: $('switch-shoaling'), 'light-dark': $('switch-light-dark') },
  apply: applyTest, confirmChange: message => window.confirm(message) });
function chooseTest(testType) { return testChooser.select(testType); }
$('choose-shoaling').addEventListener('click', () => chooseTest('shoaling'));
$('choose-light-dark').addEventListener('click', () => chooseTest('light-dark'));
const experimentTools = createExperimentTools({
  getContext: () => ({ fileName: state.file?.name, frameWidth: video.videoWidth, frameHeight: video.videoHeight,
    crop: state.crop, exclusions: state.exclusions, tankZones: state.tankZones, gridPixels: Number($('grid-pixels').value), testType: state.testType }),
  isRunning: () => state.running,
  getReport: () => state.resultsReady ? { fileName: state.file?.name, testType: state.testType, complete: state.analysisComplete,
    partial: !state.analysisComplete, summary: state.testType === 'light-dark' ? lightDarkReport(state.reviewFrames, state.settings) : summarizeFrames(state.frames) } : null,
  applySetup: setup => {
    if (state.running) throw new Error('Stop analysis before applying a setup.');
    if (setup.frameWidth !== video.videoWidth || setup.frameHeight !== video.videoHeight) throw new Error('Setup dimensions do not match this video.');
    if (setup.testType !== state.testType && !chooseTest(setup.testType)) throw new Error('Test change cancelled. Saved setup was not applied.');
    state.crop = setup.crop ? copyShape(setup.crop) : null;
    state.exclusions = (setup.exclusions ?? []).map(copyShape); state.tankZones = (setup.tankZones ?? []).map(copyShape);
    state.calibrationLine = null; state.drag = null; state.corners = []; state.focusTank = Boolean(state.crop);
    $('grid-pixels').value = setup.gridPixels; setCropInputs(state.crop ?? { x:0,y:0,width:video.videoWidth,height:video.videoHeight });
    $('clear-crop').disabled = !state.crop; $('crop-label').textContent = state.crop ? 'Saved tank crop applied.' : 'Using the full video frame.';
    clearResults(); updateMaskControls(); updateZoneControls(); updateCornerControls(); updateCalibrationControls(); updateScaleSummary(); previewViewport.reset(); drawFrame(null);
    status('Saved setup applied. Check the geometry, then analyze.');
  }
});
video.addEventListener('loadedmetadata', () => experimentTools.onVideoLoaded());
$('download-summary').addEventListener('click', () => download(`${baseName(state.file?.name)}-summary.csv`, exportData('summary'), 'text/csv'));
updateTestControls();
showPage();

$('download-csv').addEventListener('click', () => {
  download(`${baseName(state.file?.name)}-detections.csv`, exportData('detections'), 'text/csv');
});
$('download-frames').addEventListener('click', () => {
  download(`${baseName(state.file?.name)}-frames.csv`, exportData('frames'), 'text/csv');
});
$('download-json').addEventListener('click', () => {
  download(`${baseName(state.file?.name)}-analysis.json`, exportData('json'), 'application/json');
});

function renderData() {
  const lightDark = state.testType === 'light-dark';
  const format = $('data-format');
  for (const option of format.options) {
    option.hidden = option.disabled = (option.value === 'summary' && !lightDark) || (option.value === 'detections' && lightDark);
  }
  if (format.selectedOptions[0].disabled) format.value = 'frames';
  const text = exportData(format.value);
  const csv = format.value !== 'json';
  $('data-columns').hidden = !csv;
  const options = $('data-column-options');
  if (csv) {
    const headers = text.slice(0, text.indexOf('\r\n')).match(/"(?:[^"]|"")*"/g)?.map(value => value.slice(1, -1).replaceAll('""', '"')) ?? [];
    const key = `${state.testType}:${format.value}`;
    const selected = new Set(JSON.parse(localStorage.getItem(`data-columns:${key}`) ?? 'null') ?? headers);
    options.replaceChildren(...headers.map(name => {
      const label = document.createElement('label'), input = document.createElement('input');
      input.type = 'checkbox'; input.checked = selected.has(name); input.value = name;
      input.addEventListener('change', () => { const values = [...options.querySelectorAll('input:checked')].map(item => item.value); localStorage.setItem(`data-columns:${key}`, JSON.stringify(values)); renderData(); });
      label.append(input, document.createTextNode(name)); return label;
    }));
    renderExportPreview($('data-preview'), format.value, text, selected);
  } else renderExportPreview($('data-preview'), format.value, text);
}
$('data-format').addEventListener('change', renderData);

function exportData(format) {
  const lightDark = state.testType === 'light-dark';
  if (format === 'frames') return lightDark ? lightDarkFramesCsv(state.reviewFrames, state.settings) : framesCsv(state.frames);
  if (format === 'detections') return detectionsCsv(lightDark ? state.reviewFrames : state.frames);
  if (format === 'summary') return lightDarkSummaryCsv(lightDarkReport(state.reviewFrames, state.settings));
  const velocityReport = velocity.exportReport();
  const sideReport = sideTracking();
  const result = {
    videoName: state.file.name,
    ...(velocityReport ? { velocity: velocityReport } : {}),
    ...(sideReport ? { sideTracking: sideReport } : {}),
    sharpnessMethod: SHARPNESS_METHOD,
    trackingMethod: state.settings.trackFish ? TRACKING_METHOD : null,
    sharpnessLabels: exportedSharpnessLabels(state.human.candidateLabels),
    settings: exportedSettings(state.settings, video.videoWidth, video.videoHeight),
    testType: state.testType,
    analysisComplete: state.analysisComplete,
    summary: state.testType === 'light-dark' ? lightDarkReport(state.reviewFrames, state.settings) : summarizeFrames(state.frames),
    frames: state.testType === 'light-dark' ? state.reviewFrames.map(({ metrics, ...frame }) => frame) : state.frames,
    excludedFrames: state.testType === 'light-dark' ? [] : state.reviewFrames.filter(frame => !framePassesCountFilter(frame, state.settings))
  };
  return JSON.stringify(result, null, 2);
}
