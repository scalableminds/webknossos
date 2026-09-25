# Documentation screenshots

Generate documentation screenshots with Playwright against a **local** WEBKNOSSOS instance. Existing filenames and JPEG/PNG formats are preserved. Captures go into a review directory; a separate command applies them to the docs.

## Quick start

1. Run WEBKNOSSOS locally, including its datastore and tracingstore.
2. Make the **published `l4_sample`** available to that local instance, with its color and segmentation layers. Use a dedicated local documentation account with admin permissions. A dataset merely named `l4_sample` is not sufficient: the operator must ensure it is the published data. The runner verifies its name and available layers, not a voxel-data checksum.
3. Install Chrome and the repository's Yarn dependencies. No new npm dependencies are needed. Use the same Chrome executable/version for repeatable results; `--executable` or `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` selects it. The browser version is recorded in the report.
4. Export `WK_AUTH_TOKEN` for the **local** documentation account. It is added only to local API calls and page navigation, never as a blanket header to external datastores. Voxel requests from web workers retain the app’s normal data-token authentication and are not intercepted.
5. Copy `fixtures.example.json` to a local file and fill in the fixtures described below. Start with a viewer screenshot before setting up every admin/scientific scene.

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

Use `--organization scalable_minds` if that is the local owning organization, or `--dataset-id ID` to select the local record directly. The default organization is `sample_organization`. Only loopback application URLs are accepted. `--headed` shows the browser; `--browser-url http://localhost:9222` attaches to a browser you started. Each recipe still gets a fresh browser context. `--only id,id` captures a subset. `--output PATH` changes the review directory; pass the same option when applying.

## Coverage and one-time fixture setup

The catalog includes **all 131 image assets**, even unreferenced ones: **82 still screenshots** have recipes; **49 excluded images (including tool/modifier artwork and `datalayers.jpeg`), editable source assets, and GIF animations** have explicit exclusion reasons. This tool does not record animated GIFs or external videos. `assets.json` and the coverage checker prevent newly added images from silently escaping classification.

Most viewer and toolbar recipes prepare their own state using the frontend API. Skeleton examples use a deterministic illustrative tracing. The default scene is at `[3457, 3323, 1204]`, zoom `1`; override it through `fixtures.viewer`. Mesh recipes sample non-background segments around that position and wait for mesh loading. Data loading, fonts, and visible UI controls are awaited. Viewport and emulated screen are 1600×1000 at device scale 1; touch/mobile emulation is off, timezone is UTC and animations are disabled. Captures fail if mobile controls are visible. Only recipes explicitly setting `mobileControls: true` allow them.

Some screenshots inherently need local records or a scientifically meaningful annotated scene. They fail with an actionable prerequisite error rather than taking an unrelated screenshot. An unconfigured installation cannot regenerate every image successfully on its first run.

Admin fixtures:

| Setting / prerequisite | Used for |
| --- | --- |
| `userId` | Optional demonstration user; defaults to the authenticated account |
| `projectName` | Project with tasks exclusively on `l4_sample` |
| `taskId` | Assigned task on `l4_sample` |
| `nucleiJobId` | Existing nuclei/instance inference job on `l4_sample` |
| Open and archived `l4_sample` annotations | Annotation dashboards |
| Open tasks exclusively on `l4_sample` for the account | Task dashboard |
| Existing `l4_sample` jobs | Jobs table |
| A local featured publication containing only `l4_sample` datasets/annotations | Publications dashboard |
| Appropriate local feature flags and plan permissions | AI, team sharing, jobs, publications |
| `isWkorgInstance=false` | The self-hosted onboarding route |

Use demonstration users/team names because their visible values appear in the images. Admin recipes navigate existing records and open forms; they do not submit organizations, users, tasks, projects, or inference jobs. Annotation recipes create temporary annotations, then delete only those newly created annotations. The account's viewer preferences can be changed by the frontend API, hence the dedicated account. Interrupted runs can leave a temporary annotation behind; ordinary recipe failures run cleanup.

### Curated scenes

`fixtures.example.json` enumerates every scene requiring explicit configuration. These cover biological training examples, sampling examples, connectomes, blend modes, and dialogs that require specialized annotation state. For each entry, prepare an annotation on the local published `l4_sample`, set the desired camera/layers, and save its URL state. Fill in a short `description` explaining what the image demonstrates. Blank descriptions intentionally fail.

