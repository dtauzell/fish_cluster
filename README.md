# Fish Cluster

A browser-only zebrafish tank video analyzer. It samples uploaded video at a chosen interval (200 ms by default), records candidate fish center coordinates, and calculates spacing and cluster metrics. Detection can use a locally built median background or an optional Roboflow model. The video is never uploaded by this application.

## Run locally

```sh
npm run dev
```

Open <http://localhost:8000>. No install or build is required. Tests: `npm test`.

## Use

1. Add a tank video the browser can decode.
2. Drag a rectangle around the tank in the preview if the fish occupy only part of the video, or enter exact X/Y/width/height values under the preview. Portrait videos display at their own aspect ratio so the crop can be selected across the full image. For this repository's `fish.mov` (540 × 960), the tested 420 × 290 tank crop is selected automatically. Exported x/y coordinates remain in the original video frame. Set the frame interval, close distance in inches, and paper-grid calibration in pixels per 0.5-inch square. The calibration applies to both detection methods. About 15.3 px per square and a 1.5-inch close distance are prefilled for this video.
3. Background subtraction is the default method. It samples 25 points across the video to build a median tank background, then finds dark connected regions in each selected frame. Enter the known fish count. For this video, five fish are prefilled. The grid scale is approximate; nearby fish can merge into one blob and reflections can create false detections.
4. The optional Roboflow mode uses the trained `zebrafish_in_aquarium/9` model by the `zebrafish-zxjvh` workspace. Its publishable key is prefilled in the static page and is therefore visible to visitors. Project slug, version, and confidence can be changed in Model settings.
5. Analyze, then use the timeline above the video to skip to sampled frames. Yellow marks show where the detected group-size pattern changes; the previous/next buttons jump between those marks. The link-distance slider updates group colors, the selected-frame chart, timeline marks, and exports without rerunning detection. Export detections CSV, frame metrics CSV, or full JSON. The post-analysis **Human analysis** link opens a review view in the same browser tab: click fish centers, optionally show automatic centers or the full frame, mark frames reviewed, and export manual annotations as CSV. Fish marked outside the crop are kept in the export but excluded from the automatic comparison. The review reports one-to-one center matches within 0.5 inch as well as count and group-size agreement. Manual marks are kept only until the tab reloads.

The in-app About view explains both detection methods, coordinate and inch measurements, grouping, and validation. Its navigation stays in the analyzer document, so returning preserves the selected video, results, frame, and human marks. A standalone [About page](dist/about.html) is also available by direct URL.

Detection coordinates are pixel positions of region or bounding-box centers. A cluster is a connected group of at least two detections whose centers are linked by distances at or below the close distance in inches, converted using the entered grid calibration. Group numbers and colors apply within each frame only. The timeline marks changes in the sorted group sizes (for example, `3+2` to `4+1`), not changes in individual fish membership. The spacing percentile compares each frame's mean nearest-neighbor distance with 399 reproducible uniform random placements of the same detection count inside the selected crop; it is a descriptive per-frame comparison, not a video-wide significance test. Average pair distance is calculated within each frame and averaged over frames with at least two detections. Distances are reported in approximate inches for either detection method. The application does not identify or track individual fish across time. If the linked Roboflow project has no trained browser-compatible version, use background mode or provide a different trained project and version.

The default confidence cutoff is 0.15 to help detect small fish. The progress line shows both the raw model box count and the kept fish count; if the raw count is still one, the model itself is missing the other fish in that frame.

When Roboflow mode is selected, the app begins preparing the model after a video is selected and keeps the browser worker alive for later analyses on the same page. Reloading the page still requires model initialization. Browser caching of downloaded assets depends on the browser and Roboflow response headers. Background mode needs no model download or key.

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
