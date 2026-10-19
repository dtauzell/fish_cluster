import { analyzeFrame, cropFitsFrame, csv, inchesToPixels, mapCanvasPoint, matchPointsWithin, nearestNeighborLinks, normalizePredictions, randomSpacingReference, sampleTimes, spacingPercentile, summarizeFrames } from './analysis.mjs?v=14';
import { grayscale, medianBackground, detectBackgroundFish } from './background.mjs?v=10';

const $ = id => document.getElementById(id);
const video = $('source-video');
const canvas = $('frame-canvas');
const ctx = canvas.getContext('2d');
const humanCanvas = $('human-canvas');
const humanCtx = humanCanvas.getContext('2d');
const state = { file: null, url: null, frames: [], settings: null, crop: null, drag: null, model: null, modelLoad: null, running: false, stopped: false, resultsReady: false, previewToken: 0, human: { marks: new Map(), reviewed: new Set(), index: null, loading: false } };
let previewSeek = Promise.resolve();
const groupColors = ['#8ce6ce', '#f6d979', '#f4a7b9', '#9ab9ff', '#d3a9f0', '#ffba87'];
const referenceCache = new Map();

function referenceFor(count, crop) {
  const key = `${count}:${crop.width}:${crop.height}`;
  if (!referenceCache.has(key)) referenceCache.set(key, randomSpacingReference(count, crop));
  return referenceCache.get(key);
}

function frameMetrics(detections, config) {
  const metrics = analyzeFrame(detections, config.thresholdPx);
  metrics.randomSpacingPercentile = spacingPercentile(metrics.meanNearestDistancePx, referenceFor(detections.length, config.crop));
  metrics.meanPairDistanceInches = metrics.meanPairDistancePx == null ? null : metrics.meanPairDistancePx / config.pixelsPerInch;
  metrics.meanNearestDistanceInches = metrics.meanNearestDistancePx == null ? null : metrics.meanNearestDistancePx / config.pixelsPerInch;
  if (config.method === 'background') metrics.countDifference = detections.length - config.expectedFish;
  return metrics;
}

function status(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}
window.addEventListener('unhandledrejection', event => {
  const detail = event.reason?.message ?? String(event.reason);
  status(`Browser model error: ${detail}`, true);
});
function fmt(value, digits = 1) { return Number.isFinite(value) ? value.toFixed(digits) : '—'; }
function timeLabel(ms) { return `${(ms / 1000).toFixed(2)} s`; }
function resetHuman() {
  state.human = { marks: new Map(), reviewed: new Set(), index: null, loading: false };
  $('human-link').hidden = true;
}

function loadMetadata(file) {
  if (!file || state.running) return;
  ++state.previewToken;
  if (state.url) URL.revokeObjectURL(state.url);
  state.file = file;
  state.url = URL.createObjectURL(file);
  state.frames = [];
  state.resultsReady = false;
  resetHuman();
  state.crop = null;
  state.drag = null;
  $('canvas-wrap').style.aspectRatio = '16 / 10';
  $('crop-fields').disabled = true;
  $('clear-crop').disabled = true;
  $('crop-label').textContent = 'Drag on the preview to select the tank area.';
  video.src = state.url;
  video.load();
  $('file-label').textContent = file.name;
  $('video-meta').hidden = true;
  $('results').hidden = true;
  $('frame-slider').disabled = true;
  $('frame-groups').hidden = true;
  $('timeline').hidden = true;
  $('empty-preview').hidden = false;
  $('empty-preview').querySelector('strong').textContent = 'Loading first frame…';
  $('analyze').disabled = true;
  status('Reading video metadata…');
}

