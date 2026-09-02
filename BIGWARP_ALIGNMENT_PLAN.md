# BigWarp-style Dataset Alignment for WEBKNOSSOS — Design Doc & Implementation Plan

Branch: `live-warp` (currently just a spike/demo, not production code)
Owner: Michael Büßemeyer
Last updated: 2026-09-01 (v5 — skeleton-toolbar restriction + correspondence table redesign, see §0.6)

> **Purpose of this file**: this feature spans multiple sessions and a lot of context
> (old spike code, related PRs/issues, an external design doc). Context gets
> compacted, so this file is the durable memory: what the feature is, what already
> exists, what's hacky/broken, what's decided, and what's still open. Edit it freely —
> it's a living doc, not something regenerated from scratch each session.

---

## 0. Implementation progress (v1 build, 2026-08-31)

Everything below in §0 reflects a from-scratch v1 implementation pass on top of the
architecture in §3, done in this session. **Not yet manually tested in a browser** —
typecheck (`yarn typecheck`), lint (`yarn check-frontend`/`yarn fix-frontend`), and the
existing unit test suite (`yarn test`, 3202 tests) all pass, but nobody has clicked
through the actual flow yet. Treat the below as "should work, needs a live QA pass,"
not "verified working."

### 0.1 Done

- **Cleanup pass (§8/§10 step 1)**: reverted `edge_shader.ts`'s hidden-edges hack,
  `dataset_saga.ts`'s disabled Z1-downsampling warning, and
  `dataset_layer_transformation_accessor.ts`'s guard removal + dead commented-out
  function — all three now byte-for-byte match `master`.
- **Worker mode (§5.3, revised in §0.5 — no longer "chrome-less")**: a worker loads
  `/datasets/<name>-<id>/sandbox/skeleton?bigwarpWorker=<layerName>`. The
  `bigwarpWorker` URL param (checked via `hasUrlParam`/`getUrlParamValue` from
  `libs/utils`) now drives, with no new "embedded mode" concept needed:
  - **Navbar stays visible** (§0.5 - originally hidden entirely, reverted after QA
    found the toolbar/position/rotation inputs live in a `PortalTarget` rendered
    *inside* the navbar, so hiding it removed those too). `navbar.tsx` instead
    restricts navigation-away affordances while the param is present - see §0.5.
  - `viewer/controller.tsx`'s new `Controller.applyBigWarpWorkerSettingsIfNeeded()`
    (called once from `modelFetchDone`, right before `initializeSceneController`)
    dispatches `updateDatasetSettingAction("nativelyRenderedLayerName", <layerName>)`
    and `updateUserSettingAction("newNodeNewTree", true)`.
  - A new exported `getBigWarpWorkerLayoutConfig()` in
    `viewer/view/layouting/default_layout_configs.ts` builds a single-viewport
    (PLANE_XY only) FlexLayout config with the right border omitted entirely and the
    left border present-but-closed (so a worker can still reopen it for cosmetic
    layer tweaks, per §3). `TracingLayoutView.setControllerStatus` uses this instead
    of `getLayoutConfig(...)` whenever `bigwarpWorker` is set. This turned out to be
    simpler than the "maximize" flexlayout mechanism investigated first — a
    single-tab tabset needs no maximize state at all.
  - `borderOpenStatus` needed **no code at all**: its default state is already
    `{left: false, right: false}` (`default_state.ts`), which is exactly "closed by
    default, reopenable."
  - `t`/`f`/`q` shortcuts: since key events never bubble out of an iframe to the
    parent frame, `viewer/api/cross_origin_api.ts`'s `CrossOriginApi` component now
    also registers a `keydown` listener (gated on `hasUrlParam("bigwarpWorker")`)
    that relays `t`/`f`/`q` up to `window.parent` via
    `postMessage({type: "bigwarpShortcut", key})`. The coordinator identifies which
    side sent it via `event.source` (no separate focus-tracking needed).
- **Cross-origin API additions** (`viewer/api/api_latest.ts` + `cross_origin_api.ts`),
  all scoped to this feature and additive (no existing command's signature changed,
  since `exportTreesAsNmlString`/`importNml`/etc. are a semi-public embed API):
  - `ensureLandmarkGroups(pairGroupName, sideAGroupName, sideBGroupName)` — idempotent
    find-or-create of the nested tree-group hierarchy from §3, matched by name (safe
    since one landmark annotation only ever has one such hierarchy in v1).
  - `importNmlAsStringIntoGroup(nmlString, targetGroupId)` — like `importNmlAsString`
    but nests into an existing group and resolves with the freshly assigned tree ids.
  - `exportTreesInGroupAsNmlString(groupId, applyTransform)` and
    `exportTreesByIdsAsNmlString(treeIds, applyTransform)` — filtered exports, used
    for the reload-push and incremental-sync flows respectively.
