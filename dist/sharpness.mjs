import { frameCandidates } from './candidate-selection.mjs';
import { insideCrop } from './region.mjs';

export const SHARPNESS_METHOD = Object.freeze({
  name: 'laplacian-variance', kernel: 'four-neighbor', paddingPx: 3, minimumPixels: 9
});

/**
 * Diagnostic image measurements, never a fish/reflection classifier.
 *
 * Work on the original grayscale pixels, before thresholding or mask cleanup.
 * The four-neighbor Laplacian measures changes in edge strength; its population
 * variance usually rises with sharpness, but also responds to contrast and noise.
 * A candidate-sized patch plus 3 pixels includes the outline. Tank grid lines or
 * another fish in the patch can still influence the result.
 */
export function candidateSharpness(gray, width, height, candidate, exclusions = []) {
  if (gray.length !== width * height) throw new Error('Sharpness image dimensions do not match.');
  const unavailable = { sharpness: null, localContrast: null, sharpnessPixelCount: 0, sharpnessClipped: false };
  if (![candidate.x, candidate.y, candidate.width, candidate.height].every(Number.isFinite) ||
      candidate.width <= 0 || candidate.height <= 0) return unavailable;

  const padding = SHARPNESS_METHOD.paddingPx;
  const left = Math.floor(candidate.x - candidate.width / 2) - padding;
  const right = Math.ceil(candidate.x + candidate.width / 2) + padding;
  const top = Math.floor(candidate.y - candidate.height / 2) - padding;
  const bottom = Math.ceil(candidate.y + candidate.height / 2) + padding;
  const startX = Math.max(1, left), endX = Math.min(width - 2, right);
  const startY = Math.max(1, top), endY = Math.min(height - 2, bottom);
  let clipped = left < 1 || right > width - 2 || top < 1 || bottom > height - 2;
  let count = 0, sum = 0, sumSquared = 0, brightnessSum = 0, brightnessSquared = 0;

  for (let y = startY; y <= endY; y++) {
    for (let x = startX; x <= endX; x++) {
      // Skip the whole stencil when any of its five pixels is masked. Do not
      // paint excluded pixels black: that would introduce artificial sharp edges.
      const masked = exclusions.some(box => !box.preferenceOnly && [
        { x, y }, { x: x - 1, y }, { x: x + 1, y }, { x, y: y - 1 }, { x, y: y + 1 }
      ].some(point => insideCrop(point, box)));
      if (masked) { clipped = true; continue; }
      const index = y * width + x;
      const center = gray[index];
      const laplacian = gray[index - 1] + gray[index + 1] + gray[index - width] + gray[index + width] - 4 * center;
      count++;
      sum += laplacian;
      sumSquared += laplacian * laplacian;
      brightnessSum += center;
      brightnessSquared += center * center;
    }
  }

  // Tiny/fully excluded patches cannot support a useful comparison. Flat patches
  // with enough pixels legitimately score zero and must not become "unavailable".
  if (count < SHARPNESS_METHOD.minimumPixels) return { ...unavailable, sharpnessPixelCount: count, sharpnessClipped: clipped };
  return {
    sharpness: Math.max(0, sumSquared / count - (sum / count) ** 2),
    localContrast: Math.sqrt(Math.max(0, brightnessSquared / count - (brightnessSum / count) ** 2)),
    sharpnessPixelCount: count,
    sharpnessClipped: clipped
  };
}

/** Summaries describe the scientist's labels; they do not choose a cutoff. */
export function summarizeSharpnessLabels(frames, labelsByFrame) {
  const scores = { fish: [], reflection: [] };
  for (const frame of frames) {
    const labels = labelsByFrame.get(frame.frameIndex);
    for (const candidate of frameCandidates(frame)) {
      const label = labels?.get(candidate.detectionId);
      if (scores[label] && Number.isFinite(candidate.sharpness)) scores[label].push(candidate.sharpness);
    }
  }
  const summarize = values => {
    values.sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    const median = values.length === 0 ? null : values.length % 2
      ? values[middle] : (values[middle - 1] + values[middle]) / 2;
    return { count: values.length, median };
  };
  return { fish: summarize(scores.fish), reflection: summarize(scores.reflection) };
}
