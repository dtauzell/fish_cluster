import { usableRectangles } from './region.mjs';
import { inchesToPixels } from './analysis.mjs';

/** Validate plain values and snapshot the crop so later edits cannot change a run. */
export function createSettings(values, selectedCrop, frameWidth, frameHeight, selectedExclusions = []) {
  const { intervalMs, thresholdInches, gridPixels, method, confidence, expectedFish, versionText, projectSlug, key } = values;
  const version = Number(versionText);
  if (!Number.isInteger(intervalMs) || intervalMs < 1) throw new Error('Frame interval must be at least 1 ms.');
  if (!Number.isFinite(thresholdInches) || thresholdInches < 0.01) throw new Error('Close distance must be at least 0.01 inches.');
  if (!Number.isFinite(gridPixels) || gridPixels <= 0) throw new Error('Enter the number of pixels across one 0.5-inch square.');
  const crop = selectedCrop ?? { x: 0, y: 0, width: frameWidth, height: frameHeight };
  const exclusions = selectedExclusions.map(box => ({ ...box }));
  if (exclusions.some(box => ![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0)) {
    throw new Error('Reflection masks must be rectangles with positive dimensions.');
  }
  if (!usableRectangles(crop, exclusions).length) throw new Error('Reflection masks cover the entire crop. Leave room to detect fish.');
  // Each grid square is half an inch, so two squares span one inch.
  const common = {
    method,
    intervalMs,
    thresholdInches,
    thresholdPx: inchesToPixels(thresholdInches, gridPixels),
    gridPixels,
    pixelsPerInch: gridPixels * 2,
    crop: { ...crop },
    exclusions
  };
  if (method === 'background') {
    if (!Number.isInteger(expectedFish) || expectedFish < 1) throw new Error('Known fish count must be at least one.');
    return { ...common, expectedFish, preferCenter: values.preferCenter === true, trackFish: values.trackFish !== false };
  }
  if (!(confidence >= 0 && confidence <= 1)) throw new Error('Confidence must be between 0 and 1.');
  if (!versionText || !Number.isInteger(version) || version < 1) throw new Error('Enter a trained model version from Roboflow’s Models or Deploy tab.');
  if (!projectSlug || projectSlug.includes('/')) throw new Error('Enter only the Roboflow project slug, without the workspace name.');
  if (!key) throw new Error('Enter a Roboflow workspace publishable key.');
  return { ...common, confidence, version, projectSlug, key };
}
