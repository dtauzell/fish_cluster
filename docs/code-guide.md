# Reading and changing the analyzer

The initial test chooser in `app.mjs` sets `testType` to `shoaling` or
`light-dark`. `settings.mjs` snapshots that choice, enforces one expected fish
for light/dark, and requires a dark region inside the usable tank. Legacy callers
without a test type retain the earlier behavior. The detector is shared; the
interface and exports select the relevant measurements.

`light-dark.mjs` combines conservative side observations and single-fish speed
into interval-based occupancy totals. It consumes all original review frames,
so count filtering cannot hide tracking gaps or invent crossings. Each interval
is stored on its ending sample, with zero time on the first sample. Unreliable
endpoints and invalid continuity make the entire interval unknown; a valid
crossing splits elapsed time equally. The window ends at the last analyzed
sample, including for stopped runs. `exports.mjs` formats its frame and summary
CSVs; `csv-guide.html` documents both test schemas.

For background runs with `expectedFish === 1`, `background.mjs` measures median
foreground contrast over the original threshold-passing blob pixels, excluding
the padding introduced by morphology. `candidate-selection.mjs` caps the result
at one and marks insufficient separation uncertain. `pipeline.mjs` applies this
before tracking, so ambiguous choices cannot create or refresh observed tracks.
Side and velocity calculations accept rejected candidates only when the recorded,
versioned selection rule confidently resolves them. Ambiguous choices and generic
center-distance filtering still invalidate automatic intervals. All candidates
and scores remain auditable.

Single-fish selection first permits an unambiguous recent observed path to
resolve competitors. Without that evidence, `foreground-boundary-margin-v1`
prefers a supported alternative over a wall-like region that is at most 6 pixels
thick, at least 40 pixels long, has an aspect ratio of at least 10, lies within
8 pixels of a crop edge, and runs parallel to that edge (absolute axis dot
product at least 0.95). Polygon crops use their actual edges. Isolated wall
candidates remain available. Rejected wall regions retain their original scores
and IDs with reason `wall-like-boundary-region`; near ties among the remaining
candidates stay uncertain. The diagnostics table displays **No (tank wall)**.

`experiment-storage.mjs` validates and snapshots named setups and per-fish
results, persists compact records, and calculates equal-weight means by trial
and exposure. `experiment-ui.mjs` owns the corresponding controls. Before loading
a replacement video, the app refreshes the setup snapshot; after metadata loads,
the tools can reapply it only for matching dimensions and test type. Applying a
setup clears stale results. Batch snapshots survive video changes and update
only through explicit add/replace actions. Storage failures leave in-memory data
available; unreadable stored data disables subsequent writes to preserve it.

This app has no build step. `dist/` contains the source code as well as the files
served to the browser. Start with `npm run dev`; run automated checks with
`npm test`. The Python code in `experiments/` is a separate exploratory detector,
not part of the browser application.

## Follow one frame through the app

1. `app.mjs` reads the form and calls `createSettings()` in `settings.mjs`.
   This validates values, copies the crop, and converts the entered inches into
   pixels. The GUI owns the current file, result list, and selection.
2. `analyzeVideo()` in `pipeline.mjs` samples timestamps and asks `video.mjs`
   to seek the video and read the cropped pixels. Grayscale reads draw only the
   selected crop into a dedicated canvas, reducing pixel readback work. Bitmap
   and PNG captures use a separate full-frame canvas. Both canvases are private,
   so labels and crop outlines painted in the preview do not enter the detector.
3. Background mode calls `background.mjs`. Roboflow mode asks `model.mjs` for
   a reusable inference worker and normalizes its boxes with `analysis.mjs`.
   Both methods initially return centers relative to the crop.
4. The pipeline adds the crop's X/Y offset to every center, producing positions
   in the original video. Background tracking in `tracking.mjs` assigns provisional
   path IDs and supplies overlap evidence to later sampled frames. It calls `frameMetrics()` in `measurements.mjs` to
   calculate distances, groups, and the comparison with random placements.
5. The pipeline yields a completed frame. `app.mjs` saves it and updates the
   controls; `preview.mjs` paints the video, centers, and links. The GUI chooses
   what to display; detection does not know about any buttons or page elements.
