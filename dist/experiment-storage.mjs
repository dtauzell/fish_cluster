import { polygonBox } from './geometry.mjs';

const clone = value => JSON.parse(JSON.stringify(value));
const finite = Number.isFinite;
export const EXPERIMENT_STORAGE_KEY = 'fish-cluster-experiments-v1';
function shape(value, width, height) {
  if (!value || ![value.x, value.y, value.width, value.height].every(finite) || value.x < 0 || value.y < 0 || value.width <= 0 || value.height <= 0 || value.x + value.width > width || value.y + value.height > height) throw new Error('All tank areas and masks must fit inside the video frame.');
  if (value.polygon) {
    const bounds = polygonBox(value.polygon);
    if (bounds.x < value.x || bounds.y < value.y || bounds.x + bounds.width > value.x + value.width || bounds.y + bounds.height > value.y + value.height) throw new Error('Polygon corners must fit inside their area.');
  }
  return clone(value);
}
export function validateSetup(value, width = value?.frameWidth, height = value?.frameHeight) {
  if (!value || value.version !== 1 || typeof value.name !== 'string' || !value.name.trim()) throw new Error('Enter a setup name.');
  if (![value.frameWidth, value.frameHeight].every(n => Number.isInteger(n) && n > 0)) throw new Error('Setup video dimensions are invalid.');
  if (value.frameWidth !== width || value.frameHeight !== height) throw new Error(`Setup requires ${value.frameWidth} × ${value.frameHeight} video pixels; this video is ${width} × ${height}.`);
  if (!finite(value.gridPixels) || value.gridPixels <= 0) throw new Error('Setup scale must be positive.');
  if (!Array.isArray(value.exclusions) || !Array.isArray(value.tankZones)) throw new Error('Setup masks and zones are invalid.');
  const testType = value.testType ?? 'light-dark';
  if (!['light-dark', 'shoaling'].includes(testType)) throw new Error('Setup test type is invalid.');
  const exclusions = value.exclusions.map(box => shape(box, width, height));
  const tankZones = value.tankZones.map(zone => {
    if (!['light', 'dark'].includes(zone.side)) throw new Error('Tank zones must be light or dark.');
    return shape(zone, width, height);
  });
  return { version: 1, testType, name: value.name.trim(), frameWidth: width, frameHeight: height,
    crop: value.crop == null ? null : shape(value.crop, width, height), exclusions, tankZones, gridPixels: value.gridPixels };
}
export function captureSetup(context, name) { return validateSetup({ ...context, version: 1, name }); }
const metrics = ['darkTimeSeconds', 'lightTimeSeconds', 'unknownTimeSeconds', 'observedDurationSeconds', 'zoneSwitchCount', 'averageSpeedPxPerSecond', 'averageSpeedInchesPerSecond', 'velocityDurationSeconds', 'coverageFraction'];
export function resultKey(result) { return JSON.stringify([result.trial, result.exposure, result.fishId]); }
function validateResult(value) {
  const result = { ...value };
  for (const key of ['trial', 'exposure', 'fishId']) {
    if (typeof result[key] !== 'string' || !result[key].trim()) throw new Error('Enter trial, exposure and fish ID before adding a fish.');
    result[key] = result[key].trim();
  }
  const durations = ['darkTimeSeconds', 'lightTimeSeconds', 'unknownTimeSeconds', 'observedDurationSeconds', 'velocityDurationSeconds'];
  if (durations.some(key => !finite(result[key]) || result[key] < 0) || result.observedDurationSeconds <= 0) throw new Error('Fish results require finite nonnegative durations and positive observed duration.');
  const tolerance = Math.max(1e-7, result.observedDurationSeconds * 1e-7);
  if (Math.abs(result.darkTimeSeconds + result.lightTimeSeconds + result.unknownTimeSeconds - result.observedDurationSeconds) > tolerance || result.velocityDurationSeconds > result.observedDurationSeconds + tolerance) throw new Error('Fish result durations are inconsistent.');
  if (!Number.isInteger(result.zoneSwitchCount) || result.zoneSwitchCount < 0) throw new Error('Zone switch count must be a nonnegative integer.');
  for (const key of ['coverageFraction', 'darkFraction', 'lightFraction']) if (result[key] !== null && (!finite(result[key]) || result[key] < 0 || result[key] > 1)) throw new Error('Fish result fractions must be between zero and one.');
  for (const key of ['averageSpeedPxPerSecond', 'averageSpeedInchesPerSecond']) if (result[key] !== null && (!finite(result[key]) || result[key] < 0)) throw new Error('Fish result speeds must be nonnegative or unavailable.');
  return result;
}
export function snapshotResult(metadata, report) {
  const wrapper = report?.summary ? report : null;
  if (wrapper && wrapper.testType !== 'light-dark') throw new Error('Batch fish results require a light/dark trial.');
  report = wrapper?.summary ?? report;
  if (!report) throw new Error('Analyze a light/dark trial before adding a fish.');
  const result = { trial: metadata.trial, exposure: metadata.exposure, fishId: metadata.fishId,
    fileName: String(wrapper?.fileName ?? metadata.fileName ?? ''), testType: 'light-dark',
    complete: wrapper ? wrapper.complete === true : true, partial: wrapper ? wrapper.partial === true || wrapper.complete !== true : false,
    savedAt: new Date().toISOString() };
  for (const key of metrics) result[key] = report[key] ?? null;
  const known = result.darkTimeSeconds + result.lightTimeSeconds;
  result.darkFraction = known > 0 ? result.darkTimeSeconds / known : null;
  result.lightFraction = known > 0 ? result.lightTimeSeconds / known : null;
  return validateResult(result);
}
export function summarizeGroups(results) {
  const groups = new Map();
  for (const result of results) {
    const key = JSON.stringify([result.trial, result.exposure]);
    if (!groups.has(key)) groups.set(key, { trial: result.trial, exposure: result.exposure, fishCount: 0, expectedFish: 10, values: [] });
    const group = groups.get(key); group.fishCount++; group.values.push(result);
  }
  return [...groups.values()].map(({ values, ...group }) => {
    group.completeFishCount = values.filter(row => row.complete === true).length;
    group.partialFishCount = values.filter(row => row.partial === true).length;
    for (const key of [...metrics, 'darkFraction', 'lightFraction']) {
      const valid = values.map(row => row[key]).filter(finite);
      group[`${key}Mean`] = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
      group[`${key}N`] = valid.length;
    }
    return group;
  });
}
export function recordsCsv(rows) {
  if (!rows.length) return '';
  const columns = [...new Set(rows.flatMap(Object.keys))];
  const cell = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return [columns.map(cell).join(','), ...rows.map(row => columns.map(key => cell(row[key])).join(','))].join('\r\n');
}
export function createExperimentStorage(storage = globalThis.localStorage) {
  let readFailed = false;
  return {
    load() {
      try {
      const raw = storage.getItem(EXPERIMENT_STORAGE_KEY);
      if (!raw) return { setups: [], results: [] };
      const value = JSON.parse(raw);
      if (value.version !== 1 || !Array.isArray(value.setups) || !Array.isArray(value.results)) throw new Error('Saved experiment data has an unsupported format.');
      const seen = new Set();
      value.results = value.results.map(validateResult);
      for (const result of value.results) {
        if (!result || !['trial', 'exposure', 'fishId'].every(key => typeof result[key] === 'string' && result[key].trim()) ||
          ![...metrics, 'darkFraction', 'lightFraction'].every(key => result[key] == null || (finite(result[key]) && result[key] >= 0))) throw new Error('Saved fish results are invalid.');
        const key = resultKey(result);
        if (seen.has(key)) throw new Error('Saved fish results contain duplicate fish.');
        seen.add(key);
      }
      return { setups: value.setups.map(setup => validateSetup(setup)), results: clone(value.results) };
      } catch (error) { readFailed = true; throw error; }
    },
    save(value) { if (readFailed) throw new Error('Browser saving is disabled because saved data could not be read. Original data is preserved; export current results as CSV.'); storage.setItem(EXPERIMENT_STORAGE_KEY, JSON.stringify({ version: 1, setups: value.setups, results: value.results })); }
  };
}
