import { singleFishVelocity, velocityChart } from './velocity.mjs';

export function createVelocityView({ getFrames, getSettings, getSelectedTime }) {
  const $ = id => document.getElementById(id);
  let report = null;
  function draw() {
    const enabled = Boolean(report && (getSettings()?.testType === 'light-dark' || $('show-velocity').checked));
    $('velocity-details').hidden = !enabled;
    if (!enabled) { $('velocity-chart').innerHTML = ''; return; }
    const inches = $('velocity-units').value === 'inches';
    const suffix = inches ? 'InchesPerSecond' : 'PxPerSecond';
    for (const [id, key] of [['velocity-min', 'min'], ['velocity-max', 'max'], ['velocity-average', 'average']]) {
      const value = report[key + suffix];
      $(id).textContent = value == null ? '—' : `${value.toFixed(2)} ${inches ? 'in/s' : 'px/s'}`;
    }
    $('velocity-coverage').textContent = report.validIntervalCount
      ? `${report.validIntervalCount} of ${report.possibleIntervalCount} adjacent intervals measured · ${(report.measuredDurationMs / 1000).toFixed(2)} s covered. Average = total measured distance / measured time.`
      : 'No velocity yet. At least two consecutive included samples with one observed or corrected fish are needed.';
    $('velocity-scale-note').hidden = !inches;
    $('velocity-empty').hidden = report.validIntervalCount > 0;
    $('velocity-chart').hidden = report.validIntervalCount === 0;
    $('velocity-chart').innerHTML = velocityChart(report, $('velocity-units').value, getSelectedTime());
  }
  function refresh() {
    report = getFrames().length ? singleFishVelocity(getFrames(), getSettings()) : null;
    $('velocity-panel').hidden = !report;
    const calibrated = Boolean(report?.pixelsPerInch);
    $('velocity-units').querySelector('option[value="inches"]').disabled = !calibrated;
    if (!calibrated) $('velocity-units').value = 'pixels';
    $('show-velocity').closest('label').hidden = getSettings()?.testType === 'light-dark';
    draw();
  }
  $('show-velocity').addEventListener('change', refresh);
  $('velocity-units').addEventListener('change', draw);
  return { refresh, select: draw,
    exportReport: () => report && (getSettings()?.testType === 'light-dark' || $('show-velocity').checked) ? report : null };
}
