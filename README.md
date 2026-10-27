# Fish Cluster

A browser-only zebrafish tank video analyzer. It samples uploaded video at a chosen interval (200 ms by default), records candidate fish center coordinates, and calculates spacing and cluster metrics. Detection can use a locally built median background or an optional Roboflow model. The video is never uploaded by this application.

## Run locally

```sh
npm run dev
```

Open <http://localhost:8000>. No install or build is required. Tests: `npm test`.

## Use

Start by choosing **Shoaling** or **Light / dark**. Shoaling retains the spacing
and cluster analysis described below. Light/dark fixes the count at one fish and
shows time in dark, time in light, unknown time, observed zone switches, and
average scalar speed, without pair-distance or cluster controls. Mark the dark
region; the rest of the usable tank is light. The **Frames CSV column guide**
beside the export buttons explains every column for each test.

With one fish expected, background analysis keeps at most one candidate, choosing
the strongest foreground contrast against the median background. This favors a
dark fish over a faint reflection on the light floor, while still supporting a
pale fish on the dark floor. A competing candidate is excluded as weaker contrast
only when the winner has at least 1.5 times its contrast and an eight-level lead;
close choices remain uncertain and do not contribute known zone time or speed.
An unambiguous match to the previous observed position can resolve competing
candidates. When distances to that position are close, motion from consecutive
observations can resolve the choice; missing or uncertain samples break that
evidence. Otherwise, a supported fish away from the tank boundary takes
precedence over a long, very thin region following that boundary. The diagnostic
table identifies these rejected regions as **No (tank wall)**. This uses the
actual polygon edges for four-corner crops.
This is a selection heuristic, not proof that the winner is the fish. Rejected
candidates remain visible as pink crosses and in the JSON and diagnostic review.
The light/dark frames CSV includes the original candidate count, rejected count,
selected foreground contrast, selection method, and automatic selection status.
Manual corrections override the automatic choice. Reanalyze existing recordings
to apply the rule. Multi-fish and Roboflow detection retain their existing rules.

Light/dark totals use every analyzed sample, including samples excluded by the
count filter. The measured window runs from the first sample to the last, with
no extrapolation into the unsampled video tail. Adjacent reliable observations
on the same side assign their elapsed time to that side; a crossing splits it
equally. An interval with an unknown endpoint, a sample gap, or an unexplained
track change is unknown. Average speed is total valid displacement divided by
valid time. Coverage and speed duration accompany the totals; a stopped run is
marked partial. Applied frame corrections update these results and exports.

In **Saved tank setups**, save a named crop, masks, light/dark regions and scale
in this browser. **Reuse current setup for next video** is enabled initially.
Reused and saved setups require exactly matching video dimensions and preserve
four-corner geometry. Check the alignment when loading each video. Named setups
remain available after reload; videos themselves are not stored by this feature.

In light/dark Results, **Trial results across fish** collects reviewed summaries.
Enter a trial, exposure label and fish ID, then **Add current fish**. Load the next
video and repeat. The same trial/exposure/fish key cannot be added twice;
**Replace matching fish** explicitly updates its saved snapshot after further
corrections. Download one per-fish CSV and one group-means CSV, both readable in
Excel. Means are calculated separately for each trial and exposure, weighting
each fish equally and reporting a valid count for each metric. Progress targets
ten fish per group; exposure labels are free text, so all three exposure levels
can share the same collection. Dark/light fractions use known zone time, while
coverage reports the known fraction of the full analyzed window. Partial runs
are identified in the table and exports. These summaries persist in this browser;
export CSVs to keep a portable copy.

