import { analyzeFrame, cropFitsFrame, csv, mapCanvasPoint, normalizePredictions, sampleTimes, summarizeFrames } from './analysis.mjs';
import { grayscale, medianBackground, detectBackgroundFish } from './background.mjs?v=10';

const $ = id => document.getElementById(id);
const video = $('source-video');
const canvas = $('frame-canvas');
const ctx = canvas.getContext('2d');
const state = { file: null, url: null, frames: [], settings: null, crop: null, drag: null, model: null, modelLoad: null, running: false, stopped: false, previewToken: 0 };

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

function loadMetadata(file) {
  if (!file || state.running) return;
  ++state.previewToken;
  if (state.url) URL.revokeObjectURL(state.url);
  state.file = file;
  state.url = URL.createObjectURL(file);
  state.frames = [];
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
  $('results').hidden = true;
  $('frame-slider').disabled = true;
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
  if (!frame) { drawCrop(); return; }
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const threshold = state.settings.thresholdPx;
  const dots = frame.detections;
  ctx.lineWidth = Math.max(1, canvas.width / 800);
  ctx.strokeStyle = 'rgba(132, 232, 197, .7)';
  for (let i = 0; i < dots.length; i++) for (let j = i + 1; j < dots.length; j++) {
    if (Math.hypot(dots[i].x - dots[j].x, dots[i].y - dots[j].y) <= threshold) {
      ctx.beginPath(); ctx.moveTo(dots[i].x, dots[i].y); ctx.lineTo(dots[j].x, dots[j].y); ctx.stroke();
    }
  }
  const radius = Math.max(4, canvas.width / 180);
  for (const dot of dots) {
    ctx.beginPath(); ctx.arc(dot.x, dot.y, radius + 3, 0, Math.PI * 2); ctx.fillStyle = '#071a22'; ctx.fill();
    ctx.beginPath(); ctx.arc(dot.x, dot.y, radius, 0, Math.PI * 2); ctx.fillStyle = '#91f2d1'; ctx.fill();
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
  $('results').hidden = true;
  $('frame-slider').disabled = true;
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
  const thresholdPct = Number($('threshold').value);
  const method = $('method').value;
  const confidence = Number($('confidence').value);
  const versionText = $('model-version').value.trim();
  const version = Number(versionText);
  const projectSlug = $('model-slug').value.trim();
  const key = $('publishable-key').value.trim();
  if (!Number.isInteger(intervalMs) || intervalMs < 1) throw new Error('Frame interval must be at least 1 ms.');
  if (!(thresholdPct > 0 && thresholdPct <= 100)) throw new Error('Close distance must be between 0.1% and 100%.');
  const crop = state.crop ?? { x: 0, y: 0, width: video.videoWidth, height: video.videoHeight };
  const common = { method, intervalMs, thresholdPct, thresholdPx: Math.hypot(crop.width, crop.height) * thresholdPct / 100, crop: { ...crop } };
  if (method === 'background') {
    const expectedFish = Number($('expected-fish').value);
    const gridPixels = Number($('grid-pixels').value);
    if (!Number.isInteger(expectedFish) || expectedFish < 1) throw new Error('Known fish count must be at least one.');
    if (!(gridPixels > 0)) throw new Error('Enter the number of pixels across one 0.5-inch square.');
    return { ...common, expectedFish, gridPixels, pixelsPerInch: gridPixels / 0.5 };
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
      const metrics = analyzeFrame(detections, config.thresholdPx);
      if (config.pixelsPerInch) {
        metrics.meanPairDistanceInches = metrics.meanPairDistancePx == null ? null : metrics.meanPairDistancePx / config.pixelsPerInch;
        metrics.meanNearestDistanceInches = metrics.meanNearestDistancePx == null ? null : metrics.meanNearestDistancePx / config.pixelsPerInch;
        metrics.countDifference = detections.length - config.expectedFish;
      }
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

function showResults() {
  const summary = summarizeFrames(state.frames);
  $('results').hidden = false;
  $('stat-fish').textContent = fmt(summary.meanFishCount);
  $('stat-distance').textContent = state.settings.method === 'background'
    ? (Number.isFinite(summary.meanPairDistanceInches) ? `${fmt(summary.meanPairDistanceInches, 2)} in` : '—')
    : (Number.isFinite(summary.meanPairDistancePx) ? `${fmt(summary.meanPairDistancePx)} px` : '—');
  $('distance-note').textContent = state.settings.method === 'background'
    ? `approximate · ${fmt(summary.meanPairDistancePx)} px · ${fmt(state.settings.pixelsPerInch)} px/in`
    : 'center to center · pixels';
  $('stat-close').textContent = Number.isFinite(summary.meanCloseFishFraction) ? `${fmt(summary.meanCloseFishFraction * 100, 0)}%` : '—';
  $('stat-clusters').textContent = fmt(summary.meanClusterCount);
  $('frame-slider').max = state.frames.length - 1;
  $('frame-slider').value = state.frames.length - 1;
  $('frame-slider').disabled = false;
}

$('frame-slider').addEventListener('input', async e => {
  const frame = state.frames[Number(e.target.value)];
  if (!frame || state.running) return;
  const token = ++state.previewToken;
  try {
    await seekTo(frame.timestampMs / 1000);
    if (token !== state.previewToken) return;
    drawFrame(frame);
    $('frame-position').textContent = state.settings.method === 'background'
      ? `${frame.frameIndex + 1} / ${state.frames.length} · ${frame.detections.length} candidates / ${state.settings.expectedFish} expected`
      : `${frame.frameIndex + 1} / ${state.frames.length} · ${frame.detections.length} fish / ${frame.rawPredictionCount} boxes`;
    $('frame-time').textContent = timeLabel(frame.timestampMs);
  } catch (error) { status(error.message, true); }
});

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
  const rows = state.frames.flatMap(f => f.detections.map(d => ({ frame_index: f.frameIndex, timestamp_ms: f.timestampMs, detection_id: d.detectionId, class: d.className, confidence: d.confidence, x_px: d.x, y_px: d.y, box_width_px: d.width, box_height_px: d.height, blob_area_px: d.area, split_from_blob: d.splitFromBlob ?? false, edge_recovered: d.edgeRecovered ?? false })));
  download(`${baseName()}-detections.csv`, csv(rows, ['frame_index', 'timestamp_ms', 'detection_id', 'class', 'confidence', 'x_px', 'y_px', 'box_width_px', 'box_height_px', 'blob_area_px', 'split_from_blob', 'edge_recovered']), 'text/csv');
});
$('download-frames').addEventListener('click', () => {
  const rows = state.frames.map(f => ({ frame_index: f.frameIndex, timestamp_ms: f.timestampMs, rawPredictionCount: f.rawPredictionCount, ...f.metrics }));
  download(`${baseName()}-frames.csv`, csv(rows, ['frame_index', 'timestamp_ms', 'rawPredictionCount', 'fishCount', 'countDifference', 'pairCount', 'meanPairDistancePx', 'meanPairDistanceInches', 'meanNearestDistancePx', 'meanNearestDistanceInches', 'closeFishFraction', 'clusterCount', 'isolatedCount']), 'text/csv');
});
$('download-json').addEventListener('click', () => {
  download(`${baseName()}-analysis.json`, JSON.stringify({ videoName: state.file.name, settings: exportedSettings(), summary: summarizeFrames(state.frames), frames: state.frames }, null, 2), 'application/json');
});
