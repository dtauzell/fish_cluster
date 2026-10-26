# Fish video regression images

These small grayscale crops come from the repository's local `fish.mov` and are
used by Node tests without requiring a video decoder. They are outside `dist/`
and are not part of the deployed site.

- Crop: original-video `(x=50, y=200, width=420, height=330)`.
- `frame-169.pgm` through `frame-176.pgm`: consecutive samples at 33.6–35.0
  seconds. Frame 174 contains two simultaneous merges, including an X-shaped
  crossing near `(145, 380)`. The two merged regions inflate the current median
  area and previously prevented size-based splitting. The regression uses recent
  observed fish areas and checks for two uncertain centers in each merged region.
- `frame-555.pgm`: sampled frame 555 (one-based), 110.8 seconds at 200 ms intervals.
  Two touching fish around `(356, 363)` form one large region. Reflections fill
  the candidate count, so count-only recovery previously failed to split it.
- `frame-437.pgm`: 87.2 seconds. The broad top-wall reflection must not be split
  into extra central candidates at the expense of real fish near the right edge.
- `frame-583.pgm` through `frame-588.pgm`: consecutive samples at 116.4–117.4
  seconds. Two fish merge into a modest-size region at 584, 585, and 587.
  The visible area is less than 1.5 times the median fish area. Frame 584 needs
  short-term observed context; 585 and 587 also contain two stable dark bodies.
  These fixtures exercise the sequence, not just isolated images.
- `tank-background.pgm`: per-pixel median of 25 samples at
  `(i + 0.5) * 120.32 / 25` seconds, for `i=0..24`.

Frames were decoded with FFmpeg (`-ss TIME -i fish.mov -frames:v 1`, cropped and
output as raw RGBA), then converted using the app's `grayscale()` function:
`round(0.299 * R + 0.587 * G + 0.114 * B)`. PGM is a simple lossless file format:
a `P5` header, dimensions, maximum brightness 255, then one byte per pixel.
Browser seeking can choose a neighboring source frame, so Safari is checked too.
`safari/` contains a separately captured median background and frames 580–590,
decoded by Safari at the same 200 ms interval with the default crop
`(x=50, y=240, width=420, height=290)`. These have PGM dimensions `420 290`.
In this decode, frame 587's second dark core is too small for the image-only
check. The sequence regression verifies that tracking supplies two uncertain
centers and excludes the wall reflection. Disabling tracking reproduces the
original failure. The test also checks later path reacquisition without relabeling
earlier estimates as observed. Keep both decodes: an FFmpeg-only fixture misses
this browser case.

The test's expected centers are approximate manually inspected positions, not
fish identities or a claim of accuracy across the whole clip.

## Light/dark single-fish recording

`light-dark/` contains grayscale crops from `single_fish_dark_side - 1.mov`
(720 × 1280, duration 62.13 seconds), decoded with FFmpeg and converted by the
application's `grayscale()` function. Crop: `(200, 400, 490, 170)`.
`background.pgm` is the median of 25 samples at `(i + 0.5) * 62.13 / 25`.
`dark-0s.pgm` shows a bright fish against the dark floor near original-video
`(533, 509)`; the original darker-only rule misses it. `light-15s.pgm` shows
a dark fish against the light floor near `(285, 479)`. Tests mark the dark region
from `x=403` to the crop's right edge and confirm both detections, without
changing the light-side result. Centers are approximate spot checks, not a claim
of accuracy throughout the video. Synthetic crossing tests cover a fish spanning
the region boundary and manual side reassignment. Safari's full-video check at
200 ms intervals found exactly one candidate in 280 of 311 samples with this
crop and boundary; the remaining 31 samples require review. Matching the known
count alone does not validate the position.

`variation-lower.pgm` and `variation-upper.pgm` save the 10th–90th percentile
range from the same 25 background samples, expanded over a two-pixel neighborhood.
`ridge-jitter-2s.pgm` is frame 10 (zero-based) of an FFmpeg `fps=5` decode,
with the same crop and RGBA-to-grayscale conversion. Its selected source frame
can differ from a direct seek to 2 seconds. It contains five false ridge regions
near x=530 and one fish near `(489, 516)`. The learned-background core check
removes those five regions and retains the fish. A companion check preserves the
complete original fish region at 0 seconds, where the fish crosses the ridge.
On this full 311-frame FFmpeg decode, the same rectangular crop and regions yield
279 samples with exactly one candidate without suppression and 288 with it.
This count comparison is not a manual validation of every detected position.
