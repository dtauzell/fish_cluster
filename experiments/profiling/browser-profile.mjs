// Run from a browser on the app's local origin. Timers are injected into fetched
// copies of modules; the application modules and their behavior stay intact.
// Results contain timings and counts, never decoded images or credentials.
let currentSamples;

function record(name, elapsed) {
  const samples = currentSamples[name] ??= [];
  samples.push(elapsed);
}

globalThis.__fishProfileMeasure = (name, fn) => {
  const start = performance.now();
  try { return fn(); } finally { record(name, performance.now() - start); }
};
globalThis.__fishProfileMeasureAsync = async (name, fn) => {
  const start = performance.now();
  try { return await fn(); } finally { record(name, performance.now() - start); }
};

const timed = globalThis.__fishProfileMeasure;
const timedAsync = globalThis.__fishProfileMeasureAsync;
const urls = [];
const moduleBase = new URL('/', location.origin);

function replaceRequired(source, before, after) {
  if (!source.includes(before)) throw new Error(`Profile instrumentation no longer matches: ${before}`);
  return source.replace(before, after);
}

async function instrument(name, transform, imports = {}) {
  let source = await (await fetch(new URL(name, moduleBase))).text();
  source = source.replace(/from '(\.\/[^']+)'/g, (_, path) =>
    `from '${imports[path] ?? new URL(path, moduleBase).href}'`);
  source = transform(source);
  source = `const timed = globalThis.__fishProfileMeasure;\nconst timedAsync = globalThis.__fishProfileMeasureAsync;\n${source}`;
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  urls.push(url);
  return url;
}

function wrapImport(source, name, category) {
  const pattern = new RegExp(`\\b${name}\\b(?=[^\\n]*} from)`);
  if (!pattern.test(source)) throw new Error(`Missing profile import: ${name}`);
  return source.replace(pattern, `${name} as unprofiled_${name}`) +
    `\nfunction ${name}(...args) { return timed('${category}', () => unprofiled_${name}(...args)); }\n`;
}

async function loadModules(instrumented, videoModule) {
  if (!instrumented) {
    const [pipeline, video, preview, settings, analysis] = await Promise.all([
      import(new URL('pipeline.mjs', moduleBase)), import(new URL(videoModule, moduleBase)),
      import(new URL('preview.mjs', moduleBase)), import(new URL('settings.mjs', moduleBase)),
      import(new URL('analysis.mjs', moduleBase))
    ]);
    return { ...pipeline, ...video, ...preview, ...settings, summarizeFrames: analysis.summarizeFrames };
  }
  const backgroundUrl = await instrument('background.mjs', source => {
    for (const name of ['connectedRegions', 'splitLargeBlobs']) {
      source = wrapImport(source, name, `detail.${name}`);
    }
    for (const name of ['erode3', 'dilate3']) {
      source = replaceRequired(source, `function ${name}(`, `function unprofiled_${name}(`);
      source += `\nfunction ${name}(...args) { return timed('detail.${name}', () => unprofiled_${name}(...args)); }\n`;
    }
    return source;
  });
  const pipelineUrl = await instrument('pipeline.mjs', source => {
    for (const [name, category] of Object.entries({
      detectBackgroundFish: 'detection', medianBackground: 'medianBackground',
      candidateSharpness: 'sharpness', frameMetrics: 'metrics',
      selectCentralCandidates: 'candidateSelection'
    })) source = wrapImport(source, name, category);
    source = replaceRequired(source, 'tracker.update(selected.detections, timestampMs)',
      "timed('tracking', () => tracker.update(selected.detections, timestampMs))");
    return replaceRequired(source, 'const yieldToBrowser = () => new Promise(resolve => setTimeout(resolve, 0));',
      "const yieldToBrowser = () => timedAsync('cooperativeYield', () => new Promise(resolve => setTimeout(resolve, 0)));");
  }, { './background.mjs': backgroundUrl });
  const videoUrl = await instrument(videoModule, source => {
    const draws = [...source.matchAll(/(?:context|grayContext)\.drawImage\(video, [^\n]+?\);/g)];
    const read = source.match(/return grayscale\(((?:context|grayContext)\.getImageData\([^\n]+?\))\);/);
    if (!draws.length || !read) throw new Error('Missing video capture instrumentation points.');
    for (const [draw] of draws) source = replaceRequired(source, draw, `timed('pixel.drawImage', () => ${draw.slice(0, -1)});`);
    return replaceRequired(source, read[0],
      `const image = timed('pixel.getImageData', () => ${read[1]});\n    return timed('pixel.grayscale', () => grayscale(image));`);
  });
  const [pipeline, video, preview, settings, analysis] = await Promise.all([
    import(pipelineUrl), import(videoUrl), import(new URL('preview.mjs', moduleBase)),
    import(new URL('settings.mjs', moduleBase)), import(new URL('analysis.mjs', moduleBase))
  ]);
  return { ...pipeline, ...video, ...preview, ...settings, summarizeFrames: analysis.summarizeFrames };
}

