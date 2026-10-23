# Browser analysis profiling

`browser-profile.mjs` profiles the existing background-subtraction pipeline in a
browser. It injects timers into fetched copies of the application modules using
Blob module URLs. It does not modify the deployed application or change the
detection settings or algorithms.

Run from the repository root:

```sh
ln -s ../fish.mov dist/profile-source.mov
ln -s ../experiments/profiling/browser-profile.mjs dist/profile-browser.mjs
npm run dev
```

Open <http://localhost:8000/background-test.html>, keep that tab selected, and run
this in its browser console:

```js
const { profileVideo } = await import('/profile-browser.mjs');
window.fishProfileResults = await profileVideo();
console.table(window.fishProfileResults.runs.map(run => ({
  run: run.run,
  seconds: run.wallMs / 1000,
  kept: run.keptFrames,
  skipped: run.skippedFrames
})));
```

The default is three complete passes over the included video at 200 ms intervals,
with the tested 420 × 290 crop, five expected fish, tracking enabled, center
selection disabled, and the exact-five count filter enabled. Preview drawing and
sharpness overlays are included for retained frames. The initial video fetch,
metadata loading, and first-frame preparation are outside the timed section;
each timed pass builds its own background from 25 samples.

For controls, use `profileVideo({ instrumented: false })` to run the original
modules without injected timers, or `profileVideo({ render: false })` to omit
preview drawing. `preferCenter: true` enables the optional center-selection rule.
Do not run profiles concurrently, and keep the tab visible throughout each run.

## Compare cropped capture with the original adapter

To reproduce the crop optimization comparison, first serve the original adapter
from the revision used for the baseline profile and expose the browser check:

```sh
git show 9e58f63:dist/video.mjs > dist/profile-video-baseline.mjs
ln -s ../experiments/profiling/check-crop-capture.mjs dist/check-crop-capture.mjs
```

Then run this in the selected browser tab's console:

```js
window.cropComparison = [];
for (const variant of ['baseline', 'cropped', 'cropped', 'baseline', 'baseline', 'cropped']) {
  const profile = await profileVideo({
    runs: 1,
    videoModule: variant === 'baseline' ? 'profile-video-baseline.mjs' : 'video.mjs'
  });
  window.cropComparison.push({ variant, ...profile });
}
const { checkCropCapture } = await import('/check-crop-capture.mjs');
window.cropCaptureCheck = await checkCropCapture();
```

The `outputSha256` field fingerprints all retained frame data, including
detections, excluded candidates, tracking metadata, and measurements. The browser
check compares grayscale bytes across every analysis/background sample, then
checks grayscale, bitmap, and decoded PNG pixels on several crop sizes and
positions. It uses the included video's dimensions and crop.

After the comparison also remove `dist/profile-video-baseline.mjs` and
`dist/check-crop-capture.mjs`. Recorded results and limits are in
`crop-capture-report.md` and `crop-capture-results.json`.

## Sequential decoding experiment

This experiment was not enabled in the application: see
`sequential-decode-report.md` for the measured timing and pixel mismatches.
It requires the included H.264 `fish.mov`, `ffprobe` on the development machine,
and browser WebCodecs support. It uses offline packet metadata to isolate
decoder/capture performance before adding a browser container parser.

With the local server and `profile-source.mov` link from above available:

```sh
python3 experiments/profiling/prepare-sequential-profile.py fish.mov /tmp/fish-sequential-metadata.json
ln -s /tmp/fish-sequential-metadata.json dist/profile-sequential-metadata.json
ln -s ../experiments/profiling/sequential-decode.mjs dist/profile-sequential-decode.mjs
```

In the selected tab at <http://localhost:8000/background-test.html>:

```js
const { compareSequentialDecode } = await import('/profile-sequential-decode.mjs');
window.sequentialResult = await compareSequentialDecode({ fullFrameCapture: true });
```

Set `fullFrameCapture: false` to test direct crop drawing. The optional
`colorSpaceOverride` accepts the `VideoColorSpaceInit` dictionary; the recording
was tested with `{ primaries: 'smpte432', transfer: 'bt709', matrix: 'smpte170m',
fullRange: true }`. Results include capture timings, pixel differences, selected
packet timestamps, and baseline analysis fingerprints. Sequential analysis is
only attempted when the pixel comparison passes. Progress is available as
`window.sequentialProgress`.

Cleanup:

```sh
rm dist/profile-source.mov dist/profile-sequential-metadata.json dist/profile-sequential-decode.mjs
```

Each result contains stage totals, call counts, median/p95 durations, retained
and skipped counts, and a checksum of retained centers/timestamps. Stage names
beginning with `detail.` are nested inside `detection`; do not add them to the
top-level totals. Very short individual calls may measure as zero at the
browser's timer resolution, so interpret their aggregate timings rather than
their per-call medians. Pixel readback can include deferred browser image
conversion or graphics synchronization work.

This harness times pipeline work and preview drawing. Full-page DOM updates and
final results charts are not included; the accompanying report includes a
separate normal-app wall-time measurement. Roboflow inference is not profiled.

Remove the temporary serving links when finished:

```sh
rm dist/profile-browser.mjs dist/profile-source.mov
```

See `safari-background-report.md` and `safari-background-results.json` for the
recorded measurements.