```json
{
  "scenes": {
    "docs/tutorials/images/tutorial_trainingdata_07_isolated_voxels.jpeg": {
      "description": "Reviewed example of deliberately isolated labeled voxels inside the training bounding box",
      "annotationId": "REPLACE_WITH_LOCAL_ANNOTATION_ID",
      "hash": {
        "position": [3457, 3323, 1204],
        "zoomStep": 1,
        "mode": "orthogonal"
      },
      "selector": "#screenshot_target_inputcatcher_PLANE_XY"
    }
  }
}
```

`annotationId` is optional for plain dataset views. If supplied, the runner verifies that the annotation belongs to the selected `l4_sample`. `hash` accepts the viewer's JSON URL state, including layer state, mappings, and meshes. Optional `hoverSelectors`, `clickSelectors`, and `clickTexts` are performed in that order, then `selector` chooses the capture target with surrounding padding. Omit `selector` for the full viewport. Use only non-destructive interactions for reusable curated annotations.

For the additive/cover examples, prepare suitable color layers on the local copy of `l4_sample`; blending a single color layer cannot demonstrate the difference. Biological defects and ground-truth examples need reviewed annotation content, not just a camera coordinate. When replacing the old scientific examples, update their accompanying Bosch/Briggman/Loomba attributions and explanatory labels in the same documentation change to match the new `l4_sample` examples. The tool does not automatically rewrite scientific claims or image credits.

## Review and failure behavior

`report.json` records the browser, dataset ID, successful outputs, and per-recipe failures. `index.html` shows before/after pairs and errors. The command exits unsuccessfully if any selected recipe fails, but keeps successful captures available for review. Apply copies only successful images from the latest report, verifies their hashes, and refuses to overwrite a docs image changed since capture. Failed images remain unchanged. Different-sized screenshots are allowed; crops follow elements rather than fixed screen coordinates.

Capture uses the real app UI. Missing selectors, disabled features, unavailable records, and server errors must be fixed instead of accepted as new baselines. The browser is isolated between recipes, but the local database fixtures are shared and should be kept stable. Run sequentially against the dedicated local account.

## Framing

Normal element captures include 48 pixels of surrounding UI; admin dialogs include 64. Tall dialogs expand the capture viewport so their footer remains visible. Context-menu recipes include the underlying viewport. Standalone toolbar icons keep tight crops. A recipe can return `{ target, context, padding }`, where `target` and optional `context` are Playwright locators or CSS selectors (context also accepts an array). Their combined bounds plus padding are clipped to the visible viewport. Set `padding: 0` explicitly for a tight capture.

## Maintaining recipes

- `viewer.mjs`: viewer, annotation, mesh, toolbar, and curated-scene recipes.
- `admin.mjs`: dashboard, dataset settings, users, tasks, jobs, onboarding.
- `assets.json`: complete image classification, with reasons for exclusions.
- `run.mjs`: browser lifecycle, dataset resolution, authenticated requests, capture, cleanup.
- `core.mjs`: gallery and guarded apply operation.

Add one recipe per still screenshot with a unique ID and existing output path, then run:

```sh
yarn docs:screenshots:check
yarn docs:screenshots:test
yarn biome check tools/docs-screenshots
```

The coverage/unit checks run without Chrome or a local server. They check inventory/reference coverage and safe apply behavior; they do not establish that live UI selectors work. Verify changed recipes against the running local app before applying their results.

To exercise authentication and worker fetches in real Chrome, run `DOCS_SCREENSHOTS_BROWSER_TEST=1 node --test tools/docs-screenshots/browser.test.mjs`. Failed captures also record the page URL, initialization message, browser/request errors, queue state, and a diagnostic PNG in the review directory.

Failed Playwright runs also save `trace-<recipe-id>.zip`. Inspect one with `yarn playwright-core show-trace .docs-screenshots/trace-<recipe-id>.zip` to see the action log, DOM snapshots and network events. The runner uses native Playwright locators for visible controls and element captures. It creates temporary annotations for skeleton recipes too, avoiding sandbox-only API errors while naming trees.