1. Add a tank video the browser can decode.
2. Drag a rectangle around the tank in the preview if the fish occupy only part of the video, or open **Tank area, reflection masks & scale → Precise crop** to enter exact X/Y/width/height values. The preview fits both the available width and height. **Focus on tank** enlarges the selected tank crop, especially useful for portrait footage; **Full frame** shows the whole image for adjusting the crop. Fit resets zoom, and +/− zoom within the preview; scroll inside a zoomed image to reach its edges. For this repository's `fish.mov` (540 × 960), the tested 420 × 290 tank crop is selected automatically. Exported x/y coordinates remain in the original video frame. Choose centimeters or inches, then set the frame interval, close distance, and paper-grid calibration in pixels per 0.5-inch square. Centimeters are selected initially. The calibration applies to both detection methods. About 15.3 px per square and a 3.81 cm close distance are prefilled for this video. To measure your own scale, open **Set scale** and click **Draw calibration line**, drag along a known distance, enter its length in the selected units, and click **Use this scale**. Measure several grid squares near the swimming area for better accuracy; clearing the line keeps the applied scale. By default, analysis keeps only samples with exactly five detected fish; change the count or turn off **Only include frames with exactly** to keep every sample. Skipped samples still help tracking across neighboring frames.
3. Background subtraction is the default method. It samples 25 points across the video to build a median tank background, then finds dark connected regions in each selected frame. Enter the known fish count. For this video, five fish are prefilled. The grid scale is approximate; nearby fish can merge into one blob and reflections can create false detections.
4. The optional Roboflow mode uses the trained `zebrafish_in_aquarium/9` model by the `zebrafish-zxjvh` workspace. Its publishable key is prefilled in the static page and is therefore visible to visitors. Detection method, tracking options, frame inclusion, direct pixel calibration, and Model settings are under **Advanced settings**. The required inclusion count follows the tank count until you enter a different required count.
4a. By default, analysis keeps only samples with exactly five detected fish. Change the required count or turn off **Only include frames with exactly** to keep every sample. Skipped samples still help tracking across neighboring frames.
5. Analyze opens the **Results** view on the first included frame. Left/right arrow keys move through the selected frame view while you are not editing a control. Use **Setup** to configure the recording and **Results** to inspect and correct it. The Analyze button and status stay visible while setup settings scroll. Use the timeline above the video to skip to sampled frames. Yellow marks show where the detected group-size pattern changes; the previous/next buttons jump between those marks. The link-distance slider updates group colors, the selected-frame chart, timeline marks, and exports without rerunning detection. Export detections CSV, frame metrics CSV, or full JSON. In the same Results workspace, enable **Edit centers** to start from the current detections. Click a center to remove it, or click an empty location to add a center. Choose **Apply & stay** to update that frame’s groups, measurements, inclusion status, and exports. Draft edits do not affect results until applied. You can also show original automatic centers or the full frame, mark frames reviewed, and export annotations as CSV. Fish marked outside the crop are kept in the export but excluded from the automatic comparison. The review reports one-to-one center matches within 0.5 inch as well as count and group-size agreement. Manual marks are kept only until the tab reloads.

In **Results**, **Frames → Count mismatches** shows samples whose
original automatic candidate count differs from the known fish count. This
includes samples skipped by the analysis count filter and candidates excluded
by the crop-center rule. Previous/Next, the slider, and the frame-position input
navigate the selected review view; the original sample number appears beside
the timestamp. Review marks and status stay with their original samples when
switching views. The sidebar offers **Included in results**, **All sampled frames**, and **Count mismatches**, plus display options and summary metrics. The default is the first included frame, or the first sampled frame if all were excluded. If a correction removes the current frame from the included subset, Results switches to All sampled frames and keeps that frame selected. The image
fits the available height, with Fit and +/− controls for zooming. **Done & next** applies pending changes, updates the summary,
marks the frame done, and advances. With no changes, it only marks the frame done.
**Apply & stay** applies pending changes and marks the frame done while keeping it
on screen. Edit centers stays enabled across both actions. Previous/Next and arrow
keys only navigate; drafts are retained. **R** performs Done & next, and
**Cmd/Ctrl+Z** undoes a mark edit when focus is outside a control.
Progress above the summary counts done frames in the current view. When all are
done, a Review complete message links to Export results. Editing a done frame
makes it unfinished again. At the last frame, Done returns to any unfinished
frames in the current view before declaring completion.
**Download frame PNG** saves the selected video image at its original pixel size.
It follows the current tank crop or **Show full frame** setting and excludes drawn
centers and other overlays. The filename includes the sample number and time.
**Undo mark** is also available in Display & correction options. Clearing marks
creates an explicitly empty correction that can be applied; undo restores the
previous marks. Sharpness tables and scores are under collapsed **Diagnostics**.

