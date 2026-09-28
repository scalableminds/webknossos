# Documentation screenshots

Generate documentation screenshots with Playwright against a **local** WEBKNOSSOS instance. Existing filenames and JPEG/PNG formats are preserved. Captures go into a review directory; a separate command applies them to the docs.

## Quick start

1. Run WEBKNOSSOS locally, including its datastore and tracingstore.
2. Make the documentation dataset **`l4dense_motta_et_al_demo_v2`** available to that local instance. The dev setup's initial data inserts it as a remote dataset (see `InitialDataController.scala`); reading its S3 buckets requires matching `datastore.dataVaults.credentials`. Use a dedicated local documentation account with admin permissions. The runner verifies the dataset's name and available layers, not a voxel-data checksum.
3. Install Chrome and the repository's Yarn dependencies. No new npm dependencies are needed. Use the same Chrome executable/version for repeatable results; `--executable` or `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` selects it. The browser version is recorded in the report.
4. Export `WK_AUTH_TOKEN` for the **local** documentation account. It is added only to local API calls and page navigation, never as a blanket header to external datastores. Voxel requests from web workers retain the app’s normal data-token authentication and are not intercepted.
5. `fixtures.default.json` is always loaded and holds the portable fixtures: dataset, default viewer scene and curated scenes that need no local records. For instance-specific records, copy `fixtures.example.json` to a local file, fill it in and pass it with `--fixtures`; its keys override the defaults (`viewer` and `scenes` are merged per key). Start with a viewer screenshot before setting up every admin/scientific scene.

```sh
# List recipe IDs and check exhaustive image coverage (no server required).
yarn docs:screenshots --list
yarn docs:screenshots:check

# Capture one basic viewer screenshot first.
yarn docs:screenshots --only images-main_ui-png --base-url http://localhost:9000

# Capture all screenshots using the reusable local fixtures.
yarn docs:screenshots --fixtures /absolute/path/to/fixtures.json

# Inspect .docs-screenshots/index.html, then apply successful captures.
yarn docs:screenshots:apply
```

Use `--organization scalable_minds` if that is the local owning organization, set `dataset` in a fixtures file to use another dataset name, or `--dataset-id ID` to select the local record directly. The default organization is `sample_organization`. Only loopback application URLs are accepted. `--headed` shows the browser; `--browser-url http://localhost:9222` attaches to a browser you started. Each recipe still gets a fresh browser context. `--only id,id` captures a subset. `--output PATH` changes the review directory; pass the same option when applying.

## Coverage and one-time fixture setup

The catalog includes **all 129 image assets**, even unreferenced ones: **70 still screenshots** have recipes; **59 excluded images (including tool/modifier artwork, `datalayers.jpeg`, the blend-mode examples and, for now, the training-data tutorial images in `docs/tutorials/images/`), editable source assets, and GIF animations** have explicit exclusion reasons. This tool does not record animated GIFs or external videos. `assets.json` and the coverage checker prevent newly added images from silently escaping classification.

Most viewer and toolbar recipes prepare their own state using the frontend API. Skeleton examples load the agglomerate skeletons of the configured mesh segments. The default scene, `fixtures.viewer`, is the viewer's JSON URL state: position `[2827, 4498, 1792]`, zoom `1`, the `predictions` layer hidden, the `agglomerate_view_65` mapping active and the precomputed meshes (`meshfile_4-4-2`) of agglomerates 415 and 128501 loaded, close to the original screenshots. Recipes wait until all configured meshes have loaded. Without configured meshes, mesh recipes compute ad-hoc meshes for segments around the position instead. Data loading, fonts, and visible UI controls are awaited. Viewport and emulated screen are 1600×1000 at device scale 1; touch/mobile emulation is off, timezone is UTC and animations are disabled. Captures fail if mobile controls are visible. Only recipes explicitly setting `mobileControls: true` allow them.

Some screenshots inherently need local records or a scientifically meaningful annotated scene. They fail with an actionable prerequisite error rather than taking an unrelated screenshot. An unconfigured installation cannot regenerate every image successfully on its first run.

Admin fixtures: `setup-fixtures.mjs` creates the records the public API supports and writes their IDs to `.docs-screenshots/fixtures.local.json`. It is re-runnable and reuses existing records:

```sh
WK_AUTH_TOKEN=... node tools/docs-screenshots/setup-fixtures.mjs
yarn docs:screenshots --fixtures .docs-screenshots/fixtures.local.json
```

| Setting / prerequisite | Used for | Created by the setup script |
| --- | --- | --- |
| `userId` | Optional demonstration user; defaults to the authenticated account | – |
| `projectName` | Project with tasks exclusively on the documentation dataset | yes (`DocumentationL4dense`) |
| `taskId` | Task on the documentation dataset, assigned to the account | yes |
| Archived annotation on the documentation dataset | Archive dashboard | yes |
| At least one open task on the documentation dataset | Task dashboards (other open tasks may appear too) | yes |
| `nucleiJobId` | Existing nuclei/instance inference job on the documentation dataset | no API without running a job |
| Existing jobs on the documentation dataset | Jobs table | no API without running a job |
| A featured publication containing the documentation dataset | Publications dashboards | no; the dev setup's initial data links it to the Motta et al. 2019 publication |
| Appropriate local feature flags and plan permissions | AI, team sharing, jobs, publications | – |

The onboarding recipes present the local instance as self-hosted (`isWkorgInstance=false`) to their own browser context by rewriting the `/api/features` response, so they work regardless of the server configuration.

Use demonstration users/team names because their visible values appear in the images. Admin recipes navigate existing records and open forms; they do not submit organizations, users, tasks, projects, or inference jobs. Annotation recipes create temporary annotations, then delete only those newly created annotations. The account's viewer preferences can be changed by the frontend API, hence the dedicated account. Interrupted runs can leave a temporary annotation behind; ordinary recipe failures run cleanup.