- **Coordinator rewrite**: `viewer/view/layouting/align_datasets_view.tsx` is now a
  functional-component rewrite (previously a class-free but hook-light spike) that
  implements:
  - Route `/align-datasets/:datasetNameAndId` (dataset id required — legacy
    name-only URLs show an error asking the user to navigate via the dataset actions
    menu instead of implementing the full legacy-redirect chain), with
    `?layerA=<fixed>&layerB=<moving>` query params. If either is missing, an inline
    `LayerPairPicker` (two `<Select>`s built from `dataset.dataSource.dataLayers`) is
    shown instead of the iframes, so **one** UI serves both entry points (no separate
    picker per entry point).
  - Find-or-create of the one landmark annotation for a (dataset, layerA, layerB)
    triple via `createExplorational(datasetId, TracingTypeEnum.skeleton, false)` —
    see §0.2 for the localStorage-based lookup caveat.
  - Three iframes: two visible workers (`A`=fixed, `B`=moving) plus a third,
    `display:none` iframe loading the landmark annotation **normally** (not
    sandboxed, `allowSave` stays true) — this is the "store." See §0.2 for why this
    replaces the originally-envisioned "coordinator page itself hosts a headless
    Redux Store" design.
  - A generalized version of the old spike's postMessage `sendMessage` helper,
    extended to 3 iframes with per-iframe "ready" tracking (each `CrossOriginApi`
    already broadcasts `{type: "init"}` once loaded; the old spike never listened for
    it, relying on 500ms-poll self-healing — the new "push known landmarks on load"
    step is one-shot and needed a real ready-signal).
  - Sync loop (500ms, same cadence as before): computes the live correspondence
    table/transform inputs by positionally zipping each side's exported trees
    (unchanged pairing logic from the original spike — still id/name-based-pairing
    future work, §9), **and separately** merges newly-appeared local trees per side
    into the store's matching group via `exportTreesByIdsAsNmlString` +
    `importNmlAsStringIntoGroup`, tracked via a per-side `Set<number>` of
    already-merged worker-local tree ids. See §0.2 for why this is
    additions-only (no delete propagation) instead of the originally-planned
    `diffTrees`/`applySkeletonUpdateActionsFromServer` round trip.
  - Reload/resume flow: on bootstrap, pulls each side's group contents back out of
    the store via `exportTreesInGroupAsNmlString` and pushes them into that side's
    freshly-loaded worker sandbox via the existing `importNml`, before the sync loop
    starts — matches §3's "fresh empty sandbox + push known landmarks" design.
  - `t`/`f`/`q` fully wired: `onAlign` (reject-with-message on <4 pairs or on
    `checkLandmarksForThinPlateSpline` throwing — reusing its error path exactly as
    §5.5/§7.3 intended), `toggleShowOtherLayer(side)` (per-side, not global — fixes
    the `toggleShowBoth`-is-global gap from §4.2), `syncOtherViewToFocused(side)`.
  - "Store as Default": `getDataset`/`updateDatasetPartial` (both already exist on
    `master`, not gated on PR #9591 landing) patch the moving layer's
    `coordinateTransformations` by appending the newly-estimated affine (via
    `flatToNestedMatrix`). Not composed through #9591's `applyAffineOnTopOfTransforms`
    (unmerged) — just a plain array append, which is correct but doesn't collapse
    chained transforms the way that helper would.
  - Collapsible left `Drawer` (antd) replacing the always-visible sidebar; the
    correspondence table now uses a proper antd `Table` with a pin-to-focus column.
  - `main.less`'s `.adv-parent`/`.adv-left-side`/`.adv-middle`/`.adv-right-side` grid
    replaced with a simple flex row of two `.adv-worker` panes (the Drawer floats
    independently, needs no grid column).
- **Entry points (§5.1, both)**:
  - Dataset settings → Data tab: an "Align Layers…" button next to the "Data Source"
    title (`dataset_settings_data_tab.tsx`), shown when the dataset has ≥2 layers.
  - Dashboard dataset row "…" menu: a new "Align Layers…" item in
    `getDatasetActionContextMenu` (`dataset_action_view.tsx`), shown when active and
    ≥2 layers total. Both navigate to `/align-datasets/<readableURLPart>` with no
    layer params, landing on the shared inline picker described above.

### 0.2 Deliberate deviations from the plan as written (with reasons)

These are engineering-judgment calls made during implementation, not re-litigations
of Michael's decisions in §3 — flagging them here so they're not mistaken for
oversights, and so a future pass can decide whether to close the gap or keep it.

1. **The coordinator does not itself host a headless Redux Store/save-queue.**
   §3 describes the outer page as "a real WK annotation-hosting instance... near-
   headless." Investigating `TracingLayoutView`/`viewer/controller.tsx` showed that
   annotation loading (`Model.fetch`, sagas, save-queue) and 3D-viewport creation
   (`initializeSceneController`) are *not* actually decoupled enough to safely strip
   the viewport out of that class component without risking deep, hard-to-verify
   breakage (no browser available to test against during this session). Instead, the
   coordinator is a plain page that talks to a **third, hidden (`display:none`)
   iframe** loading the landmark annotation completely normally (same code path as
   any other annotation view, just not visible) — this achieves the same externally-
   observable property (a real, unmodified, persisted annotation Store with a working
   save-queue) with zero changes to `TracingLayoutView`/`controller.tsx`'s loading
   logic, at the cost of one extra iframe and postMessage round trips instead of
   direct `Store.dispatch`. If this indirection ever becomes a real problem (e.g.
   sync latency), revisit building an actual headless `TracingLayoutView` variant —
   but that's real, unscoped R&D, not a quick follow-up.
2. **Sync is additions-only, not a general `diffTrees` round trip.** §3/§7 planned
   using `diffTrees`/`applySkeletonUpdateActionsFromServer` for the coordinator↔worker
   sync. Two things made a simpler mechanism clearly better for v1: (a) with the
   hidden-iframe design above, the coordinator has no live Redux state of its own to
   diff against — it would have had to relay `UpdateAction`s over postMessage anyway;
   (b) worker-local tree/node ids are **not** globally unique across the two workers
   (each is an independent fresh sandbox), so naively replaying raw update actions
   from both workers into one shared tracing would cause id collisions. The
   implemented approach instead tracks, per side, which worker-local tree ids have
   already been merged, and merges new ones via `exportTreesByIdsAsNmlString` +
   `importNmlAsStringIntoGroup` — reusing the **existing, already-collision-safe** id
   reassignment logic inside `addTreesAndGroupsAction` instead of hand-rolling id
   remapping. **Known gap**: this only handles additions. Deleting a landmark in a
   worker does not remove it from the persisted store (it just stops being
   re-imported, since it's already marked "known"). This was already a listed v1 gap
   ("allow disabling/deleting individual pairs" - §4.2/§10 polish backlog), so it's
   not a new regression, but worth calling out explicitly: if delete support is
   picked up, the original `diffTrees`-based design is still the right target, and
   would need the coordinator to relay update actions into the store iframe (a new
   cross-origin command wrapping `applySkeletonUpdateActionsFromServerAction`) rather
   than the import-based approach used for v1.
3. **Landmark-annotation discovery uses `localStorage`, not annotation
   metadata/tags.** Finding "the" landmark annotation for a given (dataset, layerA,
   layerB) triple on a repeat visit is done by remembering `annotationId` in
   `window.localStorage`, keyed by `dataset.id:layerA:layerB`. This only works in the
   same browser/profile that created it - **not shared across devices or
   users**, and if local storage is cleared, a *new* landmark annotation gets created
   silently (the old one still exists and is still fully valid/visible in the
   annotations list, just orphaned from this tool's point of view). A real fix needs
   either a backend-queryable convention (e.g. a well-known annotation metadata key,
   or a dataset-scoped "list my alignment annotations" endpoint) - out of scope for
   this pass, but should be picked up before this feature is anything more than a
   feedback-collecting demo. The originally-mentioned "visual tag marking it as a
   landmark annotation" polish item (§3) is the visible half of the same underlying
   gap.
4. **No annotation-existence check before reusing a cached id.** If the localStorage-
   cached annotation was deleted server-side, the store iframe will just show
   whatever WEBKNOSSOS shows for a missing annotation (not specially handled) instead
   of transparently creating a fresh one. Acceptable for a spike, worth a quick guard
   later.

### 0.4 Bugs found during manual QA (started 2026-08-31) and fixes

- **Worker iframes failed to load the sandbox annotation** - browser console showed
  repeated failing `PATCH /api/annotations/Explorational/000000000000000000000000/edit`
  requests. Root cause: **a pre-existing WK bug, not specific to this feature.**
  `mayEditAnnotationViewConfig()` (`viewer/model/accessors/annotation_accessor.ts`)
  only checked `restrictions.allowUpdate`, not `restrictions.allowSave` - unlike its
  sibling `mayEditAnnotationProperties()`, which correctly checks both. Sandbox
  annotations get `allowUpdate=true, allowSave=false` by design (§7.1), so any
  `UPDATE_DATASET_SETTING`/`UPDATE_LAYER_SETTING` action (which a worker dispatches on
  load, to pin `nativelyRenderedLayerName` per §0.1) made `annotation_saga.tsx`'s
  `pushAnnotationUpdateAsyncDelayed` believe it could persist the view config, and it
  tried to PATCH the sandbox's placeholder id/type (the backend's dummy
  `Annotation(ObjectId.dummyId, ...)` object for sandboxes, `typ` defaulting to
  `Explorational`) - which of course doesn't exist as a real, addressable annotation.
  This wasn't "loading the wrong annotation"; the sandbox's placeholder id is normal
  and expected - the bug was WK trying to *persist* against it regardless. **This bug
  would already have existed for any ordinary (non-BigWarp) sandbox session that
  changes a dataset/layer setting** - this feature's per-worker `nativelyRenderedLayerName`
  pinning just makes it fire unconditionally on every worker load, surfacing it
  immediately. **Fix**: `mayEditAnnotationViewConfig` now also requires
  `restrictions.allowSave`, mirroring `mayEditAnnotationProperties`. One-line change,
  single call site, no other behavior affected (confirmed via `yarn test`, still
  3202/3202 passing). This fix is a genuine general WK correctness fix and is worth
  keeping even if `live-warp` is eventually discarded.

### 0.5 Navbar/toolbar iteration (2026-09-01, based on Michael's hands-on feedback)

Michael tried the chrome-less worker (§0.1) and found it unusable for the actual
landmark-clicking workflow: switching between the move tool and the skeleton tool, and
reading/typing the position (and rotation), both live in `ActionBarView` - which
renders into a `PortalTarget` that only exists *inside* `navbar.tsx` (`navbar.tsx:979`,
target id `navbarTracingSlot`). Hiding the whole navbar silently killed that portal
target, so none of that content rendered at all - the toolbar/position/rotation inputs
weren't just visually hidden, they were entirely unavailable. Fix and follow-on
requests, all addressed:

- **Navbar is shown again** (`router.tsx`'s `RootLayout` always renders `<Navbar />`).
  Instead, `navbar.tsx` itself restricts what's interactive when
  `hasUrlParam("bigwarpWorker")`:
  - The WEBKNOSSOS logo becomes a plain, non-clickable label (was a `<Link to="/dashboard">`).
  - Dashboard/Analysis/Task-management/Administration-or-TimeTracking/Help submenus are
    dropped entirely.
  - `LoggedInAvatar`/`AnonymousAvatar` (account switching, logout, etc.) are dropped.
  - Kept: `GlobalProgressBar`, `MaintenanceBanner`, the version-upgrade banner, and -
    critically - the `PortalTarget` itself, so `ActionBarView`'s toolbar/position/
    rotation controls keep working exactly as in a normal annotation view.
- **Tools restricted to Move + Skeleton**: new `Toolkit.BIGWARP_LANDMARKS` entry in
  `viewer/model/accessors/tool_accessor.ts` (`Toolkits.BIGWARP_LANDMARKS = [MOVE, SKELETON]`),
  deliberately *not* added to `toolkit_switcher_view.tsx`'s `toolkitOptions` so it can't
  be picked by hand. `applyBigWarpWorkerSettingsIfNeeded()` (`controller.tsx`) now also
  dispatches `updateUserSettingAction("activeToolkit", Toolkit.BIGWARP_LANDMARKS)`. This
  reuses WK's existing toolkit-restriction machinery as-is (same mechanism
  `READ_ONLY_TOOLS`/`VOLUME_TOOLS`/`SPLIT_SEGMENTS` already use) rather than a new,
  hand-rolled tool-blocking saga: `toolSaga`'s existing `ensureActiveToolIsInToolkit()`
  already auto-reverts the active tool if it's ever outside the current toolkit's list,
  and `ToolbarView`/`ToolDropdown` already derive the visible tool buttons from
  `Toolkits[activeToolkit]` - one setting change gets UI-filtering and enforcement for
  free. The toolkit *switcher* dropdown (`ToolkitView`, rendered by `action_bar_view.tsx`'s
  `ModesView`) is separately hidden in worker mode (it isn't gated by "am I in the
  restricted toolkit," so it would otherwise let the user switch back to All Tools).
  - **Found and fixed a real persistence-leak bug while doing this**: `activeToolkit`
    (like all of `userConfiguration`) gets pushed to the user's *account-wide* settings
    on the backend via `pushUserSettingsAsync` (`settings_saga.ts`), and
    `nativelyRenderedLayerName` (part of `datasetConfiguration`) gets pushed to the
    *dataset's* per-user view config via `pushDatasetSettingsAsync` - **neither push
    saga checked for sandbox mode**. Without a fix, opening a BigWarp worker would have
    permanently leaked `activeToolkit: BIGWARP_LANDMARKS` into the user's account (only
    2 tools available in every future annotation!) and leaked the pinned
    `nativelyRenderedLayerName` into that dataset's remembered view config - and the
    already-shipped `newNodeNewTree` pin from §0.1 had the exact same latent bug. Fixed
    generally (not BigWarp-specifically) by making both push sagas bail out early when
    `state.temporaryConfiguration.controlMode === ControlModeEnum.SANDBOX` - sandbox
    sessions are disposable by design, so nothing from them should ever be persisted to
    account/dataset defaults. Same root-cause *shape* as the §0.4 bug (a
    sandbox/allowSave check missing somewhere in WK's settings machinery), found by
    reasoning forward from "what else could this same class of bug affect" rather than
    from a second user report.
- **Navigation-away is blocked, not just hidden (defense in depth)**: in case some
  navigable affordance was missed above (or a future WK change adds one),
  `controller.tsx`'s `modelFetchDone` now installs a BigWarp-specific
  `window.onbeforeunload`/React-Router blocker (reusing the existing `withBlocker`/
  `setBlocking` plumbing already used for the normal "unsaved changes" prompt) whenever
  `bigwarpWorker` is set. For in-app (React Router) navigation it shows a `confirm()`
  with an explicit "Leaving this view is not allowed while aligning layers" message;
  for real browser navigation (reload/close/address-bar) it returns `true` to trigger
  the browser's own (non-customizable) native "leave site?" prompt - browsers don't
  allow a page to inject custom text there or to hard-block it outright, so this is the
  ceiling of what's achievable for that path, matching how the *existing*
  "unsaved changes" prompt already works. Note this doesn't fire for the coordinator's
  own act of setting up/pushing into a worker iframe, since the coordinator only sets
  each worker's `src` once, on initial mount.
- **Visual separation**: `.adv-worker` (`main.less`) now has a `border-top` and the
  first pane also gets a `border-right`, both using the standard
  `var(--ant-color-border)` token - separates the two iframes from each other and from
  the coordinator's own navbar above them, without adding borders on the outer
  edges (sides/bottom) per Michael's request.

### 0.6 Skeleton-toolbar restriction + correspondence table redesign (2026-09-01, based on Michael's hands-on feedback)

Michael tried the restored navbar/toolbar (§0.5) and reported four more things after
clicking landmarks in both workers:

- **Single-node-tree mode wasn't actually toggleable-off-proof, and 3 more skeleton
  toolbar buttons didn't make sense for landmark-only clicking.** `newNodeNewTree` was
  already forced on at mount (§0.1's `applyBigWarpWorkerSettingsIfNeeded`), but the
  toolbar's `SkeletonSpecificButtons` group (`viewer/view/action_bar/tools/skeleton_specific_ui.tsx`)
  still rendered its "Create new tree," "Single node tree (soma clicking) mode,"
  "Merger mode," and "draw like a pen" (`continuousNodeCreation`) toggle buttons,
  letting the user turn any of them on/off manually — none of which are meaningful
  once every click is already forced to start its own single-node tree.
  **Fix**: `viewer/view/action_bar/tools/toolbar_view.tsx`'s `ToolSpecificSettings` now
  also checks `hasUrlParam("bigwarpWorker")` and skips rendering
  `<SkeletonSpecificButtons />` entirely in that case — all four buttons live in that
  one component (confirmed by reading it), so this single check is a complete fix, not
  a partial one.
- **The third, `display:none` iframe** is the "store" from §0.2 point 1 — the *real*,
  persisted landmark annotation, loaded completely normally (same code path as any
  other annotation view, full navbar/viewport/save-queue, just visually hidden via CSS
  on the `<iframe>` element). It's not a bug or leftover; it's the actual backing
  annotation the two visible workers' landmarks get merged into. Confirmed still
  correct, no code change needed — just flagged here since it came up as a question,
  not a bug report.
- **Correspondence table redesigned**: the existing drawer already had a toggleable
  (open/close via the "Open Alignment Tools" button) table pairing up both sides'
  landmarks with a click-to-focus pin — Michael's ask refined its *shape* rather than
  asking for a new mechanism. `align_datasets_view.tsx`'s `columns` now render an index
  column plus one narrow (48px), center-aligned pin icon per side instead of the old
  wide always-visible `"x, y, z"` text columns; the full position is shown via
  `FastTooltip` on hover, and clicking a side's pin now calls a new
  `onFocusCorrespondenceSide(side, pos)` that re-centers *only that side's* iframe
  (replacing the old `onFocusCorrespondence(posA, posB)`, which always moved both).
  The `Table` itself got `style={{ width: "fit-content" }}` so it no longer stretches
  to the drawer's full 420px width.

### 0.7 "Open Alignment Tools" button invisible (2026-09-01 bug, found via Michael's report)

Michael couldn't find the drawer-toggle button at all. Root cause: `.adv-parent`
(`main.less`) never set `position: relative`, and no ancestor between it and the page
root does either (`RootLayout`'s `<Layout>`/`<Content>` in `router.tsx` don't set
`position`) — so the button's `position: absolute; top: 8; left: 8`
(`align_datasets_view.tsx`) resolved against the *viewport* (the initial containing
block), landing it at (8, 8) from the very top-left of the browser window, squarely
overlapping/behind the navbar instead of over the top-left corner of the iframe area.
**Fix**: added `position: relative` to `.adv-parent`, making it the button's
containing block as intended.

### 0.8 "Open Alignment Tools" moved into the coordinator's own navbar (2026-09-01, per Michael's request)

Superseding §0.7's fix (which is now moot - the button no longer lives inside
`.adv-parent`, so the `position: relative` fix there was reverted as dead code):
Michael asked for the button to live in the coordinator's own (normal, unrestricted -
this is the *outer* WK instance, not a `bigwarpWorker` iframe) navbar instead, next to
Help, with some separating space and a primary color so it's easy to spot. Implemented
using WK's existing cross-tree navbar-injection mechanism (`RenderToPortal`/
`PortalTarget` from `viewer/view/layouting/portal_utils.tsx`, the same pattern
`navbarTracingSlot` uses for the toolbar/position/rotation controls, and
`dashboard_top_bar.tsx` uses for `dashboard-TabBarExtraContent`) rather than a new
mechanism:

- `navbar.tsx` now renders an always-present `<PortalTarget portalId="navbarAlignToolsSlot">`
  right after the main `<Menu>` (whose last item is Help) and before the
  `navbarTracingSlot`/trailing-avatar area - so on every other page it's just an empty,
  invisible div, and on the coordinator page it's the first thing after Help, with
  `marginLeft: 16` for the "separated space" Michael asked for.
- `align_datasets_view.tsx` renders its button into that slot via
  `<RenderToPortal portalId="navbarAlignToolsSlot">`, replacing the old
  `position: absolute` floating button entirely. Now that it lives in a fixed navbar
  spot instead of floating over the iframes (where it had to hide while the Drawer was
  open to avoid visually colliding with it), it made sense to keep it **always
  visible** and toggle its own label ("Open"/"Close Alignment Tools") rather than
  disappearing while the drawer is open.
- `type="primary"` makes it a solid-color button, satisfying "make it primary so it's
  present."

### 0.9 Sync loop appears to never populate the correspondence table + reload loses landmarks (2026-09-01, reported by Michael, root cause NOT yet confirmed)

Michael reported clicking skeleton nodes in both workers but seeing nothing in the
correspondence table, and that reloading always starts both workers empty instead of
restoring previously-placed landmarks. He also asked for a "Force Save" button.

**What was ruled out** by re-reading the sync pipeline end to end (bootstrap effect →
`ensureLandmarkGroups` → per-side "push known landmarks" loop → the 500ms poll effect
→ `exportTreesAsNmlString`/`getCorrespondencePoints` → table render): the postMessage
round trip, the `Deferred`/ready-tracking mechanism, `addTreesAndGroupsAction`'s id
assignment (synchronous, confirmed via the reducer), and the table's own rendering all
check out logically - no React StrictMode is used in this codebase (confirmed via
grep), so the "double-effect-invocation aborts the one-shot bootstrap" failure mode
that would otherwise be the prime suspect for a ref-guarded async effect doesn't apply
here. **Could not conclusively reproduce or root-cause this without a live browser
session** - reasoning through async cross-iframe postMessage timing from source alone
has real limits.

**What was shipped instead of a guessed fix**: turned the previously console-only sync
health into a **visible, always-on diagnostic line in the drawer** (new `lastSyncedAt`/
`lastSyncError` state, updated every tick) plus a **"Force Save" button**:

- The drawer now shows `Sync: workers ✅/⏳ A / ✅/⏳ B · groups ✅/⏳ · <last synced
  HH:MM:SS | error: ... | not synced yet>`, updated every 500ms tick (or immediately on
  a thrown error). This turns "table is silently empty" into "which exact stage is
  stuck" - `workersReady` not flipping means the A/B iframes never announced ready,
  `groups` not flipping means the store-side bootstrap (`ensureLandmarkGroups`) is
  stuck, and an `error:` message means the poll itself is throwing (previously only
  visible via `console.error("BigWarp sync tick failed:", ...)`, easy to miss). **Next
  step**: have Michael reopen the drawer during a live session and report what this
  line says - that should make the actual failure point obvious in one glance instead
  of more guessing.
- **"Force Save"** (new cross-origin command `save`, `cross_origin_api.ts`, wrapping
  the already-existing `api.tracing.save()` → `Model.ensureSavedState()`): lets Michael
  flush the persisted "store" annotation on demand rather than relying on its normal
  debounced auto-save. This directly targets a plausible (independent of the sync-loop
  question above) explanation for "reload loses landmarks even after they clearly
  synced": reloading the coordinator tears down all three iframes at roughly the same
  time, which may not leave the store iframe's own `beforeunload`-triggered save (the
  same mechanism every ordinary WK annotation view already has) enough time to actually
  complete before its browsing context is destroyed - a full page reload for a
  *nested* iframe is a materially different situation than a user closing a normal,
  single-page annotation tab. Clicking Force Save before reloading sidesteps that
  entirely by awaiting completion before returning.

