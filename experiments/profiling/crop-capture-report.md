# Cropped grayscale capture comparison — 2026-10-23

Capturing only the selected tank crop reduced pipeline runtime by **15.1%** on
the included video. The optimized capture is kept in `dist/video.mjs`.

Grayscale reads now draw the video crop at its original pixel dimensions into
a dedicated crop-sized canvas. PNG export keeps its original full-frame canvas, avoiding repeated resizing
when used alongside grayscale reads. The detector, sampling, thresholds, and tracking
algorithms are unchanged.

## Measurements

Apple M1, 16 GiB RAM, macOS 27.0.1, Safari 27.0.1. Input and settings match the
[original profile](safari-background-report.md): two-minute `fish.mov`, 420 × 290
crop, 200 ms sampling, tracking enabled, exact-five output filter enabled,
center-selection rule disabled, and preview/sharpness overlays enabled.

Three passes per variant were interleaved in the order baseline, cropped,
cropped, baseline, baseline, cropped. Each pass rebuilt the background and
processed all 602 samples. The selected Safari tab remained visible. The
baseline adapter was copied from revision `9e58f63` before editing it.

| Measurement | Original capture | Crop capture | Reduction |
| --- | ---: | ---: | ---: |
| Instrumented pipeline, mean of 3 passes | 5.816 s | 4.936 s | **15.1%** |
| Canvas pixel readback, mean total per pass | 2.147 s | 1.323 s | **38.4%** |
| Normal app, Analyze to completion | 7.095 s | 6.067 s | **14.5%** |

Baseline pipeline passes took 5.752, 5.783, and 5.913 seconds. Crop passes took
4.902, 4.886, and 5.019 seconds. The normal-app comparison is one measurement per
variant; the optimized app was already warmed by an earlier analysis. Treat that
pair as supporting evidence rather than a repeated benchmark. No test processes
were running during the recorded final pipeline passes or the recorded normal
app timings. Video loading is excluded from all timings.

## Accuracy checks

- All six pipeline passes retained the same 358 frames and skipped the same 244.
- SHA-256 hashes of complete retained frame JSON were identical, including
  detections, rejected candidates, tracking metadata, and metrics:
  `19a799bc51e7c7d111591a3ddd30de5690f55d6c4262c80bebaed4538b29fdb8`.
- Compared grayscale pixels for all 602 sampled frames and 25 background samples.
- Also compared full-frame, odd-position, narrow, and edge-touching crops at four
  timestamps, including buffer-size changes between capture methods.
- Total: 647 grayscale comparisons, 20 bitmap comparisons, and 20 decoded PNG
  comparisons. **Zero differences across 101,920,860 compared bytes.**
- All 79 existing automated tests passed.

The improvement is measured for this video, crop, and browser. Larger crops,
other codecs, and other browser graphics backends may behave differently. A
full-frame analysis has less opportunity to benefit. The grayscale adapter uses its own buffer. The remaining large cost is seeking/waiting for video frames.

Raw results: [crop-capture-results.json](crop-capture-results.json).
Reproduction: [README.md](README.md).
