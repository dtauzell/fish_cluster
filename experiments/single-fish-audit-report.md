# Single-fish offline frame audit

Run from the repository root with FFmpeg and FFprobe installed:

```sh
node experiments/audit-single-fish.mjs
```

An optional first argument selects the output directory. Default output is
`experiments/background_results/single-fish-audit/` (ignored by Git). Open
`review.html` for every frame flagged in the current or previous run, original
source-frame numbers and timestamps. Filter by missing, uncertain or detected
frames, and toggle the overlay to inspect images without detector centers.
Each video also has native and 200 ms CSV/JSON files; JSON includes all detection
and rejected-candidate evidence, settings, and contiguous flagged intervals.

The harness runs the production `analyzeVideo()` pipeline with the established
regression crops and dark regions, 25 background samples, flicker suppression,
one expected fish, tracking enabled, and no count filter. It does not modify the
algorithm. FFmpeg decodes cropped RGBA; the application's `grayscale()` performs
the conversion used for detection. Both passes share identical decoded pixels.

The native pass verifies that every decoded source frame was analyzed exactly
once. Pipeline timing uses the nominal 30 fps clock; CSV timestamps retain the
original container timing. The maximum difference is 3.334 ms in both clips.
The harness refuses inputs differing by more than 10 ms from the nominal clock.
The 200 ms pass selects the nearest source timestamp. Browser pixels and seek
selection can differ, so these results do not replace Safari validation.

## Initial audit results

| Video | Pass | Frames | No detection | Ambiguous with a detection | Unique flagged frames |
| --- | --- | ---: | ---: | ---: | ---: |
| `single_fish_lighter_dark_part.mov` | Every source frame | 1,900 | 40 | 6 | 46 |
| `single_fish_lighter_dark_part.mov` | 200 ms | 317 | 1 | 0 | 1 |
| `single_fish_dark_side_1.mov` | Every source frame | 1,864 | 0 | 3 | 3 |
| `single_fish_dark_side_1.mov` | 200 ms | 311 | 0 | 0 | 0 |

All nine ambiguous native frames also have uncertain/estimated positions.
Flags are computed after the full pass so next-frame corrections are included.
The every-frame pass flags 49 of 3,764 frames (1.30%), including 40 with no
detection. These are review flags, not a measured error rate: a confident
selection can still be the wrong object.

In the lighter-dark clip, no detections occur at these source frames (one-based):

| Source frames | Source time in seconds | Missing frames |
| --- | --- | ---: |
| 132–139 | 4.367–4.600 | 8 |
| 195–203 | 6.467–6.733 | 9 |
| 380–382 | 12.633–12.700 | 3 |
| 1776–1795 | 59.163–59.797 | 20 |

Additional ambiguous intervals are source frames 20–21 (0.633–0.667 s), 1020
(33.965 s), 1694–1695 (56.430–56.463 s), and 1697 (56.530 s). The other clip's
ambiguous interval is source frames 881–883 (29.332–29.398 s).

## Visual checks and next experiment

Spot checks of source frames 136, 199, 381 and 1786 in the lighter-dark clip
show a visible but faint fish on the dark side near the right wall. These are
useful missed-detection examples rather than completely hidden fish. Frame 1020
also shows a fish near that area, but selection is ambiguous. Frame 882 in the
other clip shows a fish near the left edge. These are qualitative spot checks,
not manual annotation of every frame or every center.

The next algorithm experiment should preserve these original pixels and nearby
frames as regression sequences, annotate the visible body, and investigate
low-contrast support near the tank edges. Include empty wall/lettering regions
as negative controls before lowering thresholds. Compare every-frame and 200 ms
runs again: sampling changes temporal history as well as which images are seen,
so the extra misses cannot be attributed solely to samples skipped at 200 ms.

Physical scale in the harness is a regression placeholder; this audit does not
evaluate speeds or distances. No model training or network access is involved.

## Corner correction: native source frames 20–21

The user confirmed that frames 20 and 21 miss the visible fish in the lower dark
corner while selecting brighter edge regions. The original native pass selected
approximately `(688, 188)` and `(687, 234)`. Recovery skipped the faint body
because unrelated high-contrast regions already existed, leaving no nearby fish
candidate for the selection stage.

Recovery now admits a separate faint body alongside those candidates when it
matches a recent observed fish's position and size and contains stable current
foreground pixels, with no existing candidate within 45 pixels of that observation.
This avoids adding disconnected fragments alongside an already detected body.
It retains the unrelated candidates for selection and export.
There is no carried position or global threshold reduction. The measured centers
are now `(862.1, 269.6)` and `(863.4, 266.5)`, with continuous observed tracking
through source frames 19–22.

