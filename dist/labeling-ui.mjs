import { createLabelProject, editLabelRecord, labelBoxAt, validLabelBox, validateLabelProject } from './label-data.mjs';
import { importLabelProgress, labelDatasetZip, labelProgressJson } from './label-export.mjs';
import { createLabelStorage } from './label-storage.mjs';
import { baseName } from './exports.mjs';
import { download } from './download.mjs';
import { timeLabel } from './format.mjs';

/** A manual dataset editor. It shares decoded video access, but never runs detection. */
export function createLabeling({ canvas, source, queueSeek, isRunning, storageFactory = createLabelStorage }) {
  const $ = id => document.getElementById(id), context = canvas.getContext('2d');
  let project = null, records = new Map(), index = 0, selectedId = null;
  let image = null, bitmap = null, loading = false, importing = false, token = 0, storage = null;
  let importRevision = 0;
  let saved = Promise.resolve(), drag = null;
  let saveRevision = 0;
  const failedSaves = new Set();
  const undo = new Map();

  function message(text, error = false) {
    $('label-status').textContent = text;
    $('label-status').classList.toggle('error', error);
  }
  function current() {
    return records.get(index) ?? { frameIndex: index, timestampMs: index * project.intervalMs, boxes: [], labeled: false };
  }
  function snapshot() {
    return { ...project, records: [...records.values()].map(record => ({ ...record,
      boxes: record.boxes.map(box => ({ ...box })) })) };
  }
  function autosave(record) {
    const projectId = project.id;
    const revision = ++saveRevision, key = `${projectId}:${record.frameIndex}`;
    if (!storage) return;
    $('label-save-status').textContent = 'Saving progress…';
    saved = saved.catch(() => {}).then(() => storage.saveFrame(projectId, record)).then(() => {
      failedSaves.delete(key);
      if (project?.id === projectId && revision === saveRevision) {
        $('label-save-status').textContent = [...failedSaves].some(failed => failed.startsWith(`${projectId}:`))
          ? 'Some progress could not be saved. Save progress JSON before leaving.'
          : 'Progress saved in this browser. Save progress JSON for a portable backup.';
      }
    }).catch(() => {
      failedSaves.add(key);
      if (project?.id === projectId) $('label-save-status').textContent = 'Browser saving failed. Save progress JSON before leaving this page.';
    });
  }
  function remember() {
    const history = undo.get(index) ?? [];
    history.push(current().boxes.map(box => ({ ...box })));
    if (history.length > 30) history.shift();
    undo.set(index, history);
  }
  function changeBoxes(boxes, persist = true) {
    const record = editLabelRecord({ ...current(), image }, boxes);
    records.set(index, record);
    if (persist) autosave(record);
    render(); draw();
  }

  function render() {
    if (!project) return;
    const record = current(), selected = record.boxes.find(box => box.id === selectedId);
    const busy = loading || importing;
    for (const control of $('label-page').querySelectorAll('button,input,select')) control.disabled = importing;
    const complete = [...records.values()].filter(frame => frame.labeled);
    $('label-frame-number').value = index + 1;
    $('label-frame-number').max = project.frameCount;
    $('label-slider').value = index;
    $('label-slider').max = project.frameCount - 1;
    $('label-frame-time').textContent = timeLabel(record.timestampMs);
    $('label-complete').checked = record.labeled;
    $('label-complete').disabled = busy;
    $('label-and-next').disabled = busy;
    $('label-prev').disabled = busy || index === 0;
    $('label-next').disabled = busy || index === project.frameCount - 1;
    $('label-delete').disabled = busy || !selected;
    $('label-clear').disabled = busy || !record.boxes.length;
    $('label-undo').disabled = busy || !undo.get(index)?.length;
    $('label-progress').textContent = `${complete.length} of ${project.frameCount} frames labeled · ${complete.reduce((sum, frame) => sum + frame.boxes.length, 0)} fish boxes`;
    $('label-frame-state').textContent = loading ? 'Loading frame…' : record.labeled
      ? `Labeled · ${record.boxes.length} fish · included in dataset export`
      : `Draft / skipped · ${record.boxes.length} fish · excluded from dataset export`;
    $('label-dataset-export').disabled = importing || !complete.length;
    if (selected) {
      $('label-box-width').value = Number(selected.width.toFixed(2));
      $('label-box-height').value = Number(selected.height.toFixed(2));
    }
    $('label-box-list').replaceChildren();
    for (const [number, box] of record.boxes.entries()) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'secondary';
      button.disabled = importing;
      button.textContent = `Fish ${number + 1}`;
      button.setAttribute('aria-pressed', String(box.id === selectedId));
      button.addEventListener('click', () => { selectedId = box.id; $('label-tool').value = 'edit'; render(); draw(); });
      $('label-box-list').append(button);
    }
  }

  function draw() {
    if (!project || !bitmap || $('label-page').hidden || loading) return;
    const crop = project.crop, displayWidth = Math.max(1, canvas.getBoundingClientRect().width);
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(displayWidth * ratio));
    canvas.height = Math.max(1, Math.round(displayWidth * crop.height / crop.width * ratio));
    context.setTransform(canvas.width / crop.width, 0, 0, canvas.height / crop.height, 0, 0);
    context.drawImage(bitmap, 0, 0, crop.width, crop.height);
    const scale = crop.width / displayWidth;
    context.lineWidth = 2 * scale; context.font = `bold ${13 * scale}px sans-serif`;
    context.textBaseline = 'top';
    for (const [number, box] of current().boxes.entries()) {
      const selected = box.id === selectedId;
      context.strokeStyle = selected ? '#f6d979' : '#8ce6ce';
      context.strokeRect(box.x, box.y, box.width, box.height);
      const label = String(number + 1), labelWidth = context.measureText(label).width + 6 * scale;
      context.fillStyle = '#071a22'; context.fillRect(box.x, box.y, labelWidth, 17 * scale);
      context.fillStyle = selected ? '#f6d979' : '#8ce6ce';
      context.fillText(label, box.x + 3 * scale, box.y + scale);
      context.beginPath(); context.arc(box.x + box.width / 2, box.y + box.height / 2, 2 * scale, 0, Math.PI * 2); context.fill();
      if (selected && $('label-tool').value === 'edit') for (const [x, y] of corners(box)) {
        context.fillRect(x - 3 * scale, y - 3 * scale, 6 * scale, 6 * scale);
      }
    }
  }
  const corners = box => [[box.x, box.y], [box.x + box.width, box.y],
    [box.x + box.width, box.y + box.height], [box.x, box.y + box.height]];

  async function selectFrame(next) {
    if (!project || importing || !Number.isInteger(next) || next < 0 || next >= project.frameCount || isRunning()) return;
    finishDrag();
    const request = ++token;
    index = next; selectedId = null; loading = true;
    render();
    try {
      // Stored images keep annotations aligned even if a later video seek decodes a neighboring frame.
      const cached = current().image;
      let captured = cached;
      if (!captured) await queueSeek(index * project.intervalMs, async () => {
        if (request === token) captured = await source.readPng(project.crop);
      });
      if (request !== token || !captured) return;
      const decoded = await createImageBitmap(captured);
      if (request !== token) { decoded.close(); return; }
      bitmap?.close(); bitmap = decoded; image = captured;
      loading = false; render(); draw();
      message('Click each real fish. Adjust boxes around the whole fish, then mark this frame labeled.');
    } catch (error) {
      if (request !== token) return;
      loading = true; render(); message(error.message, true);
    }
  }

  async function start(config) {
    const candidate = createLabelProject(config);
    if (project?.id === candidate.id) return;
    ++importRevision;
    importing = false;
    ++token; bitmap?.close(); bitmap = null; image = null;
    project = candidate; records = new Map(); undo.clear(); index = 0; selectedId = null; loading = true;
    try {
      await saved;
      storage ??= storageFactory();
      const loaded = await storage.load(candidate);
      if (project?.id !== candidate.id) return;
      validateLabelProject({ ...candidate, records: loaded }, candidate);
      records = new Map(loaded.map(record => [record.frameIndex, record]));
      await storage.saveProject(candidate);
      $('label-save-status').textContent = loaded.length ? 'Restored saved progress for this video, crop, and interval.' : 'Progress saves automatically in this browser.';
    } catch {
      $('label-save-status').textContent = 'Browser saving is unavailable. Save progress JSON before leaving.';
    }
    $('label-source').textContent = `${project.video.name} · ${project.crop.width} × ${project.crop.height} crop · ${project.intervalMs} ms samples`;
    render();
  }

  function markLabeled(labeled) {
    if (!project || loading || importing || !image) return;
    const record = { ...current(), boxes: current().boxes.map(box => ({ ...box })), labeled, image };
    records.set(index, record); autosave(record); render();
  }
  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: Math.max(0, Math.min(project.crop.width, (event.clientX - rect.left) * project.crop.width / rect.width)),
      y: Math.max(0, Math.min(project.crop.height, (event.clientY - rect.top) * project.crop.height / rect.height)) };
  }
  function finishDrag() {
    if (!drag) return;
    drag = null;
    if (records.has(index)) autosave(current());
  }
  canvas.addEventListener('pointerdown', event => {
    if (!project || loading || importing || event.button !== 0) return;
    const position = point(event), boxes = current().boxes;
    if ($('label-tool').value === 'add') {
      const width = Number($('label-box-width').value), height = Number($('label-box-height').value);
      if (!(width >= 1 && height >= 1)) { message('Enter positive box width and height.', true); return; }
      remember();
      selectedId = Math.max(0, ...boxes.map(box => box.id)) + 1;
      changeBoxes([...boxes, labelBoxAt(position.x, position.y, width, height, project.crop, selectedId)]);
      return;
    }
    const selected = boxes.find(box => box.id === selectedId), tolerance = 9 * project.crop.width / canvas.getBoundingClientRect().width;
    const corner = selected ? corners(selected).findIndex(([x, y]) => Math.hypot(position.x - x, position.y - y) <= tolerance) : -1;
    const contains = box => position.x >= box.x && position.x <= box.x + box.width && position.y >= box.y && position.y <= box.y + box.height;
    const hit = corner >= 0 || (selected && contains(selected)) ? selected : [...boxes].reverse().find(contains);
    selectedId = hit?.id ?? null;
    if (hit) {
      remember();
      drag = { start: position, box: { ...hit }, corner };
      canvas.setPointerCapture(event.pointerId);
    }
    render(); draw();
  });
  canvas.addEventListener('pointermove', event => {
    if (!drag) return;
    const position = point(event), crop = project.crop;
    let box;
    if (drag.corner < 0) {
      box = { ...drag.box, x: Math.max(0, Math.min(crop.width - drag.box.width, drag.box.x + position.x - drag.start.x)),
        y: Math.max(0, Math.min(crop.height - drag.box.height, drag.box.y + position.y - drag.start.y)) };
    } else {
      const [oppositeX, oppositeY] = corners(drag.box)[(drag.corner + 2) % 4];
      const x = Math.max(0, Math.min(position.x, oppositeX)), y = Math.max(0, Math.min(position.y, oppositeY));
      box = { ...drag.box, x, y, width: Math.max(1, Math.abs(position.x - oppositeX)), height: Math.max(1, Math.abs(position.y - oppositeY)) };
      box.width = Math.min(box.width, crop.width - box.x); box.height = Math.min(box.height, crop.height - box.y);
    }
    if (validLabelBox(box, crop)) changeBoxes(current().boxes.map(existing => existing.id === box.id ? box : existing), false);
  });
  canvas.addEventListener('pointerup', finishDrag);
  canvas.addEventListener('pointercancel', finishDrag);
  $('label-tool').addEventListener('change', draw);
  for (const id of ['label-box-width', 'label-box-height']) $(id).addEventListener('change', () => {
    if (!project || loading || importing) return;
    const box = current().boxes.find(box => box.id === selectedId);
    const width = Number($('label-box-width').value), height = Number($('label-box-height').value);
    if (!box || !(width >= 1 && height >= 1)) return;
    remember();
    const resized = labelBoxAt(box.x + box.width / 2, box.y + box.height / 2, width, height, project.crop, box.id);
    changeBoxes(current().boxes.map(existing => existing.id === box.id ? resized : existing));
  });
  function removeSelected() {
    if (!project || loading || importing || !selectedId) return;
    remember(); changeBoxes(current().boxes.filter(box => box.id !== selectedId)); selectedId = null; render();
  }
  $('label-delete').addEventListener('click', removeSelected);
  $('label-clear').addEventListener('click', () => { if (!loading && !importing) { remember(); changeBoxes([]); } });
  $('label-undo').addEventListener('click', () => {
    const boxes = undo.get(index)?.pop();
    if (boxes && !loading && !importing) { selectedId = null; changeBoxes(boxes); }
  });
  $('label-complete').addEventListener('change', event => markLabeled(event.target.checked));
  function navigationStep() {
    const value = Number($('label-step').value);
    return Number.isInteger(value) && value >= 1 ? value : 1;
  }
  $('label-and-next').addEventListener('click', () => { markLabeled(true); selectFrame(Math.min(project.frameCount - 1, index + navigationStep())); });
  $('label-prev').addEventListener('click', () => selectFrame(Math.max(0, index - navigationStep())));
  $('label-next').addEventListener('click', () => selectFrame(Math.min(project.frameCount - 1, index + navigationStep())));
  $('label-slider').addEventListener('input', event => selectFrame(Number(event.target.value)));
  $('label-frame-number').addEventListener('change', event => {
    const next = Number(event.target.value) - 1;
    if (Number.isInteger(next) && next >= 0 && next < project.frameCount) selectFrame(next); else render();
  });
  $('label-next-draft').addEventListener('click', () => {
    for (let offset = 1; offset <= project.frameCount; offset++) {
      const next = (index + offset) % project.frameCount;
      if (!records.get(next)?.labeled) { selectFrame(next); return; }
    }
    message('Every sampled frame is labeled.');
  });
  document.addEventListener('keydown', event => {
    if (!project || $('label-page').hidden || loading || importing || drag || event.ctrlKey || event.metaKey || event.altKey ||
      event.target.closest('input,select,textarea,button,a')) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); $('label-prev').click(); }
    if (event.key === 'ArrowRight') { event.preventDefault(); $('label-next').click(); }
    if (event.key.toLowerCase() === 'l') { event.preventDefault(); markLabeled(!current().labeled); }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeSelected(); }
  });
  $('label-dataset-export').addEventListener('click', async () => {
    try {
      finishDrag(); const copy = snapshot();
      message('Preparing labeled images and YOLO annotations…');
      const archive = await labelDatasetZip(copy);
      download(`${baseName(copy.video.name)}-${copy.id}-yolo.zip`, archive, 'application/zip');
      message(`Exported ${copy.records.filter(record => record.labeled).length} labeled frames. Drafts and skipped frames were excluded.`);
    } catch (error) { message(error.message, true); }
  });
  $('label-progress-export').addEventListener('click', async () => {
    try {
      finishDrag(); const copy = snapshot();
      message('Saving portable labeling progress…');
      download(`${baseName(copy.video.name)}-${copy.id}-labeling-progress.json`, await labelProgressJson(copy), 'application/json');
      message('Progress exported, including draft boxes and saved frame images.');
    } catch (error) { message(error.message, true); }
  });
  $('label-progress-import').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file || !project || importing) return;
    event.target.value = '';
    const expected = project;
    const revision = ++importRevision;
    const stillCurrent = () => project === expected && importRevision === revision;
    importing = true; finishDrag(); render(); message('Restoring labeling progress…');
    try {
      const imported = importLabelProgress(await file.text(), expected);
      // Decode all images before replacing existing work, not halfway through an import.
      for (const record of imported.records) if (record.image) {
        const decoded = await createImageBitmap(record.image); decoded.close();
      }
      await saved;
      if (!stillCurrent()) return;
      if (storage) try { await storage.replace(imported); }
      catch { if (stillCurrent()) $('label-save-status').textContent = 'Progress restored in this tab. Browser saving failed; keep a progress JSON backup.'; }
      if (!stillCurrent()) return;
      records = new Map(imported.records.map(record => [record.frameIndex, record])); undo.clear();
      importing = false;
      if (!$('label-page').hidden) await selectFrame(index);
      if (stillCurrent()) message('Progress restored. This replaces labels for this video and crop.');
    } catch (error) { if (stillCurrent()) message(error.message, true); }
    finally {
      if (stillCurrent()) { importing = false; render(); }
    }
  });
  new ResizeObserver(draw).observe(canvas.parentElement);
  return { start, hasProject: () => Boolean(project), show: () => selectFrame(index),
    leave: () => { ++token; finishDrag(); },
    reset: () => { ++importRevision; importing = false; ++token; finishDrag(); bitmap?.close(); bitmap = null; image = null; project = null; records.clear(); undo.clear(); } };
}
