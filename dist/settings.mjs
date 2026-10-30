import { copyShape, polygonBox } from './geometry.mjs';
import { analysisPixelMask, usableRectangles } from './region.mjs';
import { inchesToPixels } from './analysis.mjs';
import { darkZoneMask } from './tank-zones.mjs';

/** Validate plain values and snapshot the crop so later edits cannot change a run. */
export function createSettings(values, selectedCrop, frameWidth, frameHeight, selectedExclusions = [], selectedTankZones = []) {
  const { intervalMs, thresholdInches, gridPixels } = values;
  const testType = values.testType;
  if (testType != null && !['shoaling', 'light-dark'].includes(testType)) throw new Error('Choose a shoaling or light-dark test.');
  const expectedFish = testType === 'light-dark' ? 1 : values.expectedFish;
  if (!Number.isInteger(intervalMs) || intervalMs < 1) throw new Error('Frame interval must be at least 1 ms.');
  if (!Number.isFinite(thresholdInches) || thresholdInches < 0.01) throw new Error('Close distance must be at least 0.01 inches.');
  if (!Number.isFinite(gridPixels) || gridPixels <= 0) throw new Error('Enter the number of pixels across one 0.5-inch square.');
  if (!Number.isInteger(expectedFish) || expectedFish < 1) throw new Error('Known fish count must be at least one.');
  const crop = selectedCrop ?? { x: 0, y: 0, width: frameWidth, height: frameHeight };
  const exclusions = selectedExclusions.map(copyShape);
  if (exclusions.some(box => ![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0)) {
    throw new Error('Reflection masks must be rectangles with positive dimensions.');
  }
  if (!usableRectangles(crop, exclusions.filter(box => !box.polygon)).length) throw new Error('Reflection masks cover the entire crop. Leave room to detect fish.');
  const tankZones = selectedTankZones.map(copyShape);
  if (testType === 'light-dark' && !tankZones.some(zone => zone.side === 'dark')) throw new Error('Mark the dark tank region for the light-dark test.');
  if (tankZones.some(zone => !['dark', 'light'].includes(zone.side) ||
    ![zone.x, zone.y, zone.width, zone.height].every(Number.isFinite) || zone.width <= 0 || zone.height <= 0)) {
    throw new Error('Tank regions must be light or dark rectangles with positive dimensions.');
  }
  for (const shape of [crop, ...exclusions, ...tankZones]) {
    if (shape.polygon) {
      const bounds = polygonBox(shape.polygon);
      if (bounds.x < shape.x || bounds.y < shape.y || bounds.x + bounds.width > shape.x + shape.width || bounds.y + bounds.height > shape.y + shape.height) {
        throw new Error('Polygon corners must fit inside their bounding box.');
      }
    }
  }
  if ((crop.polygon || exclusions.some(box => box.polygon)) && !analysisPixelMask(crop, exclusions).some(Boolean)) {
    throw new Error('Masks cover the entire tank area. Leave room to detect fish.');
  }
  if (testType === 'light-dark') {
    const dark = darkZoneMask(crop, tankZones), usable = analysisPixelMask(crop, exclusions);
    if (!dark.some((value, index) => value && usable[index])) throw new Error('Mark a dark region inside the usable tank area.');
  }
  // Each grid square is half an inch, so two squares span one inch.
  const common = {
    ...(testType ? { testType } : {}),
    method: 'background',
    expectedFish,
    intervalMs,
    thresholdInches,
    thresholdPx: inchesToPixels(thresholdInches, gridPixels),
    gridPixels,
    pixelsPerInch: gridPixels * 2,
    crop: copyShape(crop),
    exclusions,
    tankZones,
    filterExactCount: values.filterExactCount === true,
    filterFrameCount: values.filterExactCount === true ? (testType === 'light-dark' ? 1 : values.filterFrameCount) : null
  };
  if (testType !== 'light-dark' && values.filterExactCount && (!Number.isInteger(values.filterFrameCount) || values.filterFrameCount < 1)) {
    throw new Error('Required fish per frame must be a whole number of at least one.');
  }
  return { ...common, interveningFrames: values.interveningFrames === true, thresholdOverlap: values.thresholdOverlap === true, preferCenter: values.preferCenter === true, trackFish: values.trackFish !== false, suppressFlicker: values.suppressFlicker !== false };
}