Use **Apply & stay** to apply a correction. If the corrected
count meets the analysis filter, a skipped frame is included in results;
restoring automatic centers applies the filter again. **Restore automatic centers** also resets the draft to the original detections so Done does not reapply an old correction; Undo mark can recover the previous draft. **Start from current centers** resets a draft to the applied result, and **Clear draft centers** prepares an explicitly empty correction. Corrected frames stay in
the mismatch view based on their original candidates. The Results workspace remains
available even when all samples were skipped. Human CSV includes every sampled
frame, its `automatic_candidate_count`, and an `included_in_results` flag.
Analysis CSVs contain included frames; the full JSON also saves `excludedFrames`.

To include fish swimming above the tank floor, enlarge the crop to cover their
swimming area. Under the preview, choose **Mask reflection area** from the drag
tool and draw rectangles over reflections or fixtures. Red masks apply to every
sampled frame; use **Undo last mask** or **Clear masks** to adjust them, then
analyze again. Keep masks small: real fish inside them are also excluded. A mask
cannot distinguish a fish from its reflection when they occupy the same image
area. Masks appear in human review and are saved in the JSON settings.

For an angled tank, open **Tank area, light/dark sides, reflection masks & scale**,
choose **Select tank crop** under **Area tool**, and set **Selection shape** to
**Four corners**. Click four corners in order around the swimming area. The
fourth click applies the outline. Switching to Four corners exits calibration
and restores the last area tool; each corner uses a simple click, including the
first. Selecting calibration shows Rectangle/drag mode. **Undo corner** and **Cancel corners** adjust
an unfinished selection. Crossed or concave outlines are rejected. The same
four-corner mode works for light/dark regions and reflection masks. Rectangle
mode still uses dragging. The detector and manual corrections use the outlined
area, while decoding and clean PNG/training exports use its rectangular bounding
box. Coordinates remain in original-video pixels; the image is not rotated or
stretched. Precise crop inputs replace a four-corner tank outline with a rectangle.
Full JSON retains the corners. Changing areas requires analyzing again.

For a tank with a dark and a light side, open **Tank area, light/dark sides,
reflection masks & scale**. Crop to the swimming area, then use the **Area tool**
to **Mark dark region** and **Mark light region**, outlining each side with a
rectangle or four corners. You can draw several areas; the last drawn wins at overlaps.
**Undo last region** and **Clear light/dark regions** adjust these marks.
Unlike reflection masks, these regions keep fish in the analysis. In dark regions,
background subtraction accepts both brighter and darker changes; light and
unmarked areas retain the darker-fish rule. The median background remains local
to each pixel. Analyze again after editing regions. Results show the region
outlines and counts under frame details. Detection CSV adds `tank_side`
(`dark`, `light`, or `unmarked`); frame CSV adds `darkSideCount`, `lightSideCount`,
and `unmarkedSideCount`. Full JSON includes region shapes and each detection's
`tankSide`. Classification uses the fish center, including after manual corrections;
it does not assign a whole straddling fish to both sides. With exactly one fish
expected and at least one dark region marked, the remaining usable tank area
counts as light; marking a light region is optional. Other recordings retain
`unmarked` for areas outside all marked regions. These are sampled positions, not continuous
residence-time estimates. Set **Fish in tank** and the required inclusion
count to **1** for a single-fish recording. Files named `single_fish_dark_side…`
start with both counts at one. Calibrate scale for each recording if using inch
measurements.

With **Fish in tank = 1** and a marked dark region, the **Group changes**
timeline automatically becomes **Light / dark changes**. Purple and cyan show
the fish center in dark and light areas over video time; gray marks unknown
samples. The selected frame's side and the dark/light/unknown sample totals
appear above the bar. A missing or multiple detection, an uncertain estimate,
an excluded sample, or an automatic selection among excess candidates is unknown.
Applied manual corrections update the side classification and timeline.

Yellow ticks mark observed changes between adjacent known samples. They do not
claim a crossing time across an unknown gap or a lost automatic track. The
previous/next arrows and timeline clicks navigate side changes available in the
current review view; the bar retains all original samples so review filtering
does not conceal gaps. The count states both the recording's observed changes
and those available in the current view. Full JSON adds `sideTracking`, including
each sample's side, observed changes, and sample totals. These are sample counts,
not continuous time spent on each side. Other recordings keep **Group changes**.

