import { shapePath } from './geometry.mjs';
import { drawTankZones } from './tank-zones.mjs';
import { createCanvasViewport } from './canvas-viewport.mjs';
import { frameCandidates } from './candidate-selection.mjs';
import { createSharpnessReview, drawCandidateSharpness } from './sharpness-ui.mjs';
import { insideAnalysisArea } from './region.mjs';
import { drawExclusions, drawRejectedCandidates, drawUncertainCenters, drawFrameGroups } from './preview.mjs';
import { nearestNeighborLinks } from './analysis.mjs';
import { groupSignature } from './measurements.mjs';
import { applyManualCenters, restoreAutomaticCenters, compareFrame, summarizeReview, hasPendingCenters } from './review.mjs';
import { baseName, humanCsv } from './exports.mjs';
import { download } from './download.mjs';
import { fmt, timeLabel } from './format.mjs';
import { reviewFrameIndices, automaticCandidateCount, framePassesCountFilter } from './frame-selection.mjs';

/** Human-review controls and overlays. Comparisons live in review.mjs. */
export function createHumanReview({ state, video, humanCanvas, queuePreviewSeek, downloadFramePng,
  onFrameCorrected, onFrameSelected }) {
  const $ = id => document.getElementById(id);
  const humanCtx = humanCanvas.getContext('2d');
  const sharpnessReview = createSharpnessReview(state);
  const viewport = createCanvasViewport({ canvas: humanCanvas, viewport: $('human-viewport'),
    controls: { fit: $('human-fit'), in: $('human-zoom-in'), out: $('human-zoom-out'), output: $('human-zoom') },
    dimensions: () => state.settings ? humanViewBox() : { width: 1600, height: 1000 },
    onChange: drawHumanFrame });
  const reviewHelp = $('review-help-dialog');
  let downloadingFrame = false;
  $('review-help').addEventListener('click', () => reviewHelp.showModal());
  reviewHelp.addEventListener('click', event => {
    if (event.target !== reviewHelp) return;
    const bounds = reviewHelp.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) reviewHelp.close();
  });
  window.addEventListener('hashchange', () => { if (reviewHelp.open) reviewHelp.close(); });
  function includedInAnalysis(point) { return insideAnalysisArea(point, state.settings.crop, state.settings.exclusions); }
  function visibleIndices() {
    return reviewFrameIndices(state.reviewFrames, state.human.filter ?? (state.frames.length ? 'included' : 'all'),
      state.human.expectedFish ?? state.settings.expectedFish ?? state.settings.filterFrameCount ?? 5, state.settings);
  }

  function updateReviewSummary() {
    const indices = visibleIndices();
    const done = indices.filter(index => state.human.reviewed.has(index) &&
      !hasPendingCenters(state.reviewFrames[index], state.human.marks.get(index), state.settings)).length;
    const complete = indices.length > 0 && done === indices.length;
    $('human-progress').textContent = indices.length ? `${done} of ${indices.length} frames done in this view` : 'No frames in this view';
    $('human-review-complete').hidden = !complete;

    const markedReviewed = new Set([...state.human.reviewed].filter(index => state.human.marks.has(index)));
    const { countMatches, centerMatches, groupMatches } = summarizeReview(state.reviewFrames, state.human.marks, markedReviewed, state.settings);
    $('human-validation-summary').textContent = markedReviewed.size
      ? `Of ${markedReviewed.size} reviewed frames with center marks: ${countMatches} count matches, ${centerMatches} complete center matches, ${groupMatches} group-size matches.`
      : 'Review status records inspection. Enable Edit centers to add marks for a center-by-center comparison.';
    return { complete, remaining: indices.length - done };
  }

  function updateReviewFilter() {
    state.human.filter ??= state.frames.length ? 'included' : 'all';
    state.human.expectedFish ??= state.settings.expectedFish ?? state.settings.filterFrameCount ?? 5;
    const indices = visibleIndices();
    const mismatches = reviewFrameIndices(state.reviewFrames, 'mismatches', state.human.expectedFish).length;
    $('human-frame-filter').value = state.human.filter;
    $('human-expected-fish').closest('label').hidden = state.human.filter !== 'mismatches';
    $('human-expected-fish').value = state.human.expectedFish;
    $('human-frame-filter').options[0].textContent = `Included in results (${state.frames.length})`;
    $('human-frame-filter').options[1].textContent = `All sampled frames (${state.reviewFrames.length})`;
    $('human-frame-filter').options[2].textContent = `Count mismatches (${mismatches})`;
    $('human-filter-summary').textContent = state.human.filter === 'included'
      ? `${indices.length} included · ${mismatches} original count mismatches`
      : `${indices.length} samples · includes frames excluded from results`;
    $('human-frame-workspace').hidden = !indices.length;
    $('human-empty-filter').hidden = indices.length > 0;
    $('human-slider').max = Math.max(0, indices.length - 1);
    $('human-frame-number').max = indices.length;
    updateReviewSummary();
    return indices;
  }

  function humanViewBox() {
    return $('human-show-full').checked
      ? { x: 0, y: 0, width: video.videoWidth, height: video.videoHeight }
      : state.settings.crop;
  }

  function drawHumanFrame() {
    const index = state.human.index;
    if (index == null || !state.reviewFrames[index] || state.human.loading || $('human-page').hidden) return;
    viewport.resize();
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
    drawTankZones(humanCtx, state.settings.tankZones, view, view.width / Math.max(1, displayWidth));
    drawExclusions(humanCtx, state.settings.exclusions, view);
    if ($('human-show-full').checked || crop.polygon) {
      humanCtx.save();
      humanCtx.strokeStyle = '#f6d979';
      humanCtx.lineWidth = 2;
      humanCtx.setLineDash([7, 5]);
      shapePath(humanCtx, crop, view);
      humanCtx.stroke();
      humanCtx.restore();
    }
    const editing = $('human-edit-centers').checked;
    const frame = state.reviewFrames[index];
    const screenScale = view.width / Math.max(1, displayWidth);
    if (!editing) {
      drawFrameGroups(humanCtx, frame, state.settings.thresholdPx, view, screenScale);
      drawUncertainCenters(humanCtx, frame.detections, view, screenScale);
      drawRejectedCandidates(humanCtx, frame.rejectedDetections ?? [], view, screenScale);
    }
    if ($('human-show-nearest').checked) drawHumanNearestLinks(state.reviewFrames[index].detections, view);
    if ($('human-show-auto').checked || $('human-show-nearest').checked || $('human-show-sharpness').checked) {
      humanCtx.save();
      humanCtx.strokeStyle = '#f6d979';
      humanCtx.lineWidth = 2;
      for (const dot of state.reviewFrames[index].automaticDetections ?? state.reviewFrames[index].detections) {
        humanCtx.setLineDash(dot.positionUncertain || dot.splitFromBlob ? [3, 3] : []);
        humanCtx.beginPath();
        humanCtx.arc(dot.x - view.x, dot.y - view.y, 9, 0, Math.PI * 2);
        humanCtx.stroke();
      }
      humanCtx.restore();
      drawUncertainCenters(humanCtx, state.reviewFrames[index].detections, view,
        view.width / Math.max(1, displayWidth));
    }
    if ($('human-show-auto').checked || $('human-show-sharpness').checked) {
      drawRejectedCandidates(humanCtx, state.reviewFrames[index].rejectedDetections ?? [], view,
        view.width / Math.max(1, displayWidth));
    }
    if ($('human-show-sharpness').checked) {
      drawCandidateSharpness(humanCtx, frameCandidates(state.reviewFrames[index]), view,
        view.width / Math.max(1, displayWidth));
    }
    const marks = editing ? state.human.marks.get(index) ?? [] : [];
    humanCanvas.style.cursor = editing ? 'crosshair' : 'default';
    humanCanvas.setAttribute('aria-label', editing ? 'Click a center to remove it or an empty position to add one' : 'Analyzed frame with fish groups; enable Edit centers to correct positions');
    humanCtx.textAlign = 'center';
    humanCtx.font = `bold ${14 * screenScale}px sans-serif`;
    for (const [number, dot] of marks.entries()) {
      if (dot.x < view.x || dot.x > view.x + view.width || dot.y < view.y || dot.y > view.y + view.height) continue;
      const x = dot.x - view.x, y = dot.y - view.y;
      const color = includedInAnalysis(dot) ? '#8ce6ce' : '#f4a7b9';
      humanCtx.beginPath();
      humanCtx.arc(x, y, 6 * screenScale, 0, Math.PI * 2);
      humanCtx.fillStyle = color;
      humanCtx.fill();
      humanCtx.lineWidth = 2 * screenScale;
      humanCtx.strokeStyle = '#071a22';
      humanCtx.stroke();
      humanCtx.strokeStyle = '#071a22';
      humanCtx.lineWidth = 3 * screenScale;
      humanCtx.strokeText(String(number + 1), x, y - 11 * screenScale);
      humanCtx.fillStyle = color;
      humanCtx.fillText(String(number + 1), x, y - 11 * screenScale);
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
    if (index == null || !state.reviewFrames[index]) return;
    const frame = state.reviewFrames[index];
    sharpnessReview.update(frame);
    const splitCount = frame.detections.filter(point => point.splitFromBlob).length;
    const previousEstimate = frame.detections.some(point =>
      ['previous-frame-overlap', 'tracking-overlap', 'recent-observed-size'].includes(point.splitReason));
    $('human-overlap-note').hidden = splitCount === 0;
    $('human-overlap-note').textContent = previousEstimate
      ? 'Dashed † centers use recent fish paths and are uncertain. Check the neighboring frames, then mark all visible fish and apply your centers if needed. A fully hidden position cannot be verified from this image.'
      : 'Centers marked † are estimates inside joined regions. Check each one against the image.';
    const { manual, automatic, outside, matched } = compareFrame(frame, state.human.marks.get(index) ?? [], state.settings);
    const busy = state.human.loading || state.human.loadFailed;
    $('human-download-frame').disabled = busy || state.running || downloadingFrame;
    const editing = $('human-edit-centers').checked;
    $('human-edit-centers').disabled = busy;
    const marks = state.human.marks.get(index);
    const pending = hasPendingCenters(frame, marks, state.settings);
    $('human-edit-status').textContent = state.human.loadFailed ? 'Could not load this frame. Try another sample.'
      : state.human.loading ? 'Loading frame…'
      : `${framePassesCountFilter(frame, state.settings) ? 'Included' : 'Excluded by count filter'} · ${pending ? 'Unapplied edits — use Done & next or Apply & stay' : frame.manualCorrectionApplied ? 'Correction applied ✓ — summary updated' : state.human.reviewed.has(index) ? 'Done ✓ — no changes needed' : 'Inspect or edit, then Done & next'}`;
    $('human-edit-status').dataset.state = pending ? 'pending' : frame.manualCorrectionApplied || state.human.reviewed.has(index) ? 'done' : 'ready';
    $('human-restore-auto').disabled = busy || !frame.manualCorrectionApplied;
    $('human-undo').disabled = busy || !editing || !state.human.markHistory?.get(index)?.length;
    $('human-start-current').disabled = busy || !editing;
    $('human-correction-status').textContent = frame.manualCorrectionApplied
      ? 'Your applied centers are used in measurements and exports. Original automatic centers are preserved. Editing marks requires applying them again.'
      : 'Enable Edit centers to adjust the current detections. Click a center to remove it or click an empty position to add one, then choose Done & next or Apply & stay. Clearing the draft and applying it sets this frame’s count to zero.';
    $('human-correction-status').textContent += framePassesCountFilter(frame, state.settings)
      ? ' This frame is included in analysis results.'
      : ' This frame is excluded from analysis results by the count filter. Applying the required number of centers includes it.';
    const indices = visibleIndices();
    const position = indices.indexOf(index);
    $('human-slider').value = position;
    $('human-frame-number').value = position + 1;
    $('human-frame-time').textContent = `${position + 1}/${indices.length} · Sample ${frame.frameIndex + 1} · ${timeLabel(frame.timestampMs)}`;
    const reviewed = state.human.reviewed.has(index);
    $('human-reviewed').disabled = busy || !reviewed;
    $('human-apply-centers').hidden = !pending;
    $('human-apply-centers').disabled = busy || !pending;
    $('human-apply-centers').textContent = 'Apply & stay';
    const { complete } = updateReviewSummary();
    const anotherUnreviewed = indices.some(other => other !== index && !state.human.reviewed.has(other));
    $('human-done').textContent = complete ? 'Review complete ✓'
      : position === indices.length - 1 && !anotherUnreviewed ? 'Done — finish review' : 'Done & next →';
    $('human-done').disabled = busy || complete;
    $('human-clear').disabled = busy || !editing;
    $('human-prev').disabled = state.human.loading || position <= 0;
    $('human-next').disabled = state.human.loading || position === indices.length - 1;
    $('human-frame-details').innerHTML = `<div><span>Your fish in usable area</span><strong>${manual.fishCount}</strong></div>
      <div><span>Your fish outside usable area</span><strong>${outside}</strong></div>
      ${state.settings.tankZones?.length ? `<div><span>Fish by side (applied result)</span><strong>${frame.metrics.darkSideCount} dark / ${frame.metrics.lightSideCount} light / ${frame.metrics.unmarkedSideCount} unmarked</strong></div>` : ''}
      <div><span>Automatic fish</span><strong>${automatic.fishCount}</strong></div>
      <div><span>Original candidates (all)</span><strong>${automaticCandidateCount(frame)}</strong></div>
      <div><span>Centers used in results</span><strong>${frame.detections.length}${frame.manualCorrectionApplied ? ' (manual)' : ''}</strong></div>
      <div><span>Split estimates kept</span><strong>${frame.detections.filter(point => point.splitFromBlob).length}</strong></div>
      <div><span>Excluded outer candidates</span><strong>${frame.rejectedDetections?.length ?? 0}</strong></div>
      <div><span>Centers matched</span><strong>${matched}/${manual.fishCount}</strong></div>
      <div><span>Your groups of 2+</span><strong>${manual.clusterCount}</strong></div>
      <div><span>Automatic groups of 2+</span><strong>${automatic.clusterCount}</strong></div>
      <p>Your group sizes: ${[...manual.groupSizes].sort((a, b) => b - a).join('+') || 'none'}<br>Automatic group sizes: ${groupSignature({ metrics: automatic }) || 'none'}</p>`;
  }

  function selectHumanFrame(index) {
    if (state.running) return;
    $('human-download-status').textContent = '';
    const indices = updateReviewFilter();
    if (!indices.length) {
      ++state.previewToken;
      state.human.index = null;
      state.human.loading = false;
      $('human-download-frame').disabled = true;
      $('human-frame-details').textContent = 'No frames in this view.';
      $('human-overlap-note').hidden = true;
      onFrameSelected();
      return;
    }
    if (!indices.includes(index)) index = indices[0];
    state.human.index = index;
    state.human.loading = true;
    state.human.loadFailed = false;
    seedMarks();
    updateHumanDetails();
    onFrameSelected();
    const token = ++state.previewToken;
    return queuePreviewSeek(token, state.reviewFrames[index].timestampMs, () => {
      if ($('human-page').hidden) return;
      state.human.loading = false;
      drawHumanFrame();
      updateHumanDetails();
    }).then(result => {
      if (result === false && token === state.previewToken) {
        state.human.loading = false;
        state.human.loadFailed = true;
        updateHumanDetails();
      }
    });
  }

  function selectHumanPosition(position) {
    const index = visibleIndices()[position];
    if (index != null) return selectHumanFrame(index);
  }
  function seedMarks() {
    const index = state.human.index;
    if ($('human-edit-centers').checked && index != null && !state.human.marks.has(index)) {
      state.human.marks.set(index, state.reviewFrames[index].detections.map(({ x, y }) => ({ x, y })));
    }
  }
  $('human-edit-centers').addEventListener('change', () => {
    if (state.human.index == null || state.human.loading || state.human.loadFailed) return;
    seedMarks();
    drawHumanFrame(); updateHumanDetails();
  });
  $('human-frame-filter').addEventListener('change', event => {
    state.human.filter = event.target.value;
    selectHumanFrame(state.human.index);
  });
  $('human-expected-fish').addEventListener('change', event => {
    const count = Number(event.target.value);
    if (!Number.isInteger(count) || count < 1) {
      event.target.value = state.human.expectedFish;
      return;
    }
    state.human.expectedFish = count;
    selectHumanFrame(state.human.index);
  });
  $('human-slider').addEventListener('input', event => selectHumanPosition(Number(event.target.value)));
  $('human-frame-number').addEventListener('change', event => {
    const number = Number(event.target.value);
    if (Number.isInteger(number) && number >= 1 && number <= visibleIndices().length) selectHumanPosition(number - 1);
    else event.target.value = visibleIndices().indexOf(state.human.index) + 1;
  });
  $('human-prev').addEventListener('click', () => selectHumanPosition(visibleIndices().indexOf(state.human.index) - 1));
  $('human-next').addEventListener('click', () => selectHumanPosition(visibleIndices().indexOf(state.human.index) + 1));
  $('human-download-frame').addEventListener('click', async () => {
    const index = state.human.index;
    if (index == null || state.running || state.human.loading || state.human.loadFailed || downloadingFrame) return;
    const frame = state.reviewFrames[index];
    const fullFrame = $('human-show-full').checked;
    const view = { ...humanViewBox() };
    downloadingFrame = true;
    $('human-download-frame').disabled = true;
    $('human-download-status').textContent = '';
    try {
      await downloadFramePng(frame, view, fullFrame);
      if (state.human.index === index && state.reviewFrames[index] === frame)
        $('human-download-status').textContent = `Downloaded sample ${frame.frameIndex + 1} PNG.`;
    } catch (error) {
      if (state.human.index === index && state.reviewFrames[index] === frame)
        $('human-download-status').textContent = `Could not download sample ${frame.frameIndex + 1}: ${error.message}`;
    } finally {
      downloadingFrame = false;
      $('human-download-frame').disabled = state.human.loading || state.human.loadFailed || state.running;
    }
  });
  $('human-show-full').addEventListener('change', () => { viewport.reset(); drawHumanFrame(); });
  $('human-show-auto').addEventListener('change', drawHumanFrame);
  $('human-show-sharpness').addEventListener('change', drawHumanFrame);
  $('human-show-nearest').addEventListener('change', drawHumanFrame);
  $('human-reviewed').addEventListener('click', () => {
    if (state.human.index == null || state.human.loading || state.human.loadFailed) return;
    state.human.reviewed.delete(state.human.index);
    updateHumanDetails();
  });
  function rememberMarks() {
    const index = state.human.index;
    state.human.reviewed.delete(index);
    const histories = state.human.markHistory ??= new Map();
    const history = histories.get(index) ?? [];
    history.push(state.human.marks.has(index) ? state.human.marks.get(index).map(mark => ({ ...mark })) : null);
    if (history.length > 30) history.shift();
    histories.set(index, history);
  }
  function undoMarks() {
    const index = state.human.index;
    if (index == null || state.human.loading || state.human.loadFailed || !$('human-edit-centers').checked) return;
    const history = state.human.markHistory?.get(index);
    if (!history?.length) return;
    state.human.reviewed.delete(index);
    const marks = history.pop();
    if (marks === null) state.human.marks.delete(index);
    else state.human.marks.set(index, marks);
    drawHumanFrame(); updateHumanDetails();
  }
  $('human-undo').addEventListener('click', undoMarks);
  $('human-start-current').addEventListener('click', () => {
    if (state.human.index == null || state.human.loading || state.human.loadFailed || !$('human-edit-centers').checked) return;
    rememberMarks();
    state.human.marks.set(state.human.index, state.reviewFrames[state.human.index].detections.map(({ x, y }) => ({ x, y })));
    drawHumanFrame(); updateHumanDetails();
  });
  $('human-clear').addEventListener('click', () => {
    if (state.human.index == null || state.human.loading || state.human.loadFailed || !$('human-edit-centers').checked) return;
    rememberMarks();
    state.human.marks.set(state.human.index, []);
    drawHumanFrame(); updateHumanDetails();
  });
  function applyCenters() {
    const index = state.human.index;
    if (index == null || state.running || state.human.loading || state.human.loadFailed ||
        !hasPendingCenters(state.reviewFrames[index], state.human.marks.get(index), state.settings)) return false;
    const marks = state.human.marks.get(index);
    state.reviewFrames[index] = applyManualCenters(state.reviewFrames[index], marks, state.settings);
    state.human.reviewed.add(index);
    onFrameCorrected();
    drawHumanFrame(); updateHumanDetails();
    return true;
  }
  $('human-apply-centers').addEventListener('click', applyCenters);
  function doneAndNext() {
    const index = state.human.index;
    if (index == null || state.running || state.human.loading || state.human.loadFailed) return;
    const indices = visibleIndices();
    const next = indices[indices.indexOf(index) + 1];
    if (hasPendingCenters(state.reviewFrames[index], state.human.marks.get(index), state.settings) && !applyCenters()) return;
    state.human.reviewed.add(index);
    const available = visibleIndices();
    const target = available.includes(next) ? next : available.find(other => other !== index && !state.human.reviewed.has(other));
    if (target != null) selectHumanFrame(target);
    else updateHumanDetails();
  }
  $('human-done').addEventListener('click', doneAndNext);
  $('review-export-results').addEventListener('click', () => {
    $('results-exports').open = true;
    $('results-exports').scrollIntoView({ block: 'nearest' });
    $('results-exports').querySelector('summary').focus({ preventScroll: true });
  });
  document.addEventListener('keydown', event => {
    if (reviewHelp.open || $('human-page').hidden || state.running || event.defaultPrevented ||
        event.target.closest('input,select,textarea,summary,[role="button"],[contenteditable]:not([contenteditable="false"])')) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
      if ($('human-edit-centers').checked) { event.preventDefault(); undoMarks(); }
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const position = visibleIndices().indexOf(state.human.index);
    if (event.key === 'ArrowLeft') { event.preventDefault(); selectHumanPosition(position - 1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); selectHumanPosition(position + 1); }
    if (event.key.toLowerCase() === 'r') { event.preventDefault(); doneAndNext(); }
  });
  $('human-restore-auto').addEventListener('click', () => {
    const index = state.human.index;
    if (index == null || state.running || state.human.loading || state.human.loadFailed) return;
    rememberMarks();
    state.reviewFrames[index] = restoreAutomaticCenters(state.reviewFrames[index], state.settings);
    state.human.marks.set(index, state.reviewFrames[index].detections.map(({ x, y }) => ({ x, y })));
    onFrameCorrected();
    drawHumanFrame(); updateHumanDetails();
  });
  humanCanvas.addEventListener('click', event => {
    if (!$('human-edit-centers').checked || state.human.index == null || state.human.loading || state.human.loadFailed) return;
    const rect = humanCanvas.getBoundingClientRect();
    const view = humanViewBox();
    const point = { x: view.x + (event.clientX - rect.left) * view.width / rect.width,
      y: view.y + (event.clientY - rect.top) * view.height / rect.height };
    rememberMarks();
    const marks = state.human.marks.get(state.human.index) ?? [];
    const hitRadius = 10 * view.width / rect.width;
    const hit = marks.findIndex(mark => Math.hypot(mark.x - point.x, mark.y - point.y) <= hitRadius);
    if (hit >= 0) marks.splice(hit, 1);
    else marks.push(point);
    state.human.marks.set(state.human.index, marks);
    drawHumanFrame(); updateHumanDetails();
  });
  $('human-export').addEventListener('click', () => {
    download(`${baseName(state.file?.name)}-human-analysis.csv`,
      humanCsv(state.reviewFrames, state.human.marks, state.human.reviewed, state.settings), 'text/csv');
  });
  function refresh() {
    updateReviewFilter();
    if (state.human.index == null) return;
    updateHumanDetails();
    drawHumanFrame();
  }
  return { selectHumanFrame, indices: visibleIndices, refresh };
}
