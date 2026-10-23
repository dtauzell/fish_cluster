# Background analysis profile — 2026-10-23

Follow-up: [cropped capture comparison](crop-capture-report.md) measures the
implemented video-to-pixel optimization against this original adapter.

The dominant costs are video seeking and reading canvas pixels. A WASM port of
the detector would improve a relatively small part of the current runtime.
Investigate the video-to-pixel path before rewriting the detector.

## Setup

- Application revision: `9e58f63` (`ui updates`), with no application changes.
- Machine: Apple M1, 16 GiB RAM, macOS 27.0.1, Safari 27.0.1.
- Input: repository `fish.mov`, H.264, 540 × 960, 29.97 fps, 120.317 seconds.
- Crop: `(50, 240, 420, 290)` in original video pixels; no reflection masks.
- Sampling: every 200 ms, 602 samples plus 25 background-building samples.
- Detection: background subtraction, five expected fish, tracking on, center
  selection off, exact-five output filter on; sharpness overlays on in preview.
- Three complete instrumented passes in a selected, visible Safari tab.
- Video loading and initial presentation excluded; background construction,
  detection of every sample, and drawing retained samples included.

## Measured runtime

| Run type | Passes | Wall time |
| --- | ---: | --- |
| Instrumented pipeline with preview | 3 | 5.908, 5.814, 5.819 s; mean **5.847 s** |
| Original pipeline modules with preview | 3 | 6.152, 6.108, 6.149 s; mean **6.136 s** |
| Instrumented pipeline without preview | 3 | 5.937, 5.823, 5.869 s; mean **5.876 s** |
| Normal app, Analyze button to completion | 1 | **7.119 s** |

Every pass processed all 602 samples, retaining 358 and skipping 244. Every
harness pass had the same checksum of retained centers and timestamps
(`20413204.796022072`), including the original-module controls. The normal app
reported the same retained/skipped counts. Instrumentation and JIT/cache/scheduling
variation affect timings; the controls do not establish an instrumentation cost.
Removing preview drawing produced no meaningful improvement in these runs.

## Where the instrumented pipeline spent time

Mean totals across the three visible, instrumented passes:

| Stage | Total | Share of wall time |
| --- | ---: | ---: |
| Seeking / waiting for decoded frames | 2,689 ms | **46.0%** |
| Canvas `getImageData` pixel readback | 2,171 ms | **37.1%** |
| Background detector | 571 ms | **9.8%** |
| Grayscale conversion | 122 ms | 2.1% |
| Preview drawing | 71 ms | 1.2% |
| Cooperative browser yields | 61 ms | 1.0% |
| Copying video into the analysis canvas | 48 ms | 0.8% |
| Candidate sharpness | 42 ms | 0.7% |
| Median background construction | 28 ms | 0.5% |
| Tracking, candidate selection, metrics, summary | 23 ms | 0.4% |
| Other pipeline work / timer overhead | 21 ms | 0.4% |

The 627 seek calls averaged about 4.29 ms. Pixel reads averaged about 3.46 ms.
Readback may include deferred graphics synchronization or video color conversion;
these timers do not measure decoder CPU separately from waiting or deferred work.

Nested inside the 571 ms detector total were approximately 383 ms of mask erosion
and dilation, 77 ms of connected-region detection, and 7 ms of blob splitting.
These nested figures are **already included** in the detector row.

## Implications for WASM

For this video and crop, the detector is about 9.8% of pipeline wall time. Making
that entire stage instantaneous would reduce pipeline time by at most 9.8%
(about a 1.11× speedup). A fourfold detector speedup would reduce total pipeline
time by about 7.3%, before WASM calls and memory-copy overhead. These are bounds
from the measured proportions, not a WASM benchmark or promised speedup.

The next experiments should target the 83% spent waiting for video frames and
reading pixels:

1. Compare the current full-frame canvas capture with drawing only the selected
   crop into an appropriately sized analysis canvas before readback. Check both
   frame accuracy and browser timings.
2. Investigate processing frames sequentially instead of seeking for every
   sample, while preserving exact sampling timestamps and Safari compatibility.
3. If detector work still matters after those improvements, mask cleanup is the
   first WASM candidate suggested by the nested timings.

The harness does not time the normal app's per-event DOM updates or final charts.
The separate normal-app measurement includes those costs and is a single run.
Browser timers reported at roughly 1 ms resolution, so sub-millisecond individual
call medians should not be interpreted as zero work. These results cover the
default background method on this recording, not Roboflow, other videos, larger
crops, other browsers, or a cold network model load. Skipped frames still undergo
detection and tracking so the exact-five filter does not avoid their main cost.

Raw measurements: [safari-background-results.json](safari-background-results.json).
Reproduction instructions: [README.md](README.md).