### Curated scenes

Curated scenes capture a stored viewer state. `fixtures.default.json` configures the connectome viewer, which only needs URL state; a local fixtures file can add or override scenes. Fill in a short `description` explaining what the image demonstrates. Blank descriptions intentionally fail.

```json
{
  "scenes": {
    "docs/images/connectome_viewer.jpeg": {
      "description": "Synapses of agglomerate 97086 listed in the Connectome tab",
      "annotationId": "OPTIONAL_LOCAL_ANNOTATION_ID",
      "hash": { "position": [2850, 4318, 1770], "zoomStep": 1.3, "mode": "orthogonal" },
      "clickTexts": ["Connectome"]
    }
  }
}
```

`annotationId` is optional for plain dataset views. If supplied, the runner verifies that the annotation belongs to the documentation dataset. `hash` accepts the viewer's JSON URL state, including layer state, mappings, and meshes. Optional `hoverSelectors`, `clickSelectors`, and `clickTexts` are performed in that order, then `selector` chooses the capture target with surrounding padding. Omit `selector` for the full viewport. Optional `highlights` accepts CSS selectors or `{ "target": "CSS selector" }` objects for editorial callouts. Use only non-destructive interactions for reusable curated annotations.

Scenes that only need UI state have dedicated recipes in `viewer.mjs` instead: the box-sampling examples generate deterministic bounding boxes in a temporary annotation, and the merger-mode and materialize images open the real dialogs and menus. The hand-drawn callouts of the original box-sampling images are not reproduced. When replacing the old scientific examples, update their accompanying attributions and explanatory labels in the same documentation change. The tool does not automatically rewrite scientific claims or image credits.

## Review and failure behavior

`report.json` records the browser, dataset ID, successful outputs, and per-recipe failures. `index.html` shows before/after pairs and errors. The command exits unsuccessfully if any selected recipe fails, but keeps successful captures available for review. Apply copies only successful images from the latest report, verifies their hashes, and refuses to overwrite a docs image changed since capture. Failed images remain unchanged. Different-sized screenshots are allowed; crops follow elements rather than fixed screen coordinates.

Capture uses the real app UI. Missing selectors, disabled features, unavailable records, and server errors must be fixed instead of accepted as new baselines. The browser is isolated between recipes, but the local database fixtures are shared and should be kept stable. `index.html` has a header with the number of captured, succeeded, failed and excluded images and filters for each; excluded images are listed with their reason and current image. Run sequentially against the dedicated local account.

## Framing

Normal element captures include 48 pixels of surrounding UI; admin dialogs include 64. Tall dialogs expand the capture viewport so their footer remains visible. Context-menu recipes include the underlying viewport. Standalone toolbar icons keep tight crops. A recipe can return `{ target, context, padding }`, where `target` and optional `context` are Playwright locators or CSS selectors (context also accepts an array). Their combined bounds plus padding are clipped to the visible viewport. Set `padding: 0` explicitly for a tight capture.

Preserve editorial callouts with `highlights: [locator]` in the capture descriptor. Red outlines are anchored to the live elements after animations and layout settle; they add no layout changes and are removed after capture. All highlights use red, including legacy fixtures that specify another color. Highlight targets must be fully visible; missing or clipped targets fail rather than silently losing emphasis. Use `target: null` to highlight a full-viewport capture. Prefer highlighting a specific control within its broader panel over outlining the entire screenshot.

Labeled `regions` explain a UI layout, as in `user_interface.png`: each region takes a `target` (one or several locators, combined into one box), a `color`, a large `label` and optional sub-`labels` (`{ target, text }`). The region gets a thick colored frame and a whitened background.

## Maintaining recipes

- `viewer.mjs`: viewer, annotation, mesh, toolbar, and curated-scene recipes.
- `admin.mjs`: dashboard, dataset settings, users, tasks, jobs, onboarding.
- `assets.json`: complete image classification, with reasons for exclusions.
- `run.mjs`: browser lifecycle, dataset resolution, authenticated requests, capture, cleanup.
- `core.mjs`: gallery and guarded apply operation.
- `setup-fixtures.mjs`: creates the local admin records and writes `.docs-screenshots/fixtures.local.json`.

Add one recipe per still screenshot with a unique ID and existing output path, then run:

```sh
yarn docs:screenshots:check
yarn docs:screenshots:test
yarn biome check tools/docs-screenshots
```

The coverage/unit checks run without Chrome or a local server. They check inventory/reference coverage and safe apply behavior; they do not establish that live UI selectors work. Verify changed recipes against the running local app before applying their results.

To exercise authentication and worker fetches in real Chrome, run `DOCS_SCREENSHOTS_BROWSER_TEST=1 node --test tools/docs-screenshots/browser.test.mjs`. Failed captures also record the page URL, initialization message, browser/request errors, queue state, and a diagnostic PNG in the review directory.

Failed Playwright runs also save `trace-<recipe-id>.zip`. Inspect one with `yarn playwright-core show-trace .docs-screenshots/trace-<recipe-id>.zip` to see the action log, DOM snapshots and network events. The runner uses native Playwright locators for visible controls and element captures. It creates temporary annotations for skeleton recipes too, avoiding sandbox-only API errors while naming trees.

### Optional browser frame

Use `--browser-frame generic` to add a neutral browser tab and address bar around each capture; the default is `--browser-frame none`. This is a deterministic generic frame, not native Chrome chrome. It preserves the captured pixels without scaling and displays only the local server origin, omitting annotation IDs, URL hashes, and tokens. The report records the frame mode.

```sh
yarn docs:screenshots --only images-main_ui-png --browser-frame generic --output .docs-screenshots/framed
```
