// Experimental only: ffprobe packet metadata isolates the decoder/capture cost
// before committing to a browser container parser or changing the application.
import { createVideoSource } from '/video.mjs';
import { grayscale } from '/background.mjs';
import { sampleTimes } from '/analysis.mjs';
import { createSettings } from '/settings.mjs';

const crop = { x: 50, y: 240, width: 420, height: 290 };
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
async function fingerprint(frames) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(frames)))));
}

async function decodeSamples(buffer, metadata, targets, colorSpaceOverride, fullFrameCapture) {
  const canvas = document.createElement('canvas');
  canvas.width = fullFrameCapture ? metadata.config.codedWidth : crop.width;
  canvas.height = fullFrameCapture ? metadata.config.codedHeight : crop.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const samples = [];
  let previous = null, targetIndex = 0, outputFrames = 0, decoderError;
  let colorSpace, display;
  const config = { ...metadata.config, description: new Uint8Array(metadata.config.description), hardwareAcceleration: 'prefer-hardware' };
  if (colorSpaceOverride) config.colorSpace = colorSpaceOverride;
  const support = await VideoDecoder.isConfigSupported(config);
  if (!support.supported) throw new Error('This browser does not support the recording codec.');
  const [numerator, denominator] = metadata.timeBase.split('/').map(Number);
  const microseconds = ticks => Math.round(ticks * numerator / denominator * 1e6);
  function capture(target, frame) {
    if (fullFrameCapture) context.drawImage(frame, 0, 0);
    else context.drawImage(frame, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
    samples.push({ ...target, decodedTimestampUs: frame.timestamp,
      gray: grayscale(context.getImageData(fullFrameCapture ? crop.x : 0, fullFrameCapture ? crop.y : 0, crop.width, crop.height)) });
  }
  const decoder = new VideoDecoder({
    output(frame) {
      try {
        outputFrames++;
        colorSpace ??= frame.colorSpace.toJSON();
        display ??= { width: frame.displayWidth, height: frame.displayHeight, visibleRect: frame.visibleRect.toJSON() };
        if (previous) {
          if (frame.timestamp < previous.timestamp) throw new Error('Decoder output is not in presentation order.');
          while (targetIndex < targets.length && targets[targetIndex].timestampUs < frame.timestamp) {
            const target = targets[targetIndex++];
            if (target.timestampUs < previous.timestamp) throw new Error('No decoded frame covers this sample.');
            capture(target, previous);
          }
          previous.close();
        }
        previous = frame;
      } catch (error) { decoderError = error; frame.close(); }
    },
    error(error) { decoderError = error; }
  });
  decoder.configure(config);
  const start = performance.now();
  try {
    for (const [index, [pts, duration, position, size, key]] of metadata.packets.entries()) {
      if (decoderError) throw decoderError;
      while (decoder.decodeQueueSize >= 24) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => { decoder.removeEventListener('dequeue', ready); reject(new Error('Decoder queue stalled')); }, 10000);
          function ready() { clearTimeout(timer); resolve(); }
          decoder.addEventListener('dequeue', ready, { once: true });
        });
        if (decoderError) throw decoderError;
      }
      decoder.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: microseconds(pts),
        duration: microseconds(duration), data: new Uint8Array(buffer, position, size) }));
      if (index % 300 === 0) globalThis.sequentialProgress = { stage: 'decode', packets: index, total: metadata.packets.length };
    }
    await decoder.flush();
    if (decoderError) throw decoderError;
    while (targetIndex < targets.length) capture(targets[targetIndex++], previous);
    return { samples, wallMs: performance.now() - start, outputFrames, colorSpace, display };
  } finally {
    previous?.close();
    if (decoder.state !== 'closed') decoder.close();
  }
}

async function analyzeSamples(samples, duration, name) {
  // Isolate analysis CPU from Safari's timer throttling when cached reads no
  // longer perform any browser media work. No production code is modified.
  const original = await (await fetch('/pipeline.mjs')).text();
  const transformed = original.replace(/from '(\.\/[^']+)'/g, (_, path) => `from '${new URL(path, location.href).href}'`)
    .replace('const yieldToBrowser = () => new Promise(resolve => setTimeout(resolve, 0));', 'const yieldToBrowser = async () => {};');
  const moduleUrl = URL.createObjectURL(new Blob([transformed], { type: 'text/javascript' }));
  const { analyzeVideo } = await import(moduleUrl);
  URL.revokeObjectURL(moduleUrl);
  const byTime = new Map(samples.map(sample => [sample.timestampUs, sample.gray]));
  let selected;
  const source = {
    async seekTo(seconds) { selected = byTime.get(Math.round(seconds * 1e6)); if (!selected) throw new Error(`Missing cached sample ${seconds}`); },
    readGray() { return selected; }
  };
  const config = createSettings({ method: 'background', intervalMs: 200, thresholdInches: 1.5,
    gridPixels: 15.3, expectedFish: 5, trackFish: true, preferCenter: false,
    filterExactCount: true, filterFrameCount: 5 }, crop, 540, 960);
  const frames = [];
  let skipped = 0;
  const start = performance.now();
  for await (const event of analyzeVideo({ config, duration, source })) {
    if (event.type === 'frame') frames.push(event.frame);
    if (event.type === 'skipped') skipped++;
    if (event.type !== 'status' && (frames.length + skipped) % 50 === 0) {
      globalThis.sequentialProgress = { stage: `analyze ${name}`, samples: frames.length + skipped };
    }
  }
  const wallMs = performance.now() - start;
  globalThis.sequentialProgress = { stage: `fingerprint ${name}`, keptFrames: frames.length, skipped };
  return { wallMs, keptFrames: frames.length, skippedFrames: skipped, outputSha256: await fingerprint(frames),
    frameSummary: frames.map(frame => ({ timestampMs: frame.timestampMs, count: frame.detections.length })) };
}

