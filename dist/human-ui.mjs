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

/** Human-review controls and overlays. Comparisons live in review.mjs. */
export function createHumanReview({ state, video, humanCanvas, queuePreviewSeek, onFrameCorrected }) {
  const $ = id => document.getElementById(id);
  const humanCtx = humanCanvas.getContext('2d');
  const sharpnessReview = createSharpnessReview(state);
  function includedInAnalysis(point) { return insideAnalysisArea(point, state.settings.crop, state.settings.exclusions); }

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
    drawExclusions(humanCtx, state.settings.exclusions, view);
    if ($('human-show-full').checked) {
      humanCtx.save();
      humanCtx.strokeStyle = '#f6d979';
      humanCtx.lineWidth = 2;
      humanCtx.setLineDash([7, 5]);
      humanCtx.strokeRect(crop.x, crop.y, crop.width, crop.height);
      humanCtx.restore();
    }
    if ($('human-show-nearest').checked) drawHumanNearestLinks(state.frames[index].detections, view);
    if ($('human-show-auto').checked || $('human-show-nearest').checked || $('human-show-sharpness').checked) {
      humanCtx.save();
      humanCtx.strokeStyle = '#f6d979';
      humanCtx.lineWidth = 2;
      for (const dot of state.frames[index].automaticDetections ?? state.frames[index].detections) {
        humanCtx.setLineDash(dot.positionUncertain || dot.splitFromBlob ? [3, 3] : []);
        humanCtx.beginPath();
        humanCtx.arc(dot.x - view.x, dot.y - view.y, 9, 0, Math.PI * 2);
        humanCtx.stroke();
      }
      humanCtx.restore();
      drawUncertainCenters(humanCtx, state.frames[index].detections, view,
        view.width / Math.max(1, displayWidth));
    }
    if ($('human-show-auto').checked || $('human-show-sharpness').checked) {
      drawRejectedCandidates(humanCtx, state.frames[index].rejectedDetections ?? [], view,
        view.width / Math.max(1, displayWidth));
    }
    if ($('human-show-sharpness').checked) {
      drawCandidateSharpness(humanCtx, frameCandidates(state.frames[index]), view,
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
    if (index == null || !state.frames[index]) return;
    const frame = state.frames[index];
    sharpnessReview.update(frame);
    const splitCount = frame.detections.filter(point => point.splitFromBlob).length;
    const previousEstimate = frame.detections.some(point =>
      ['previous-frame-overlap', 'tracking-overlap', 'recent-observed-size'].includes(point.splitReason));
    $('human-overlap-note').hidden = splitCount === 0;
    $('human-overlap-note').textContent = previousEstimate
      ? 'Dashed † centers use recent fish paths and are uncertain. Check the neighboring frames, then mark all visible fish and apply your centers if needed. A fully hidden position cannot be verified from this image.'
      : 'Centers marked † are estimates inside joined regions. Check each one against the image.';
    const { manual, automatic, outside, matched } = compareFrame(frame, state.human.marks.get(index) ?? [], state.settings);
    $('human-restore-auto').disabled = !frame.manualCorrectionApplied;
    $('human-correction-status').textContent = frame.manualCorrectionApplied
      ? 'Your applied centers are used in measurements and exports. Original automatic centers are preserved. Editing marks requires applying them again.'
      : 'Mark every fish in this frame, then apply your centers to replace its automatic result. Applying no marks sets its count to zero. Other frames keep their automatic results.';
    $('human-slider').value = index;
    $('human-frame-number').value = index + 1;
    $('human-frame-time').textContent = timeLabel(frame.timestampMs);
    $('human-reviewed').checked = state.human.reviewed.has(index);
    $('human-prev').disabled = index === 0;
    $('human-next').disabled = index === state.frames.length - 1;
    $('human-frame-details').innerHTML = `<div><span>Your fish in usable area</span><strong>${manual.fishCount}</strong></div>
      <div><span>Your fish outside usable area</span><strong>${outside}</strong></div>
      <div><span>Automatic fish</span><strong>${automatic.fishCount}</strong></div>
      <div><span>Centers used in results</span><strong>${frame.detections.length}${frame.manualCorrectionApplied ? ' (manual)' : ''}</strong></div>
      <div><span>Split estimates kept</span><strong>${frame.detections.filter(point => point.splitFromBlob).length}</strong></div>
      <div><span>Excluded outer candidates</span><strong>${frame.rejectedDetections?.length ?? 0}</strong></div>
      <div><span>Centers matched</span><strong>${matched}/${manual.fishCount}</strong></div>
      <div><span>Your groups of 2+</span><strong>${manual.clusterCount}</strong></div>
      <div><span>Automatic groups of 2+</span><strong>${automatic.clusterCount}</strong></div>
      <p>Your group sizes: ${[...manual.groupSizes].sort((a, b) => b - a).join('+') || 'none'}<br>Automatic group sizes: ${groupSignature({ metrics: automatic }) || 'none'}</p>`;
    $('human-progress').textContent = `${state.human.reviewed.size} of ${state.frames.length} frames reviewed`;
    const { countMatches, centerMatches, groupMatches } = summarizeReview(state.frames, state.human.marks, state.human.reviewed, state.settings);
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
  $('human-show-sharpness').addEventListener('change', drawHumanFrame);
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
  $('human-apply-centers').addEventListener('click', () => {
    const index = state.human.index;
    if (index == null || state.running || state.human.loading) return;
    state.frames[index] = applyManualCenters(state.frames[index], state.human.marks.get(index) ?? [], state.settings);
    state.human.reviewed.add(index);
    onFrameCorrected();
    drawHumanFrame(); updateHumanDetails();
  });
  $('human-restore-auto').addEventListener('click', () => {
    const index = state.human.index;
    if (index == null || state.running || state.human.loading) return;
    state.frames[index] = restoreAutomaticCenters(state.frames[index], state.settings);
    onFrameCorrected();
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
    download(`${baseName(state.file?.name)}-human-analysis.csv`,
      humanCsv(state.frames, state.human.marks, state.human.reviewed, state.settings), 'text/csv');
  });
  return { selectHumanFrame };
}
