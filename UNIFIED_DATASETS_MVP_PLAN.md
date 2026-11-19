# Unified datasets: MVP prototype plan

Status: plan, nothing built yet. Written 2026-11-18 from the "Annotation vs. dataset" slides and the team meeting notes.
Audience: the agent that builds the prototype. Read sections 1 to 4 before touching code; section 5 is the build order.

## 1. Goal and non-goals

**Goal.** A prototype, behind a feature flag, in which users only ever see one kind of object: the dataset. A dataset contains immutable data layers (color, segmentation) and editable annotation layers (skeleton, volume). The only operation on a dataset is *copy*. The prototype exists to judge look and feel on real data, so the UI has to be complete enough to click through, while the backend may take shortcuts.

**Non-goals for the prototype.**

- Tasks, projects and compound annotations. They stay on today's annotation code path and UI, untouched.
- Jobs writing into an existing dataset.
- Versioning of data-layer changes. Only annotation layers are versioned (as today).
- Merging layers, per-layer permissions, per-layer ownership, the lineage graph.
- The Python library and the public API versions.
- Production-grade migration. The conversion in section 4.6 has to work on a dev database; the production rollout is described in section 6 but not built.

**Vocabulary used in UI text.** "Dataset" for the object. "Data layer" for immutable layers. "Annotation layer" for skeleton and volume layers. The noun "annotation" for an object disappears from all unified-mode UI. "Copy" replaces "create annotation", "duplicate" and "copy to my account".

## 2. Architecture decision

**Keep annotations as an internal storage container; bind exactly one to each dataset.**

A unified dataset is a `datasets` row plus zero or one *backing annotation* (a normal `annotations` row of type `Explorational`, referenced by a new `datasets._annotation` column). The backing annotation holds the annotation layers and their FossilDB history. Users never see it as an object: it has no name, no list entry and no URL of its own.

Why this and not a new storage model:

- The tracingstore, FossilDB layout, update actions, versioning, save sagas, mutex and collaboration modes all keep working unchanged. Per-annotation versioning becomes per-dataset versioning of annotation layers for free.
- "Copy" maps onto two things that already exist: `ComposeService.composeDataset` (creates a virtual dataset whose layers point at the same storage paths, i.e. linked layers) and the tracingstore's `duplicateAnnotation` (copies annotation layers).
- Existing annotations convert without touching FossilDB: create a virtual dataset that links the source's layers, then re-point `annotations._dataset` at it (section 4.6).
- It matches the meeting's direction (Philipp, Florian, Norman): no huge migration, the internals may keep both tables.

Consequences to keep in mind:

- `annotations._dataset` stays, and for backing annotations it is always the dataset that points back at it. The binding is 1:1 and never moves after conversion.
- A "linked" data layer is a metadata copy pointing at the same paths, exactly as compose does today. There is no live reference, so changes to the source never propagate (meeting decision 1). Provenance is recorded separately for display.
- Only virtual datasets can have data layers added or removed in place (`ComposeService.addLayer` requires `isVirtual`). Copies are always virtual. Uploaded and disk-scanned datasets are not, so in the prototype their data layers are fixed and the UI says "make a copy to change data layers". Annotation layers can be added to any dataset.

## 3. Design decisions

These resolve the open points from the meeting for the prototype. Each is the recommended default, chosen to be cheap and to not paint the real migration into a corner. Items marked **confirm** are product decisions the team should revisit after trying the prototype.