$('video-file').addEventListener('change', e => loadMetadata(e.target.files[0]));
function updateMethod() {
  const background = $('method').value === 'background';
  $('background-settings').hidden = !background;
  $('model-settings').hidden = background;
  state.frames = [];
  state.resultsReady = false;
  resetHuman();
  $('results').hidden = true;
  $('frame-slider').disabled = true;
  $('frame-groups').hidden = true;
  $('timeline').hidden = true;
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

async function showFirstFrame() {
  // A seek away from exact zero makes Safari decode a frame from a local MOV.
  const firstTime = Math.min(0.01, video.duration / 2);
  if (typeof video.requestVideoFrameCallback !== 'function') {
    await seekTo(firstTime);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return;
  }
  let callbackId, timer;
  const presented = new Promise((resolve, reject) => {
    callbackId = video.requestVideoFrameCallback(() => resolve());
    timer = setTimeout(() => reject(new Error('The video did not present a decoded frame.')), 10000);
  });
  try {
    await Promise.all([seekTo(firstTime), presented]);
  } finally {
    clearTimeout(timer);
    if (typeof video.cancelVideoFrameCallback === 'function') video.cancelVideoFrameCallback(callbackId);
  }
}

function seekTo(seconds) {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 2 && Math.abs(video.currentTime - seconds) < .001) { resolve(); return; }
    const timer = setTimeout(() => { cleanup(); reject(new Error('Timed out while seeking the video.')); }, 12000);
    const onSeek = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error('The video could not be decoded at this time.')); };
    function cleanup() { clearTimeout(timer); video.removeEventListener('seeked', onSeek); video.removeEventListener('loadeddata', onSeek); video.removeEventListener('error', onError); }
    video.addEventListener('seeked', onSeek, { once: true });
    video.addEventListener('error', onError, { once: true });
    if (seconds === 0 && video.currentTime === 0 && video.readyState < 2) video.addEventListener('loadeddata', onSeek, { once: true });
    else video.currentTime = seconds;
  });
}

