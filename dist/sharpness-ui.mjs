import { frameCandidates } from './candidate-selection.mjs';
import { fmt } from './format.mjs';
import { summarizeSharpnessLabels } from './sharpness.mjs';
import { baseName, sharpnessCsv } from './exports.mjs';
import { download } from './download.mjs';
import { addInputHelp } from './input-help.mjs';

// Try nearby positions so crowded fish do not get covered by another score.
function scoreLabelBox(candidate, candidates, placed, view, width, height, scale) {
  const center = { x: candidate.x - view.x, y: candidate.y - view.y };
  const gap = 12 * scale;
  const offsets = [
    [0, 20 * scale], [0, -20 * scale],
    [width / 2 + gap, 0], [-width / 2 - gap, 0],
    [width / 2 + gap, 20 * scale], [-width / 2 - gap, 20 * scale],
    [width / 2 + gap, -20 * scale], [-width / 2 - gap, -20 * scale]
  ];
  const overlap = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  let best, leastOverlap = Infinity;
  for (const [dx, dy] of offsets) {
    const box = {
      x: Math.max(0, Math.min(view.width - width, center.x + dx - width / 2)),
      y: Math.max(0, Math.min(view.height - height, center.y + dy - height / 2)), width, height
    };
    let cost = placed.reduce((sum, previous) => sum + overlap(box, previous), 0);
    for (const point of candidates) {
      cost += 10 * overlap(box, { x: point.x - view.x - gap, y: point.y - view.y - gap,
        width: gap * 2, height: gap * 2 });
    }
    if (cost < leastOverlap) { best = box; leastOverlap = cost; }
    if (cost === 0) break;
  }
  return best;
}

/** Draw frame-local candidate IDs and scores at a readable screen size. */
export function drawCandidateSharpness(context, candidates, view, pixelsPerScreenPixel) {
  const scale = pixelsPerScreenPixel;
  context.save();
  context.font = `bold ${12 * scale}px sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const placed = [];
  for (const candidate of candidates) {
    const label = `${candidate.rejectionReason ? '× ' : ''}#${candidate.detectionId}${candidate.splitFromBlob ? '†' : ''} S ${fmt(candidate.sharpness)}${candidate.sharpnessClipped ? '*' : ''}`;
    const width = context.measureText(label).width + 8 * scale;
    const height = 19 * scale;
    const box = scoreLabelBox(candidate, candidates, placed, view, width, height, scale);
    placed.push(box);
    const x = box.x + width / 2, y = box.y + height / 2;
    context.strokeStyle = '#a8c2c0';
    context.lineWidth = scale;
    context.beginPath();
    context.moveTo(candidate.x - view.x, candidate.y - view.y);
    context.lineTo(Math.max(box.x, Math.min(box.x + width, candidate.x - view.x)),
      Math.max(box.y, Math.min(box.y + height, candidate.y - view.y)));
    context.stroke();
    context.fillStyle = '#071a22';
    context.fillRect(x - width / 2, y - height / 2, width, height);
    context.fillStyle = candidate.rejectionReason ? '#f4a7b9' : '#eaf5f3';
    context.fillText(label, x, y);
  }
  context.restore();
}

/** Review labels are independent of human center marks and never remove detections. */
export function createSharpnessReview(state) {
  const table = document.getElementById('sharpness-candidates');
  const summary = document.getElementById('sharpness-comparison');

  function updateSummary() {
    const { fish, reflection } = summarizeSharpnessLabels(state.frames, state.human.candidateLabels);
    summary.textContent = `Median sharpness across labeled candidates: fish ${fmt(fish.median)} (n=${fish.count}); ` +
      `reflections ${fmt(reflection.median)} (n=${reflection.count}). Counts include only candidates with scores. ` +
      'Labels are for comparison only and never change which candidates are used.';
  }

  function update(frame) {
    const candidates = frameCandidates(frame);
    if (!candidates.length) {
      table.innerHTML = '<p>No automatic candidates in this frame.</p>';
    } else {
      const rows = candidates.map((candidate, index) => `<tr>
        <th scope="row">#${candidate.detectionId}${candidate.splitFromBlob ? '†' : ''}</th>
        <td>${candidate.trackId ? `T${candidate.trackId}` : '—'}</td>
        <td>${candidate.splitFromBlob ? 'Uncertain estimate' : 'Observed'}</td>
        <td>${fmt(candidate.sharpness)}${candidate.sharpnessClipped ? '*' : ''}</td>
        <td>${fmt(candidate.localContrast)}</td>
        <td>${fmt(candidate.distanceFromCenterPx)}</td>
        <td>${candidate.rejectionReason ? 'No (outer)' : 'Yes'}</td>
        <td><select data-candidate-index="${index}" aria-label="Label candidate ${candidate.detectionId}">
          <option value="">Unsure</option><option value="fish">Fish</option><option value="reflection">Reflection</option>
        </select></td>
      </tr>`).join('');
      table.innerHTML = `<table><thead><tr><th>Candidate</th><th>Track</th><th>Position</th><th>Sharpness</th><th>Contrast</th><th title="Distance from the crop center in video pixels">Center (px)</th><th>Used automatically</th><th>Your label</th></tr></thead><tbody>${rows}</tbody></table>`;
      const labels = state.human.candidateLabels.get(frame.frameIndex);
      for (const select of table.querySelectorAll('select')) {
        select.value = labels?.get(candidates[Number(select.dataset.candidateIndex)].detectionId) ?? '';
        addInputHelp(select, 'Label this candidate as Fish or Reflection to compare sharpness scores. Choose Unsure to remove a label. These labels do not change detections or your manual center marks.');
      }
    }
    updateSummary();
  }

  table.addEventListener('change', event => {
    const select = event.target.closest('select[data-candidate-index]');
    const frame = state.frames[state.human.index];
    if (!select || !frame || !['', 'fish', 'reflection'].includes(select.value)) return;
    const candidate = frameCandidates(frame)[Number(select.dataset.candidateIndex)];
    if (!candidate) return;
    const labels = state.human.candidateLabels.get(frame.frameIndex) ?? new Map();
    if (select.value) labels.set(candidate.detectionId, select.value);
    else labels.delete(candidate.detectionId);
    if (labels.size) state.human.candidateLabels.set(frame.frameIndex, labels);
    else state.human.candidateLabels.delete(frame.frameIndex);
    updateSummary();
  });

  document.getElementById('sharpness-export').addEventListener('click', () => {
    download(`${baseName(state.file?.name)}-sharpness-comparison.csv`,
      sharpnessCsv(state.frames, state.human.candidateLabels), 'text/csv');
  });
  return { update };
}
