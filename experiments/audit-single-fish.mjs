// Offline audit of the production detector. Requires local FFmpeg / FFprobe.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, openSync, readSync, closeSync, unlinkSync, rmdirSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { grayscale } from '../dist/background.mjs';
import { analyzeVideo } from '../dist/pipeline.mjs';
import { hasAmbiguousRejectedCandidates } from '../dist/candidate-selection.mjs';
import { csv } from '../dist/analysis.mjs';

const presets = [
  { file: 'single_fish_lighter_dark_part.mov', reviewedSourceFrames: [19, 20, 21, 22, 132, 133, 134, 135, 136, 137], crop: { x: 452, y: 111, width: 491, height: 182,
    polygon: [{ x: 452, y: 131 }, { x: 930, y: 111 }, { x: 943, y: 289 }, { x: 456, y: 293 }] },
  tankZones: [{ x: 686, y: 118, width: 256, height: 169, side: 'dark',
    polygon: [{ x: 688, y: 121 }, { x: 930, y: 118 }, { x: 942, y: 285 }, { x: 686, y: 287 }] }] },
  { file: 'single_fish_dark_side_1.mov', crop: { x: 167, y: 372, width: 538, height: 209 },
    tankZones: [{ x: 408, y: 377, width: 289, height: 190, side: 'dark' }] }
];
const output = resolve(process.argv[2] ?? 'experiments/background_results/single-fish-audit');
const generatedAt = new Date().toISOString();
mkdirSync(output, { recursive: true });
const previousGallery = existsSync(join(output, 'review.html')) ? readFileSync(join(output, 'review.html'), 'utf8') : '';
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { maxBuffer: 32 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw result.error ?? new Error(`${command}: ${result.stderr}`);
  return result.stdout;
}
function reasons(frame) {
  const result = [];
  if (frame.detections.length === 0) result.push('missing');
  if (frame.detections.length > 1) result.push('multiple');
  if (frame.detections.length > 0 && (frame.selectionConfident === false || hasAmbiguousRejectedCandidates(frame))) result.push('ambiguous');
  if (frame.detections.some(point => point.positionUncertain || point.splitFromBlob ||
      point.positionSource !== 'observed')) result.push('uncertain-or-estimated');
  return result;
}
function intervals(rows) {
  const groups = [];
  for (const row of rows.filter(row => row.reasons.length)) {
    let group = groups.at(-1);
    if (!group || row.sample !== group.at(-1).sample + 1) groups.push(group = []);
    group.push(row);
  }
  return groups.map(group => ({ startSeconds: group[0].seconds, endSeconds: group.at(-1).seconds,
    count: group.length, reasons: [...new Set(group.flatMap(row => row.reasons))],
    sourceFrames: [group[0].sourceFrame, group[Math.floor(group.length / 2)].sourceFrame, group.at(-1).sourceFrame] }));
}
const summaries = [];
const cards = [];
for (const preset of presets) {
  const file = resolve(preset.file), name = basename(file, '.mov');
  // Read the last pass before replacing it so resolved misses stay reviewable.
  const previousResults = ['native', '200ms'].flatMap(mode => {
    const path = join(output, `${name}-${mode}.json`);
    return existsSync(path) ? [JSON.parse(readFileSync(path, 'utf8'))] : [];
  });
  const metadata = JSON.parse(run('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_streams', '-show_frames', '-show_entries',
    'stream=width,height,duration,r_frame_rate:frame=best_effort_timestamp_time', '-of', 'json', file]));
  const stream = metadata.streams[0];
  const timestamps = metadata.frames.map(frame => Number(frame.best_effort_timestamp_time));
  const [num, den] = stream.r_frame_rate.split('/').map(Number), fps = num / den;
  const duration = Number(stream.duration), count = timestamps.length;
  // Keep the pipeline's fixed-rate clock, allowing small container jitter.
  // Pixels still consume every native frame once; report original timestamps.
  const maxTimingJitterMs = Math.max(...timestamps.map((time, i) => Math.abs(time - timestamps[0] - i / fps) * 1000));
  if (maxTimingJitterMs > 10)
    throw new Error(`${file}: variable frame timing needs an explicit timestamp adapter`);
  console.log(`${name}: decoding ${count} native frames (${fps} fps)`);
  const scratch = mkdtempSync(join(tmpdir(), 'fish-audit-')), raw = join(scratch, 'frames.rgba');
  const { crop } = preset;
  let fd;
  try {
    run('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:v:0', '-vf',
      `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}:exact=1`, '-fps_mode', 'passthrough',
      '-pix_fmt', 'rgba', '-f', 'rawvideo', raw]);
    fd = openSync(raw, 'r');
    const rgba = Buffer.alloc(crop.width * crop.height * 4);
    function readFrame(index) {
      if (index < 0 || index >= count || readSync(fd, rgba, 0, rgba.length, index * rgba.length) !== rgba.length)
        throw new Error(`Incomplete decode at frame ${index + 1}`);
      return rgba;
    }
    const results = [];
    for (const mode of ['native', '200ms']) {
      const config = { method: 'background', testType: 'light-dark', expectedFish: 1, ...preset,
        intervalMs: mode === 'native' ? 1000 / fps : 200, exclusions: [], trackFish: true,
        suppressFlicker: true, pixelsPerInch: 30.6, thresholdPx: 45 };
      delete config.file;
      delete config.reviewedSourceFrames;
      let requestedTime = 0, reads = 0;
      const sourceIndices = [];
      const source = { seekTo: async seconds => { requestedTime = seconds; }, readGray: () => {
        // Native pass consumes each source frame exactly once, after the 25
        // background reads. Sampled pass chooses the nearest source timestamp.
        const index = mode === 'native' && reads >= 25 ? reads - 25
          : timestamps.reduce((best, time, i) => Math.abs(time - requestedTime) < Math.abs(timestamps[best] - requestedTime) ? i : best, 0);
        if (reads++ >= 25) sourceIndices.push(index);
        return grayscale({ data: readFrame(index), width: crop.width, height: crop.height });
      } };
      const frames = [];
      for await (const event of analyzeVideo({ config, duration, source })) {
        if (event.frame) {
          frames.push(event.frame);
          if (frames.length % 300 === 0) console.log(`  ${mode}: ${frames.length} frames analyzed`);
        }
      }
      if (mode === 'native' && (frames.length !== count || new Set(sourceIndices).size !== count))
        throw new Error('Native pass did not cover every source frame exactly once');
      // Classify after completion: the pipeline can revise the preceding frame.
      const rows = frames.map((frame, index) => ({ sample: index + 1, sourceFrame: sourceIndices[index] + 1,
        seconds: timestamps[sourceIndices[index]], reasons: reasons(frame), detections: frame.detections.length,
        x: frame.detections[0]?.x, y: frame.detections[0]?.y, selectionMethod: frame.selectionMethod }));
      const summary = { video: preset.file, mode, generatedAt, totalFrames: rows.length, maxTimingJitterMs,
        missing: rows.filter(row => row.reasons.includes('missing')).length,
        ambiguous: rows.filter(row => row.reasons.includes('ambiguous')).length,
        uncertain: rows.filter(row => row.reasons.includes('uncertain-or-estimated')).length,
        flagged: rows.filter(row => row.reasons.length).length, intervals: intervals(rows) };
      summaries.push(summary);
      results.push({ mode, config, summary, rows, frames });
      console.log(`  ${mode}: ${summary.missing} missing, ${summary.flagged} total flagged / ${rows.length}`);
      writeFileSync(join(output, `${name}-${mode}.csv`), csv(rows.map(row => ({ ...row, reasons: row.reasons.join(';') })),
        ['sample', 'sourceFrame', 'seconds', 'reasons', 'detections', 'x', 'y', 'selectionMethod']));
      writeFileSync(join(output, `${name}-${mode}.json`), JSON.stringify({ config, summary, rows, frames }));
    }
    const native = results[0];
    const chosen = [...new Set([...results.flatMap(result => result.rows.filter(row => row.reasons.length).map(row => row.sourceFrame)),
      ...previousResults.flatMap(result => result.rows.filter(row => row.reasons.length).map(row => row.sourceFrame)),
      ...[...previousGallery.matchAll(/id="([a-z0-9_]+)-frame-(\d+)"/g)]
        .filter(match => match[1] === name).map(match => Number(match[2])),
      ...(preset.reviewedSourceFrames ?? [])])].sort((a, b) => a - b);
    for (const sourceFrame of chosen) {
      const filename = `${name}-${String(sourceFrame).padStart(4, '0')}.png`;
      run('ffmpeg', ['-v', 'error', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size',
        `${crop.width}x${crop.height}`, '-i', 'pipe:0', '-frames:v', '1', '-y', join(output, filename)],
      { input: readFrame(sourceFrame - 1) });
      const frame = native.frames[sourceFrame - 1], row = native.rows[sourceFrame - 1];
      const previous = previousResults[0]?.rows.find(item => item.sourceFrame === sourceFrame);
      const category = row.reasons.includes('missing') ? 'missing' : row.reasons.length ? 'uncertain' : 'resolved';
      const status = row.reasons.length ? row.reasons.join(', ') : 'Fish detected · no native review flag';
      const comparison = previous ? `Previous run: ${previous.reasons.join(', ') || 'fish detected; no review flag'}` : '';
      const circles = (points, color) => points.map(point => `<circle cx="${point.x - crop.x}" cy="${point.y - crop.y}" r="8" fill="none" stroke="${color}" stroke-width="2"/>`).join('');
      cards.push(`<figure id="${name}-frame-${sourceFrame}" data-status="${category}"><figcaption>${name} · source frame ${sourceFrame} · ${row.seconds.toFixed(3)} s<br><strong>${status}</strong><br>${comparison}</figcaption><div class="image"><img src="${filename}" alt="${name}, source frame ${sourceFrame}" width="${crop.width}" height="${crop.height}"><svg viewBox="0 0 ${crop.width} ${crop.height}">${circles(frame.detections, '#00ffee')}${circles(frame.rejectedDetections ?? [], '#ff6688')}</svg></div></figure>`);
    }
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(raw); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    rmdirSync(scratch);
  }
}
writeFileSync(join(output, 'summary.json'), JSON.stringify(summaries, null, 2));
writeFileSync(join(output, 'review.html'), `<!doctype html><meta charset="utf-8"><title>Single fish frame audit</title>
<style>body{font:16px system-ui;margin:30px;background:#10232b;color:#eee}table{border-collapse:collapse}td,th{padding:8px;border:1px solid #668}main{display:flex;flex-wrap:wrap;gap:16px}figure{margin:0;max-width:100%}figcaption{font-size:13px;margin:8px 0}.image{position:relative}img{display:block;max-width:100%;height:auto}svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}body:has(#overlays:not(:checked)) svg{display:none}label{display:inline-block;margin:8px 20px 16px 0}select{font:inherit}figure[hidden]{display:none}</style>
<h1>Single fish frame audit</h1><p>Updated <time datetime="${generatedAt}">${generatedAt}</time></p><p>Production detector with FFmpeg pixels, established regression crops, 25 background samples and tracking enabled. Native pass checks every decoded source frame. 200 ms pass checks normal app sampling.</p>
<p>Flags identify missing, ambiguous, or estimated observations, not verified errors. A confident result can still select the wrong object. FFmpeg pixels and nearest-frame selection can differ from Safari. Native detection uses the nominal frame-rate clock; source timestamps in the tables retain container jitter (at most 10 ms, checked by the harness). Scale is a regression placeholder; distances are not evaluated.</p>
<table><tr><th>Video</th><th>Pass</th><th>Frames</th><th>Missing</th><th>Ambiguous</th><th>Uncertain</th><th>Flagged (unique)</th></tr>${summaries.map(s => `<tr><td>${s.video}</td><td>${s.mode}</td><td>${s.totalFrames}</td><td>${s.missing}</td><td>${s.ambiguous}</td><td>${s.uncertain}</td><td>${s.flagged}</td></tr>`).join('')}</table>
<p>Every frame flagged in this or an earlier review is shown, plus reviewed source frames 19–22 and 132–137. All results and timestamps are in the neighboring CSV and JSON files. Images and centers show the current native pass. Cyan = selected center; pink = rejected candidates.</p>
<label><input id="overlays" type="checkbox" checked> Show detector centers</label>
<label>Show <select id="frame-filter"><option value="all">All review frames</option><option value="missing">Still missing</option><option value="uncertain">Uncertain detections</option><option value="resolved">Detected without a review flag</option></select></label>
<output id="visible-count" aria-live="polite"></output><main>${cards.join('\n')}</main>
<script>const filter = document.getElementById('frame-filter');const cards = [...document.querySelectorAll('figure')];function update(){let count=0;for(const card of cards){card.hidden=filter.value!=='all'&&card.dataset.status!==filter.value;if(!card.hidden)count++;}document.getElementById('visible-count').textContent=count+' of '+cards.length+' review frames';}filter.addEventListener('change',update);update();</script>`);
console.log(`Review report: ${join(output, 'review.html')}`);