For bright ridges and fixtures on the dark side, **Advanced settings → Learn
background flicker in dark regions** is enabled by default. It learns the usual
brightness range of each pixel from the background samples, including a two-pixel
neighborhood to tolerate small ridge shifts. A candidate needs a small core
(at least five pixels and 8% of its area) that changes beyond that range. The
whole candidate outline is retained when it passes, so fish can still cross a
ridge. This does not change the dark/light side classification. Fixed bright
objects are already part of the median background. Reflection masks remain an option for areas
to exclude, but also exclude fish swimming through them.

For single-fish recordings, learning also excludes sustained foreground visits
from that brightness range. This keeps a fish that rests over embossed lettering
from being learned as ordinary flicker. A faint body connected to a bright core
can retain its recent observed extent, so the tracker does not shrink to a tiny
patch and lose the fish on the following sample.

With one fish expected and learned background flicker enabled, the marked dark
region gets a second pass for faint fish. A core must exceed the learned range
by 18 brightness levels; connected body pixels can have contrast as low as 12.
This can recover an empty sample or expand a small, faint detection to include
more of the fish. Size, masks, and learned-variation checks still apply, and
ordinary strong detections keep the usual cutoff of 24. Full JSON marks recovered
detections with `lowContrastRecovered`, `foregroundThreshold`, and
`foregroundCoreThreshold`.
When a nearby observed fish was present within 250 ms, recovery can also use a
12-level core if current foreground, body size, and movement agree with that
observation. JSON records `lowContrastReferenceTimestampMs` for these detections.
Faint interior recovery runs before relaxing the tank borders, so a wall
reflection cannot fill the expected count and prevent that recovery step.

For a recording configured with **Fish in tank = 1**, Results offers an optional
**Single-fish velocity → Show velocity tracker**. It starts off. Enable it to see
minimum, maximum, and average speed and a speed-versus-video-time graph. Pixels
per second are the default; choose approximate inches per second to use the
current scale, calibrated for this recording. Here “velocity” is scalar speed,
measured as the straight-line center displacement divided by elapsed time.
Curved motion between samples is not measured, and detection jitter can inflate
speed. The average is total measured distance divided by measured time.

Only consecutive, included samples with exactly one observed or manually
corrected center contribute. Missing or multiple centers, excluded samples,
estimates, excess candidates discarded by the center rule, and automatic track
changes break the graph. The tracker never bridges skipped samples or treats
unknown time as stationary. Coverage reports measured intervals and seconds;
fewer than two usable consecutive samples leaves the statistics unavailable.
Applying a correction or changing scale recalculates the view, and the yellow
line follows the selected frame. This view is hidden for recordings configured
with more than one fish; it does not depend on the review count override or
require the provisional identity tracker. With velocity enabled, **Export all
JSON** also includes its summary, coverage, method, and timestamped intervals in
both units. Existing CSV formats are unchanged.

Background mode also offers **If there are extra candidates, keep those nearest
the crop center**. This is off by default. When enabled, a frame with more
candidates than the known fish count keeps only that many nearest the middle of
the crop rectangle. Before choosing those candidates, it checks unusually large
central regions for a touching pair even if reflections have already filled the
count. For smaller overlaps, two stable dark body regions can support a split.
A complete, non-estimated sample from the preceding 250 ms can also support an
estimated merge. With tracking enabled, established paths can also support an overlap for up to one second after an observed center. Estimates never renew that deadline. Split estimates are marked with dashed rings and † and recorded in exports. The final center
selection leaves frames at or below the known count alone. This can
reject reflections, but can also reject real edge fish. Pink × markers and the
Results diagnostic table show the excluded candidates. They retain their scores and
are included in the comparison CSV and full JSON; detection CSV and spacing/group
metrics use only the kept candidates. The random-spacing percentile is omitted
for frames affected by this rule because selecting central points biases spacing.