The full-video rerun changes the selected centers only in source frames 20 and
21 across both clips and both sampling rates (using a one-pixel comparison
tolerance). Lighter-dark native review flags fall from 46 to 44. Its 40 missing
frames remain; all other summary counts are unchanged. These two errors were
previously counted as ambiguous detections, so fixing them does not reduce the
no-detection count.

The original gallery remains in `background_results/single-fish-audit/`.
For the corrected comparison gallery, run:

```sh
node experiments/audit-single-fish.mjs experiments/background_results/single-fish-audit-corner-fix
```

The harness now includes source frames 19–22 in its gallery even when unflagged,
so the corrected corner detections remain visible. The corner-fix gallery showed
all 40 still-missing frames, all seven remaining uncertain frames, and the four
corner-sequence frames; it no longer limits images to interval representatives.
Each card shows the previous run's status alongside the current native result.
Recorded-frame and pipeline
regressions live in `tests/single-fish-corner.test.mjs`, with negative controls
for invalid history, missing current-image evidence, and nearby disconnected
fragments. Validation: 222 unit
tests and six browser tests pass.

## Dark-area correction: native source frames 132–136

The user confirmed a visible fish in the dark area in source frames 132–136.
In frame 132, the faint 229-pixel outline has 15 pixels beyond the learned
background range by 12 gray levels, including a connected 12-pixel core. The
usual 8% support requirement demands 19 pixels. That first miss removes the
recent observation needed to recover the following frames.

For a missing fish only, temporal recovery now accepts a connected core of at
least five stable pixels at the existing 12-level cutoff. It still requires
a recent selected observation, compatible position and body size, current
foreground pixels, and the configured dark and analysis masks. The fallback
does not expand an existing detected fragment, use rejected candidates alone,
or accept scattered bright pixels as a core.

The full-video comparison recovers source frames 132–137. Already detected
native-frame centers are unchanged (one-pixel comparison tolerance). The lighter-dark native
pass now has 34 misses and four uncertain frames; the dark-side clip and both
200 ms passes retain their previous counts. Source frames 138–139 remain missed.

There is one additional center change in the lighter-dark 200 ms pass: sample 33
(native source frame 193, 6.4 seconds) moves from `(788.1, 244.4)` to
`(816.3, 240.3)`. A faint current body becomes a candidate and the next observed
sample resolves selection toward it. A spot check shows the old center near the
tail and the new center farther along the visible body. The other clip's centers
are unchanged in both passes. No existing detections are lost in any pass.

The refreshed `background_results/single-fish-audit-corner-fix/review.html`
includes every current/previous flagged frame, corrected source frames 19–22,
and the reviewed frames 132–136. The missing filter shows 34 frames; recovered
frames remain available in the detected filter with their previous-run status.
Regression images are in `lighter-dark-corner/source-120-145.pgm.gz`; tests are
in `tests/single-fish-dark-gap.test.mjs`. Validation: 226 unit tests and six
browser tests pass.

## Recovery across lettering: remaining 34 native misses

The user confirmed a visible fish in every remaining missed example. The
lettering and ridges interrupt faint outlines, while learned flicker bounds
suppress some body pixels. Several gaps begin when the detector follows only
a small patch and then fails its size checks on the next, larger region.

Temporal recovery now tries a 10-level body as a fallback after the existing
12- and 8-level searches. This retains an already supported fuller outline while
recovering intermediate regions that match a small previous observation. Two
additional cases remain bounded to a recent selected fish:

- A stable 10-level core needs the usual support proportion, a connected core,
  movement within 15 pixels, area between half and twice the last observation,
  and compatible dimensions. Rejected candidates alone cannot enable it.
- After normal recovery fails, a small head may be at least 75% of the ordinary
  region minimum, within 20 pixels of the selected fish, with at least 20% stable
  support at the original 12-level core cutoff and a connected core. An explicit
  configured minimum area is honored.

All 34 previously missed native frames now have observed detections, without
carried positions or estimated centers. Across the 3,764 native frames, there
are zero no-detection frames and seven uncertain frames. A count of one is not
proof that every center is correct; the recovered gallery remains available
for visual review. The separate 200 ms pass still misses native source frame
139 in the lighter-dark clip because its temporal history differs.

Compared with the preceding dark-gap fix, no detections are lost, and only one
already-detected native center moves by more than one pixel: source frame 1775
changes from `(788.2,205.0)` to `(814.1,193.9)` after next-frame evidence resolves
the body candidate. All other existing native centers and both sampled passes'
selected centers stay within one pixel of their earlier positions.

The gallery preserves every frame previously displayed across reruns, including
recovered examples. Its filters now show zero missing, seven uncertain and 44
detected examples among 51 review cards. Full-frame sequence regressions cover
all 34 misses, while recorded empty-lettering controls, scattered-noise controls
and invalid-history controls remain negative. Validation: 233 unit tests and
six browser tests pass.
