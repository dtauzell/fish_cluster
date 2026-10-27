# Fish video regression images

## Native-frame text-overlap sequences

`lighter-dark-corner/` also stores `source-180-212.pgm.gz`,
`source-370-392.pgm.gz`, and `source-1750-1810.pgm.gz`. They contain full tank
crops at every native source frame in the named inclusive ranges. Each is a
gzip-compressed sequence of lossless `P5\n491 182\n255\n` PGM images. Decode
selects the original zero-based FFmpeg frames with `between(n, first-1, last-1)`,
then `crop=491:182:452:111:exact=1`, RGBA, and application `grayscale()`, without
FPS conversion. They share the 25 references documented below.

The user confirmed a visible fish in all remaining missed examples, several
crossing embossed text. Native frames 138–139, 195–203, 380–382 and 1776–1795
exposed three gaps: a recovery search that skipped a usable 10-level outline,
lettering obscuring the strongest core, and a visible head smaller than the
ordinary 45-pixel region minimum. Tests require current image evidence and
recent selected history; they never carry an old position through an empty
frame. The intermediate outline is a fallback after the supported 8-level body,
so it does not replace an already usable fuller body with a smaller patch.

`single-fish-text-overlap.test.mjs` checks all 34 previously missed native
frames and controls for stale, distant or rejected-only history, configured
minimum area, scattered bright pixels, and recorded empty lettering. The latter
uses the unmodified `(800,160,100,115)` rectangle from reference 10 with the rest
of the tank held at its median, as in the earlier lettering regressions.

## Faint dark-side sequence, native frames 132–136

`lighter-dark-corner/source-120-145.pgm.gz` adds the full unmodified tank crops
for native source frames 120–145 (one-based), selected with
`select=between(n\,119\,144)` before the same exact FFmpeg crop and application
RGBA-to-grayscale conversion as the corner fixtures below. It uses their shared
25 reference samples. Each concatenated PGM has header `P5\n491 182\n255\n`.

The user confirmed the visible fish in the dark area in frames 132–136.
Frame 132's 229-pixel faint outline contains only 15 pixels beyond the learned
range by 12 gray levels, including a connected patch of 12. This fails the
normal 8% core requirement (19 pixels). Losing the observation also interrupts
recovery in following frames. A bounded temporal recovery may now accept five
connected stable core pixels at the same brightness cutoff, provided a recent
selected observation matches position and size. Approximate observed body centers
are `(853, 224)` in frame 132 and `(860, 206)` by frame 136.

`single-fish-dark-gap.test.mjs` checks the recorded sequence and rejects stale,
uncertain or incompatible history, learned variation, masked or absent fish
pixels, and scattered bright noise without a connected stable core.

## Faint corner fish with unrelated edge candidates, native frames 20–21

`lighter-dark-corner/` contains full `491 × 182` grayscale tank crops from
`single_fish_lighter_dark_part.mov`. `source-001-024.pgm.gz` stores the first 24
native frames at 30 fps, without resampling. `background-samples.pgm.gz` stores
25 reference images, choosing the nearest original source timestamp to
`(i + 0.5) * 63.33 / 25`. The zero-based reference indices are
38, 114, 190, 266, 342, 418, 494, 570, 646, 722, 798, 874, 950, 1026, 1102,
1178, 1254, 1330, 1406, 1482, 1558, 1634, 1710, 1786, and 1862.

Each gzip file is a sequence of concatenated `P5\n491 182\n255\n` PGM images.
FFmpeg decodes original RGBA with `crop=491:182:452:111:exact=1` and no FPS
conversion; the application's `grayscale()` converts the unmodified pixels.
Tank and dark polygons match the angled-crop regressions below.

The user identified the visible fish in the lower dark corner in native source
frames 20–21 (0.633–0.667 seconds), around original `(863, 269)`. The earlier
detector retained only brighter thin regions near the middle boundary and left
edge. Those unrelated candidates blocked recovery of the faint fish despite
its observed position in frame 19. The regression requires a current stable
core and compatible recent observation to recover the body alongside the edge
candidates, preserving those candidates for selection and the export audit.
Negative controls reject stale, uncertain, split, distant or incompatible
history, learned background variation, and images with the fish pixels removed.