function summarize(samples) {
  const ordered = samples.toSorted((a, b) => a - b);
  const totalMs = samples.reduce((sum, value) => sum + value, 0);
  return { calls: samples.length, totalMs, meanMs: totalMs / samples.length,
    medianMs: ordered[Math.floor(ordered.length * .5)], p95Ms: ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * .95))] };
}

export async function profileVideo({ videoUrl = '/profile-source.mov', runs = 3, render = true, preferCenter = false, instrumented = true, videoModule = 'video.mjs' } = {}) {
  if (document.visibilityState !== 'visible') throw new Error('Select this browser tab before profiling.');
  const modules = await loadModules(instrumented, videoModule);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  // Fetch once, then use the same local Blob path as the upload UI.
  const response = await fetch(videoUrl);
  if (!response.ok) throw new Error(`Video fetch failed: ${response.status}`);
  const blobUrl = URL.createObjectURL(new Blob([await response.arrayBuffer()], { type: 'video/quicktime' }));
  video.src = blobUrl;
  video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:.01';
  document.body.append(video);
  await new Promise((resolve, reject) => {
    video.addEventListener('loadedmetadata', resolve, { once: true });
    video.addEventListener('error', () => reject(new Error('Could not load profile video')), { once: true });
  });
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.style.cssText = 'display:block;width:400px;max-width:100%;height:auto';
  document.body.append(canvas);
  const source = modules.createVideoSource(video);
  currentSamples = {};
  await source.showFirstFrame();
  const preview = modules.createPreview(canvas, video);
  const config = modules.createSettings({ method: 'background', intervalMs: 200,
    thresholdInches: 1.5, gridPixels: 15.3, expectedFish: 5, trackFish: true,
    preferCenter, filterExactCount: true, filterFrameCount: 5 },
    { x: 50, y: 240, width: 420, height: 290 }, video.videoWidth, video.videoHeight);
  const result = { userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency,
    visibility: document.visibilityState,
    video: { width: video.videoWidth, height: video.videoHeight, durationSeconds: video.duration },
    settings: config, render, instrumented, videoModule, runs: [] };
  try {
    for (let run = 0; run < runs; run++) {
      currentSamples = {};
      const frames = [];
      let skipped = 0;
      const profiledSource = { ...source,
        seekTo: seconds => timedAsync('seekAndDecode', () => source.seekTo(seconds)) };
      const start = performance.now();
      for await (const event of modules.analyzeVideo({ config, duration: video.duration, source: profiledSource })) {
        if (event.type === 'skipped') skipped++;
        if (event.type === 'frame') {
          frames.push(event.frame);
          if (render) timed('previewDraw', () => preview.drawFrame(event.frame, config.thresholdPx, config.crop, [], true));
        }
        if (event.type !== 'status' && (frames.length + skipped) % 50 === 0) {
          globalThis.fishProfileProgress = { run: run + 1, processed: frames.length + skipped, total: event.total };
        }
      }
      timed('summary', () => modules.summarizeFrames(frames));
      const wallMs = performance.now() - start;
      const stages = Object.fromEntries(Object.entries(currentSamples).map(([key, samples]) => [key, summarize(samples)]));
      const accountedMs = Object.entries(stages).filter(([name]) => !name.startsWith('detail.')).reduce((sum, [, value]) => sum + value.totalMs, 0);
      const checksum = frames.reduce((sum, frame) => sum + frame.timestampMs + frame.detections.reduce((s, point) => s + point.x + point.y, 0), 0);
      // Fingerprint all retained detections, rejected candidates, tracking
      // metadata and metrics outside the timed section when comparing variants.
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(frames)));
      const outputSha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      result.runs.push({ run: run + 1, wallMs, visibilityAtEnd: document.visibilityState, keptFrames: frames.length, skippedFrames: skipped,
        sampledFrames: frames.length + skipped, checksum, outputSha256, stages, unaccountedMs: wallMs - accountedMs });
      globalThis.fishProfileProgress = { run: run + 1, complete: true, wallMs };
    }
    return result;
  } finally {
    video.remove(); canvas.remove();
    URL.revokeObjectURL(blobUrl);
    urls.forEach(url => URL.revokeObjectURL(url));
  }
}
