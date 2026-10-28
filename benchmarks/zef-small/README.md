# Small 3D-ZeF detection benchmark

Run `npm run benchmark:zef` from the repository root. Requires Node and FFmpeg.
Open `benchmarks/zef-small/results/index.html` to review every sampled frame;
`report.json` contains per-frame detections and metrics. No network is needed.

This is a local 2D detection regression benchmark, not the official 3D MOT score.
It calls the production `detectBackgroundFish` directly with default settings and
known count 2. It does not run pipeline candidate selection, identity tracking,
or Light / Dark analysis. It cannot establish performance in the intended setup.

## Fixed inputs and scoring

Twelve original overhead JPEGs from ZebraFish-03 (two-fish validation sequence),
frames 1, 151, …, 1651, spaced 2.5 seconds apart at 60 fps. Native 2704×1520
resolution, full frame, no resizing or hand-tuned mask. A median of the same
12 images builds the background. This is an offline background, using future
frames just as the app's video background sampling does; it is not online tracking.
The manifest pins the source dataset revision. `checksums.json` locks inputs.

GT columns (zero-based): frame 0, identity 1; top head 5–6, top box
x/y/width/height 7–10, top occlusion 11; front fields follow. Original top-view
coordinates are used directly. Green boxes and red detection centers in the
report make alignment inspectable. No head-position error is reported because
our detections locate body centers.

A detection matches when its center lies inside a visible annotated fish box.
Maximum-cardinality one-to-one matching prevents duplicate credit. Visible labels are matched first, then remaining detections are matched one-to-one
to occluded labels. Misses and matches are reported separately for each group.
Remaining detections are false positives. Visible, occluded, and overall recall
are reported; precision includes matches from both groups. Orange boxes identify
occluded annotations. Their scores are diagnostic because those labels may be
estimated. This is a coarse
localization test: a center inside a box does not prove accurate segmentation.

The command exits unsuccessfully when true positives fall below the saved
baseline, occluded matches fall below it, or false positives rise above it. It always writes the report first.
The baseline records existing behavior, not an acceptable accuracy target.
Review changes before explicitly replacing it with
`node benchmarks/zef-small/run.mjs --save-baseline`.
Do not repeatedly tune on these frames and claim independent test performance.
Use additional held-out recordings for broader validation.

## Sources and reproduction

Pedersen, Haurum, Bengtson & Moeslund (CVPR 2020),
[3D-ZeF](https://vap.aau.dk/3d-zef/).
Original images and labels: [author-hosted dataset](https://huggingface.co/datasets/vapaau/3D-ZeF).
[Benchmark archive and license](https://motchallenge.net/data/3D-ZeF20/).
Retain attribution. The MOT archive specifies CC BY-NC-SA 3.0; the Hugging Face
metadata says MIT. These fixtures conservatively retain the archive's
noncommercial/share-alike terms; this note does not resolve that discrepancy.
JPEGs and labels are unmodified extracts. Generated overlays are derivatives.

`node benchmarks/zef-small/download.mjs` restores missing images from the pinned
revision. Labels and hashes are included in the repository. FFmpeg converts JPEGs
to RGBA; the production grayscale function then converts to detector input.
FFmpeg version differences may affect decoding, so investigate a regression
before updating the baseline.

## Motion-guided overlap experiment

`node benchmarks/zef-small/download-overlaps.mjs` downloads 82 additional original
images from the pinned dataset revision (four concurrent downloads). Then run
`node benchmarks/zef-small/overlap-experiment.mjs`. Open
`results/overlap-experiment/index.html`; detailed results are in the adjacent JSON.
Fixtures are locked by `overlap-checksums.json`.

Two independent windows: 1141–1261 and 1441–1561, every third source frame
(20 fps, 2 seconds per window). The existing 12-frame median background is held
fixed across all methods. Compare original detector, maxArea=20,000 alone, and
an experimental tracker with expanded raw components and Kalman-guided splitting.

The experiment initializes two tracks from the largest ordinary-size components
without ground truth, predicts constant velocity with independent x/y Kalman
filters, and assigns distinct candidates using uncertainty-weighted distance.
Candidates farther than 180 pixels or outside the statistical gate are rejected.
When both predictions are supported within 35 pixels of one component of at
least 2,500 pixels, the production two-cluster splitter receives those predictions
as seeds. Split centers are estimates and receive higher measurement noise.
Unmatched predictions are not counted as observed detections. Ground truth is
used only for scoring. No track identity accuracy is measured.

These are development examples already inspected by us, not an independent
accuracy test. The motion arm combines gating, assignment, and splitting; changes
cannot be attributed to Kalman filtering alone. Fixed parameters and automated
initialization need broader testing. No production algorithm is changed.
