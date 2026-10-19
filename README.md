# Fish Cluster

A browser-only zebrafish tank video analyzer. It samples uploaded video at a chosen interval (200 ms by default), records candidate fish center coordinates, and calculates spacing and cluster metrics. Detection can use a locally built median background or an optional Roboflow model. The video is never uploaded by this application.

## Run locally

```sh
npm run dev
```

Open <http://localhost:8000>. No install or build is required. Tests: `npm test`.

## Use

1. Add a tank video the browser can decode.
2. Drag a rectangle around the tank in the preview if the fish occupy only part of the video, or enter exact X/Y/width/height values under the preview. Portrait videos display at their own aspect ratio so the crop can be selected across the full image. For this repository's `fish.mov` (540 × 960), the tested 420 × 290 tank crop is selected automatically. Exported x/y coordinates remain in the original video frame. Set the frame interval and close distance. The close distance is a percentage of the analyzed area's diagonal.
3. Background subtraction is the default method. It samples 25 points across the video to build a median tank background, then finds dark connected regions in each selected frame. Enter the known fish count and the paper-grid scale. For this video, five fish and about 15.3 px per 0.5-inch square are prefilled. The grid scale is approximate; nearby fish can merge into one blob and reflections can create false detections.
4. The optional Roboflow mode uses the trained `zebrafish_in_aquarium/9` model by the `zebrafish-zxjvh` workspace. Its publishable key is prefilled in the static page and is therefore visible to visitors. Project slug, version, and confidence can be changed in Model settings.
5. Analyze, inspect sampled frames, and export detections CSV, frame metrics CSV, or full JSON.

Detection coordinates are pixel positions of region or bounding-box centers. A cluster is a connected group of at least two detections whose centers are linked by distances at or below the threshold. Average pair distance is calculated within each frame and averaged over frames with at least two detections. In background mode, distance is also reported in approximate inches using the grid calibration. The application does not identify or track individual fish across time. If the linked Roboflow project has no trained browser-compatible version, use background mode or provide a different trained project and version.

The default confidence cutoff is 0.15 to help detect small fish. The progress line shows both the raw model box count and the kept fish count; if the raw count is still one, the model itself is missing the other fish in that frame.

When Roboflow mode is selected, the app begins preparing the model after a video is selected and keeps the browser worker alive for later analyses on the same page. Reloading the page still requires model initialization. Browser caching of downloaded assets depends on the browser and Roboflow response headers. Background mode needs no model download or key.

## Background subtraction experiment

The static [ten-frame report](dist/background-test.html) shows detected counts from a separate background subtraction trial on `fish.mov`. It is also linked from the app footer and is included in the Cloudflare Pages output. The [experiment instructions](experiments/README.md) explain the method and how to regenerate the page. These blob counts have not been manually validated as fish counts.

## Cloudflare Pages

Deploy the repository as a static Pages project with no build command and `dist` as the output directory. The page uses no server routes or storage. Background mode runs locally without model assets; a live network connection is needed for Roboflow mode and optional web fonts. Do not put a private Roboflow API key in the site source or browser form.
