import { captureSetup, validateSetup, createExperimentStorage, snapshotResult, resultKey, summarizeGroups, recordsCsv } from './experiment-storage.mjs';

export function createExperimentTools({ getContext, applySetup, getReport, isRunning }) {
  const setupRoot = document.querySelector('#saved-setups');
  const batchRoot = document.querySelector('#batch-results');
  if (!setupRoot || !batchRoot) return { refresh() {}, onVideoLoaded() {} };
  setupRoot.innerHTML = `<p>Reuse tank geometry and scale on matching video dimensions. Check alignment each time.</p><label>Setup name <input data-name placeholder="Tank setup"></label><button class="secondary" type="button" data-save>Save setup</button><label>Saved setup <select data-select></select></label><button class="secondary" type="button" data-load>Apply setup</button><button class="secondary" type="button" data-delete>Delete setup</button><label class="experiment-reuse"><input type="checkbox" data-reuse checked> Reuse current setup for next video</label><p data-status role="status"></p>`;
  batchRoot.innerHTML = `<p>Save each fish once. Group means weight fish equally; target: 10 fish per trial and exposure. Side fractions use known time.</p><label>Trial <input data-trial placeholder="Trial 1"></label><label>Exposure level <input data-exposure placeholder="Exposure level"></label><label>Fish ID <input data-fish placeholder="Fish 1"></label><button class="secondary" type="button" data-add>Add current fish</button><button class="secondary" type="button" data-replace hidden>Replace matching fish</button><p data-status role="status"></p><div data-table></div><button class="secondary" type="button" data-fish-csv>Download per-fish CSV</button><button class="secondary" type="button" data-group-csv>Download group means CSV</button>`;
  const s = selector => setupRoot.querySelector(selector), b = selector => batchRoot.querySelector(selector);
  let data = { setups: [], results: [] }, previousSetup = null;
  let storage;
  try { storage = createExperimentStorage(); data = storage.load(); }
  catch (error) { s('[data-status]').textContent = `Could not read saved data: ${error.message}`; }
  function save(root) {
    try { if (!storage) storage = createExperimentStorage(); storage.save(data); return true; }
    catch (error) { root.querySelector('[data-status]').textContent = `Changes remain available in this page, but browser storage failed: ${error.message}`; return false; }
  }
  function guard(root, action) {
    if (isRunning()) { root.querySelector('[data-status]').textContent = 'Wait for analysis to finish.'; return; }
    try { action(); } catch (error) { root.querySelector('[data-status]').textContent = error.message; }
  }
  function remember() {
    const context = getContext();
    if (context.frameWidth > 0 && context.frameHeight > 0) {
      try { previousSetup = captureSetup(context, 'Current tank setup'); } catch { previousSetup = null; }
    }
  }
  function refresh() {
    const selected = s('[data-select]').value;
    s('[data-select]').replaceChildren(...data.setups.map(setup => new Option(`${setup.name} (${setup.frameWidth} × ${setup.frameHeight})`, setup.name)));
    if (data.setups.some(item => item.name === selected)) s('[data-select]').value = selected;
    const running = isRunning();
    for (const button of setupRoot.querySelectorAll('button')) button.disabled = running;
    for (const button of batchRoot.querySelectorAll('button')) button.disabled = running;
    const table = b('[data-table]'); table.replaceChildren();
    const rows = document.createElement('table');
    const head = rows.createTHead().insertRow();
    for (const label of ['Trial', 'Exposure', 'Fish', 'Video', 'Status', 'Dark %', 'Coverage %', '']) { const th = document.createElement('th'); th.textContent = label; head.append(th); }
    for (const result of data.results) {
      const row = rows.insertRow();
      for (const value of [result.trial, result.exposure, result.fishId, result.fileName, result.partial ? 'Partial' : 'Complete', result.darkFraction == null ? '—' : (result.darkFraction * 100).toFixed(1), result.coverageFraction == null ? '—' : (result.coverageFraction * 100).toFixed(1)]) row.insertCell().textContent = value;
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary'; remove.textContent = 'Remove'; remove.disabled = running;
      remove.addEventListener('click', () => guard(batchRoot, () => { data.results = data.results.filter(item => resultKey(item) !== resultKey(result)); save(batchRoot); refresh(); })); row.insertCell().append(remove);
    }
    table.append(rows);
    for (const group of summarizeGroups(data.results)) { const p = document.createElement('p'); p.textContent = `${group.trial} / ${group.exposure}: ${group.fishCount} / 10 fish (${group.partialFishCount} partial) · mean dark ${group.darkFractionMean == null ? '—' : `${(group.darkFractionMean * 100).toFixed(1)}%`} (n=${group.darkFractionN})`; table.append(p); }
    b('[data-fish-csv]').disabled = running || !data.results.length;
    b('[data-group-csv]').disabled = running || !data.results.length;
    remember();
  }
  s('[data-save]').addEventListener('click', () => guard(setupRoot, () => {
    const setup = captureSetup(getContext(), s('[data-name]').value);
    if (data.setups.some(item => item.name === setup.name)) throw new Error('This setup name exists. Use a new name or delete the existing setup first.');
    data.setups.push(setup); if (save(setupRoot)) s('[data-status]').textContent = `Saved ${setup.name}.`; refresh(); s('[data-select]').value = setup.name;
  }));
  s('[data-load]').addEventListener('click', () => guard(setupRoot, () => {
    const context = getContext(); const setup = validateSetup(data.setups.find(item => item.name === s('[data-select]').value), context.frameWidth, context.frameHeight);
    applySetup(setup); s('[data-status]').textContent = `Applied ${setup.name}. Check alignment before analyzing.`; refresh();
  }));
  s('[data-delete]').addEventListener('click', () => guard(setupRoot, () => { data.setups = data.setups.filter(item => item.name !== s('[data-select]').value); if (save(setupRoot)) s('[data-status]').textContent = 'Setup deleted.'; refresh(); }));
  function add(replace) { guard(batchRoot, () => {
    const result = snapshotResult({ trial: b('[data-trial]').value, exposure: b('[data-exposure]').value, fishId: b('[data-fish]').value, fileName: getContext().fileName }, getReport());
    const index = data.results.findIndex(item => resultKey(item) === resultKey(result));
    if (index >= 0 && !replace) { b('[data-replace]').hidden = false; throw new Error('This fish already exists for this trial and exposure. Use Replace matching fish to update it.'); }
    if (index >= 0) data.results[index] = result; else data.results.push(result);
    b('[data-replace]').hidden = true; if (save(batchRoot)) b('[data-status]').textContent = 'Fish result saved.'; refresh();
  }); }
  b('[data-add]').addEventListener('click', () => add(false)); b('[data-replace]').addEventListener('click', () => add(true));
  function download(rows, name) { const url = URL.createObjectURL(new Blob([recordsCsv(rows)], { type: 'text/csv;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  b('[data-fish-csv]').addEventListener('click', () => download(data.results, 'fish-results.csv'));
  b('[data-group-csv]').addEventListener('click', () => download(summarizeGroups(data.results), 'fish-group-means.csv'));
  function onVideoLoaded() {
    if (s('[data-reuse]').checked && previousSetup && previousSetup.testType === getContext().testType && !isRunning()) {
      try { const context = getContext(); applySetup(validateSetup(previousSetup, context.frameWidth, context.frameHeight)); s('[data-status]').textContent = 'Reused previous tank setup. Check alignment before analyzing.'; }
      catch (error) { s('[data-status]').textContent = `Previous setup was not applied: ${error.message}`; }
    }
    refresh();
  }
  refresh();
  return { refresh, onVideoLoaded };
}