export async function compareSequentialDecode({ colorSpaceOverride, fullFrameCapture = false } = {}) {
  if (document.visibilityState !== 'visible') throw new Error('Keep this tab selected.');
  if (typeof VideoDecoder !== 'function') return { supported: false };
  const [metadata, buffer] = await Promise.all([
    fetch('/profile-sequential-metadata.json').then(r => r.json()), fetch('/profile-source.mov').then(r => r.arrayBuffer())
  ]);
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.preload = 'auto';
  video.style.cssText = 'position:fixed;width:2px;height:2px;opacity:.01';
  const loaded = new Promise((resolve, reject) => {
    video.addEventListener('loadedmetadata', resolve, { once: true });
    video.addEventListener('error', () => reject(new Error('Video load failed')), { once: true });
  });
  const url = URL.createObjectURL(new Blob([buffer], { type: 'video/quicktime' }));
  video.src = url; document.body.append(video); await loaded;
  const source = createVideoSource(video);
  const duration = video.duration;
  const targets = [...Array.from({ length: 25 }, (_, index) => (index + .5) * duration * 1e6 / 25),
    ...sampleTimes(duration, 200).map(ms => ms * 1000)].map(timestampUs => ({ timestampUs: Math.round(timestampUs) }))
    .sort((a, b) => a.timestampUs - b.timestampUs);
  try {
    await source.showFirstFrame();
    const sequential = await decodeSamples(buffer, metadata, targets, colorSpaceOverride, fullFrameCapture);
    const baseline = [];
    const start = performance.now();
    for (const [index, target] of targets.entries()) {
      await source.seekTo(target.timestampUs / 1e6);
      baseline.push({ ...target, gray: source.readGray(crop) });
      if (index % 50 === 0) globalThis.sequentialProgress = { stage: 'seek baseline', samples: index, total: targets.length };
    }
    const baselineCaptureMs = performance.now() - start;
    globalThis.sequentialCaptureDebug = { baselineCaptureMs, sequentialCaptureMs: sequential.wallMs,
      outputFrames: sequential.outputFrames, sequentialSamples: sequential.samples.length, baselineSamples: baseline.length,
      colorSpace: sequential.colorSpace, display: sequential.display };
    globalThis.sequentialProgress = { stage: 'compare pixels' };
    let differingBytes = 0, differingSamples = 0, maxDifference = 0;
    const examples = [];
    for (let index = 0; index < baseline.length; index++) {
      let differences = 0;
      const a = baseline[index].gray, b = sequential.samples[index].gray;
      for (let pixel = 0; pixel < a.length; pixel++) {
        const difference = Math.abs(a[pixel] - b[pixel]);
        if (difference) { differences++; maxDifference = Math.max(maxDifference, difference); }
      }
      if (differences) {
        differingSamples++; differingBytes += differences;
        if (examples.length < 10) examples.push({ timestampUs: baseline[index].timestampUs,
          decodedTimestampUs: sequential.samples[index].decodedTimestampUs, differences });
      }
    }
    globalThis.sequentialPixelDebug = { differingSamples, differingBytes, maxDifference, examples };
    const levels = gray => ({ min: gray.reduce((a, b) => Math.min(a, b), 255), max: gray.reduce((a, b) => Math.max(a, b), 0),
      mean: gray.reduce((a, b) => a + b, 0) / gray.length, firstPixels: Array.from(gray.slice(0, 20)) });
    const firstSampleLevels = { baseline: levels(baseline[0].gray), sequential: levels(sequential.samples[0].gray) };
    globalThis.sequentialLevelDebug = firstSampleLevels;
    const baselineAnalysis = await analyzeSamples(baseline, duration, 'baseline');
    const sequentialAnalysis = differingBytes === 0 ? await analyzeSamples(sequential.samples, duration, 'sequential') : null;
    return { supported: true, userAgent: navigator.userAgent, durationSeconds: duration, crop,
      sampledTargets: targets.length, decodedFrames: sequential.outputFrames,
      grayscaleCacheBytes: targets.length * crop.width * crop.height,
      baselineCaptureMs, sequentialCaptureMs: sequential.wallMs,
      sequentialColorSpace: sequential.colorSpace, sequentialDisplay: sequential.display,
      requestedColorSpace: colorSpaceOverride, fullFrameCapture, firstSampleLevels,
      differingSamples, differingBytes, maxDifference, examples, baselineAnalysis, sequentialAnalysis,
      sampleTimestamps: sequential.samples.map(({ timestampUs, decodedTimestampUs }) => ({ timestampUs, decodedTimestampUs })) };
  } finally { video.remove(); URL.revokeObjectURL(url); }
}