### 0.10 Root cause of §0.9 found and fixed: `CrossOriginApi`'s "init" handshake never fired reliably (2026-09-01)

Michael's new diagnostic line (§0.9) came back showing `workers ⏳ A / ⏳ B · groups ⏳
· not synced yet` with no change over time, even after clicking nodes in both fully
loaded, interactive workers - i.e. the coordinator never received a single "init"
message from *any* of the three iframes, not a partial/one-sided failure.

**Root cause, found in `viewer/api/cross_origin_api.ts`** (pre-existing code, not
something this feature's earlier passes touched, but never exercised this critically
before - normal usage of the embed API has a lot more tolerance for a late/dropped
"init"): the effect that posts `{type: "init"}` to the parent frame was written as

```ts
useEffect(() => {
  if (window.webknossos && window.parent) {
    window.webknossos.apiReady().then(() => window.parent.postMessage({type: "init"}, "*"));
  }
}, [window.webknossos]);
```

`window.webknossos` is a **plain global variable**, assigned in
`Controller.modelFetchDone()` (`window.webknossos = new ApiLoader(Model)`) - mutating a
global does **not** trigger a React re-render by itself. This effect therefore only
ever re-runs (and thus only ever sends "init") when *some unrelated* state change
happens to cause `CrossOriginApi` to re-render again after that assignment, at which
point the dependency-array diff coincidentally notices the global changed. In today's
code that coincidence exists (`TracingLayoutView.setControllerStatus("loaded")` calls
`this.setState(...)` right after `window.webknossos` is assigned, which does re-render
`CrossOriginApi` as a sibling) - so this used to "work," but entirely by accident, not
by any real guarantee, and evidently not reliably enough for what this feature needs.

**Fix**: listen for the `"webknossos:initialized"` event directly instead - the same
`nanoevents` event `ApiLoader`'s own `readyPromise` is built on
(`app.vent.on("webknossos:initialized", resolve)`, `api_loader.ts`), emitted exactly
once by `modelFetchDone()` right after `window.webknossos` is assigned
(`app.vent.emit("webknossos:initialized")`, `controller.tsx`). `CrossOriginApi` now
registers `app.vent.on("webknossos:initialized", sendInit)` on mount (falling back to
sending immediately if `window.webknossos` is *already* set, e.g. on a fast refresh) -
unconditionally correct, no dependency on React re-render timing at all. This is a
general WK correctness fix (same category as §0.4's `mayEditAnnotationViewConfig` and
§0.5's settings-persistence-leak fixes) worth keeping regardless of this feature's fate.

**Not yet reconfirmed live** - typecheck/lint/tests pass, but this needs Michael's next
test pass to confirm the diagnostic line actually starts showing ✅s and the
correspondence table populates.

### 0.3 Not started / explicitly out of scope for this pass

- **Manual browser QA in progress** (started 2026-08-31, see §0.4) - the single bug
  found so far is fixed; still needs a full click-through: worker chrome-less mode
  rendering correctly, landmarks syncing into the store, alignment visually snapping
  layers, persistence round-tripping.
- **TPS transform** (§5.5/§8): still affine-only, as planned for v1. TPS remains
  tracked, not forgotten.
- **XY-only viewport restriction**: **now implemented** (see §0.1) - this closes the
  §9 open question that used to track it.
- **Naming convention mismatch** (fixed/moving vs. the Notion doc's left/right): not
  resolved - the implementation consistently uses "A/fixed" and "B/moving" internally
  and in the UI, matching §1's terminology, not the Notion doc's opposite convention.
  Still worth a final decision, just not blocking.
- **Layer-pair picker UX**: implemented (inline `LayerPairPicker`, §0.1), but only the
  minimal version - no validation beyond "pick two different layers," no indication
  of which layers already have an existing landmark annotation.
- **v2 cross-worker ghost landmarks**: still deferred, design unchanged from §3.
- **Visual tag for landmark annotations in the annotations list**: still not done
  (§0.2 point 3 makes this more important than originally scoped).

---

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

> **Superseded by §0.** This section describes the pre-implementation "hackathon
> spike" state (commit history below, up to `f095437e18`). As of 2026-08-31 that code
> has been substantially rewritten per §0 - `align_datasets_view.tsx` is no longer
> what's described in §4.1, and the gaps listed in §4.2 are mostly closed (see §0.3
> for what's still actually open). Kept below for history/context, not as a
> description of the current code.

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

1. **Left/right ↔ fixed/moving convention mismatch**: the v1 implementation (§0) settled on "A/fixed" + "B/moving" consistently in code and UI copy, which resolves the *internal* inconsistency, but doesn't reconcile with the Notion doc's opposite left/right convention. Low priority - internally consistent now, just not matching that external reference.
2. **v2 cross-worker ghost landmarks** (§3) — design is recorded, not scheduled; open sub-question of whether WK supports true tree/group edit-locking or whether "read-only" starts convention-only.
3. **Landmark annotation discovery** (§0.2 point 3, new this pass) — v1 uses `localStorage`, not shared across devices/users. Needs a backend-queryable mechanism (metadata convention or a list endpoint) to become more than a single-browser demo.
4. **Deletion sync** (§0.2 point 2, new this pass) — v1's sync is additions-only; removing a landmark in a worker doesn't remove it from the persisted store. The originally-planned `diffTrees`-based approach is still the right target if/when this is picked up.
5. **No manual browser QA yet** (§0.3) — the v1 implementation has only been typechecked/linted/unit-tested, never clicked through in a running instance.

Resolved: XY-only viewport restriction (§0.1, done via a dedicated single-tab FlexLayout config, no "maximize" mechanism needed); layer-pair picker UX (§0.1, done, minimal inline picker); one shared annotation vs. two (§3); annotation lifecycle (persistent/revisitable, user-triggered creation, not auto); affine-first with TPS tracked as future (§5.5); coplanar handling = reject with message (§5.5, §0.1); coordinator has no viewport (§3/§5.2, achieved via the hidden-iframe design, §0.2); tree-group visibility = internal-only (§3); layer choice = coordinator-owned but worker keeps its own cosmetic layer-settings tab, via permanent per-worker `nativelyRenderedLayerName` pinning, **no #7270 workaround needed** (§3, §0.1); entry points = both dashboard "..." menu and dataset settings data tab (§5.1, §0.1); cross-worker landmark display = deferred to v2, design recorded (§3).

---

## 10. Suggested implementation order

**v1 status: steps 1-8 done, see §0.** Steps 9-10 remain.

1. ✅ **Cleanup pass**: reverted `edge_shader.ts`/`dataset_saga.ts` hacks; deleted the `dataset_layer_transformation_accessor.ts` change.
2. ✅ **Coordinator shell**: implemented as a plain page talking to a hidden "store" iframe rather than a headless Redux-hosting fork of `TracingLayoutView` — see §0.2 point 1 for why, and reconsider that choice here if it ever becomes a real limitation.
3. ✅ **Worker chrome-less mode**: `bigwarpWorker=<layerName>` URL param, navbar hidden, single-viewport (XY-only) layout, `newNodeNewTree` auto-enabled, permanent per-worker `nativelyRenderedLayerName` pinning.
4. ✅ **Sync**: implemented as additions-only import-based merging rather than a full `diffTrees` round trip — see §0.2 point 2 for why, and open question §9.4 for the gap this leaves (no delete propagation).
5. ✅ **Reload flow**: pushes known landmarks into a fresh worker sandbox via `importNml` on load.
6. ✅ **Shortcuts**: `t`/`f`/`q`, focus-aware (via `event.source`, no separate focus-tracking needed).
7. ✅ **Persistence**: "Store as Default" reusing `getDataset`/`updateDatasetPartial` (already on `master`) - plain append rather than `applyAffineOnTopOfTransforms` (unmerged PR #9591), see §0.1.
8. ✅ **Entry points**: dashboard "..." menu item + dataset settings data tab, both driving the shared inline layer-pair picker → find-or-create landmark annotation → coordinator view.
9. **Manual browser QA** (not started, §0.3) — needs a running instance + a real multi-layer dataset. Do this before anything else below.
10. **TPS support**: swap in `createThinPlateSplineTransform` once there's a model-selection trigger.
11. **Polish backlog** (from PR #9082's own notes plus prior sessions): highlight high-error landmark pairs, allow disabling/deleting individual pairs (would also close the deletion-sync gap, §9.4), display node/tree ids, visual tag for landmark annotations in the annotations list (would help with §9.3's discovery gap), **v2 cross-worker read-only ghost landmarks (§3 — design already recorded)**.

---

## 11. File index (for quick navigation next session)

- `frontend/javascripts/viewer/view/layouting/align_datasets_view.tsx` — the coordinator (§0.1 v1 rewrite; correspondence table redesigned in §0.6).
- `frontend/javascripts/viewer/view/action_bar/tools/toolbar_view.tsx` — `ToolSpecificSettings` hides `SkeletonSpecificButtons` for `bigwarpWorker` mode (§0.6).
- `frontend/javascripts/viewer/api/cross_origin_api.ts` — iframe postMessage bridge; has the v1 additions (`ensureLandmarkGroups`, `importNmlIntoGroup`, `exportTreesInGroupAsNmlString`, `exportTreesByIdsAsNmlString`, the `bigwarpShortcut` keydown relay) plus `save` (§0.9, backs the "Force Save" button); the "init" handshake itself was rewritten in §0.10 (general WK correctness fix, not BigWarp-specific).
- `frontend/javascripts/viewer/api/api_latest.ts` — backing implementations of the above cross-origin commands.
- `frontend/javascripts/viewer/controller.tsx` — `applyBigWarpWorkerSettingsIfNeeded()` (§0.1/§0.5) + the align-mode navigation blocker (§0.5).
- `frontend/javascripts/viewer/view/layouting/default_layout_configs.ts` — `getBigWarpWorkerLayoutConfig()` (§0.1, XY-only viewport).
- `frontend/javascripts/viewer/view/layouting/tracing_layout_view.tsx` — uses the above when `bigwarpWorker` is set.
- `frontend/javascripts/router/router.tsx` — the `/align-datasets/:datasetNameAndId` route. `RootLayout` always renders `<Navbar />` again as of §0.5.
- `frontend/javascripts/navbar.tsx` — restricts navigation-away affordances for `bigwarpWorker` mode while keeping the `navbarTracingSlot` portal target (§0.5); also hosts the `navbarAlignToolsSlot` portal target next to Help, used by the coordinator's own (unrestricted) navbar (§0.8).
- `frontend/javascripts/viewer/model/accessors/tool_accessor.ts` — `Toolkit.BIGWARP_LANDMARKS` (§0.5).
- `frontend/javascripts/viewer/view/action_bar_view.tsx` — `ModesView` hides the toolkit switcher for `bigwarpWorker` mode (§0.5).
- `frontend/javascripts/viewer/model/sagas/settings_saga.ts` — `pushUserSettingsAsync`/`pushDatasetSettingsAsync` SANDBOX guards (§0.5, general WK bug fix, same class as §0.4's).
- `frontend/javascripts/viewer/model/accessors/annotation_accessor.ts` — `mayEditAnnotationViewConfig` (§0.4, general WK bug fix found via this feature's QA).
- `frontend/javascripts/viewer/model/helpers/transformation_helpers.ts` — `Transform` type, affine/TPS creation.
- `frontend/javascripts/viewer/model/accessors/dataset_layer_transformation_accessor.ts` — layer transform resolution logic (cleaned up in §0.1, no BigWarp-specific code belongs here after all - see §3).
- `frontend/javascripts/libs/estimate_affine.ts` — least-squares affine estimation.
- `frontend/javascripts/libs/thin_plate_spline.ts` (`TPS3D`) — TPS primitive, not yet wired in.
- `frontend/javascripts/viewer/model/helpers/nml_helpers.ts` — `parseNml`/`serializeToNml`.
- `frontend/javascripts/viewer/model/sagas/skeletontracing_saga.ts:676-790` — `diffTrees`/`diffSkeletonTracing`, not used by v1 (§0.2 point 2), still the target if delete-sync is picked up.
- `frontend/javascripts/dashboard/advanced_dataset/dataset_action_view.tsx` — entry point #1 (§0.1, done).
- `frontend/javascripts/dashboard/dataset/dataset_settings_data_tab.tsx` — entry point #2 (§0.1, done).
- `docs/bigwarp_assets/notion_mockup.png` — the Notion doc's layout mockup, saved locally.
- PR #9082 (closed, = this branch's own hackathon PR) — https://github.com/scalableminds/webknossos/pull/9082
- PR #9591 (open, transform persistence to reuse) — https://github.com/scalableminds/webknossos/pull/9591
- Issue #7270 (open, annotation-layer coordinate systems) — https://github.com/scalableminds/webknossos/issues/7270
- Notion design doc — https://app.notion.com/p/scalableminds/Design-Doc-Bring-BigWarp-to-WK-3c2b51644c6380c69ec8ccb95e441426 (fetch with `ntn pages get 3c2b51644c6380c69ec8ccb95e441426`)