function drawFrame(frame) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (video.readyState >= 2) ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  if (!frame) { drawCrop(); return; }
  const threshold = state.settings.thresholdPx;
  const dots = frame.detections;
  ctx.lineWidth = Math.max(1, canvas.width / 800);
  for (let i = 0; i < dots.length; i++) for (let j = i + 1; j < dots.length; j++) {
    if (Math.hypot(dots[i].x - dots[j].x, dots[i].y - dots[j].y) <= threshold) {
      ctx.strokeStyle = groupColors[frame.metrics.groupIds[i] % groupColors.length];
      ctx.beginPath(); ctx.moveTo(dots[i].x, dots[i].y); ctx.lineTo(dots[j].x, dots[j].y); ctx.stroke();
    }
  }
  const radius = Math.max(4, canvas.width / 180);
  for (const [i, dot] of dots.entries()) {
    const group = frame.metrics.groupIds[i];
    const color = frame.metrics.groupSizes[group] === 1 ? '#cad1d0' : groupColors[group % groupColors.length];
    ctx.beginPath(); ctx.arc(dot.x, dot.y, radius + 3, 0, Math.PI * 2); ctx.fillStyle = '#071a22'; ctx.fill();
    ctx.beginPath(); ctx.arc(dot.x, dot.y, radius, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    ctx.font = `bold ${Math.max(12, canvas.width / 42)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 3; ctx.strokeStyle = '#071a22';
    const label = String(group + 1);
    ctx.strokeText(label, dot.x, dot.y - radius - 7);
    ctx.fillStyle = color; ctx.fillText(label, dot.x, dot.y - radius - 7);
  }
  drawCrop();
}

function drawCrop() {
  const box = state.drag?.box ?? state.crop;
  if (!box) return;
  ctx.save();
  ctx.strokeStyle = '#f6d979';
  ctx.lineWidth = Math.max(2, canvas.width / 250);
  ctx.setLineDash([Math.max(6, canvas.width / 80), Math.max(4, canvas.width / 120)]);
  ctx.strokeRect(box.x, box.y, box.width, box.height);
  ctx.restore();
}

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
  state.frames = [];
  state.resultsReady = false;
  resetHuman();
  $('results').hidden = true;
  $('frame-slider').disabled = true;
  $('frame-groups').hidden = true;
  $('timeline').hidden = true;
  $('clear-crop').disabled = full;
  $('crop-label').textContent = full ? 'Using the full video frame.' : `Tank crop: ${width} × ${height} px at (${x}, ${y}).`;
  setCropInputs(box);
  drawFrame(null);
  status(full ? 'Using the full video frame.' : 'Tank area selected. Analyze to use the crop.');
}

canvas.addEventListener('pointerdown', event => {
  if (!state.file || state.running || video.readyState < 2 || !canvas.width) return;
  const point = pointOnCanvas(event);
  state.drag = { start: point, box: { x: point.x, y: point.y, width: 0, height: 0 } };
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
  const box = state.drag.box;
  state.drag = null;
  if (box.width >= 30 && box.height >= 30) {
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

async function loadInferenceJS() {
  try { return await import('https://cdn.jsdelivr.net/npm/inferencejs@1.2.3/dist/inference.es.js'); }
  catch { throw new Error('Could not load InferenceJS. Check your network connection.'); }
}

function modelIdentity(config) { return `${config.projectSlug}/${config.version}/${config.key}`; }

async function prepareModel(config) {
  const identity = modelIdentity(config);
  if (state.model?.identity === identity) return state.model;
  if (state.modelLoad?.identity === identity) return state.modelLoad.promise;
  const precedingLoad = state.modelLoad?.promise;
  const promise = (async () => {
    if (precedingLoad) { try { await precedingLoad; } catch { /* A newer selection can still load. */ } }
    if (state.model?.identity === identity) return state.model;
    if (state.model) {
      try { await state.model.engine.stopWorker(state.model.workerId); } catch { /* Continue with the new model. */ }
      state.model = null;
    }
    const { InferenceEngine } = await loadInferenceJS();
    const engine = new InferenceEngine();
    const workerId = await engine.startWorker(config.projectSlug, config.version, config.key);
    const model = { identity, engine, workerId };
    state.model = model;
    return model;
  })();
  state.modelLoad = { identity, promise };
  try { return await promise; }
  finally { if (state.modelLoad?.promise === promise) state.modelLoad = null; }
}

function settings() {
  const intervalMs = Number($('interval').value);
  const thresholdInches = Number($('threshold').value);
  const gridPixels = Number($('grid-pixels').value);
  const method = $('method').value;
  const confidence = Number($('confidence').value);
  const versionText = $('model-version').value.trim();
  const version = Number(versionText);
  const projectSlug = $('model-slug').value.trim();
  const key = $('publishable-key').value.trim();
  if (!Number.isInteger(intervalMs) || intervalMs < 1) throw new Error('Frame interval must be at least 1 ms.');
  if (!Number.isFinite(thresholdInches) || thresholdInches < 0.01) throw new Error('Close distance must be at least 0.01 inches.');
  if (!Number.isFinite(gridPixels) || gridPixels <= 0) throw new Error('Enter the number of pixels across one 0.5-inch square.');
  const crop = state.crop ?? { x: 0, y: 0, width: video.videoWidth, height: video.videoHeight };
  const common = { method, intervalMs, thresholdInches, thresholdPx: inchesToPixels(thresholdInches, gridPixels), gridPixels, pixelsPerInch: gridPixels * 2, crop: { ...crop } };
  if (method === 'background') {
    const expectedFish = Number($('expected-fish').value);
    if (!Number.isInteger(expectedFish) || expectedFish < 1) throw new Error('Known fish count must be at least one.');
    return { ...common, expectedFish };
  }
  if (!(confidence >= 0 && confidence <= 1)) throw new Error('Confidence must be between 0 and 1.');
  if (!versionText || !Number.isInteger(version) || version < 1) throw new Error('Enter a trained model version from Roboflow’s Models or Deploy tab.');
  if (!projectSlug || projectSlug.includes('/')) throw new Error('Enter only the Roboflow project slug, without the workspace name.');
  if (!key) throw new Error('Enter a Roboflow workspace publishable key.');
  return { ...common, confidence, version, projectSlug, key };
}

function modelErrorMessage(error, config) {
  let payload = error;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { /* Plain text. */ }
  }
  if (typeof payload?.message === 'string' && payload.message.trim().startsWith('{')) {
    try { payload = JSON.parse(payload.message); } catch { /* Plain text. */ }
  }
  const detail = payload?.error?.message ?? payload?.message ?? String(payload);
  const code = payload?.error?.e?.[0]?.code ?? payload?.e?.[0]?.code;
  if (code === 'NO_MODEL' || String(detail).includes('No trained model was found')) {
    return `No trained Roboflow model exists for ${config.projectSlug} version ${config.version}. Choose a trained version in Roboflow’s Models or Deploy tab, or train a model for this project.`;
  }
  if (String(detail).includes('Model initialization failed')) {
    return `Video loaded, but the Roboflow model could not initialize: ${detail}. Check that this model is available for browser inference, then retry.`;
  }
  return `Analysis stopped: ${detail}`;
}

function croppedGray(crop) {
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return grayscale(ctx.getImageData(crop.x, crop.y, crop.width, crop.height));
}

async function prepareBackground(config) {
  const count = Math.min(25, Math.max(1, Math.ceil(video.duration * 2)));
  const samples = [];
  for (let i = 0; i < count; i++) {
    if (state.stopped) return null;
    await seekTo((i + 0.5) * video.duration / count);
    samples.push(croppedGray(config.crop));
    $('progress').value = (i + 1) / count * 10;
    status(`Building tank background · ${i + 1} of ${count} samples`);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  status('Finding the median tank background…');
  return medianBackground(samples);
}

$('analyze').addEventListener('click', async () => {
  if (state.running || !state.file) return;
  let config;
  try { config = settings(); } catch (error) { status(error.message, true); return; }
  if (Math.ceil(video.duration * 1000 / config.intervalMs) > 10000) { status('This setting would analyze over 10,000 frames. Increase the frame interval.', true); return; }
  const times = sampleTimes(video.duration, config.intervalMs);
  state.running = true; state.stopped = false; state.settings = config; state.frames = [];
  state.resultsReady = false;
  resetHuman();
  $('timeline').hidden = true; $('frame-groups').hidden = true;
  $('analyze').disabled = true; $('cancel').hidden = false; $('results').hidden = true; $('video-file').disabled = true; $('method').disabled = true; $('crop-fields').disabled = true;
  $('progress').hidden = false; $('progress').value = 0; $('frame-slider').disabled = true;
  try {
    let model = null;
    let background = null;
    if (config.method === 'background') background = await prepareBackground(config);
    else {
      status('Preparing Roboflow model in this browser…');
      model = await prepareModel(config);
    }
    if (state.stopped) return;
    for (let i = 0; i < times.length; i++) {
      if (state.stopped) break;
      const timestampMs = times[i];
      await seekTo(timestampMs / 1000);
      const { crop } = config;
      let detections, rawCount;
      if (config.method === 'background') {
        detections = detectBackgroundFish(croppedGray(crop), background, crop.width, crop.height, { expectedFish: config.expectedFish }).map((d, index) => ({
          detectionId: index + 1, className: 'fish candidate', confidence: 1,
          ...d, x: d.x + crop.x, y: d.y + crop.y
        }));
        rawCount = detections.length;
      } else {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const bitmap = await createImageBitmap(canvas, crop.x, crop.y, crop.width, crop.height);
        let predictions;
        try { predictions = await model.engine.infer(model.workerId, bitmap); } finally { bitmap.close(); }
        rawCount = Array.isArray(predictions) ? predictions.length : (predictions?.predictions?.length ?? 0);
        detections = normalizePredictions(predictions, crop.width, crop.height, config.confidence).map(d => ({ ...d, x: d.x + crop.x, y: d.y + crop.y }));
      }
      const metrics = frameMetrics(detections, config);
      const frame = { frameIndex: i, timestampMs, rawPredictionCount: rawCount, detections, metrics };
      state.frames.push(frame);
      drawFrame(frame);
      $('empty-preview').hidden = true;
      $('frame-position').textContent = `${i + 1} / ${times.length}`;
      $('frame-time').textContent = timeLabel(timestampMs);
      $('progress').value = (config.method === 'background' ? 10 : 0) + ((i + 1) / times.length) * (config.method === 'background' ? 90 : 100);
      status(config.method === 'background'
        ? `Analyzed ${i + 1} of ${times.length} frames · ${detections.length} fish candidates (known count ${config.expectedFish})`
        : `Analyzed ${i + 1} of ${times.length} frames · ${detections.length} fish in current frame (${rawCount} model boxes)`);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
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
    state.running = false; $('analyze').disabled = false; $('cancel').hidden = true; $('progress').hidden = true; $('video-file').disabled = false; $('method').disabled = false; $('crop-fields').disabled = false;
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
    ? `${tight} of ${valid.length} frames (${fmt(100 * tight / valid.length, 0)}%) had mean nearest-neighbor spacing in the tightest 5% of random placements with the same detection count and tank crop. This is a per-frame comparison, not a video-wide significance test.`
    : 'At least two detections are needed to compare spacing with random placements.';
}

function groupSignature(frame) {
  return [...frame.metrics.groupSizes].sort((a, b) => b - a).join('+');
}

function changeFrames() {
  const changes = [];
  for (let i = 1; i < state.frames.length; i++) {
    if (groupSignature(state.frames[i]) !== groupSignature(state.frames[i - 1])) changes.push(i);
  }
  return changes;
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
  $('frame-groups').textContent = `${groups} · ${frame.metrics.clusterCount} group${frame.metrics.clusterCount === 1 ? '' : 's'} of 2+ · ${frame.metrics.isolatedCount} single · ${Number.isFinite(percentile) ? `spacing percentile ${fmt(percentile * 100, 1)}% vs random` : 'random comparison unavailable'}`;
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

async function seekToDrawableFrame(seconds) {
  await seekTo(seconds);
  // Safari updates drawImage after seeked even when a paused video's frame callback does not fire.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
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
      ? `${frame.frameIndex + 1} / ${state.frames.length} · ${frame.detections.length} candidates / ${state.settings.expectedFish} expected`
      : `${frame.frameIndex + 1} / ${state.frames.length} · ${frame.detections.length} fish / ${frame.rawPredictionCount} boxes`;
    $('frame-time').textContent = timeLabel(frame.timestampMs);
  });
}

$('frame-slider').addEventListener('input', event => selectFrame(Number(event.target.value)));
function refreshDistanceResults() {
  if (!state.frames.length || state.running) return;
  state.settings.thresholdPx = inchesToPixels(state.settings.thresholdInches, state.settings.gridPixels);
  state.settings.pixelsPerInch = state.settings.gridPixels * 2;
  for (const frame of state.frames) frame.metrics = frameMetrics(frame.detections, state.settings);
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
  const nextView = location.hash === '#about' ? 'about' : location.hash === '#human-analysis' ? 'human' : 'analysis';
  if (activeView) viewScroll.set(activeView, window.scrollY);
  activeView = nextView;
  const human = nextView === 'human', about = nextView === 'about';
  $('workspace').hidden = human || about;
  $('results').hidden = human || about || !state.resultsReady;
  $('human-page').hidden = !human;
  $('about-page').hidden = !about;
  document.title = about ? 'About the analysis — Fish Cluster' : human ? 'Human analysis — Fish Cluster' : 'Fish Cluster — zebrafish video analysis';
  if (about) loadAbout();
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

function humanFrameMetrics(index) {
  return analyzeFrame((state.human.marks.get(index) ?? []).filter(insideCrop), state.settings.thresholdPx);
}

function insideCrop(point) {
  const { x, y, width, height } = state.settings.crop;
  return point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height;
}

function humanViewBox() {
  return $('human-show-full').checked
    ? { x: 0, y: 0, width: video.videoWidth, height: video.videoHeight }
    : state.settings.crop;
}

function drawHumanFrame() {
  const index = state.human.index;
  if (index == null || !state.frames[index] || state.human.loading || $('human-page').hidden) return;
  const crop = state.settings.crop;
  const view = humanViewBox();
  const displayWidth = humanCanvas.getBoundingClientRect().width;
  const pixelRatio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(displayWidth * pixelRatio));
  const height = Math.max(1, Math.round(displayWidth * view.height / view.width * pixelRatio));
  if (humanCanvas.width !== width || humanCanvas.height !== height) {
    humanCanvas.width = width; humanCanvas.height = height;
  }
  // Draw overlays at screen resolution while keeping all positions in original video pixels.
  humanCtx.setTransform(width / view.width, 0, 0, height / view.height, 0, 0);
  humanCtx.clearRect(0, 0, view.width, view.height);
  humanCtx.drawImage(video, view.x, view.y, view.width, view.height, 0, 0, view.width, view.height);
  if ($('human-show-full').checked) {
    humanCtx.save();
    humanCtx.strokeStyle = '#f6d979'; humanCtx.lineWidth = 2;
    humanCtx.setLineDash([7, 5]);
    humanCtx.strokeRect(crop.x, crop.y, crop.width, crop.height);
    humanCtx.restore();
  }
  if ($('human-show-nearest').checked) drawHumanNearestLinks(state.frames[index].detections, view);
  if ($('human-show-auto').checked || $('human-show-nearest').checked) {
    humanCtx.save();
    humanCtx.strokeStyle = '#f6d979'; humanCtx.lineWidth = 2;
    for (const dot of state.frames[index].detections) {
      humanCtx.beginPath(); humanCtx.arc(dot.x - view.x, dot.y - view.y, 9, 0, Math.PI * 2); humanCtx.stroke();
    }
    humanCtx.restore();
  }
  const marks = state.human.marks.get(index) ?? [];
  humanCtx.textAlign = 'center'; humanCtx.font = 'bold 14px sans-serif';
  for (const [number, dot] of marks.entries()) {
    if (dot.x < view.x || dot.x > view.x + view.width || dot.y < view.y || dot.y > view.y + view.height) continue;
    const x = dot.x - view.x, y = dot.y - view.y;
    const color = insideCrop(dot) ? '#8ce6ce' : '#f4a7b9';
    humanCtx.beginPath(); humanCtx.arc(x, y, 6, 0, Math.PI * 2);
    humanCtx.fillStyle = color; humanCtx.fill();
    humanCtx.lineWidth = 2; humanCtx.strokeStyle = '#071a22'; humanCtx.stroke();
    humanCtx.strokeStyle = '#071a22'; humanCtx.lineWidth = 3;
    humanCtx.strokeText(String(number + 1), x, y - 11);
    humanCtx.fillStyle = color; humanCtx.fillText(String(number + 1), x, y - 11);
  }
}

function drawHumanNearestLinks(detections, view) {
  const scale = view.width / Math.max(1, humanCanvas.getBoundingClientRect().width);
  humanCtx.save();
  humanCtx.lineWidth = 1.5 * scale;
  humanCtx.strokeStyle = '#f6d979';
  humanCtx.font = `bold ${14 * scale}px sans-serif`;
  humanCtx.textAlign = 'center';
  humanCtx.textBaseline = 'middle';
  const links = nearestNeighborLinks(detections);
  for (const { from, to } of links) {
    const a = detections[from], b = detections[to];
    humanCtx.beginPath();
    humanCtx.moveTo(a.x - view.x, a.y - view.y);
    humanCtx.lineTo(b.x - view.x, b.y - view.y);
    humanCtx.stroke();
  }
  for (const { from, to, distancePx } of links) {
    const a = detections[from], b = detections[to];
    const label = `${fmt(distancePx / state.settings.pixelsPerInch, 2)} in`;
    const width = humanCtx.measureText(label).width + 8 * scale, height = 22 * scale;
    const x = Math.max(width / 2, Math.min(view.width - width / 2, (a.x + b.x) / 2 - view.x));
    const y = Math.max(height / 2, Math.min(view.height - height / 2, (a.y + b.y) / 2 - view.y));
    humanCtx.fillStyle = '#071a22';
    humanCtx.fillRect(x - width / 2, y - height / 2, width, height);
    humanCtx.fillStyle = '#f6d979';
    humanCtx.fillText(label, x, y);
  }
  humanCtx.restore();
}

function updateHumanDetails() {
  const index = state.human.index;
  if (index == null || !state.frames[index]) return;
  const frame = state.frames[index];
  const manual = humanFrameMetrics(index);
  const within = (state.human.marks.get(index) ?? []).filter(insideCrop);
  const outside = (state.human.marks.get(index) ?? []).length - manual.fishCount;
  const matched = matchPointsWithin(within, frame.detections, state.settings.pixelsPerInch * 0.5);
  $('human-slider').value = index;
  $('human-frame-number').value = index + 1;
  $('human-frame-time').textContent = timeLabel(frame.timestampMs);
  $('human-reviewed').checked = state.human.reviewed.has(index);
  $('human-prev').disabled = index === 0;
  $('human-next').disabled = index === state.frames.length - 1;
  $('human-frame-details').innerHTML = `<div><span>Your fish in crop</span><strong>${manual.fishCount}</strong></div><div><span>Your fish outside crop</span><strong>${outside}</strong></div><div><span>Automatic fish</span><strong>${frame.metrics.fishCount}</strong></div><div><span>Centers matched</span><strong>${matched}/${manual.fishCount}</strong></div><div><span>Your groups of 2+</span><strong>${manual.clusterCount}</strong></div><div><span>Automatic groups of 2+</span><strong>${frame.metrics.clusterCount}</strong></div><p>Your group sizes: ${[...manual.groupSizes].sort((a, b) => b - a).join('+') || 'none'}<br>Automatic group sizes: ${groupSignature(frame) || 'none'}</p>`;
  $('human-progress').textContent = `${state.human.reviewed.size} of ${state.frames.length} frames reviewed`;
  let countMatches = 0, centerMatches = 0, groupMatches = 0;
  for (const reviewedIndex of state.human.reviewed) {
    const checkedFrame = state.frames[reviewedIndex];
    const checkedMarks = (state.human.marks.get(reviewedIndex) ?? []).filter(insideCrop);
    const checkedMetrics = analyzeFrame(checkedMarks, state.settings.thresholdPx);
    const pairs = matchPointsWithin(checkedMarks, checkedFrame.detections, state.settings.pixelsPerInch * 0.5);
    if (checkedMarks.length === checkedFrame.detections.length) countMatches++;
    if (pairs === checkedMarks.length && pairs === checkedFrame.detections.length) centerMatches++;
    if ([...checkedMetrics.groupSizes].sort((a, b) => b - a).join('+') === groupSignature(checkedFrame)) groupMatches++;
  }
  $('human-validation-summary').textContent = state.human.reviewed.size
    ? `Of reviewed frames: ${countMatches} count matches, ${centerMatches} complete center matches, ${groupMatches} group-size matches.`
    : 'Review a few frames to compare counts, centers, and group sizes.';
}

function selectHumanFrame(index) {
  if (!state.frames[index] || state.running) return;
  state.human.index = index;
  state.human.loading = true;
  updateHumanDetails();
  const token = ++state.previewToken;
  return queuePreviewSeek(token, state.frames[index].timestampMs, () => {
    if ($('human-page').hidden) return;
    state.human.loading = false;
    drawHumanFrame();
  });
}

$('human-slider').addEventListener('input', event => selectHumanFrame(Number(event.target.value)));
$('human-frame-number').addEventListener('change', event => {
  const number = Number(event.target.value);
  if (Number.isInteger(number) && number >= 1 && number <= state.frames.length) selectHumanFrame(number - 1);
  else event.target.value = (state.human.index ?? 0) + 1;
});
$('human-prev').addEventListener('click', () => selectHumanFrame(state.human.index - 1));
$('human-next').addEventListener('click', () => selectHumanFrame(state.human.index + 1));
$('human-show-full').addEventListener('change', drawHumanFrame);
$('human-show-auto').addEventListener('change', drawHumanFrame);
$('human-show-nearest').addEventListener('change', drawHumanFrame);
new ResizeObserver(() => drawHumanFrame()).observe(humanCanvas.parentElement);
$('human-reviewed').addEventListener('change', event => {
  if (event.target.checked) state.human.reviewed.add(state.human.index);
  else state.human.reviewed.delete(state.human.index);
  updateHumanDetails();
});
$('human-clear').addEventListener('click', () => {
  state.human.marks.delete(state.human.index);
  drawHumanFrame(); updateHumanDetails();
});
humanCanvas.addEventListener('click', event => {
  if (state.human.index == null || state.human.loading) return;
  const rect = humanCanvas.getBoundingClientRect();
  const view = humanViewBox();
  const point = { x: view.x + (event.clientX - rect.left) * view.width / rect.width,
    y: view.y + (event.clientY - rect.top) * view.height / rect.height };
  const marks = state.human.marks.get(state.human.index) ?? [];
  const hit = marks.findIndex(mark => Math.hypot(mark.x - point.x, mark.y - point.y) <= 10);
  if (hit >= 0) marks.splice(hit, 1);
  else marks.push(point);
  state.human.marks.set(state.human.index, marks);
  drawHumanFrame(); updateHumanDetails();
});
$('human-export').addEventListener('click', () => {
  const rows = state.frames.flatMap((frame, index) => {
    const marks = state.human.marks.get(index) ?? [];
    const inCrop = marks.filter(insideCrop);
    const metrics = humanFrameMetrics(index);
    const matched = matchPointsWithin(inCrop, frame.detections, state.settings.pixelsPerInch * 0.5);
    const common = { frame_index: index, frame_number: index + 1, timestamp_ms: frame.timestampMs,
      reviewed: state.human.reviewed.has(index), manual_fish_count_in_crop: inCrop.length,
      manual_fish_count_outside_crop: marks.length - inCrop.length,
      automatic_fish_count: frame.metrics.fishCount, manual_cluster_count: metrics.clusterCount,
      automatic_cluster_count: frame.metrics.clusterCount,
      matched_center_count: matched,
      manual_group_sizes: [...metrics.groupSizes].sort((a, b) => b - a).join('+'),
      automatic_group_sizes: groupSignature(frame), close_distance_inches: state.settings.thresholdInches };
    return marks.length ? marks.map((mark, markIndex) => ({ ...common, mark_number: markIndex + 1,
      x_px: mark.x.toFixed(2), y_px: mark.y.toFixed(2), inside_crop: insideCrop(mark),
      manual_group_id: insideCrop(mark) ? metrics.groupIds[inCrop.indexOf(mark)] + 1 : null })) : [common];
  });
  download(`${baseName()}-human-analysis.csv`, csv(rows, ['frame_index', 'frame_number', 'timestamp_ms', 'reviewed', 'manual_fish_count_in_crop', 'manual_fish_count_outside_crop', 'automatic_fish_count', 'matched_center_count', 'manual_cluster_count', 'automatic_cluster_count', 'manual_group_sizes', 'automatic_group_sizes', 'close_distance_inches', 'mark_number', 'x_px', 'y_px', 'inside_crop', 'manual_group_id']), 'text/csv');
});
showPage();

function download(name, content, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function baseName() { return (state.file?.name ?? 'fish-video').replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-') || 'fish-video'; }
function exportedSettings() {
  const { key, ...safe } = state.settings;
  return { ...safe, frameWidth: video.videoWidth, frameHeight: video.videoHeight, modelReference: safe.projectSlug === 'zebrafish_in_aquarium' && safe.version === 9 ? 'https://universe.roboflow.com/zebrafish-zxjvh/zebrafish_in_aquarium' : null };
}
$('download-csv').addEventListener('click', () => {
  const rows = state.frames.flatMap(f => f.detections.map((d, index) => ({ frame_index: f.frameIndex, timestamp_ms: f.timestampMs, detection_id: d.detectionId, group_id: f.metrics.groupIds[index] + 1, group_size: f.metrics.groupSizes[f.metrics.groupIds[index]], class: d.className, confidence: d.confidence, x_px: d.x, y_px: d.y, box_width_px: d.width, box_height_px: d.height, blob_area_px: d.area, split_from_blob: d.splitFromBlob ?? false, edge_recovered: d.edgeRecovered ?? false })));
  download(`${baseName()}-detections.csv`, csv(rows, ['frame_index', 'timestamp_ms', 'detection_id', 'group_id', 'group_size', 'class', 'confidence', 'x_px', 'y_px', 'box_width_px', 'box_height_px', 'blob_area_px', 'split_from_blob', 'edge_recovered']), 'text/csv');
});
$('download-frames').addEventListener('click', () => {
  const rows = state.frames.map((f, index) => ({ frame_index: f.frameIndex, timestamp_ms: f.timestampMs, rawPredictionCount: f.rawPredictionCount, ...f.metrics, groupSizes: groupSignature(f), groupChanged: index > 0 && groupSignature(f) !== groupSignature(state.frames[index - 1]) }));
  download(`${baseName()}-frames.csv`, csv(rows, ['frame_index', 'timestamp_ms', 'rawPredictionCount', 'fishCount', 'countDifference', 'pairCount', 'meanPairDistancePx', 'meanPairDistanceInches', 'meanNearestDistancePx', 'meanNearestDistanceInches', 'closeFishFraction', 'clusterCount', 'isolatedCount', 'groupSizes', 'groupChanged', 'randomSpacingPercentile']), 'text/csv');
});
$('download-json').addEventListener('click', () => {
  download(`${baseName()}-analysis.json`, JSON.stringify({ videoName: state.file.name, settings: exportedSettings(), summary: summarizeFrames(state.frames), frames: state.frames }, null, 2), 'application/json');
});