6. `exports.mjs` turns the saved results into CSV. `download.mjs` handles the
   browser's file download. JSON uses the same saved frames and measurements.

The pipeline is an async generator: its caller uses `for await` to receive
progress events and frames as they become available. It receives video access,
model preparation, and a cancellation function as arguments. Tests can supply
small synthetic images or model responses without starting a browser or
fetching a model. Frames already yielded remain available after cancellation or
an error. Cancellation is checked between samples and frames, allowing the
current operation to finish.

## Where to make changes

| Concern | Module |
| --- | --- |
| File selection, crop controls, result controls, charts, navigation | `dist/app.mjs` |
| Automatic detection overlay | `dist/preview.mjs` |
| Human annotation controls and overlay | `dist/human-ui.mjs` |
| Training-data box editor and labeled-frame navigation | `dist/labeling-ui.mjs`, `dist/labeling.css` |
| Label project identity, box validation, YOLO coordinates | `dist/label-data.mjs` |
| Dataset ZIP and portable progress JSON | `dist/label-export.mjs`, `dist/zip.mjs` |
| Labeling autosave and restoring saved images | `dist/label-storage.mjs` |
| Video decoding, seeking, grayscale/bitmap capture | `dist/video.mjs` |
| Analysis sequence and progress events | `dist/pipeline.mjs` |
| Detecting dark moving regions | `dist/background.mjs` |
| Connected pixels and conservative overlap evidence | `dist/connected-regions.mjs`, `dist/overlap-evidence.mjs` |
| Estimating centers inside joined regions | `dist/blob-splitting.mjs` |
| Roboflow worker lifetime and model errors | `dist/model.mjs` |
| Crop geometry, reflection masks, usable area | `dist/region.mjs` |
| Optional selection of central candidates | `dist/candidate-selection.mjs` |
| Form validation and calibration | `dist/settings.mjs` |
| Point geometry, grouping, random reference statistics | `dist/analysis.mjs` |
| Candidate sharpness and label summaries | `dist/sharpness.mjs` |
| Score overlays and diagnostic label controls | `dist/sharpness-ui.mjs` |
| Calibrated frame measurements, group-change detection | `dist/measurements.mjs` |
| Manual/automatic comparison | `dist/review.mjs` |
| CSV rows and safe exported settings | `dist/exports.mjs` |
| Downloading files and formatting displayed numbers | `dist/download.mjs`, `dist/format.mjs` |

`analysis`, `background`, `measurements`, `review`, `settings`, and `exports` work
on ordinary data and do not access the DOM. `pipeline` coordinates those
functions through the supplied video and model interfaces. Browser details stay
in the adapters and GUI modules.

## Coordinates, units, and result shapes

The top-left pixel is `(0, 0)`; X increases to the right and Y downward. A crop is
`{ x, y, width, height }`, measured in original video pixels. For example, a
center at `(10, 20)` inside a crop starting at `(50, 240)` becomes `(60, 260)`
in saved results. The review overlay also stores original-video coordinates,
even when displaying only the cropped region.

`settings.exclusions` contains reflection-mask shapes, also in original video
pixels. They subtract areas from the crop. Background mode removes their pixels
before connecting regions; both detection methods reject centers in the masks.
Masks apply to the entire video, including real fish that enter them. Use a larger
crop to include elevated fish, then small masks to exclude wall reflections.
`region.mjs` handles these rules and decomposes the usable area into disjoint
rectangles so random points remain uniform even when masks overlap.

A detection has this common shape, with optional method-specific fields:

```js
{
  detectionId: 1,       // Number within this frame, not a tracked fish identity.
  className: 'fish candidate',
  confidence: 1,        // Background mode uses 1; this is not a calibrated probability.
  x: 60, y: 260,        // Center in original video pixels after pipeline conversion.
  width: 15, height: 8  // Size of the surrounding rectangle, in pixels.
}
```

Background detections can also have `area`, `splitFromBlob`, and `edgeRecovered`.
Area is the number of foreground pixels, not the rectangle's area. Background
centers are averages of region pixels; model centers come from predicted boxes.

