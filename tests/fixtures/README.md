# Fish video regression images

## Low-contrast fish in the lighter dark-side recording

`lighter-dark-low-contrast/` contains samples 1 and 7–10 (one-based) of
`single_fish_lighter_dark_part.mov` (1280 × 720, duration 63.33 seconds).
Tank crop: `(452, 111, 491, 182)`; dark region: `(686, 118, 256, 169)`.
Decode uses `crop=491:182:452:111:exact=1`, raw RGBA, and the app's
`grayscale()` function. Background and expanded variation bounds use 25 samples
at `(i + 0.5) * 63.33 / 25` seconds.

Sample 1 is a direct seek to 0 seconds; samples 7–10 are 1.2–1.8 seconds.
For sample 1, the user confirmed the fish near `(863, 257)` and the reflection
near `(461.1, 257.4)`. The startup regression requires the selected center to be
within 10 pixels of the fish and far from the reflection, without a prior track
or coordinate hints. FFmpeg and Safari both select near `(865, 262)`.
`single-fish-boundary.test.mjs` uses four-corner crop and dark-region geometry
reconstructed from the user's screenshot, within these same bounding boxes.
It reproduces the exact rejected wall location `(461.1, 257.4)`: a 4 × 66 region
with contrast 35 (FFmpeg) or 32 (Safari), stronger than the fish's 21. Selection
must prefer the supported fish and retain the wall candidate with rejection
reason `wall-like-boundary-region`. A pipeline regression checks the first
observed track and dark-side classification; controls preserve isolated wall
candidates, observed paths near walls, and ambiguity among interior candidates.
An additional controlled case reduces the recorded fish's contrast by 15% and
adds a darker wall pulse near the reported reflection. Border recovery alone
selects `(461, 256)`; running faint interior recovery first selects the confirmed
fish near `(865, 262)`. This guards the startup ordering failure even when the
unaltered decode already finds the fish.
The default 24-level cutoff misses samples 7 and 9. Requiring a stable 18-level
core while retaining connected 12-level body pixels gives approximate centers
`(832, 210)` and `(852, 192)` respectively. The sequence regression checks track continuity through
samples 7–10. Synthetic controls reject faint regions without a stronger core,
ordinary background variation, excluded pixels, and light-side changes.

`safari/` contains a separate browser decode with background and variation bounds
and samples 1, 33–35, and 63–65 from the same crop. Samples 34 and 64 need a lower
12-level core supported by the immediately previous observed fish. The regression
checks centers near `(821, 239)` and `(809, 177)`, continuous track IDs, and known
dark-side observations. Controls reject stale or uncertain history, incompatible
size or motion, and pixels within ordinary background variation.

## Single fish crossing tank markings, sample 61

`single-fish-ridge/` contains crops from `single_fish_dark_side - 1.mov`
(720 × 1280, duration 62.13 seconds). Tank crop: `(167, 372, 538, 209)`;
marked dark region: `(408, 377, 289, 190)`. Samples 60–62 are one-based,
direct seeks to 11.8, 12.0, and 12.2 seconds. FFmpeg uses
`crop=538:209:167:372:exact=1`, raw RGBA, and the app's `grayscale()` function.
The median background and expanded variation range use 25 samples at
`(i + 0.5) * 62.13 / 25` seconds.

At sample 61, tank markings interrupt the fish's contrast and separate the body
near `(571, 468)` from its tail near `(602, 477)`. The sequence regression
checks a bounded, image-supported join near `(581, 471)` and observed track
continuity through the neighboring samples. Negative controls remove the faint
connecting contrast or provide an incompatible size or uncertain history.

## Original shoaling recording

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

`competing-candidates.pgm` is zero-based sample 27 (5.4 seconds) from FFmpeg's
`fps=5` decode, cropped and converted to grayscale as above. It contains the fish
near original `(249, 499)` and a weaker wall reflection near `(215, 477)`.
With the saved background and variation, their foreground contrasts are 80 and
33 respectively. This tests single-fish selection without discarding the rejected
reflection from the audit trail. `single-5.6s.pgm` is a direct FFmpeg seek to 5.6
seconds and contains one detected fish near `(250, 507)`; it checks preservation
of an already unambiguous observation. Sample numbering and browser decoding can
differ; these are nearby regressions for the reported sample-29 reflection.