## Low-contrast fish in the lighter dark-side recording

`lighter-dark-low-contrast/` contains samples 1, 7–10, and 142–145 (one-based) of
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

Samples 142–145 are direct FFmpeg seeks to 28.2–28.8 seconds, decoded with the
same crop and background. The user identified the true fish near `(810.7, 168.6)`
and a competing center `(786.2, 144)` at sample 144. This FFmpeg decode yields
the fish near `(807, 167)` but does not reproduce the extra competing region.
The motion regression combines the recorded fish trajectory with the reported
competing position and deliberately stronger synthetic evidence scores. It
checks that observed motion breaks the ambiguous previous-position match in
favor of the fish while preserving the path through sample 145. The competing
region's scores and shape are stress inputs, not measured Safari evidence.

## Faint fish near tank markings, samples 303–313

`lighter-dark-nearby/` contains 25 background samples and samples 303–313 from
`single_fish_lighter_dark_part.mov`, encoded as concatenated gzip-compressed
PGM images (`P5\n140 90\n255\n`). They preserve original video rectangle
`(760, 190, 140, 90)`, crop-local `(308, 79)`, with unmodified grayscale pixels.
Tests place this rectangle in the shared median background so surrounding tank
pixels stay fixed. Background times and tank/dark polygons match the earlier
lighter-dark regressions. Video samples use every sixth native frame at 30 fps.

The prior full-frame replay missed samples 307–310. Sample 306 had two supported
regions: the selected fragment near `(866, 223)` and a rejected body region near
`(821, 248)`. The latter supports a faint region in sample 307; it then supports
the following observed samples. Sample 310 requires 8-level connected body
pixels while retaining a stable 12-level core. Approximate visually checked
recovered body centers are `(818, 247)`, `(817, 247)`, `(806, 247)`, and `(810, 247)`.
`single-fish-nearby.test.mjs` checks those samples, correction of sample 306,
track continuity, dark-side time, and speed coverage. Controls reject stale or
unsupported references, ordinary learned variation, empty frames, masked pixels,
and weak pixels without the required core. These are FFmpeg images; browser
seeking may select neighboring native frames.

## Fish resting over embossed lettering, samples 172–264

`lighter-dark-lettering/` stores gzip-compressed sequences of concatenated
lossless PGM images (each image has header `P5\n100 115\n255\n`).
`background-samples.pgm.gz` contains 25 reference samples at
`(i + 0.5) * 63.33 / 25` seconds. `samples-169-266.pgm.gz` contains 98 samples,
including three preceding samples and two following samples around the reported
93-sample interval. Video: `single_fish_lighter_dark_part.mov`, same tank and dark
polygons as the angled-crop first-frame regression.

`samples-149-156.pgm.gz` adds eight samples around the turn in frame 153, using
the same unmodified rectangle and reference images. The original 12-level body
segmentation shrinks from area 307 in frame 152 to area 138 in frame 153, moving
the center left to about `(842, 214)`. A bounded 10-level retry retains a connected
area of 416 near `(851, 212)`, while still requiring a stable 12-level core.
The regression checks the measured outline, track continuity, stale or invalid
references, masks, and controls that remove the faint connecting body pixels.

To keep the data compact, these images preserve original video rectangle
`(800, 160, 100, 115)`, containing the fish, embossed letters, and surrounding
floor. Tests place it at crop-local `(348, 49)` in the shared `491 × 182` median
background; pixels outside this rectangle are held at that median. Pixels inside
the rectangle remain unmodified. Samples were decoded as raw RGBA, converted
with `grayscale()`, and selected every sixth native frame using
`select=not(mod(n\,6))` in the 30 fps recording.

`stationary-fish.test.mjs` checks observed positions and one track ID throughout
all 93 samples, plus dark-side occupancy with no unknown gap. Background reference
10 (26.5986 seconds) shows the fish outside this rectangle and supplies an empty
lettering control. Synthetic tests retain rapid ridge flicker in the learned
range and bound bright-core expansion by a recent observed body. In the full
unmodified-frame replay, detections in samples 172–264 increased from 5 of 93 to
93 of 93; both the full replay and focused fixture keep observed image positions
rather than carried estimates. This is a sequence regression, not manual
validation of every center across the complete recording.

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