A saved frame is:

```js
{
  frameIndex: 0,               // Zero-based sampled-frame index.
  timestampMs: 0,              // Milliseconds from the beginning of the video.
  rawPredictionCount: 5,       // Model boxes before filtering, or background candidates.
  detections: [/* centers */],
  metrics: {/* distances, counts, groups, spacing percentile */}
}
```

A half-inch grid square measuring 15 pixels gives 30 pixels per inch. Names
ending in `Px` use video pixels, names ending in `Inches` use the calibration,
and timestamps ending in `Ms` use milliseconds. Missing distances are `null`
when a frame has fewer than two fish.

`metrics.groupIds[i]` is the zero-based group of `detections[i]`.
`metrics.groupSizes[groupId]` gives that group's size. Exported group numbers
are one-based. A group of one fish is isolated; a group of at least two is a
cluster. Group IDs and colors are assigned independently for every frame. The
sorted group sizes, such as `3+2`, determine timeline changes; they say nothing
about which individual fish belong to those groups across time.

## Background detection in plain language

Read `detectBackgroundFish()` first: it names each processing stage. The helper
functions above it explain the details.

- **Grayscale:** one brightness value per pixel, from 0 (black) to 255 (white).
  An image is a flat array; pixel `(x, y)` is at `y * width + x`.
- **Median background:** sample up to 25 times across the video and take the
  middle brightness at each pixel. A moving fish usually occupies a given pixel
  in fewer than half the samples, leaving an estimate of the stationary tank.
- **Threshold / mask:** a pixel sufficiently darker than the background becomes
  1 (a possible fish); other pixels become 0. In marked dark regions, absolute
  brightness difference selects both brighter and darker changes. Light and
  unmarked pixels retain the directional darker-only comparison.
- **Erosion / dilation:** shrink or grow foreground pixels using their four
  neighbors. Opening removes specks; closing fills gaps within a region.
- **Blob / connected region:** flood-fill adjacent selected pixels. Reject
  regions with implausible areas or dimensions and calculate each remaining
  region's center and surrounding rectangle.
- **Recovery:** if the count is low, look near the normally excluded borders.
  An unusually large region may be split by repeatedly assigning pixels to two
  estimated centers and updating their averages (two-cluster k-means). These
  are heuristics guided by the known count; they do not force the output count.

The detector assumes a fixed camera. `tank-zones.mjs` classifies original-video
centers against ordered light/dark shapes (last drawn wins), and rasterizes
the dark regions once into crop pixels for detection. Regions keep fish usable;
reflection masks still exclude pixels. `tankSide` is attached to automatic and
manually corrected detections, and `frameMetrics()` recalculates side counts.
Uncovered centers are `unmarked`, except in the single-fish dark-region mode,
where `analysisTankSide()` assigns the remaining usable tank to light. Reflections can become false detections,
and touching fish can become one region.

## Optional selection by distance from the center

`blob-splitting.mjs` handles candidate regions that may contain two touching fish.
The original recovery only ran when the total region count was low; a reflection
could fill that count while a real pair remained merged. With `preferCenter`
enabled, the splitter now examines the provisional nearest N regions before the
final selection, even when the count is already N or greater. The size-based path requires at least 400 foreground pixels and 1.5 times the median
area of the provisional central regions. The reference area stays fixed during
the pass. Each original region receives at most one two-center estimate; the
algorithm does not keep subdividing its results to force a particular count.

For a region at least as large as the reference area, two additional checks can
support a split below the 1.5-times area gate. `overlap-evidence.mjs` first looks
for exactly two substantial dark connected cores that remain separate at two
adjacent contrast cutoffs. It examines only the original region's pixels, using
contrast cutoffs from the detection threshold plus 16 to plus 56 in steps of 4.
Each core needs at least the minimum fish area or 8% of the parent region,
whichever is larger; centers must remain within 4 pixels across cutoffs and be
at least 10 pixels apart. This avoids replacing the size gate with a universally
lower threshold. Cutoffs are heuristics, not calibrated reflection probabilities.

