# Documentation screenshots

Regenerates the screenshots in `docs/` with Playwright against a **local** WEBKNOSSOS instance. Captures land in a review directory (`.docs-screenshots/`); a separate command copies them into the docs. Existing filenames and image formats are kept. Image filenames must be unique across all docs subdirectories.

## Quick start

Prerequisites: WEBKNOSSOS running locally (incl. datastore and tracingstore) with the dev setup's initial data, which includes the documentation dataset `l4dense_motta_et_al_demo_v2` (reading its S3 buckets requires matching `datastore.dataVaults.credentials`), and a local Chrome.

```sh
# Check image coverage and run the unit tests (no server needed).
yarn docs:screenshots:check
yarn docs:screenshots:test

# Create the local records (teams, task, annotations, …) the admin screenshots need. Re-runnable.
WK_AUTH_TOKEN=secretSampleUserToken node tools/docs-screenshots/setup-fixtures.mjs

# Capture all screenshots, or a subset with --only id,id (list IDs with --list).
WK_AUTH_TOKEN=secretSampleUserToken yarn docs:screenshots --fixtures .docs-screenshots/fixtures.local.json

# Review .docs-screenshots/index.html, then copy the successful captures into docs/.
yarn docs:screenshots:apply
```

Further options: `--organization`, `--dataset-id`, `--base-url` (loopback only), `--headed`, `--executable` (Chrome path), `--browser-url http://localhost:9222` (attach to a running browser), `--output PATH` (pass it to apply as well), `--diff-threshold`, `--browser-frame generic` (adds a neutral browser frame). See `run.mjs`.

## Adding or changing a screenshot

Every image under `docs/` is listed in `assets.json`: it either has a recipe or an exclusion reason (GIFs, icons, artwork, …). `yarn docs:screenshots:check` fails for unclassified images. To add a screenshot, add a recipe (dataset, position, zoom, UI state, crop) to `viewer.mjs` or `admin.mjs` — in practice, ask a coding agent to do it, e.g. "add a recipe for `docs/images/foo.jpeg` using dataset L4, focused on segment 123". Then capture it with `--only` and check the result in `index.html`.

## Review and apply

`index.html` shows old/new pairs, errors, and excluded images. Each capture is diffed against the current docs image; the "Changed" filter lists captures where at least `--diff-threshold` percent (default 3) of the pixels differ. The run fails if any recipe fails but keeps successful captures. Apply only copies successful captures and refuses to overwrite docs images that changed since capture.

Failures are meant to be fixed, not accepted: recipes that need local records or features fail with a prerequisite error rather than capturing something unrelated. Failed captures save a diagnostic PNG and a Playwright trace (`yarn playwright-core show-trace .docs-screenshots/trace-<recipe-id>.zip`).

## Reference

### Capture environment

1600×1000 viewport at device scale 1, UTC, no animations, light theme (applied to the capture's browser context only, the account is not changed). The default viewer scene (`viewer` in `fixtures.default.json`) loads the `agglomerate_view_65` mapping and the meshes of agglomerates 415 and 128501. Recipes create temporary annotations and delete them afterwards; admin recipes open forms but never submit them. Use a dedicated local account, since the frontend API may change its viewer settings.

### Fixtures

`fixtures.default.json` holds the portable fixtures and is always loaded. `--fixtures FILE` overrides its keys (`viewer` and `scenes` are merged per key); `setup-fixtures.mjs` writes such a file. Some records cannot be created through the API:

| Prerequisite | Used for |
| --- | --- |
| `nucleiJobId` / existing jobs on the documentation dataset | AI and jobs screenshots |
| Jobs enabled (`yarn enable-jobs`, then restart) | Jobs, AI |
| Featured publication with the documentation dataset (part of the initial data) | Publications dashboard |
| Matching feature flags and plan permissions | AI, team sharing, publications |

### Curated scenes

`scenes` in a fixtures file capture a stored viewer state, keyed by output path:

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

`description` is required. `hash` is the viewer's JSON URL state. Optional `hoverSelectors`, `clickSelectors` and `clickTexts` run in that order; `selector` picks the capture target (default: full viewport); `highlights` adds red outlines.

### Capture descriptors

A recipe returns `{ target, context, padding }` (Playwright locators or CSS selectors; default padding 48 px, 64 px for admin dialogs; `padding: 0` for tight crops) plus optional annotations:

- `highlights: [locator]` – red outlines around live elements; `target: null` highlights a full-viewport capture.
- `regions` – labeled, colored frames explaining a layout, as in `user_interface.png`.
- `callouts` – red text boxes with curved arrows (`text`, `at: { x, y, width }`, optional `arrowTo`), as in the box-sampling images.

### Files

- `viewer.mjs` / `admin.mjs`: recipes
- `assets.json`: image classification
- `run.mjs`: browser lifecycle, auth, capture, cleanup
- `core.mjs`: gallery, image diff, apply
- `inventory.mjs`: coverage check
- `setup-fixtures.mjs`: creates local records

`DOCS_SCREENSHOTS_BROWSER_TEST=1 node --test tools/docs-screenshots/browser.test.mjs` tests authentication and worker fetches in real Chrome.