**Track fish across nearby frames** is enabled by default in background mode.
Use a frame interval of 250 ms or less. T numbers identify provisional paths;
fish can exchange identities during an overlap. Tracking uses recent motion and
current foreground pixels, and stops carrying an overlap after one second
without an observed center. Later reacquisition is recorded separately; it does
not turn an estimated position into an observation. To use paths to separate
joined fish, also enable the nearest-center option above.
If several pairs merge at once and the count is low, recent observed fish sizes
can provide the size reference for splitting them. These remain uncertain estimates,
including the two centers inside an X-shaped crossing.

In **Results**, dashed † centers need checking against neighboring frames.
With **Edit centers** enabled, the **Center coordinates** panel at the top of the
sidebar shows pointer coordinates and each numbered draft center in original
video pixels. **Copy center coordinates** includes the sample number and time;
copying coordinates does not require applying a correction.

Enable **Edit centers**, check or adjust every visible fish, then choose **Apply & stay** to update
that frame's measurements and exports. Applying no marks explicitly sets its
count to zero. **Restore automatic centers** undoes the correction. Manual marks
outside the crop or inside reflection masks are not applied. Corrections affect
only the selected frame and do not retrain or rerun the tracker. Original
candidates remain available for comparison and in full JSON. Detection CSV
identifies `observed`, `overlap-estimate`, and `manual` positions, their uncertainty,
and any track ID; frame CSV includes uncertainty counts and correction status.
Distances and groups include estimated positions until you correct them.

Candidate overlays can show **S**, a sharpness score measured from the original
video pixels around each detection. Higher values usually indicate sharper edges;
this is a diagnostic measurement, not a reflection probability. After analyzing,
open **Results → Diagnostics: fish & reflections** to see sharpness and local
contrast, label candidates as fish or reflections, and compare their median scores
across frames. Export the comparison CSV to keep those labels. Labels do not
remove detections or change counts. To compare reflections, leave the areas you
want to inspect unmasked during that diagnostic run. A `*` flags a scoring patch
clipped by the crop or a mask. Grid lines, noise, contrast, and motion can all affect
the score; compare examples from the same recording before considering a cutoff.

The in-app About view explains both detection methods, coordinate and inch measurements, grouping, and validation. Its navigation stays in the analyzer document, so returning preserves the selected video, results, frame, and human marks. A standalone [About page](dist/about.html) is also available by direct URL.

Detection coordinates are pixel positions of region or bounding-box centers. A cluster is a connected group of at least two detections whose centers are linked by distances at or below the close distance in inches, converted using the entered grid calibration. Group numbers and colors apply within each frame only. The timeline marks changes in the sorted group sizes (for example, `3+2` to `4+1`), not changes in individual fish membership. The spacing percentile compares each frame's mean nearest-neighbor distance with 399 reproducible uniform random placements of the same detection count inside the selected crop outside reflection masks; it is a descriptive per-frame comparison, not a video-wide significance test. Average pair distance is calculated within each frame and averaged over frames with at least two detections. Distances are reported in approximate inches for either detection method. Background mode can follow short, provisional fish paths; these are not verified individual identities. If the linked Roboflow project has no trained browser-compatible version, use background mode or provide a different trained project and version.

The default confidence cutoff is 0.15 to help detect small fish. The progress line shows both the raw model box count and the kept fish count; if the raw count is still one, the model itself is missing the other fish in that frame.

When Roboflow mode is selected, the app begins preparing the model after a video is selected and keeps the browser worker alive for later analyses on the same page. Reloading the page still requires model initialization. Browser caching of downloaded assets depends on the browser and Roboflow response headers. Background mode needs no model download or key.

## Label training frames

1. Load a video, select a crop that contains every fish you want to label, and set
   the sampling interval. Choose **Label frames for training**; running detection
   first is optional.
2. Click a real fish to place a box. Adjust width/height, or choose **Move or resize
   boxes** and drag the box or a corner. Label each identifiable fish separately,
   including overlapping fish. Use the fish buttons to select overlapping boxes.
   Do not label reflections or guess completely hidden fish. Analysis reflection
   masks are ignored here, so label all real fish visible inside the clean crop.