If image evidence is insufficient, a preceding sample can support a merge only
when it is at most 250 ms old, contains the known number of kept detections, and
contains no split/estimated centers. Each preceding center is assigned to its
nearest current region within 8 foreground pixels. Exactly two distinct centers
entering one region can seed a split. An estimated center is never fed back as a
fresh observation. Large gaps and missing/estimated reference frames disable this
path. This is short-term overlap evidence, not persistent identity tracking.
A completely hidden fish's exact position cannot be observed in a single view.

## Tracking through short overlaps

`tracking.mjs` keeps independent, short-lived paths in original-video coordinates.
It is enabled by default in background mode (`trackFish`); Roboflow mode is unchanged.
`point-assignment.mjs` implements minimum-cost one-to-one matching, allowing paths
to remain unmatched rather than assigning the same candidate twice. IDs are
provisional associations, not verified biological identities. They can swap when
fish cross. The crop-local candidate ID and within-frame group ID are separate.

An observed center updates its path's velocity (capped at 30 pixels per 200 ms),
foreground area, and observation time. A split center updates only its carried
position. During an overlap the tracker holds that position for matching rather
than extrapolating an old velocity through a turn. A sample gap greater than
250 ms resets paths; one second without an observed center expires a path.
Estimates cannot renew this deadline, and expired IDs are never reused in a run.

With the center rule enabled, `background.mjs` asks for tracking seeds while
original foreground pixels are still available. Each path needs at least two
observations. It chooses its nearest current region within 8 pixels of predicted
foreground. Exactly two paths, at least 10 pixels apart, can seed a two-center
split if the region has at least 60% of their summed observed foreground areas.
The existing median-area, minimum child-area, and separation checks still apply.
No foreground means no inferred fish. Image evidence takes priority over tracking;
tracking takes priority over the older whole-frame 250 ms fallback.

When multiple pairs merge simultaneously (frame 174), the current frame's median
region area can itself be inflated. If the region count is below the known fish
count, the tracker can supply a smaller median area from at least three established
paths. Only observed areas enter that reference; estimates do not update it or
renew its one-second deadline. The 400-pixel absolute gate, 1.5-times median gate,
minimum child area, and 10-pixel separation remain in force. A split enabled by
this smaller reference is marked `recent-observed-size`, with its reference time
and `splitSizeReferenceArea` (CSV: `split_size_reference_area_px`). Its centers
remain uncertain, and its random-spacing percentile is omitted. A count already
at or above the known count cannot enable this size fallback. This restores two
centers for the X-shaped pair; it does not trace the two crossing bodies or prove
their exact centers.

Temporal splits have `splitReason: 'tracking-overlap'`, `sourceTrackIds`, and
`splitReferenceTimestampMs`. All split centers have `positionUncertain: true`
and `positionSource: 'overlap-estimate'`; ordinary detections use `'observed'`.
`trackId` and `trackLastObservedTimestampMs` describe the path. If a later
observed center reacquires a path, the tracker adds `trackReacquired: true` to it
and `trackReacquiredTimestampMs` to pending estimates from that path. The pipeline
keeps these point objects in yielded frames so the later annotation reaches the
saved results. It never changes their positions or uncertainty after yielding.
Reacquisition supports continuity, not the accuracy of hidden positions.

Detection and diagnostic CSVs export these fields in snake_case. Frame CSV adds
`uncertainPositionCount`, `manualPositionCount`, and correction status. Full JSON
also includes the tracking method's limits and version. The GUI draws dashed
orange rings and † for estimates, even when sharpness scores are hidden.

Two-cluster k-means starts along the region’s longest axis or at the two evidence-backed seed positions. Both parts must have
at least the detector's minimum area, and centers must be at least 10 pixels
apart. A † identifies a split estimate in review. Exports include `splitReason`
(`large-central-region`, `known-count-recovery`, `separate-dark-bodies`,
`previous-frame-overlap`, `tracking-overlap`, or `recent-observed-size`) and `sourceBlobArea`; temporal estimates also
record `splitReferenceTimestampMs` (CSV: `split_reference_timestamp_ms`). CSV uses
`split_reason` and `source_blob_area_px`. Frame CSV also reports
`splitCandidateCount`. Area is evidence for a possible merge, not proof: a large
single fish or artifact can still be split incorrectly. Without the center rule,
count-based recovery continues to stop when the known count is reached.

