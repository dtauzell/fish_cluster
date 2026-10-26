import { shapePath } from './geometry.mjs';
import { frameCandidates } from './candidate-selection.mjs';
import { drawCandidateSharpness } from './sharpness-ui.mjs';

// Paint detections supplied by the analyzer; this module does not detect fish.
export function createPreview(canvas, video) {
  const ctx = canvas.getContext('2d');
  function drawFrame(frame, threshold, crop, exclusions = [], showSharpness = false,
    view = { x: 0, y: 0, width: video.videoWidth || canvas.width, height: video.videoHeight || canvas.height }, testType = 'shoaling') {
    if (canvas.width !== view.width) canvas.width = view.width;
    if (canvas.height !== view.height) canvas.height = view.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.translate(-view.x, -view.y);
    if (video.readyState >= 2) ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
    if (!frame) { drawCrop(crop); drawExclusions(ctx, exclusions); return; }
    const dots = frame.detections;
    drawFrameGroups(ctx, frame, threshold, { x: 0, y: 0 }, canvas.width / Math.max(1, canvas.getBoundingClientRect().width), testType);
    drawCrop(crop);
    drawExclusions(ctx, exclusions);
    drawRejectedCandidates(ctx, frame.rejectedDetections ?? [], { x: 0, y: 0 }, canvas.width / Math.max(1, canvas.getBoundingClientRect().width));
    drawUncertainCenters(ctx, dots, { x: 0, y: 0 }, canvas.width / Math.max(1, canvas.getBoundingClientRect().width));
    if (showSharpness) {
      ctx.save();
      ctx.translate(view.x, view.y);
      drawCandidateSharpness(ctx, frameCandidates(frame), view,
        canvas.width / Math.max(1, canvas.getBoundingClientRect().width));
      ctx.restore();
    }
  }

  function drawCrop(box) {
    if (!box) return;
    ctx.save();
    ctx.strokeStyle = '#f6d979';
    ctx.lineWidth = Math.max(2, canvas.width / 250);
    ctx.setLineDash([Math.max(6, canvas.width / 80), Math.max(4, canvas.width / 120)]);
    shapePath(ctx, box);
    ctx.stroke();
    ctx.restore();
  }

  function drawCalibrationLine(line) {
    if (!line) return;
    const scale = canvas.width / Math.max(1, canvas.getBoundingClientRect().width);
    ctx.save();
    ctx.lineWidth = 3 * scale;
    ctx.strokeStyle = '#9ab9ff';
    ctx.fillStyle = '#9ab9ff';
    ctx.beginPath();
    ctx.moveTo(line.start.x, line.start.y);
    ctx.lineTo(line.end.x, line.end.y);
    ctx.stroke();
    for (const point of [line.start, line.end]) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 5 * scale, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  return { drawFrame, drawCalibrationLine };
}

/** Group colors and links are shared by setup previews and the results editor. */
export function drawFrameGroups(ctx, frame, threshold, view, scale, testType = 'shoaling') {
  const shoaling = testType !== 'light-dark';
  const groupColors = ['#8ce6ce', '#f6d979', '#f4a7b9', '#9ab9ff', '#d3a9f0', '#ffba87'];
  ctx.save();
  ctx.translate(-view.x, -view.y);
  const dots = frame.detections;
  ctx.lineWidth = scale;
  for (let i = 0; i < dots.length; i++) for (let j = i + 1; j < dots.length; j++) {
    if (shoaling && Math.hypot(dots[i].x - dots[j].x, dots[i].y - dots[j].y) <= threshold) {
      ctx.strokeStyle = groupColors[frame.metrics.groupIds[i] % groupColors.length];
      ctx.beginPath();
      ctx.moveTo(dots[i].x, dots[i].y);
      ctx.lineTo(dots[j].x, dots[j].y);
      ctx.stroke();
    }
  }
  const radius = 4 * scale;
  for (const [i, dot] of dots.entries()) {
    const group = frame.metrics.groupIds[i];
    const color = !shoaling ? '#8ce6ce' : frame.metrics.groupSizes[group] === 1 ? '#cad1d0' : groupColors[group % groupColors.length];
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, radius + 3 * scale, 0, Math.PI * 2);
    ctx.fillStyle = '#071a22';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    if (!shoaling) continue;
    ctx.font = `bold ${12 * scale}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 3 * scale;
    ctx.strokeStyle = '#071a22';
    const label = String(group + 1);
    ctx.strokeText(label, dot.x, dot.y - radius - 7 * scale);
    ctx.fillStyle = color;
    ctx.fillText(label, dot.x, dot.y - radius - 7 * scale);
  }
  ctx.restore();
}

/** Dashed rings and a dagger remain visible even with sharpness labels hidden. */
export function drawUncertainCenters(context, detections, view, scale) {
  context.save();
  context.font = `bold ${11 * scale}px sans-serif`;
  context.textAlign = 'left';
  context.textBaseline = 'top';
  for (const point of detections) {
    const uncertain = point.positionUncertain || point.splitFromBlob;
    const x = point.x - view.x, y = point.y - view.y;
    if (uncertain) {
      context.strokeStyle = '#ffba87';
      context.lineWidth = 2 * scale;
      context.setLineDash([3 * scale, 3 * scale]);
      context.beginPath(); context.arc(x, y, 11 * scale, 0, Math.PI * 2); context.stroke();
    }
    const label = `${point.trackId ? `T${point.trackId}` : ''}${uncertain ? '†' : ''}`;
    if (!label) continue;
    context.setLineDash([]);
    context.lineWidth = 3 * scale;
    context.strokeStyle = '#071a22';
    context.fillStyle = uncertain ? '#ffba87' : '#eaf5f3';
    context.strokeText(label, x + 10 * scale, y + 7 * scale);
    context.fillText(label, x + 10 * scale, y + 7 * scale);
  }
  context.restore();
}

/** The same overlay is used in the preview and in cropped/full-frame human review. */
export function drawExclusions(context, exclusions = [], view = { x: 0, y: 0 }) {
  context.save();
  context.fillStyle = 'rgba(244, 100, 120, 0.24)';
  context.strokeStyle = '#f4a7b9';
  context.lineWidth = 2;
  for (const box of exclusions) {
    shapePath(context, box, view);
    context.fill();
    context.stroke();
  }
  context.restore();
}

/** Crosses distinguish rejected candidates from centers used in measurements. */
export function drawRejectedCandidates(context, candidates, view, scale) {
  context.save();
  context.strokeStyle = '#f4a7b9';
  context.lineWidth = 2 * scale;
  const radius = 5 * scale;
  for (const point of candidates) {
    const x = point.x - view.x, y = point.y - view.y;
    context.beginPath();
    context.moveTo(x - radius, y - radius);
    context.lineTo(x + radius, y + radius);
    context.moveTo(x + radius, y - radius);
    context.lineTo(x - radius, y + radius);
    context.stroke();
  }
  context.restore();
}
