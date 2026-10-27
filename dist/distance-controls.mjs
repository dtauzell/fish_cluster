export const distanceToInches = (value, units) => Number(value) / (units === 'cm' ? 2.54 : 1);
export const distanceFromInches = (value, units) => value * (units === 'cm' ? 2.54 : 1);

/** Keep every threshold control in sync with one physical distance in inches. */
export function createDistanceControls({ input, units, slider, getSettings, isRunning, refresh, unitsChanged }) {
  let displayedUnits = units.value;
  let lastText = input.value;
  let canonical = distanceToInches(lastText, displayedUnits);
  input.min = distanceFromInches(.01, displayedUnits);
  function readInches() {
    if (input.value !== lastText) {
      canonical = distanceToInches(input.value, displayedUnits);
      lastText = input.value;
    }
    return canonical;
  }
  function writeInches(value) {
    canonical = value;
    input.value = Number(distanceFromInches(value, displayedUnits).toPrecision(12));
    lastText = input.value;
  }
  units.addEventListener('change', () => {
    const inches = readInches();
    const previousUnits = displayedUnits;
    displayedUnits = units.value;
    if (Number.isFinite(inches)) writeInches(inches);
    input.min = distanceFromInches(.01, displayedUnits);
    unitsChanged(previousUnits);
  });
  slider.addEventListener('input', () => {
    const settings = getSettings();
    if (!settings || isRunning()) return;
    const inches = Number(slider.value);
    if (!Number.isFinite(inches) || inches < .01) return;
    settings.thresholdInches = inches;
    writeInches(inches);
    refresh();
  });
  input.addEventListener('change', () => {
    const inches = readInches(), settings = getSettings();
    if (!Number.isFinite(inches) || inches < .01 || !settings || isRunning()) return;
    settings.thresholdInches = inches;
    slider.max = Math.max(Number(slider.max), inches);
    slider.value = inches;
    refresh();
  });
  return { readInches };
}