Background settings can enable `preferCenter` (off by default). After masks and
sharpness measurements, `candidate-selection.mjs` measures each candidate center's
distance from `(crop.x + crop.width / 2, crop.y + crop.height / 2)`. If the count
exceeds `expectedFish`, it retains only the nearest N. It preserves detection order
and IDs; equal distances retain their original order. It never invents missing
fish or rejects anything when there are no excess candidates.

Each frame retains `rejectedDetections` with `distanceFromCenterPx`, sharpness,
and `rejectionReason: 'farther-from-crop-center'`. Rejected candidates appear as
pink crosses and can still be labeled in diagnostic review. `frameCandidates()`
combines kept and rejected candidates in original ID order for these displays,
label summaries, and the sharpness comparison CSV. The detection CSV, human
center matching, groups, and distances use the kept list. JSON keeps both lists.
Frame CSV includes `rejectedCandidateCount`; comparison CSV includes
`included_in_analysis`, `rejection_reason`, and `distance_from_center_px`.

This rule can discard real edge fish or retain central reflections. It is a
heuristic to inspect, not a reflection classifier. Because retaining central
points itself makes spacing tighter, frames with any such removals get a null
`randomSpacingPercentile` and reason `center-selection`. Changing the grouping
distance preserves that omission. Frames with preceding-frame or tracked estimates also omit the percentile, even if no
candidate was rejected, using reason `temporal-overlap-estimate`. Other frames
with no removals keep the usual random reference. Pair distances and group counts remain descriptive of the kept centers.

## Sharpness diagnostics

`sharpness.mjs` computes the population variance of the four-neighbor Laplacian
in a candidate-sized patch padded by 3 pixels. For a pixel at index `i`, the
Laplacian is `left + right + above + below - 4 * center`. The variance measures
how much these responses vary across the patch. The pixels come from the original
grayscale frame before detection thresholding, erosion, or dilation. Background
mode reuses its grayscale image; model mode reads one for scoring.

Each detection stores `sharpness`, `localContrast` (brightness standard deviation),
`sharpnessPixelCount`, and `sharpnessClipped`. Crop and image boundaries are
respected; a sample is omitted if any of its five pixels is inside a reflection
mask. This avoids creating artificial edges by replacing masked pixels with black.
Fewer than 9 usable pixels, or a missing/invalid box, produces a null score. A flat
patch with enough pixels correctly scores zero. Clipped patches get an asterisk
in the GUI. The scoring algorithm definition is also included in JSON exports.

These are local image measurements, not calibrated probabilities or a 0–100
scale. Brightness offsets leave the Laplacian variance unchanged, but contrast,
noise, background grid lines, other fish in the patch, and motion affect it.
No threshold rejects a candidate. Use the same recording/resolution for comparisons.

Human review gives each candidate a frame-local ID and a separate optional
fish/reflection label. These labels live in `state.human.candidateLabels`, separate
from manually clicked centers and reviewed-frame status. They never change counts,
groups, or center matching. Medians summarize scored labels across all frames;
missing scores are omitted. Labels and scores can be exported with the sharpness
comparison CSV; JSON includes scores, method metadata, and labeled IDs. Detection
CSV includes scores as well. Rerunning detection resets diagnostic labels, while
changing the grouping distance preserves them. To inspect a suspected reflection,
leave that area unmasked for the diagnostic run.

## Measurements and human review

`state.reviewFrames` retains every completed sample, including count-filter
skips; `state.frames` contains only samples currently included in analysis.
`frame-selection.mjs` applies the analysis count filter to current centers and
builds review view indices from original automatic candidates, including outer
candidates. Manual corrections rebuild analysis membership without changing
review identity or the original mismatch subset. Review navigation uses positions
within that subset while marks remain keyed to the complete review collection.
Human exports cover that complete collection; analysis JSON separately retains
excluded samples. The review route also works when no sample passed the filter.

