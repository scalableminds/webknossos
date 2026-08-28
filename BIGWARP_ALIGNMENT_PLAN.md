# BigWarp-style Dataset Alignment for WEBKNOSSOS — Design Doc & Implementation Plan

Branch: `live-warp` (currently just a spike/demo, not production code)
Owner: Michael Büßemeyer
Last updated: 2026-08-28 (v2 — architecture decided interactively with Michael + Notion doc content pulled in)

> **Purpose of this file**: this feature spans multiple sessions and a lot of context
> (old spike code, related PRs/issues, an external design doc). Context gets
> compacted, so this file is the durable memory: what the feature is, what already
> exists, what's hacky/broken, what's decided, and what's still open. Edit it freely —
> it's a living doc, not something regenerated from scratch each session.

---

## 1. The idea (in one paragraph)

Give users a [BigWarp](https://imagej.net/plugins/bigwarp)-like workflow for manually
registering two (mis-)aligned layers of a dataset, but in WEBKNOSSOS style. Two
annotation views of the same dataset are shown side by side (as iframes), each
showing only one of the two layers to align. The user navigates each side
independently, finds a matching structure, and drops a single-node skeleton tree
("landmark") at that spot in both views. Once ≥4 non-coplanar landmark pairs exist,
pressing a shortcut computes a transform (affine now, TPS later) from the moving
layer's landmarks to the fixed layer's landmarks and live-applies it to both iframes,
so the user visually sees layer B snap onto layer A. Iterate, refine, and once happy,
persist the transform as the layer's new default (reusing the storage mechanism from
PR #9591, "Live transforms via landmarks").

This is explicitly a **feedback-collecting demo/spike**, not a polished feature yet.

### Terminology (BigWarp naming, used throughout this doc)
- **Fixed layer** — the reference layer that doesn't move (BigWarp's "target" image). Left iframe.
- **Moving layer** — the layer that gets warped to match the fixed layer (BigWarp's "moving image"). Right iframe.
- **Landmark** — a single-node skeleton tree marking a point that should match between the two layers.
- **Correspondence** — a pair of landmarks (one per side) believed to be the same physical point.
- **Coordinator** — the outer, near-headless WK instance that owns and persists the one real "landmark annotation" (see §3).
- **Worker** — one of the two sandboxed, non-saving iframe WK instances the user actually clicks landmarks in (see §3).

---

## 2. Reference material

- **BigWarp docs**: https://imagej.net/plugins/bigwarp — general plugin docs (dual BigDataViewer windows + landmark table, TPS/Affine/Similarity/Rotation/Translation transform models). Some of its documented shortcuts (Q/W/E/Ctrl+D) are from a version/workflow that doesn't match what Michael actually observed in hands-on use — **defer to §2.1 below for the shortcuts to actually copy.**

- **PR #9082 — "\[Hackathon Prototype] Live warp"** (github.com/scalableminds/webknossos/pull/9082, **CLOSED**): this *is* the `live-warp` branch itself (its `headRefName` is `live-warp`) — not a separate spike, just the PR wrapper around the code already described in §4. Its description has a "Next Steps" TODO list worth keeping:
  - Allow easier setup: select a dataset with 2 layers to align (today: hardcoded).
  - **Attach a skeleton layer to a specific transformation/coordinate system** — the PR author's own words: *"we need a skeleton layer A in the coordinate system of layer A and a skeleton layer B for the coordinate system of layer B. In the prototype, I hacked this together by creating two datasets A and B (DS A has transforms T in layer A, and DS B has the inverse transforms T_inv in layer B). We need a better way for this though... allow to define the coordinate system for the skeleton layer separately (needs to be stored in the annotation)"* → links to **issue #7270**, see below. **This is the crux of "which layer does a side's landmarks live in" and is not yet solved anywhere in WK.**
  - More UI: highlight high-error landmark pairs, allow disabling/deleting individual pairs, display node/tree ids, general polish.

- **Issue #7270 — "Coordinate Systems for Annotation Layers"** (github.com/scalableminds/webknossos/issues/7270, **OPEN**, unrelated to this branch, pre-existing platform gap): *"layers cannot simply reuse existing transformations within that dataset (they need to be duplicated). Additionally, annotation layers cannot freely choose from existing transformations (instead, they have no transformation as long as they are not a segmentation-fallback-layer)."* This is why PR #9082's original hackathon prototype needed two duplicate datasets, and why the spike's `dataset_layer_transformation_accessor.ts` edit (§8) exists as a hand-rolled workaround attempt. **Update, resolved this session: this is NOT actually a blocker for this feature.** Worked out with Michael in detail — see §3's "Layer choice per side" for the mechanism (each worker permanently pins its *own* dominant layer as `nativelyRenderedLayerName`, so the shared skeleton layer trivially and correctly inherits identity rendering per-worker via existing, unmodified WK logic; no per-node coordinate-system tagging is ever needed). #7270 remains a real, worthwhile general platform gap — just not one this feature needs solved.

- **PR #9591 — "Live transforms via landmarks"** (github.com/scalableminds/webknossos/pull/9591, **OPEN**, not merged, not locally checked out): a *different but overlapping* feature — single-annotation landmark-based affine transforms + backend persistence. See §6 for the deep-dive — its persistence path (`getDataset` + `updateDatasetPartial`) and transform-composition helpers should be reused regardless of whether/when that PR itself merges.

- **Notion design doc**: https://app.notion.com/p/scalableminds/Design-Doc-Bring-BigWarp-to-WK-3c2b51644c6380c69ec8ccb95e441426 — **now fetchable** via the `ntn` CLI (Michael's Notion CLI integration, authenticated to the `scalableminds` workspace; re-fetch with `ntn pages get 3c2b51644c6380c69ec8ccb95e441426` if this summary ever needs double-checking against edits). Key content, folded in below:
  - BigWarp opens two datasets and orients them simultaneously; left = moving, right = target (**note**: this is the *opposite* left/right convention from §1 above, which follows the spike code's `layerName1`(left)=fixed / `layerName2`(right)=moving. **Not yet reconciled — pick one and be consistent, see open questions §8.**).
  - **§2.1 Shortcuts actually worth copying** (from Michael's own field notes, sourced from watching a BigWarp usage video — treat as more authoritative than the generic imagej.net doc for what to replicate):
    - `t` — apply the transform from currently-clicked landmarks.
    - `f` — toggle showing the other layer, **scoped to whichever view tab currently has focus** (this is the precise spec for the "per-focused-iframe toggle" from the original ask — confirms `toggleShowBoth`'s current global behavior needs to become focus-scoped).
    - `q` — sync the *other* view's position/orientation/zoom to match the currently-active one.
    - Toggle between "landmark clicking mode" and "navigation mode" (maps to WK's `newNodeNewTree` + normal move-tool switching).
  - **General problem called out explicitly**: *"If the landmarks/nodes are only in a single slice, stretch across the 3rd dimension might happen. We should encourage/nudge the user to click points in different slices for a more accurate transformation."* — directly matches the "reject coplanar landmarks" decision in §8/§9.
  - **Core architectural question the doc poses, "How to sync both tabs?"** — it lays out the same options this session converged on independently:
    - **(A) One annotation**:
      - A.1 — rely on live-collab auto-sync. Rejected in the doc: *"no skeleton support yet"* at time of writing (2026-08-20). Worth a quick sanity check some day (live-collab skeleton support may have moved since — Michael has been actively building on it, see `[[live-collab-rebase-update-actions-9052]]`), but **not reopening this now** — A.2 was already chosen independently in this session before this doc was even read, for the same reasons.
      - **A.2 — coordinator/worker ("master/slave"): "the right side is not allowed to save. But changes to its skeleton are detected and copied over to the left side which can still edit and saves this to the annotation. Both tabs show the same annotation."** Marked **"First option to test!"** in the doc. **→ This is the architecture decided on in §3.**
      - *"Simply comparing the difference between the skeleton might solve the things that complicated the spike"* — i.e. diffing, not order-based zipping. Matches §7.2.
    - **(B) Two annotations, synced regularly** — rejected: *"When I want to return to a bigwarp annotation → one annotation needs a reference to the respective other annotation → con: 'metadata maintenance'."* Same reasoning independently reached in this session.
  - A rough mockup (saved locally at `docs/bigwarp_assets/notion_mockup.png` since the Notion-hosted image is a 1-hour signed S3 URL — re-export from Notion if it needs updating): just a shared navbar over two full-width, edge-to-edge iframes. No sidebar drawn — the collapsible left drawer for the coordinator's tool UI (§5.2) is a deliberate addition beyond this mock, not a contradiction of it.
  - *"BigWarp should be a feature in WK and not as a separate service accessing WK from outside... The WK instances should be \[in an] iframe to have them individually have a viewing state"* — matches the existing spike approach, no change needed.

---

## 3. Architecture decision: one shared annotation, coordinator + two workers

**This supersedes the "two independent annotations" framing from v1 of this doc.**
Confirmed with Michael and independently corroborated by the Notion doc's own "A.2, first
option to test" recommendation.

- There is exactly **one persisted "landmark annotation" per dataset** (a normal,
  skeleton-only annotation — shows up in the annotations list like any other; a visual
  tag marking it as a landmark annotation is a nice-to-have polish item, not v1).
- The **outer `/align-datasets` page ("coordinator")** is not a bare React shell
  anymore (as the current spike is) — it becomes a real WK annotation-hosting instance
  bound to that landmark annotation: real Store, real sagas, real save-queue. It is
  **near-headless**: it always shows the normal WK **navbar**, but **never renders a
  data/3D viewport** — the only visualization of dataset content happens in the two
  iframes. Its own UI is a **collapsible left drawer** (hidden by default, reopenable,
  same interaction pattern as WK's existing left settings sidebar) hosting the
  alignment tool: the correspondence table, align/reset controls, etc.
- The **two iframes ("workers")** each load the *same* landmark annotation ID, but in
  a mode where `allowUpdate = true` and `allowSave = false` — i.e. WK's existing
  **sandbox** concept (`RestrictionsAndSettings.allowSave`, see §7.1), which already
  supports exactly "can edit locally, can't persist." The user freely places landmarks
  in each worker; those edits never touch the backend and never auto-sync between the
  two workers or to the coordinator in real time.
- **Sync direction, chosen explicitly**: coordinator polls each worker's current
  skeleton state (still via NML export/parse — see §7.2, kept for v1), diffs it
  against what it last saw for that worker, and applies the resulting changes to its
  own (persisted) copy of the landmark annotation — tagged internally by which worker
  they came from. The workers never need to know about each other or about the
  coordinator's storage — they're dumb, disposable scratchpads.
- **Reload / resuming a previous session**: rather than generalizing "sandbox mode" to
  load one *specific existing* annotation with save forced off (a real platform gap,
  see §7.1), each worker loads a **fresh, empty, non-savable annotation** every time,
  and the coordinator **pushes** the previously-known landmarks for that side into it
  right after load, reusing the existing `importNml`/`importNmlAsString` cross-origin
  API call that's already wired (`cross_origin_api.ts:86-106`). This is simpler than
  it sounds precisely because it avoids needing "sandbox-load-existing-annotation" to
  exist at all.
- **Data model for landmarks inside the one landmark annotation** — nested tree
  groups, agreed with Michael as:
  ```
  MISSING_GROUP_ID (-1, WK's existing "no group"/root sentinel)
    └─ group: "Layer pair: <fixed layer name> × <moving layer name>"
         ├─ group: "<fixed layer name> landmarks"   (all left/worker-1 nodes)
         └─ group: "<moving layer name> landmarks"  (all right/worker-2 nodes)
  ```
  This intentionally supports **multiple layer pairs coexisting later** (a dataset
  with >2 layers might eventually want several alignment attempts, each its own
  top-level pair-group) — **but for v1, only build the data model shape, not the
  UI/functionality to create or switch between multiple pairs.** One pair only for
  now. Landmarks from a different layer-pair combination are meaningless together
  (nodes reference a coordinate space tied to one specific layer) and must never be
  mixed across pair-groups.
  - **These groups are internal bookkeeping only — never exposed as user-editable
    group structure.** Michael's reasoning, worth keeping verbatim: *"moving trees
    from one \[group] to another iframe would be very strange as it does not make
    sense, as in the other iframe a different layer is used which the nodes
    reference."* The user only ever interacts with the paired correspondence table in
    the coordinator's drawer, never raw tree groups.
- **Layer choice per side — mixed ownership, agreed explicitly, mechanism worked out
  this session**: the **coordinator** decides which dataset layer is "dominant" per
  side and pushes that down into each worker once, on load. **Workers may still open
  their own normal layer-settings tab** to tweak *cosmetic* things (color, histogram,
  manually toggling a layer's own visibility) — but never which layer the landmarks
  reference; that's coordinator-owned.
  - **The mechanism**: each worker sets `state.datasetConfiguration.nativelyRenderedLayerName`
    to *its own* dominant layer, permanently, for the life of that worker session
    (worker A → layer A, worker B → layer B). This is an ordinary, already-existing
    per-view setting (`updateDatasetSettingAction`) — nothing new to build. Consequence:
    each worker's landmark nodes are *always* created and stored in that worker's own
    dominant layer's native/raw coordinate frame, and — because the skeleton layer has
    no transform config of its own and therefore inherits "render natively relative to
    whichever layer is pinned" via the existing (unmodified)
    `dataset_layer_transformation_accessor.ts` logic — they **never need to be moved or
    re-projected, ever**, no matter how many times the layer-B→layer-A transform gets
    (re)computed. This is simpler than PR #9591's approach (§6), which *does* need to
    force-move nodes (`forceOverwrite`) because it only has one shared view and one
    `nativelyRenderedLayerName` choice to reconcile both sides through. We get to skip
    that entirely by having two independently-configurable workers.
  - **The transform itself** (mapping raw layer-B points → raw layer-A points) is
    computed exactly as the current spike already does: feed both sides' raw
    (`untransformedPosition`) points straight into `estimateAffineMatrix4x4`, set the
    result as layer B's `coordinateTransformations` in both iframes. No node
    repositioning needed for this to work — the transform is purely a
    layer-level rendering/persistence artifact, decoupled from landmark storage.
  - **Accepted tradeoff, confirmed with Michael**: since A-side and B-side landmark
    nodes permanently live in two different raw frames (distinguished only by which
    internal tree-group they're in, §3's group hierarchy), opening the persisted
    landmark annotation in a *normal* WK view (outside this tool) would render one
    side's dots correctly and the other side's scattered/wrong — a normal view can
    only pin one native layer at a time. **This is fine**: the landmark annotation is
    tool-only bookkeeping data, not meant to be browsed normally. A visual tag/warning
    for this is a nice-to-have polish item (§10), not v1.
  - **Consequence for the spike's suspicious accessor edit (§8)**: re-traced the
    control flow of `_getTransformsForLayerThatDoesNotSupportTransformationConfigOrNull`
    and the removed `nativelyRenderedLayerName != null &&` guard was already
    unreachable-when-false given how the function is structured (the preceding
    `if (nativelyRenderedLayerName == null)` branch always returns). The edit is very
    likely inert — a leftover from an abandoned refactor (the dead commented-out
    duplicate right below it in the diff is probably that abandoned attempt) — safe to
    just drop entirely during cleanup rather than something to puzzle over or preserve.

- **Deferred to v2, recorded now per Michael's request: cross-worker read-only
  landmark visibility.** Michael's original ask (§1) only specified the paired
  comparison happening in the coordinator's sidebar table (already exists, §4.1) — but
  he'd like to also see the *other* side's landmarks live, in-scene, inside each
  worker (read-only, visually distinct e.g. by color), so alignment quality is visible
  directly on the canvas, not just in a table. This is valuable but was explicitly
  deferred past v1 to avoid complicating the core loop before it even works. **Design
  for whenever it's picked up**, so it doesn't need to be re-derived:
  - Keep this entirely separate from the canonical data model above — the
    coordinator's persisted, per-side-raw-frame landmark storage does **not** change.
  - Additively, whenever a transform is (re)computed, the coordinator computes a
    "ghost" copy of the *other* side's raw points run through the current transform
    (forward `T_B` for a B-ghost shown in worker A's frame; `invert(T_B)` for an
    A-ghost shown in worker B's frame) and pushes them into a separate, visually
    distinct tree/group in that worker (reusing the existing `importNml`/
    `importNmlAsString` cross-origin call, or a small dedicated new command if NML
    round-tripping proves too clumsy for frequent updates).
  - Re-push on every recompute so ghosts track the current transform — there's no
    incremental "move by delta" needed (unlike PR #9591's `forceOverwrite`/
    `LandmarkPositionStore`), since ghosts are just recomputed from the coordinator's
    canonical raw data + current transform each time, not persisted/mutated in place.
  - **Open sub-question for that point**: whether WK supports actually locking a
    specific tree/group from user edits, or whether "read-only" would have to be
    convention-only (distinct color + user education) for a first pass — not checked
    yet, no need to check until this is picked up.

### Why this is more feasible than it sounds (existing primitives found this session)
1. **`allowUpdate`/`allowSave` split already exists** (`types/api_types.ts:383-387`,
   comment literally says *"allowSave might be false even though allowUpdate ... are
   true (e.g., see sandbox annotations)"*), and WK already has a sandbox route
   (`/datasets/:datasetNameAndId/sandbox/:type`, `ControlModeEnum.SANDBOX`,
   `router.tsx:409`). Gap: today it only ever creates a **fresh** tracing, not "load
   this existing annotation ID with save forced off" — hence the "push landmarks into
   a fresh sandbox via the iframe API" design above, which sidesteps needing that
   generalization.
2. **State → diff → actions already exists**: `diffTrees`/`diffSkeletonTracing`
   (`viewer/model/sagas/skeletontracing_saga.ts:676-790`) is a pure generator over two
   `TreeMap`s → `UpdateAction[]`. No running saga context needed — just two tree maps
   (e.g. "last known trees for worker N" vs. "trees just polled from worker N").
3. **Actions → state already exists**: `applySkeletonUpdateActionsFromServer()`
   (`viewer/model/reducers/update_action_application/skeleton.ts:33`) applies a list
   of `UpdateAction`s to tracing state. Between this and `diffTrees`, the *entire*
   round trip (worker state → actions → coordinator state) already exists on master —
   no new low-level machinery needed, just new orchestration/glue code in the
   coordinator.
4. **Checked and ruled out**: `tryToIncorporateActions`
   (`viewer/model/sagas/saving/rebasing/incorporate_update_actions_sagas.tsx:65`,
   already merged to master from the live-collab work) is a poor fit — it operates on
   `APIUpdateActionBatch[]`, i.e. actions with real backend version numbers, meant for
   rebasing onto *another user's server-persisted* edits on the same annotation.
   Worker edits never touch the backend, so there's no version history to rebase
   against. Plain `diffTrees` + `applySkeletonUpdateActionsFromServer` is the
   right-sized tool.

---

## 4. Current state of the `live-warp` branch (the code as it exists today)

Commits (`master..live-warp`, oldest first):
```
23a3e3532f [wip] dual pane iframe view
faf1dfb463 add missing view
58caea78b3 use both iframes and create transform with the existing trees
6924c4f1f8 wip
6fe7c4ccc2 first working version of iterative landmark alignment
f8d901aadb add more functionality to sidebar
906195c4e6 iterate
f095437e18 Merge branch 'master' ... into live-warp
20a59d209b format
```

Files touched (diff vs merge-base `4a8b396c94`):
- `frontend/javascripts/viewer/view/layouting/align_datasets_view.tsx` — **new file, the whole feature**, 307 lines. Everything below in this section describes this file unless noted.
- `frontend/javascripts/router/router.tsx` — registers `/align-datasets` route, adds `height: 100%` to the root `<Layout>`.
- `frontend/javascripts/viewer/api/api_latest.ts` — adds `TracingApi.exportTreesAsNmlString()`, `DataApi.getTransformsForLayer()`, `DataApi.setLayerVisibility()`.
- `frontend/javascripts/viewer/api/cross_origin_api.ts` — exposes the above three plus `getCameraPosition`/`centerPositionAnimated`/`setAffineLayerTransforms` over the **pre-existing** cross-window postMessage bridge (this bridge itself is *not new* — it's WK's existing mechanism for embedding an annotation in a third-party page).
- `frontend/javascripts/viewer/model/accessors/dataset_layer_transformation_accessor.ts` — a real (small) logic change plus a stale, commented-out duplicate of a whole function. See §6.1 below — now understood to be a hand-rolled workaround for issue #7270 (§2), **needs cleanup either way**.
- `frontend/javascripts/viewer/model/sagas/dataset_saga.ts` — disables the "z1 downsampling causes bad quality" warning toast (`if (false && showWarning)`). Almost certainly a demo-convenience hack.
- `frontend/javascripts/viewer/geometries/materials/edge_shader.ts` — `bool isVisible = 0.; // rgba.a == 1.0;` — hardcodes all skeleton edges invisible. Likely irrelevant for landmark (single-node, edge-less) trees, but is dead/dangerous code if left in.
- `frontend/stylesheets/main.less` — adds a 3-column CSS grid (`.adv-parent` / `.adv-left-side` / `.adv-middle` / `.adv-right-side`) for the new view's layout.

### 4.1 What `align_datasets_view.tsx` does today, concretely
- Renders a 3-column grid: control sidebar + two `<iframe>`s pointed at **hardcoded annotation URLs**, two pre-existing annotations on **hardcoded layer names** (`C555_DIAMOND_2f` / `C555_versaCT`). Per PR #9082's own notes (§2), these two annotations were actually two separate *datasets*, one with transform T baked into a layer and the other with T⁻¹ — a manual hack around the exact problem issue #7270 names.
- Talks to each iframe via `postMessage` (`sendMessage`/`Deferred` wrapper, `messageId` prefixed `"adv-"`) on top of the pre-existing cross-origin API bridge.
- `getCorrespondences()`: exports both sides' trees as NML, parses client-side, sorts each side's trees by `treeId` and nodes by `id`, then **zips positionally** — the Nth tree on the left is assumed to match the Nth tree on the right. No id/name-based matching. (Superseded by the diff-based sync in §3, but the "export/parse NML" leg of this stays, see §7.2.)
- Polls this every 500ms via `useInterval`.
- `onAlign()`: computes an **affine** transform (`createAffineTransform`, ordinary least-squares, needs ≥4 non-coplanar point pairs — matches "min 4 points, not all in one plane"), pushes it (and its inverse) into both iframes via `setAffineLayerTransforms`. In-memory only, nothing persisted.
- `onReset()`: resets both layers on both sides to `Identity4x4`.
- `toggleShowBoth()`: **global** (not per-focused-iframe as BigWarp's `f` key actually works, §2.1), toggles the other layer's visibility in both iframes at once.
- `onLeftToRight`/`onRightToLeft`: reads one iframe's camera position, un-transforms it through the other layer's current transform, re-centers the other iframe there.
- Sidebar table: position pairs + per-axis residual error after the current transform, with a pin icon per row (`onFocusCorrespondence`) to re-center both iframes on that pair. This is already basically the "paired comparison table with click-to-jump" from the original ask — just unpolished (raw voxel coordinates, no labels, no delete/edit, no error highlighting — matches PR #9082's own "more UI" TODOs).

### 4.2 Gaps versus where we're headed
- Two annotation IDs + two layer names hardcoded — no dataset/layer-pair picker yet (§5.1).
- No keyboard shortcuts (`t`/`f`/`q`) — buttons only.
- `toggleShowBoth` is global, not focus-scoped.
- Affine only, no TPS (tracked for later, §8).
- No coplanarity check before computing a transform.
- No persistence ("Store as Default").
- Both the outer page's and the inner iframes' full navbar/tabs show — no "coordinator has no viewport" and no "worker is chrome-less" modes yet (§5.2).
- No XY-only viewport restriction inside workers.
- `newNodeNewTree` (soma-clicking) not auto-enabled.
- Architecture is "two independent annotations," superseded by §3.

---

## 5. What to build (v1 scope, given the architecture in §3)

### 5.1 Entry points (agreed: both)
1. **Dashboard dataset row "..." actions menu** — `dashboard/advanced_dataset/dataset_action_view.tsx`. This file already has a primary `NewAnnotationLink` (line ~35) plus a secondary actions surface for occasional per-dataset actions (clear cache, delete, etc. — same file, further down, built on antd `MenuProps`). Add an **"Align Layers…"** item there. Clicking it needs a layer-pair picker (dataset might have >2 layers, can't hardcode which two to align) before creating/opening the one landmark annotation for that dataset and navigating to the coordinator view.
2. **Dataset Settings, data tab** — `dashboard/dataset/dataset_settings_view.tsx` / `DatasetSettingsDataTab`, near where layer configuration and PR #9591's per-layer transform editing conceptually live.

Both entry points should converge on the same "find or create the dataset's landmark annotation, ask for/confirm the layer pair, open the coordinator view" flow — don't build two divergent code paths.

### 5.2 Coordinator page shell
- No data/3D viewport, ever.
- Normal navbar.
- Collapsible left drawer (default closed), containing the alignment tool UI (today's sidebar contents: align/reset/shortcuts hint, the correspondence table).
- Needs a real annotation Store bound to the one landmark annotation, with save-queue active (this *is* the persisted copy).

### 5.3 Worker (iframe) configuration
- Chrome-less: no navbar, tabs (left settings, right info) closed by default. **No existing "embedded" route flag for this today** — needs a small new mechanism: a URL flag (e.g. `?embedded=true`) read in `RootLayout`/`Navbar` to skip the navbar, plus dispatching to close `uiInformation.borderOpenStatus.left`/`.right` on mount (state already exists, `viewer/store.ts:625`, defaults `default_state.ts:296`). Worker still allows the user to reopen its own left settings tab manually for cosmetic layer tweaks (§3, "mixed ownership").
- `newNodeNewTree` forced on, so every click starts a fresh single-node landmark tree.
- The coordinator sets each worker's `nativelyRenderedLayerName` to that worker's own dominant layer, once, on load — a plain existing per-view setting, dispatched via `updateDatasetSettingAction`. **No #7270 workaround needed** — see §3's "Layer choice per side" for why this is sufficient on its own (resolved this session, previously thought to need a scoped workaround).
- Restricted to the XY viewport only — mechanism still TBD (§9).

### 5.4 Sync: coordinator ⇄ workers
- Poll each worker via the existing `exportTreesAsNmlString` + `parseNml` round trip (kept for v1 — see explicit note below).
- Diff each worker's parsed trees against "last known trees for this worker" using `diffTrees`/`diffSkeletonTracing`.
- Apply the resulting `UpdateAction[]` to the coordinator's own tracing state (tagged into that worker's tree group) via `applySkeletonUpdateActionsFromServer`, letting the normal save-queue persist it.
- On worker (re)load: push that worker's currently-known landmarks into its fresh empty sandbox annotation via the existing `importNml`/`importNmlAsString` cross-origin call.
- **Explicit future TODO, recorded per Michael's request, not for v1**: replace polling with a push model — have each worker's cross-origin API proactively `postMessage` a diff/update whenever its own skeleton tracing changes, instead of the coordinator polling on a fixed interval.

### 5.5 Transform computation & shortcuts
- Affine only for v1 (`createAffineTransform`), TPS explicitly deferred but tracked — **please keep track that we want TPS eventually** (Michael's words).
- Reject (don't auto-repair) coplanar/degenerate landmark configurations, with a clear message telling the user to add a point off the current plane — matches both the original ask and the Notion doc's explicit warning about single-slice landmark stretch.
- Keyboard shortcuts matching Michael's field notes on real BigWarp (§2.1): `t` compute+apply transform, `f` toggle other layer scoped to the focused worker, `q` sync the other worker's view to the focused one's position/orientation/zoom.

### 5.6 Persistence
- "Store as Default" in the coordinator's drawer, reusing PR #9591's exact pattern: `getDataset(id)` → patch just this layer's `coordinateTransformations` → `updateDatasetPartial(id, { dataSource })`. See §6.2.
- Prefer composing with `applyAffineOnTopOfTransforms`/the 7-matrix SRT helpers from #9591 over the current spike's raw `setAffineLayerTransforms` (which replaces a layer's entire transform stack with one matrix and loses composability with whatever transform the layer already had).

---

## 6. PR #9591 — "Live transforms via landmarks" (open, unmerged) — reuse, don't reinvent

Fetched via `gh pr diff 9591` (not locally checked out — this PR's branch was never
pulled). Solves a related but narrower problem: landmark-based affine transforms
*within a single annotation*, plus backend persistence.

### 6.1 What it adds
- **`LandmarkTransformModal`**: pick two skeleton tree groups **in the same
  annotation** (source/target), validate ≥3 trees each, equal counts, exactly one
  node per tree, estimate an affine, apply it as the layer's transform. Single-
  annotation analog of what this feature's `onAlign()` does across two workers.
  - Coplanar handling via `augmentIfCoplanar()`: duplicates degenerate-axis points
    with a synthetic +1 offset so the solver never fails. **We're explicitly not
    using this strategy (§5.5 — we reject with a message instead)**; noting it here
    only so the two approaches aren't confused later.
  - Force-moves source landmark nodes to their transformed positions afterward
    (`setNodePositionAction(..., forceOverwrite: true)`, a new 4th param) — relevant
    if this feature ever wants landmarks to visually track a transformed layer.
- **The "live SRT transform" format** (`dataset_layer_transformation_accessor.ts`):
  a canonical 7-affine-matrix representation (center→origin, scale, rotX, rotY, rotZ,
  translation, origin→center), round-trippable through slider UI without Euler-angle
  ambiguity. `applyAffineOnTopOfTransforms` is the function to reuse for combining a
  newly-estimated landmark affine with whatever transform a layer already has.
- **`LayerTransformSettingsPopover`**: slider-based SRT editor with "Reset to Stored
  Default" and **"Store as Default"** (`handleSaveForAllUsers`) — *this* is the exact
  persistence call to reuse for §5.6.
- Minor: `setNodePositionAction` gained `forceOverwrite`; `fromCenterToOrigin`/
  `fromOriginToCenter` split into raw-`Matrix4` vs. `...AsAffine` variants.

### 6.2 Concretely, what to reuse
- **Persistence**: `getDataset` + `updateDatasetPartial`, exactly as `handleSaveForAllUsers` does.
- **Transform math**: `applyAffineOnTopOfTransforms` / `decomposeAffineToSRT` instead of the current raw-replace `setAffineLayerTransforms`.
- **Validation UX phrasing**: `LandmarkTransformModal`'s messages ("Need at least 3 landmark pairs", "Each ... tree must contain exactly one node") are a good template.

### 6.3 Where they differ
- #9591 pairs landmarks by tree-group membership within one annotation; this feature pairs them across two independent worker iframes — the coordinator/worker split (§3) is the whole point and isn't something to give up.
- #9591 only ever produces SRT-form transforms (no shear, no TPS). This feature isn't constrained to SRT-only long-term (TPS is the eventual goal), but persistence (§5.6) is transform-format-agnostic regardless.

---

## 7. Foundational WK infrastructure this feature builds on (already exists)

1. **Cross-origin iframe API** — `viewer/api/cross_origin_api.ts`. Pre-existing embed mechanism; extend here for any new coordinator↔worker remote-control command.
2. **Sandbox mode / `allowSave`** — see §3's feasibility notes above.
3. **Transform helpers** — `viewer/model/helpers/transformation_helpers.ts`: `Transform` type already supports both `affine` and `thin_plate_spline` (`createThinPlateSplineTransform`, `TPS3D` in `libs/thin_plate_spline.ts` — primitive exists, not wired into this view yet). `checkLandmarksForThinPlateSpline` already implements a "try to build a TPS, let it throw" degenerate-check — matches the §5.5 "reject" decision, worth reusing/adapting its error path rather than writing a new coplanarity check from scratch.
4. **`estimateAffineMatrix4x4`** — `libs/estimate_affine.ts`, plain least-squares, needs ≥4 non-coplanar points (why "min 4, not all on one plane" is mathematically required, not arbitrary).
5. **`newNodeNewTree`** — `viewer/store.ts:379` / `default_state.ts:72`, default `false`. Forcing this `true` in workers = BigWarp's "landmark clicking mode."
6. **`borderOpenStatus`** — `viewer/store.ts:625` / `default_state.ts:296`. Lever for closing worker tabs by default.
7. **Diff/apply round trip** — `diffTrees`/`diffSkeletonTracing` (state→actions) and `applySkeletonUpdateActionsFromServer` (actions→state), see §3.

---

## 8. Known bugs/hacks in the current spike to clean up

- `edge_shader.ts`: `bool isVisible = 0.; // rgba.a == 1.0;` unconditionally hides all skeleton edges, globally, for as long as this branch is checked out. **Must be reverted** — landmark trees are single-node/edge-less anyway so this hack isn't even doing useful work for this feature.
- `dataset_saga.ts`: `if (false && showWarning)` permanently disables the Z1-downsampling warning toast. Revert or scope it.
- `dataset_layer_transformation_accessor.ts`: dropped the `nativelyRenderedLayerName != null &&` guard, plus ~50 lines of dead, commented-out code with stray `console.log`s. Re-traced this session (§3): the guard removal is very likely inert (already unreachable-when-false given the function's control flow) — just delete both during cleanup, no special behavior to preserve or reverse-engineer.
- Fragile positional (not id/name-based) correspondence pairing — moot once §3/§5.4's diff-based sync replaces `getCorrespondences()`'s current sort-and-zip approach.

---

## 9. Open questions still to resolve

1. **Left/right ↔ fixed/moving convention mismatch**: spike code has left=`layerName1`=fixed, right=`layerName2`=moving; the Notion doc describes BigWarp itself as left=moving, right=target/fixed. Pick one convention and use it consistently in UI copy and code naming — currently unreconciled.
2. **XY-only viewport restriction mechanism** — WK already supports single-viewport ("maximize viewport") layouts; exact API to force this on programmatically/via URL for a worker on load isn't pinned down yet.
3. **Layer-pair picker UX** (§5.1) — not designed yet: how does a user pick "these are the 2 layers to align" when a dataset has more than 2 color layers?
4. **v2 cross-worker ghost landmarks** (§3) — design is recorded, not scheduled; open sub-question of whether WK supports true tree/group edit-locking or whether "read-only" starts convention-only.

Resolved this session (kept above for traceability, not re-litigated): one shared annotation vs. two (§3, chose one); annotation lifecycle (persistent/revisitable, user-triggered creation, not auto); affine-first with TPS tracked as future (§5.5); coplanar handling = reject with message (§5.5); coordinator has no viewport (§3/§5.2); tree-group visibility = internal-only (§3); sync mechanism = keep polling, push is future TODO (§5.4); layer choice = coordinator-owned but worker keeps its own cosmetic layer-settings tab, via permanent per-worker `nativelyRenderedLayerName` pinning, **no #7270 workaround needed** (§3); entry points = both dashboard "..." menu and dataset settings data tab (§5.1); cross-worker landmark display = deferred to v2, design recorded (§3).

---

## 10. Suggested implementation order

1. **Cleanup pass**: revert `edge_shader.ts`/`dataset_saga.ts` hacks; delete (not rewrite — confirmed inert, §3/§8) the `dataset_layer_transformation_accessor.ts` change.
2. **Coordinator shell**: real annotation-hosting page, no viewport, collapsible drawer, bound to a manually-created test landmark annotation (entry-point UI can come later).
3. **Worker chrome-less mode**: `?embedded=true` flag hiding navbar + closing `borderOpenStatus`, `newNodeNewTree` auto-enable, permanent per-worker `nativelyRenderedLayerName` pinning to that worker's own dominant layer (§3 — this is what makes landmark coordinate spaces "just work" with no further changes needed).
4. **Diff-based sync**: replace `getCorrespondences()`'s positional zip with `diffTrees` polling into the coordinator's own tree-group-tagged state, via `applySkeletonUpdateActionsFromServer`.
5. **Reload flow**: push known landmarks into a fresh worker sandbox via `importNmlAsString` on load.
6. **Shortcuts**: `t`/`f`/`q`, focus-aware.
7. **Persistence**: "Store as Default" reusing #9591's `getDataset`/`updateDatasetPartial` + `applyAffineOnTopOfTransforms`.
8. **Entry points**: dashboard "..." menu item + dataset settings data tab, both driving a layer-pair picker → find-or-create landmark annotation → coordinator view.
9. **TPS support**: swap in `createThinPlateSplineTransform` once there's a model-selection trigger.
10. **Polish backlog** (from PR #9082's own notes plus this session): highlight high-error landmark pairs, allow disabling/deleting individual pairs, display node/tree ids, XY-only viewport, visual tag for landmark annotations in the annotations list, **v2 cross-worker read-only ghost landmarks (§3 — design already recorded)**.

---

## 11. File index (for quick navigation next session)

- `frontend/javascripts/viewer/view/layouting/align_datasets_view.tsx` — today's whole feature UI (pre-rearchitecture).
- `frontend/javascripts/viewer/api/cross_origin_api.ts` — iframe postMessage bridge.
- `frontend/javascripts/viewer/model/helpers/transformation_helpers.ts` — `Transform` type, affine/TPS creation.
- `frontend/javascripts/viewer/model/accessors/dataset_layer_transformation_accessor.ts` — layer transform resolution logic; where the #7270 workaround belongs.
- `frontend/javascripts/libs/estimate_affine.ts` — least-squares affine estimation.
- `frontend/javascripts/libs/thin_plate_spline.ts` (`TPS3D`) — TPS primitive, not yet wired in.
- `frontend/javascripts/viewer/model/helpers/nml_helpers.ts` — `parseNml`/`serializeToNml`.
- `frontend/javascripts/viewer/model/sagas/skeletontracing_saga.ts:676-790` — `diffTrees`/`diffSkeletonTracing`.
- `frontend/javascripts/viewer/model/reducers/update_action_application/skeleton.ts:33` — `applySkeletonUpdateActionsFromServer`.
- `frontend/javascripts/viewer/store.ts` — `newNodeNewTree` (~379), `borderOpenStatus` (~625).
- `frontend/javascripts/dashboard/advanced_dataset/dataset_action_view.tsx` — entry point #1.
- `frontend/javascripts/dashboard/dataset/dataset_settings_view.tsx` — entry point #2.
- `docs/bigwarp_assets/notion_mockup.png` — the Notion doc's layout mockup, saved locally.
- PR #9082 (closed, = this branch's own hackathon PR) — https://github.com/scalableminds/webknossos/pull/9082
- PR #9591 (open, transform persistence to reuse) — https://github.com/scalableminds/webknossos/pull/9591
- Issue #7270 (open, annotation-layer coordinate systems) — https://github.com/scalableminds/webknossos/issues/7270
- Notion design doc — https://app.notion.com/p/scalableminds/Design-Doc-Bring-BigWarp-to-WK-3c2b51644c6380c69ec8ccb95e441426 (fetch with `ntn pages get 3c2b51644c6380c69ec8ccb95e441426`)