| # | Topic | Decision |
|---|---|---|
| D1 | Owner | The dataset owner is `datasets._uploader`, shown as "Owner". For a copy it is the person who copied. If a dataset has no uploader (disk scan, old data), the fallback owner is the organization owner (`users.isOrganizationOwner`). No new column. |
| D2 | Who may edit annotation layers | The owner, plus anyone for whom `DatasetService.isEditableBy` holds (admin, dataset manager, team manager of an allowed team), plus whoever the existing collaboration mode admits. Everyone else opens the dataset read-only and gets a "Copy to edit" button. **confirm** |
| D3 | Who may copy | Any logged-in user who can read the dataset. No manager role needed. The copy is created in the source's folder without a folder write check. **confirm** (Philipp raised that requiring "manager" to compose would be odd.) |
| D4 | Read permissions | One level. Read access is today's dataset read access. On top, the backing annotation's `Private` visibility acts as an "only me" switch. `Internal` and `Public` add no restriction. A copy inherits the source's allowed teams, `isPublic` and folder. This never grants more than today, where opening an annotation also required reading its dataset. |
| D5 | Listing | Originals are listed as today. A copy is listed for its owner and for users it is shared with (the existing `ownedOrSharedQ` semantics). A toggle "Show copies by others" lists every copy the user may read. This keeps the list from exploding (meeting item 10). |
| D6 | Changes don't propagate | No propagation of layer changes to copies (meeting decision 1). |
| D7 | Brushing a segmentation | As today: a volume layer with the segmentation as fallback, shown to the user as one layer. In the UI this is "Extend a segmentation layer". The original is reachable through version history or by copying first. |
| D8 | Versioning | Annotation layers only, per dataset, via the backing annotation. Adding or removing a data layer is not versioned in the prototype. |
| D9 | Deleting a linked layer's source | Unchanged from compose today: data paths are only deleted when no other dataset uses them (`findPathsUsedOnlyByThisDataset`, `findDatasetsUsingDataFromDir`). The copy keeps working. |
| D10 | Tasks | Out of scope. Task annotations keep their URLs, the Tasks tab and all behavior. Target model in section 6. |
| D11 | Names | Datasets are named. Layers get a name prompt whenever one is added, copied or linked (Michael's note). The backing annotation's own name is unused. |
| D12 | Tags and description | Dataset tags and description are the only ones shown. Conversion hard-copies the annotation's into the new dataset. |
| D13 | Empty datasets | A dataset the user may edit starts with zero annotation layers. Annotation tools are disabled until a layer is added. See risk R1. |
| D14 | "Finished"/archive state | Hidden in unified mode. **confirm** whether datasets need one. |

## 4. Specification

Everything below is active only when the feature flag is on. With the flag off, behavior must be byte-for-byte today's.

### 4.1 Feature flag

`features.unifiedDatasets = false` in `conf/application.conf` (the `features {}` block, around line 180). Add it to `WkConf.Features` (`app/utils/WkConf.scala:168`) and to `APIFeatureToggles` (`frontend/javascripts/types/api_types.ts:801`). Read it in the frontend with `features().unifiedDatasets`.

### 4.2 Schema (evolution 194)

Add `schema/evolutions/194-unified-datasets.sql`, its reversion, and mirror the change in `schema/schema.sql` (bump `schemaVersion` to 194). Follow the guard pattern of `193-optional-task-experience.sql`.

```sql
ALTER TABLE webknossos.datasets ADD COLUMN _annotation TEXT UNIQUE;   -- backing annotation, nullable
ALTER TABLE webknossos.datasets ADD COLUMN _copiedFrom TEXT;          -- direct source of a copy, nullable

CREATE TABLE webknossos.dataset_layer_origins(
  _dataset TEXT NOT NULL,
  layerName TEXT NOT NULL,
  _sourceDataset TEXT NOT NULL,
  sourceLayerName TEXT NOT NULL,
  PRIMARY KEY (_dataset, layerName)
);
```

- Add foreign keys in the style of the existing ones: `_annotation → annotations(_id)`, `_copiedFrom → datasets(_id)`, `dataset_layer_origins._dataset → datasets(_id) ON DELETE CASCADE`. `_sourceDataset` gets no cascade; a deleted source just leaves a dangling name the UI shows as "deleted dataset".
- `webknossos.datasets_` is `SELECT *` and must be dropped and recreated in the evolution (see earlier evolutions that add dataset columns for the pattern).
- No enum changes. Copies use `creationType = Compose`; `_copiedFrom IS NOT NULL` is what identifies a copy.
- After applying: remember that `apply-evolutions` does not regenerate Slick tables on its own; touch `schema/refreshStamp/stamp`.

Extend `Dataset` (`app/models/dataset/Dataset.scala:65`) and its parsing with `_annotation: Option[ObjectId]` and `_copiedFrom: Option[ObjectId]`. `dataset_layer_origins` gets a small DAO of its own; do not thread it through the `DataSource` models.

### 4.3 Backend

New code goes into a `UnifiedDatasetService` (`app/models/dataset/`) plus thin controller actions in `DatasetController`. Routes go into `conf/webknossos.latest.routes` next to the dataset routes.

**B1. Backing annotation lookup: `POST /api/datasets/:id/backingAnnotation`**

Returns `{ annotationId: string | null, access: "edit" | "read" | "none" }`.

1. Check dataset read access with the request's context (anonymous allowed for public datasets).
2. If `_annotation` is set: compute `access` from the restrictions in B2 and return.
3. If it is not set and the user would be allowed to edit (D2): create an empty explorational annotation with `AnnotationService.createExplorationalFor(owner, dataset, List.empty)`, where `owner` follows D1, then claim it with `UPDATE datasets SET _annotation = ? WHERE _id = ? AND _annotation IS NULL`. If zero rows were updated, another request won; discard the new annotation (mark it deleted) and return the winner.
4. Otherwise return `{ annotationId: null, access: "read" }`. The viewer then opens in plain view mode.

**B2. Restrictions for backing annotations**

In `AnnotationRestrictionDefaults.defaultsFor` (`app/models/annotation/AnnotationRestrictions.scala:59`), branch when the annotation is a backing annotation (look up `datasets._annotation = annotation._id`; cache or pass the dataset in, don't query per restriction call):

- `allowAccess`: the user can read the dataset, and visibility is not `Private` unless the user is owner or team manager/admin (today's Private rule).
- `allowUpdate`: annotation is mutable, and the user is owner, or `datasetService.isEditableBy(dataset, user)`, or today's `othersMayEdit` rule applies.
- `allowUpdateWithMutex`, `allowFinish`, `allowDownload`: unchanged logic on top of the above.

Known gap, accepted: viewers who only have a dataset sharing token and no account get the dataset without its annotation layers, because `UserTokenController.handleAnnotationAccess` (line 197) does not understand dataset sharing tokens.

**B3. Copy: `POST /api/datasets/:id/copy`**

Body: `{ name: string, layerNames?: string[], includeAnnotationLayers: boolean }`. Returns `{ newDatasetId }`.

1. Read access on the source; user must be logged in.
2. Build a `ComposeRequest` from the source's own data source: all layers (or the `layerNames` subset), no transformations, the source's voxel size, the source's folder. Call `ComposeService.composeDataset`. It calls `createAndSetUpDataset`, which asserts folder update access (`DatasetService.scala:127`); add a parameter to skip that assertion for copies (D3).
3. Set `_copiedFrom`, copy `dataset_allowedTeams`, `isPublic`, `description`, `tags`, `metadata` from the source. `_uploader` is the copying user (already done by `addUploader`).
4. Insert one `dataset_layer_origins` row per linked layer. If the source layer itself has an origin row, copy that row's source instead, so the origin always names where the data really lives.
5. Annotation layers: if `includeAnnotationLayers` and the source has a backing annotation the user may read, duplicate it into the new dataset. `AnnotationController.duplicateAnnotation` (line 503) is the template; extract it into the service with a `targetDataset` parameter, because today it always reuses the annotation's own dataset. Otherwise create an empty backing annotation as in B1.
6. If the source has no data layers left to link (should not happen), fail with a clear message; compose rejects empty layer lists.

Compose requires source and target on the same datastore. That holds trivially for a copy.

**B4. Owner rights on copies**

Extend `DatasetService.isEditableBy` (line 645) and the SQL `isEditable` in `findAllCompactWithSearch` (`Dataset.scala:339`) with: the user is `_uploader` and `_copiedFrom IS NOT NULL`. This lets people rename, re-describe, add layers to and delete their own copies. It deliberately does not apply to originals.

**B5. Data layers: add and remove**

- Add: reuse `POST /api/datasets/:id/compose/addLayer` (`ComposeService.addLayer`). In unified mode, also insert the `dataset_layer_origins` row. Virtual datasets only; the endpoint already enforces it.
- Remove: `DatasetController.updatePartial` with a `dataSource` that omits the layer. Verify that this path accepts layer removal for virtual datasets; if not, add `DELETE /api/datasets/:id/layers/:layerName` that mirrors `addLayer`. Reject removal of a layer that a volume layer of the backing annotation uses as fallback. Delete the origin row.

**B6. List and detail payloads**

`GET /api/datasets` compact info (`DatasetCompactInfo`, `Dataset.scala:98`; SQL at 284 to 432) gains, when the flag is on:

- `ownerName` (uploader's name, same-organization only, as `uploaderFullNameFor` does),
- `copiedFromId`,
- `backingAnnotationId`,
- `annotationLayers: [{ name, typ }]` (join `annotation_layers` through `_annotation`),
- `modified` (the backing annotation's `modified`, else the dataset's `created`).

New list parameter `copies`: `mineAndShared` (default; originals plus copies matching `AnnotationAccessQueries.ownedOrSharedQ` on the backing annotation), `all`, `none`.

`DatasetService.publicWrites` (line 861) gains `owner`, `copiedFrom: { id, name } | null`, `backingAnnotationId`, and `layerOrigins: { [layerName]: { datasetId, datasetName, layerName } }`.

**B7. Deletion**

When a dataset with a backing annotation is deleted, mark the annotation deleted too, and make sure the backing annotation does not count in `countAllByDatasetIncludingDeleted` (`DatasetService.scala:793`), otherwise every unified dataset would only ever be soft-deleted.

**B8. Conversion endpoints.** See section 4.6.

### 4.4 Viewer

**Opening a dataset.** `TracingViewModeRouteWrapper` (`frontend/javascripts/router/route_wrappers.tsx:286`) is the single entry point. With the flag on it first calls B1:

- `annotationId` present and `access` is `edit` or `read`: render `TracingLayoutView` with `ControlModeEnum.TRACE` and that annotation id. The URL stays `/datasets/<name>-<id>/view`.
- `annotationId` present and `access` is `none`: show a "This dataset is private" page.
- `annotationId` null: render view mode as today.

`CreateAnnotationRouteWrapper` (line 129) is the model for the async-then-render pattern. Add `isUnifiedDataset` to the store's annotation slice (or an accessor comparing `annotation.annotationId` with the dataset's `backingAnnotationId`) so that all the conditionals below have one source of truth. Task and legacy annotations opened through `/annotations/:id` must not take any unified branch.

**Action bar** (`viewer/view/action_bar_view.tsx`, `action_bar/tracing_actions_view.tsx`, `action_bar/view_dataset_actions_view.tsx`, `action_bar/save_actions.tsx`):

- Remove the "Create Annotation" button (`CreateAnnotationButton`, line 174; rendered at 448).
- Title shows the dataset name only.
- Menu: "Copy dataset…" (replaces Duplicate and the sandbox "Copy To My Account"), "Version history" (the existing version restore), Download, Share, "Dataset settings" (link to `/datasets/:id/edit`). Hide Finish/Archive (D14).
- Read-only state: a persistent, unobtrusive banner or tag "Read-only" with a primary "Copy to edit" button that opens the copy modal. Also shown in view mode when `annotationId` was null.

**Layers tab** (`viewer/view/left_border_tabs/layer_settings_tab.tsx`, add buttons at 401 to 445):

- One list of all layers. Under each layer name a muted origin line: "linked from *l4_sample*" (from `layerOrigins`, linking to that dataset), "extends *segmentation*" for a volume layer with a fallback, or nothing for layers that are native to this dataset.
- Three buttons at the bottom, matching the slides:
  - "Add skeleton layer": existing `addLayerToAnnotation` dispatch (line 499), after a name prompt.
  - "Add volume layer": the existing `modals/add_volume_layer_modal.tsx`, restructured as two radio options, "Fresh, empty volume layer" and "Extend a segmentation layer" (with a select of segmentation layers), plus a name field.
  - "Add layer from another dataset": new modal with a dataset search select (reuse the dataset search from the compose wizard, `admin/dataset/composition_wizard/`), a layer select, and a name field. Calls B5, then reloads the viewer. Disabled on non-virtual datasets with the tooltip "This dataset's data layers are fixed. Make a copy to add or remove data layers."
- On each segmentation data layer: an "Edit" action (brush icon) that is a shortcut for "Extend a segmentation layer" with that layer preselected.
- Per-layer menu: Rename, Remove. Remove on annotation layers uses the existing `deleteAnnotationLayer`. Remove on data layers calls B5 and is subject to the same virtual-only rule.
- "Save view configuration as default" stays available to those who have it today; it must now also show while a backing annotation is loaded.

**Info tab** (`viewer/view/right_border_tabs/info_tab/dataset_info_tab_view.tsx`, `identity_block.tsx`):

- One identity block: dataset name, dataset description, owner, and "Copy of *X*" when `copiedFrom` is set.
- Remove "view dataset without annotation" (lines 84 to 95) and "Other annotations". Replace the latter with "*n* copies", linking to the dashboard filtered to this dataset's copies.
- Annotation name and annotation description editing are hidden; name and description edits go to the dataset (allowed per B4 or today's dataset edit rights).

**Share modal** (`viewer/view/action_bar/share_modal_view.tsx`): keep the existing modal for the prototype. Relabel visibility as "Private (only me)" / "Everyone with access to this dataset" and hide the `Public` option, since public access is governed by the dataset's own setting (D4). Team sharing in this modal continues to write annotation shared teams, which drive listing (D5).

**Copy modal** (new, shared by viewer and dashboard): name field (default `<name>_copy`), a checklist of data layers each tagged "linked", and one checkbox "Include annotation layers (*n*)" tagged "copied". Submits to B3 and navigates to the new dataset.

### 4.5 Dashboard

Files: `dashboard/dashboard_view.tsx` (tabs, `getTabs` at 185), `dashboard/dataset_folder_view.tsx`, `dashboard/advanced_dataset/dataset_table.tsx`, `dashboard/advanced_dataset/dataset_action_view.tsx`, `dashboard/folders/details_sidebar.tsx`, `dashboard/dataset/queries.tsx`.

- Hide the "Annotations" tab. Keep Datasets, Tasks, Publications.
- Above the table, a filter bar:
  - Segmented control "Show": All · Without annotation layers · With annotation layers.
  - Switch "Group copies" (default on).
  - Switch "Show copies by others" (default off; maps to `copies=all`).
- Grouping: with "Group copies" on, a copy is rendered as a child row of its source using antd Table tree data (`children`). Resolve the parent by walking `copiedFromId` within the loaded rows; a copy whose source is not in the result set (other folder, no access, filtered out) is shown at top level. With grouping off, the list is flat and each copy shows "copy of *X*" under its name.
- Columns: Name, Layers (existing data-layer tags plus distinct tags for skeleton and volume layers), Owner, Last modified, Actions.
- Actions per row: Open, Copy (opens the copy modal), Settings, and the existing overflow menu. Remove "New Annotation" and "Resume Annotation" links (`dataset_action_view.tsx:26` and `:38`) and `create_annotation_modal.tsx` usage in unified mode.
- Details sidebar: layer list with origins, owner, "Copy of", number of copies. Remove the annotation count link.

Follow the existing frontend conventions in this area: small focused components and hooks, typed antd table models, react-query for the list (mind that the query cache persists to localStorage, so include the new filter parameters in the query keys).

### 4.6 Converting existing data (prototype)

**Datasets** need no conversion. They get a backing annotation lazily through B1 the first time someone with edit rights opens them.

**Explorational annotations** each become a dataset. `UnifiedDatasetService.convertAnnotation(annotationId)`, idempotent:

1. Skip unless the annotation is `Explorational`, not deleted, and not already a backing annotation.
2. Load its dataset *S*. Create a virtual dataset *N* by composing all of *S*'s layers, exactly as in B3 steps 2 to 4, but with: owner (`_uploader`) = the annotation's `_user`; name = the annotation's name if non-empty, else `<S.name>_annotation_<last 6 chars of annotation id>`; description = the annotation's description if non-empty, else *S*'s; tags = the annotation's tags; `created` = the annotation's `created`; `_copiedFrom` = *S*; folder, allowed teams and `isPublic` from *S*.
3. In one transaction: `UPDATE annotations SET _dataset = N`, `UPDATE datasets SET _annotation = <annotation> WHERE _id = N`. Leave visibility, shared teams, contributors, collaboration mode and private links on the annotation as they are; D4 and D5 read them from there.
4. Copy the owner's `user_datasetConfigurations` and `user_datasetLayerConfigurations` rows from *S* to *N* so their layer settings survive.

No FossilDB data is touched. The tracingstore resolves fallback layers by name within the annotation's dataset, and *N* has the same layer names pointing at the same paths as *S*, so volume layers keep working. The tracingstore's `datasetIdByAnnotationIdCache` (`TSRemoteWebknossosClient.scala:55`) has no expiry and may still answer *S* until restart; that is harmless while *N* and *S* have the same layers, but give the cache a short TTL so later layer changes on *N* are picked up.

Two ways to trigger it:

- **Lazy:** when `/annotations/:id` is opened with the flag on and the annotation is explorational, call `POST /api/annotations/:id/convertToDataset` (requires read access to the annotation) and redirect to `/datasets/<name>-<newId>/view`, preserving query string and hash. If it is already a backing annotation, just redirect. Old links keep working this way.
- **Batch, for trying the prototype on a full dev database:** `POST /api/maintenance/convertAnnotationsToDatasets?organizationId=&limit=`, super-user only, runs the conversion serially and reports counts and failures. Annotations whose dataset is unusable or deleted are skipped and reported.

There is no reverse conversion. Reverting the prototype means restoring the dev database, so take a dump before running the batch.

## 5. Build order

Each phase ends in something clickable. Run `yarn typecheck`, `yarn check-frontend`, `yarn test`, `sbt --client compile` and `yarn test-backend` as appropriate after each, and verify with the flag off that nothing changed.

1. **Edit in place.** Flag (4.1), evolution (4.2), B1, B2, the route wrapper change in 4.4. Result: opening a dataset as its owner or an admin lets you add a skeleton layer, trace, save, reload and see the work still there. This phase alone resolves the "my work vanished" problem from the slides and is the first thing to demo.
2. **Viewer chrome.** The rest of 4.4 except the copy modal and "Add layer from another dataset".
3. **Copy.** B3, B4, B7, the copy modal, read-only banner wiring.
4. **Dashboard.** B6 and 4.5.
5. **Conversion.** 4.6, lazy redirect first, then the batch endpoint.
6. **Data layers.** B5 and the "Add layer from another dataset" modal and data-layer removal.

Phases 1 to 4 are the core of the look and feel. 5 makes it testable on existing data. 6 can be dropped if time runs out.

## 6. Target model and production migration (not built in the prototype)

How the prototype's shortcuts are meant to grow into the real thing, so the prototype's choices can be judged against it.

**Conversion at scale.** Converting every annotation into a virtual dataset multiplies `dataset_layers` and `dataset_mags` rows by the number of annotations (a 5-layer, 8-mag dataset adds about 45 rows per copy). That is fine for explorational annotations in a prototype and questionable for production, and clearly too much for tasks. The recommended target is *reference links*: a linked layer is a row that names its source dataset and layer and carries no mags of its own, resolved when the data source is built. `dataset_layer_origins` is the seed of that. Reference links also give real answers to "what happens when the source layer is deleted" and to the lineage graph, at the price of deciding propagation semantics again (a reference would see source changes unless it is pinned).

**Rollout.** Lazy conversion on open plus a throttled background batch, per organization, behind the flag. No big-bang migration. Old `/annotations/:id` URLs redirect permanently. Both list UIs cannot coexist per organization, so the flag flips for an organization once its batch is done.

**Mapping of today's annotation fields.**

| Today | After conversion |
|---|---|
| annotation name, description, tags | dataset name, description, tags (hard copy) |
| owner (`_user`) | dataset owner (`_uploader`) |
| visibility Private | "only me" switch on the dataset |
| visibility Internal | no extra restriction; dataset permissions apply |
| visibility Public | no extra restriction; public access only if the dataset itself is public or opened with its sharing token. Copy the source's sharing token to the new dataset so previously shared links keep working. |
| shared teams, contributors | drive listing; later merge into dataset allowed teams |
| collaboration mode, mutex, locked | unchanged, on the backing annotation |
| state Finished (explorational "archived") | needs a decision (D14) |
| "based on dataset X" | "Copy of X", plus per-layer origins |

**Tasks.** Recommended: keep task annotations on the legacy path until reference links exist, then represent each task instance as a dataset with a task marker that is excluded from lists by default (Philipp's and Valentin's proposal). This avoids blocking the unification on live collaboration (Michael's concern) and avoids the row explosion.

**Later, in rough order:** a real `isPrivate` and owner on the dataset instead of reading them from the annotation; versioning of data-layer changes; jobs with "add to this dataset" as output target; merge-into-existing-layer when adding a layer; retiring "Compose dataset"; per-layer permissions if the team still wants them; Python library overhaul.

## 7. Risks and things to verify early

- **R1. Annotations with zero layers.** The viewer and backend have probably never run with an explorational annotation that has no layers. `Annotation.tracingType` (`Annotation.scala:62`) has a default for it, and `createLayersForExplorational` accepts an empty list, but tool availability, the save saga and `api.tracing` helpers need a check. Verify in phase 1 before anything else. If it turns out to be a rabbit hole, create the backing annotation with one empty skeleton layer and treat "has annotation layers" as "has a non-empty skeleton or any volume layer" in the list filter.
- **R2. Layer identity.** `getMergedDataLayersFromDatasetAndVolumeTracings` (`viewer/model_initialization.ts:638`) replaces a fallback segmentation layer by the volume layer and uses the tracing id as layer name. Per-layer view settings are therefore keyed differently before and after "extend". Acceptable for the prototype; note what users see.
- **R3. Reload on layer changes.** Adding a volume layer hard-reloads today (`add_volume_layer_modal.tsx:232`). Adding or removing a data layer also needs a full reload plus datastore cache invalidation (already done by `addLayer`). Don't try to make these live.
- **R4. Concurrent editors.** With D2, an admin and the owner can both have edit rights without the mutex. The second saver gets today's version-conflict message. Acceptable for the prototype; if it annoys testers, default backing annotations of originals to the `Exclusive` collaboration mode.
- **R5. Permission checks on the tracingstore path.** B2 must check dataset read access itself, because the tracingstore authorizes by annotation id alone. Don't rely on the frontend having loaded the dataset.
- **R6. Storage accounting.** Linked layers share paths with their source. Check that `organization_usedStorage_*` does not bill a copy's layers a second time, or ignore the numbers on copies in the prototype UI.
- **R7. redux-saga.** If new sagas use `try/finally`, heed the pitfall in `AGENTS.md` about yielding effects in `finally` blocks.

## 8. Demo checklist

With the flag on and the batch conversion run on a dev database:

1. The dashboard has no Annotations tab. Former annotations appear as rows nested under their source dataset.
2. Opening a dataset you own shows no "Create Annotation" button. Add a skeleton layer, place nodes, reload: the nodes are still there under the same URL.
3. "Edit" on a segmentation layer lets you brush. The layer list still shows one segmentation layer, captioned "extends segmentation".
4. A user without edit rights sees "Read-only" and "Copy to edit". The copy opens under a new URL, lists data layers as "linked from …", and is editable.
5. In a copy, "Add layer from another dataset" adds a color layer from a second dataset; removing it works too.
6. An old `/annotations/<id>` link redirects to its dataset.
7. Version history on a dataset restores an earlier state of the annotation layers.
8. Task annotations and the Tasks tab behave exactly as before.
9. With the flag off, everything behaves exactly as before.