`analyzeFrame()` compares every pair of centers. It merges close pairs into
connected groups, so a chain A–B–C can form one group even when A and C are
farther apart than the selected distance. The implementation uses union-find,
a standard way to merge connected sets; no vision knowledge is needed here.

The random spacing comparison places the same number of centers uniformly
inside the unmasked portion of the same crop 399 times. A fixed random seed makes results reproducible.
The percentile describes one frame's mean nearest-neighbor spacing relative to
those placements. It is not a video-wide significance test. The reference is
cached by fish count, crop, and reflection masks so distance-slider changes stay fast.

`review.mjs` excludes marks outside the crop or inside reflection masks from comparison, then finds the
maximum number of one-to-one center matches within half an inch. All marks remain in CSV exports. `inside_crop` retains its rectangular meaning;
`included_in_analysis` also accounts for reflection masks. The corresponding
`manual_fish_count_in_analysis` counts only marks in the usable area. A blank manual count with
`manual_annotation_present=false` means the reviewer accepted the result without adding marks;
an explicit empty annotation has `manual_annotation_present=true` and a count of zero.
Only frames explicitly marked reviewed contribute to the review summary. Empty frames still get
a CSV row so review status is retained.

`applyManualCenters()` replaces one frame's result with a snapshot of the usable
manual marks, including an explicitly empty set. It preserves `automaticDetections`
for undo and audit. Manual centers have `positionSource: 'manual'`, no guessed
track IDs or sharpness, and recalculated measurements. Later edits to marks only
affect results when applied again. `restoreAutomaticCenters()` recalculates the
original result using the current link distance. Corrections never propagate
into other frames or rerun tracking. Review agreement and sharpness diagnostics
continue to compare the original automatic result, avoiding agreement created
by comparing manual corrections with themselves. CSV flags applied corrections;
JSON retains both result and original centers.

## Manual training-data labeling

`#labeling` is independent of detection results. `app.mjs` passes the video
metadata, selected crop, and interval to `createLabeling()`. This uses the same
sample numbering as analysis and the same serialized video-seek queue, but no
model, background, calibration, or fish count is required. Changing video, crop,
or interval creates a different project identity. Analysis reflection masks are
not applied to training images or annotation clicks: all visible real fish inside
the clean crop need labels, including fish in an analysis mask.

The editor captures a clean cropped PNG using `video.mjs.readPng()` and draws
that image beneath the box overlay. The image is retained on the first edit or
when explicitly labeling an empty frame. Revisiting an annotated frame displays
its saved PNG rather than seeking a potentially different neighboring video
frame. Dataset export reuses that exact PNG and does not seek the video.

`label-data.mjs` keeps boxes in crop-local pixel coordinates as top-left
`{id, x, y, width, height}`. `labelBoxAt()` places a box around a clicked center
and clips placement at crop edges. `yoloLabels()` writes class 0 (`fish`) with
normalized center X/Y and width/height. `labelManifest()` includes both crop-local
and original-video centers, source metadata, and sample timestamps. Box IDs are
within one frame and do not identify fish across time.

Each annotation record has `frameIndex`, `timestampMs`, `boxes`, `labeled`, and
an optional clean PNG `image` Blob. Unvisited frames need no record. Editing a
completed frame changes `labeled` to false. Only explicit completion includes a
frame in the dataset; a completed empty record exports a PNG and empty label file
as a negative example. Skipped and draft frames are excluded even if draft boxes
exist. Export refuses a completed record without its image rather than writing
misaligned labels or quietly omitting it.

`label-storage.mjs` uses IndexedDB for metadata and per-frame annotations/PNG
Blobs. Writes are serialized; a save status acknowledges the latest requested
write, and storage failures tell the user to download progress. Autosave is
specific to the browser origin and can be cleared by the browser. Portable progress
JSON includes draft records and base64 PNGs, independently of browser storage.
Import validates the video/crop/interval identity, frame timestamps, box geometry,
PNG dimensions, and image decoding before replacing current marks. The database
replacement is one transaction. A portable import still works in memory if the
browser cannot save it, with a visible backup reminder.

