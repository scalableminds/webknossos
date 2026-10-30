# Task creation from files checkpoint (POST /tasks/createFromFiles)

Owner: task-creation-from-files sub-agent (target /tmp/webknossos-rust-verify-b). Owns
src/task_creation_from_files.rs, tests/task_creation_from_files.rs, this file. Router
`task_creation_from_files::router(jobs_enabled)` (flag unused), already merged in lib.rs and covered by
`uses_long_rpc` (`POST /tasks/createFromFiles`).

## Contract (TaskController.createFromFiles + TaskCreationService)

Multipart: file parts (Play `body.files`, kept in request order; only names whose lowercase ends with
`.nml`/`.zip`) and data part `formJSON` = `NmlTaskParameters {taskTypeId, neededExperience,
pendingInstances, projectName, scriptId?, boundingBox?}`. Route-local `DefaultBodyLimit` 1 GiB (Play
`maxDiskBuffer`); parts are held in memory (Play spools to disk).

Whole-request failures, Scala order: 401 → not multipart 400 `Could not parse task creation multipart
request.` → no input file 400 `Could not extract NML file.` → no formJSON 400 `…: no form data.` → JSON
does not parse 400 `Could not create task.` → task type not readable 404 `Task type “id” could not be found
or accessed.` → batch limit over the number of input files (100 volume/hybrid, 1000 skeleton) → project by
name in user org (read access) 404 `Project with name “x” …` → `Fox.assertTrue(isTeamManagerOrAdminOf)`:
team missing 400 `Team.adminNotAllowed`, false 404 `Could not find or access the requested resource.`

Then: `extract_from_files(useZipName=false, isTaskUpload=true)` → `to_boxes()` →
addVolumeFallbackBoundingBoxes (every parsed volume whose box is empty gets the data source box; dataset read
globally, missing → 404, unusable → usableDataSourceFor error; runs for all task types) →
buildFullParamsFromFilesForSingleTask (box/position/rotation from the parsed skeleton, form box wins,
`creationInfo` = file name, description = NML description incl. "") → new ids on Ok items →
fillInMissingTracings + combineParamsWithTracings (skeleton type drops volumes; volume type drops skeletons,
volume failure (multi-layer) → item; hybrid: missing volume → fresh volume base, ANY failed file fails the
whole request with its message, 400) → `task_creation::create_tasks` (volume save + `initialData` with the
data zip bytes, saveMultiple, inserts, warnings). Per-file parse failures are task items
`{"status":400,"error":"Couldn’t parse file: f. err"}`; all-failed → 200 with only failure items, no RPC.

## Review result (2026-10-11)

Source (written by an earlier attempt, untested) was reviewed line by line against Scala; it was complete:
volume layer + data zip → `VolumeBase.initial_data`, fallback bounding boxes, hybrid fresh volume bases were
already present. Only change: rustfmt + doc comment on hybrid whole-request failure. No source fix needed.
Visibility used (already pub(crate), no change made by this pass): `task_creation::find_project`,
`find_readable_dataset`, `TaskTypeFacts`, `volume_tracing_base`, `annotation_create::{find_dataset,
usable_data_source}`, `annotation_sandbox::dataset_not_found`, `tracing_initialization::data_source_bounding_box`.

## Deviations

- Scala quirk kept (inherited from create_tasks, now tested): volume save/initialData use the parameters'
  `newAnnotationId`, which differs from the TracingBase annotation id that gets the AnnotationProto.
- Multipart parts in memory instead of disk spooling; zip extraction limits from U1 (10k entries, 2 GiB,
  depth 8) are Rust-only and reject the request with 400.
- All create_tasks deviations (checkpoints/task-creation.md) and U1 extraction deviations
  (checkpoints/annotation-upload-service.md) apply.

## Status / Done / Next / Evidence

Status: COMPLETE (2026-10-11).
Done: Scala review; tests/task_creation_from_files.rs, 4 DB tests with a recording mock tracing store:
(1) one NML (+ ignored .txt) → one skeleton task with the uploaded skeleton as base (saveMultiple tree,
task row box/position/rotation/creationInfo, TracingBase description + layer, AnnotationProto);
(2) zip with two NMLs (reverse entry order, form box override, sub-path creationInfo) + broken NML + NML with
unknown dataset → 2 tasks + 2 failure items, saveMultiple with empty entries; only failing files → 200, no RPC;
(3) volume type: zip NML volume + data_Volume.zip → volume save with data-source fallback box + initialData
(octet-stream, exact bytes, annotationId = newAnnotationId), multi-layer NML → item; hybrid: uploaded volume
keeps task box, initialData minMag=2, skeleton-only NML gets fresh volume base (mags ≥ 2), layers Skeleton+Volume;
volume type with skeleton-only NML → 400 needsEitherSkeletonOrVolume; hybrid with a broken file → whole 400;
(4) 401, non-multipart, no input file, missing/invalid/incomplete formJSON, unknown task type, task type
unreadable (no team / foreign org), unknown project, team member not manager → 404 empty, volume batch limit 101
→ 400; none make RPCs or rows; org admin without team role succeeds.
Evidence (verify-b, PG 55439): `cargo test --locked --offline --test task_creation_from_files --
--include-ignored` → 4 passed (3 runs); `rustfmt --edition 2024 --check` on both files clean; `cargo clippy --locked --offline
--all-targets -- -D warnings` exit 0 (third attempt; first two failed only in other agents' in-flight
annotation_upload.rs / tests/annotation_download.rs).