3. Choose **This frame is labeled** or **Mark labeled & next** when every fish has
   a suitable box. Previous/Next, the slider, frame number, and navigation step let
   you skip any frames. **Next unlabeled frame** jumps past completed frames.
   Editing a completed frame makes it a draft until you approve it again. A labeled
   frame with no boxes is an explicit negative example; an unmarked empty frame
   is excluded.
4. At any time, choose **Export labeled dataset ZIP**. Only completed frames enter
   the dataset, with clean cropped PNGs, matching [YOLO `.txt` boxes](https://docs.ultralytics.com/datasets/detect/) (class 0 =
   fish), class names, and a JSON manifest with crop, source timestamps, boxes,
   and centers. No overlays are burned into the images. Split recordings into
   training/validation sets in Roboflow or your training workflow; the export
   identifies the class but deliberately does not assign neighboring frames to
   random training/validation splits.
5. Progress saves automatically in this browser, separately for each video,
   crop, and interval. Reopen the same video/settings to resume. **Save progress
   JSON** creates a portable backup including draft boxes and exact saved images.
   **Restore progress JSON** replaces this project's current marks with that
   backup. Dataset ZIPs are for training; progress JSON is for resuming editing.

The labeler is separate from Results corrections and comparisons and never changes the
detector's results. Its boxes are manual training annotations, not automatic fish
predictions. Browser storage can be cleared or fill up; keep progress backups.

## Developer

`dist/` contains the application source and is also the deployable site; no build
step is needed. Run `npm run dev` to serve it locally and `npm test` to run the
automated checks.

The GUI handles controls and drawing. Separate modules decode video, detect fish,
calculate measurements, compare manual annotations, and format exports.

| File | Responsibility |
| --- | --- |
| [dist/index.html](dist/index.html), [dist/style.css](dist/style.css) | Page structure and appearance. |
| [dist/app.mjs](dist/app.mjs) | Main entry point: connects controls to analysis, manages page state, and updates results, charts, and navigation. |
| [dist/preview.mjs](dist/preview.mjs) | Draws the video preview, detection centers, group links, and crop outline. |
| [dist/human-ui.mjs](dist/human-ui.mjs) | Handles manual annotation controls and draws human-review overlays. |
| [dist/labeling-ui.mjs](dist/labeling-ui.mjs), [dist/labeling.css](dist/labeling.css) | Training-data frame navigation, manual box editing, labeled/draft status, and export controls. |
| [dist/label-data.mjs](dist/label-data.mjs) | Validates labeling projects and boxes, converts coordinates to YOLO format, and prepares annotation manifests. |
| [dist/label-export.mjs](dist/label-export.mjs), [dist/zip.mjs](dist/zip.mjs) | Export selected clean images and YOLO labels as ZIP; save and restore portable progress with exact image data. |
| [dist/label-storage.mjs](dist/label-storage.mjs) | Autosaves labeling annotations and PNGs in IndexedDB, separately for each video/crop/interval. |
| [dist/video.mjs](dist/video.mjs) | Seeks and decodes video frames, then reads cropped pixels using a private canvas. |
| [dist/pipeline.mjs](dist/pipeline.mjs) | Coordinates background preparation, frame sampling, detection, and measurement; reports progress and completed frames. |
| [dist/background.mjs](dist/background.mjs) | Estimates the stationary tank background and finds dark moving regions that may be fish. |
| [dist/connected-regions.mjs](dist/connected-regions.mjs), [dist/overlap-evidence.mjs](dist/overlap-evidence.mjs) | Find connected pixels and check for two dark bodies or two preceding observed centers entering one region. |
| [dist/tracking.mjs](dist/tracking.mjs), [dist/point-assignment.mjs](dist/point-assignment.mjs) | Follow provisional fish paths, match centers one-to-one, and supply bounded overlap evidence without treating estimates as fresh observations. |
| [dist/blob-splitting.mjs](dist/blob-splitting.mjs) | Estimates two centers inside unusually large regions, including touching pairs hidden by a full candidate count. |
| [dist/model.mjs](dist/model.mjs) | Loads and reuses the optional Roboflow model worker and explains model errors. |
| [dist/geometry.mjs](dist/geometry.mjs), [dist/tank-zones.mjs](dist/tank-zones.mjs) | Four-corner geometry, area drawing, side classification, and dark-region pixel maps. |
| [dist/region.mjs](dist/region.mjs) | Defines the usable crop area, translates reflection masks, and splits the unmasked area for random sampling. |
| [dist/candidate-selection.mjs](dist/candidate-selection.mjs) | Optionally ranks excess candidates by distance from the crop center, retaining rejected candidates for review. |
| [dist/settings.mjs](dist/settings.mjs) | Validates settings, copies the selected crop, and converts calibrated inches to pixels. |
| [dist/analysis.mjs](dist/analysis.mjs) | Calculates distances and connected groups from centers, normalizes model predictions, and supplies geometry and statistics helpers. |
| [dist/sharpness.mjs](dist/sharpness.mjs), [dist/sharpness-ui.mjs](dist/sharpness-ui.mjs) | Measure candidate sharpness and contrast, draw scores, and collect diagnostic fish/reflection labels without filtering detections. |
| [dist/side-tracking.mjs](dist/side-tracking.mjs) | Single-fish dark/light observations and side-change navigation that preserves unknown gaps. |
| [dist/velocity.mjs](dist/velocity.mjs), [dist/velocity-ui.mjs](dist/velocity-ui.mjs) | Optional single-fish speed intervals, summary statistics, and graph with gaps for unavailable positions. |
| [dist/measurements.mjs](dist/measurements.mjs) | Adds calibrated distances and random-spacing comparisons to frame metrics; identifies group-size changes. |
| [dist/review.mjs](dist/review.mjs) | Compares manual marks with automatic centers and summarizes reviewed frames. |
| [dist/exports.mjs](dist/exports.mjs) | Formats detection, frame, and manual-review CSV data and prepares settings for export. |
| [dist/download.mjs](dist/download.mjs), [dist/format.mjs](dist/format.mjs) | Save files in the browser and format displayed numbers and times. |
| [dev-server.mjs](dev-server.mjs) | Serves `dist/` locally for development. |
| [tests/](tests/) | Node tests for detection, measurements, pipeline behavior, manual comparisons, and exports. |
| [experiments/background_subtraction.py](experiments/background_subtraction.py) | Separate Python experiment that generates the background-subtraction report. |

