import { createCanvasViewport } from './canvas-viewport.mjs';
import { frameCandidates } from './candidate-selection.mjs';
import { createSharpnessReview, drawCandidateSharpness } from './sharpness-ui.mjs';
import { insideAnalysisArea } from './region.mjs';
import { drawExclusions, drawRejectedCandidates, drawUncertainCenters } from './preview.mjs';
import { nearestNeighborLinks } from './analysis.mjs';
import { groupSignature } from './measurements.mjs';
import { applyManualCenters, restoreAutomaticCenters, compareFrame, summarizeReview } from './review.mjs';
import { baseName, humanCsv } from './exports.mjs';
import { download } from './download.mjs';
import { fmt, timeLabel } from './format.mjs';
import { reviewFrameIndices, automaticCandidateCount, framePassesCountFilter } from './frame-selection.mjs';

/** Human-review controls and overlays. Comparisons live in review.mjs. */
export function createHumanReview({ state, video, humanCanvas, queuePreviewSeek, onFrameCorrected }) {
  const $ = id => document.getElementById(id);
  const humanCtx = humanCanvas.getContext('2d');
  const sharpnessReview = createSharpnessReview(state);
  const viewport = createCanvasViewport({ canvas: humanCanvas, viewport: $('human-viewport'),
    controls: { fit: $('human-fit'), in: $('human-zoom-in'), out: $('human-zoom-out'), output: $('human-zoom') },
    dimensions: () => state.settings ? humanViewBox() : { width: 1600, height: 1000 },
    onChange: drawHumanFrame });
  function includedInAnalysis(point) { return insideAnalysisArea(point, state.settings.crop, state.settings.exclusions); }
  function visibleIndices() {
    return reviewFrameIndices(state.reviewFrames, state.human.filter ?? 'all',
      state.human.expectedFish ?? state.settings.expectedFish ?? state.settings.filterFrameCount ?? 5);
  }

  function updateReviewSummary() {
    $('human-progress').textContent = `${state.human.reviewed.size} of ${state.reviewFrames.length} frames reviewed`;
    const { countMatches, centerMatches, groupMatches } = summarizeReview(state.reviewFrames, state.human.marks, state.human.reviewed, state.settings);
    $('human-validation-summary').textContent = state.human.reviewed.size
      ? `Of reviewed frames: ${countMatches} count matches, ${centerMatches} complete center matches, ${groupMatches} group-size matches.`
      : 'Review a few frames to compare counts, centers, and group sizes.';
  }

  function updateReviewFilter() {
    state.human.expectedFish ??= state.settings.expectedFish ?? state.settings.filterFrameCount ?? 5;
    const indices = visibleIndices();
    const mismatches = reviewFrameIndices(state.reviewFrames, 'mismatches', state.human.expectedFish).length;
    $('human-frame-filter').value = state.human.filter ?? 'all';
    $('human-expected-fish').value = state.human.expectedFish;
    $('human-frame-filter').options[0].textContent = `All sampled frames (${state.reviewFrames.length})`;
    $('human-frame-filter').options[1].textContent = `Count mismatches (${mismatches})`;
    $('human-filter-summary').textContent = `${indices.length} samples · ${mismatches} original count mismatches · includes samples excluded from results`;
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
    drawExclusions(humanCtx, state.settings.exclusions, view);
    if ($('human-show-full').checked) {
      humanCtx.save();
      humanCtx.strokeStyle = '#f6d979';
      humanCtx.lineWidth = 2;
      humanCtx.setLineDash([7, 5]);
      humanCtx.strokeRect(crop.x, crop.y, crop.width, crop.height);
      humanCtx.restore();
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
    const marks = state.human.marks.get(index) ?? [];
    humanCtx.textAlign = 'center';
    humanCtx.font = 'bold 14px sans-serif';
    for (const [number, dot] of marks.entries()) {
      if (dot.x < view.x || dot.x > view.x + view.width || dot.y < view.y || dot.y > view.y + view.height) continue;
      const x = dot.x - view.x, y = dot.y - view.y;
      const color = includedInAnalysis(dot) ? '#8ce6ce' : '#f4a7b9';
      humanCtx.beginPath();
      humanCtx.arc(x, y, 6, 0, Math.PI * 2);
      humanCtx.fillStyle = color;
      humanCtx.fill();
      humanCtx.lineWidth = 2;
      humanCtx.strokeStyle = '#071a22';
      humanCtx.stroke();
      humanCtx.strokeStyle = '#071a22';
      humanCtx.lineWidth = 3;
      humanCtx.strokeText(String(number + 1), x, y - 11);
      humanCtx.fillStyle = color;
      humanCtx.fillText(String(number + 1), x, y - 11);
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
    $('human-restore-auto').disabled = state.human.loading || !frame.manualCorrectionApplied;
    $('human-undo').disabled = state.human.loading || !state.human.markHistory?.get(index)?.length;
    $('human-correction-status').textContent = frame.manualCorrectionApplied
      ? 'Your applied centers are used in measurements and exports. Original automatic centers are preserved. Editing marks requires applying them again.'
      : 'Mark every fish in this frame, then apply your centers to replace its automatic result. Applying no marks sets its count to zero. Other frames keep their automatic results.';
    $('human-correction-status').textContent += framePassesCountFilter(frame, state.settings)
      ? ' This frame is included in analysis results.'
      : ' This frame is excluded from analysis results by the count filter. Applying the required number of centers includes it.';
    const indices = visibleIndices();
    const position = indices.indexOf(index);
    $('human-slider').value = position;
    $('human-frame-number').value = position + 1;
    $('human-frame-time').textContent = `${position + 1} of ${indices.length} · Sample ${frame.frameIndex + 1} · ${timeLabel(frame.timestampMs)}`;
    const reviewed = state.human.reviewed.has(index);
    $('human-reviewed').setAttribute('aria-pressed', String(reviewed));
    $('human-reviewed').textContent = reviewed ? 'Reviewed ✓ · click to undo' : 'Mark frame reviewed';
    const hasMarks = state.human.marks.has(index);
    $('human-apply-centers').hidden = !hasMarks;
    $('human-apply-centers').textContent = state.human.marks.get(index)?.length ? 'Use my marks for this frame' : 'Apply 0 centers (empty frame)';
    $('human-apply-next').hidden = !hasMarks;
    const applyLabel = state.human.marks.get(index)?.length ? 'Apply correction' : 'Apply 0 centers';
    $('human-apply-next').textContent = position === indices.length - 1 ? `${applyLabel} & finish` : `${applyLabel} & next →`;
    $('human-reviewed-next').textContent = position === indices.length - 1 ? 'Mark reviewed & finish' : 'Mark reviewed & next →';
    for (const id of ['human-reviewed', 'human-reviewed-next', 'human-apply-centers', 'human-apply-next', 'human-clear']) $(id).disabled = state.human.loading;
    $('human-prev').disabled = state.human.loading || position <= 0;
    $('human-next').disabled = state.human.loading || position === indices.length - 1;
    $('human-frame-details').innerHTML = `<div><span>Your fish in usable area</span><strong>${manual.fishCount}</strong></div>
      <div><span>Your fish outside usable area</span><strong>${outside}</strong></div>
      <div><span>Automatic fish</span><strong>${automatic.fishCount}</strong></div>
      <div><span>Original candidates (all)</span><strong>${automaticCandidateCount(frame)}</strong></div>
      <div><span>Centers used in results</span><strong>${frame.detections.length}${frame.manualCorrectionApplied ? ' (manual)' : ''}</strong></div>
      <div><span>Split estimates kept</span><strong>${frame.detections.filter(point => point.splitFromBlob).length}</strong></div>
      <div><span>Excluded outer candidates</span><strong>${frame.rejectedDetections?.length ?? 0}</strong></div>
      <div><span>Centers matched</span><strong>${matched}/${manual.fishCount}</strong></div>
      <div><span>Your groups of 2+</span><strong>${manual.clusterCount}</strong></div>
      <div><span>Automatic groups of 2+</span><strong>${automatic.clusterCount}</strong></div>
      <p>Your group sizes: ${[...manual.groupSizes].sort((a, b) => b - a).join('+') || 'none'}<br>Automatic group sizes: ${groupSignature({ metrics: automatic }) || 'none'}</p>`;
    updateReviewSummary();
  }

  function selectHumanFrame(index) {
    if (state.running) return;
    const indices = updateReviewFilter();
    if (!indices.length) {
      ++state.previewToken;
      state.human.index = null;
      state.human.loading = false;
      $('human-frame-details').textContent = 'No frames in this view.';
      $('human-overlap-note').hidden = true;
      return;
    }
    if (!indices.includes(index)) index = indices[0];
    state.human.index = index;
    state.human.loading = true;
    updateHumanDetails();
    const token = ++state.previewToken;
    return queuePreviewSeek(token, state.reviewFrames[index].timestampMs, () => {
      if ($('human-page').hidden) return;
      state.human.loading = false;
      drawHumanFrame();
      updateHumanDetails();
    });
  }

  function selectHumanPosition(position) { selectHumanFrame(visibleIndices()[position]); }
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
  $('human-show-full').addEventListener('change', () => { viewport.reset(); drawHumanFrame(); });
  $('human-show-auto').addEventListener('change', drawHumanFrame);
  $('human-show-sharpness').addEventListener('change', drawHumanFrame);
  $('human-show-nearest').addEventListener('change', drawHumanFrame);
  $('human-reviewed').addEventListener('click', () => {
    if (state.human.index == null || state.human.loading) return;
    if (state.human.reviewed.has(state.human.index)) state.human.reviewed.delete(state.human.index);
    else state.human.reviewed.add(state.human.index);
    updateHumanDetails();
  });
  function rememberMarks() {
    const index = state.human.index;
    const histories = state.human.markHistory ??= new Map();
    const history = histories.get(index) ?? [];
    history.push(state.human.marks.has(index) ? state.human.marks.get(index).map(mark => ({ ...mark })) : null);
    if (history.length > 30) history.shift();
    histories.set(index, history);
  }
  function undoMarks() {
    const index = state.human.index;
    if (index == null || state.human.loading) return;
    const history = state.human.markHistory?.get(index);
    if (!history?.length) return;
    const marks = history.pop();
    if (marks === null) state.human.marks.delete(index);
    else state.human.marks.set(index, marks);
    drawHumanFrame(); updateHumanDetails();
  }
  $('human-undo').addEventListener('click', undoMarks);
  $('human-clear').addEventListener('click', () => {
    if (state.human.index == null || state.human.loading) return;
    rememberMarks();
    state.human.marks.set(state.human.index, []);
    drawHumanFrame(); updateHumanDetails();
  });
  function applyCenters() {
    const index = state.human.index;
    if (index == null || state.running || state.human.loading || !state.human.marks.has(index)) return false;
    const marks = state.human.marks.get(index);
    state.reviewFrames[index] = applyManualCenters(state.reviewFrames[index], marks, state.settings);
    state.human.reviewed.add(index);
    onFrameCorrected();
    drawHumanFrame(); updateHumanDetails();
    return true;
  }
  $('human-apply-centers').addEventListener('click', applyCenters);
  function reviewAndNext(apply = false) {
    const index = state.human.index;
    if (index == null || state.running || state.human.loading) return;
    const indices = visibleIndices();
    const next = indices[indices.indexOf(index) + 1];
    if (apply && !applyCenters()) return;
    state.human.reviewed.add(index);
    if (next != null) selectHumanFrame(next);
    else updateHumanDetails();
  }
  $('human-reviewed-next').addEventListener('click', () => reviewAndNext());
  $('human-apply-next').addEventListener('click', () => reviewAndNext(true));
  document.addEventListener('keydown', event => {
    if ($('human-page').hidden || state.running || state.human.loading || event.defaultPrevented ||
        event.target.closest('input,select,textarea,button,a,summary,[role="button"],[contenteditable="true"]')) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
      event.preventDefault(); undoMarks(); return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); $('human-prev').click(); }
    if (event.key === 'ArrowRight') { event.preventDefault(); $('human-next').click(); }
    if (event.key.toLowerCase() === 'r') { event.preventDefault(); reviewAndNext(); }
  });
  $('human-restore-auto').addEventListener('click', () => {
    const index = state.human.index;
    if (index == null || state.running || state.human.loading) return;
    state.reviewFrames[index] = restoreAutomaticCenters(state.reviewFrames[index], state.settings);
    onFrameCorrected();
    drawHumanFrame(); updateHumanDetails();
  });
  humanCanvas.addEventListener('click', event => {
    if (state.human.index == null || state.human.loading) return;
    const rect = humanCanvas.getBoundingClientRect();
    const view = humanViewBox();
    const point = { x: view.x + (event.clientX - rect.left) * view.width / rect.width,
      y: view.y + (event.clientY - rect.top) * view.height / rect.height };
    rememberMarks();
    const marks = state.human.marks.get(state.human.index) ?? [];
    const hit = marks.findIndex(mark => Math.hypot(mark.x - point.x, mark.y - point.y) <= 10);
    if (hit >= 0) marks.splice(hit, 1);
    else marks.push(point);
    state.human.marks.set(state.human.index, marks);
    drawHumanFrame(); updateHumanDetails();
  });
  $('human-export').addEventListener('click', () => {
    download(`${baseName(state.file?.name)}-human-analysis.csv`,
      humanCsv(state.reviewFrames, state.human.marks, state.human.reviewed, state.settings), 'text/csv');
  });
  return { selectHumanFrame };
}