`label-export.mjs` builds a dataset archive containing `images/`, matching
`labels/`, `classes.txt`, class metadata in `data.yaml`, and `annotations.json`.
It does not create a train/validation split; users should split by recording or
separate time blocks. `zip.mjs` writes standard ZIP entries without compression
(PNGs are already compressed), including CRC-32 and UTF-8 filenames. ZIP64 sizes
and duplicate/unsafe paths are rejected. Dataset ZIP is for training; progress
JSON is for resuming the editor. Neither changes Human analysis marks or detector
measurements.

## Verification

The Node tests cover geometry, grouping, detector examples, pipeline sampling,
coordinate conversion, cancellation, inference cleanup, review comparisons, and
CSV semantics. To check browser integration, load a local video, analyze it,
change the distance, select a frame, add human marks, and visit About and back.
Roboflow initialization also requires network access and a working trained model.


## Angled areas and bright fixtures

`geometry.mjs` validates four convex corners in edge order and returns their
integer bounding box plus original-video `polygon` vertices. Crop, light/dark
regions, and reflection masks can each carry these vertices. `insideCrop()`
checks the polygon when present; `analysisPixelMask()` removes outside pixels
before and after detector morphology. Video decoding still reads the bounding
rectangle. Manual marks and model centers use the same area-membership check.
Random spacing uses uniform bounding-box rejection for polygon runs, with a
bounded retry count; old rectangular runs retain their original reference sequence.
JSON saves the vertices, and settings deep-copy them. Training PNGs and clean
frame downloads retain the rectangular bounding image.

In dark-region runs, `suppressFlicker` defaults to true. `backgroundVariation()`
learns the 10th–90th percentile pixel range from the background samples and expands
it over a two-pixel neighborhood, accounting for small fixture-edge movements.
After ordinary foreground cleanup, a connected region must contain at least five
pixels and 8% of its area beyond the learned range (or darker foreground evidence
on the light side). This validates a core without shrinking the full outline of
a fish crossing a ridge. The check also applies to edge recovery. The optional
setting does not affect runs without marked dark regions or model detection.


## Optional single-fish velocity

`velocity.mjs` computes scalar speed from adjacent original samples only when
`settings.expectedFish === 1`. Both frames must pass the inclusion filter and
contain exactly one finite observed/manual center. Uncertain or split estimates,
unapplied excess-candidate selections, automatic track-ID changes, nonpositive
time deltas, nonconsecutive sample indices, and elapsed gaps over 1.5 times the
configured interval are rejected. Rejected intervals remain gaps, not zeroes.
Manual corrections can repair their adjacent intervals. Average speed is summed
displacement divided by summed measured duration, rather than a mean that assigns
unobserved time zero speed. Statistics are null when no interval is available.

`velocity-ui.mjs` owns the opt-in Results controls, units, coverage, and SVG chart.
The graph uses one constant-speed line per measured interval, connecting only
consecutive valid intervals; its marker follows the selected frame. The existing
correction and calibration refresh paths recalculate the report. Pixel speeds
remain independent of calibration. Full JSON includes the report only when the
view is enabled; `single-fish-adjacent-centers-v1` identifies its method.


## Single-fish side timeline

`usesSingleFishSides()` enables the experiment when the configured expected count
is one and a dark region exists. `analysisTankSide()` applies the complement-light
rule consistently to automatic detections, manual centers, metrics, and exports;
reflection masks and the angled crop still define the usable area. Geometric
`tankSide()` retains generic marked-area membership.

`side-tracking.mjs` retains every original sample with an observed side or unknown
status. Inclusion filtering, missing/multiple centers, uncertain estimates,
excess-candidate selections, and unusable centers produce unknown samples.
Crossings require adjacent known samples, increasing timestamps within the
sampling gap limit, and an uninterrupted automatic track (or manual correction).
`visibleSideChanges()` projects actual changes into the current review indices,
so removing an unknown frame from a review view cannot invent a transition.
The Results timeline uses video time for colored side segments and keeps the
original group-size mode for other recordings. Manual correction refreshes the
same timeline; JSON includes the full report independently of the velocity toggle.