Start with `app.mjs` to understand user interactions or `pipeline.mjs` to follow
an analysis run. See the [code guide](docs/code-guide.md) for a walkthrough from
video pixels to exported measurements, coordinate conventions, and explanations
of the vision algorithms.

## Background subtraction experiment

The static [ten-frame report](dist/background-test.html) shows detected counts from a separate background subtraction trial on `fish.mov`. It is also linked from the app footer and is included in the Cloudflare Pages output. The [experiment instructions](experiments/README.md) explain the method and how to regenerate the page. These blob counts have not been manually validated as fish counts.

## Cloudflare Pages

The app deploys as a static Cloudflare Pages site. The deployable files are already in `dist/`; no build step, server routes, or storage are required. You need Node.js/npm and a Cloudflare account.

Run these commands from the repository root. First, sign in (Wrangler opens a browser):

```sh
npx wrangler login
```

Create the Pages project once. Skip this command if `fish-cluster` already exists in your Cloudflare account:

```sh
npx wrangler pages project create fish-cluster --production-branch main
```

Test and deploy the current `dist/` directory to production:

```sh
npm test
npx wrangler pages deploy dist --project-name fish-cluster --branch main
```

Wrangler prints the deployment URL. Open it to check the site; deployments are also listed under **Workers & Pages → fish-cluster** in the Cloudflare dashboard. For later updates, rerun the test and deploy commands. If you choose a different project name, use it in every command.

To publish a preview without updating production, use a branch name other than `main`:

```sh
npx wrangler pages deploy dist --project-name fish-cluster --branch preview
```

These commands use Cloudflare's [Direct Upload workflow](https://developers.cloudflare.com/pages/get-started/direct-upload/) and [Wrangler Pages commands](https://developers.cloudflare.com/workers/wrangler/commands/pages/). Only `dist/` is uploaded, so the local `fish.mov` stays on your computer. Background mode runs locally without model assets; a live network connection is needed for Roboflow mode and optional web fonts. The prefilled Roboflow publishable key is visible in the deployed source; never put a private API key there.
