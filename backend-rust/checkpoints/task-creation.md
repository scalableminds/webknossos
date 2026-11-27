# Task creation checkpoint (POST /tasks)

2026-10-10. Owner: task-creation sub-agent (target /tmp/webknossos-rust-verify-a). Owns
src/task_creation.rs, tests/task_creation.rs, this file. `task_creation::router(jobs_enabled)`
signature unchanged (flag unused). No other files edited, no visibility changes (uses existing
pub(crate) `annotation_create::{find_dataset, usable_data_source, tracing_store_url, DatasetFacts,
UsableSource}`, `annotation_duplicate::{insert_annotation, NewAnnotation}`, `tasks::public_json`,
`tracing_initialization::{plan_volume_tracing, ...}`, `TracingStoreClient::long_clients()`).

## Contract (TaskController.create + TaskCreationService)

Whole-request failures, in Scala order (crate JSON error body):
1. 401; body `List[TaskParameters]` (serde; Option fields missing/null → None) else 400 `Invalid JSON request body.`
2. empty → 400 `Zero tasks were requested.`; differing taskTypeId → 400 notOnSameTaskType;
   task type not readable (team member / org admin) → 400 `Task type “id” could not be found or accessed.`
3. differing datasetId → 400 notOnSameDataset; dataset unreadable → 400 `Dataset “id” could not be found…`;
   usableDataSourceFor (400 notUsable / 404 no voxel size); other org → 400 datasetOfOtherOrga.
4. batch limit 100 (volume/hybrid) / 1000 (skeleton) → 400 `Cannot create more than N tasks in one request.`
5. new ids (annotation ObjectId, tracing UUIDs per tracing type).
6. base annotations, serially: invalid baseId → 400 ObjectId.invalid; annotation readable by requester
   (any type/state) else task readable with total=1, pending=0, first non-cancelled readable Task
   annotation Finished (else 400 notOneAnnotation; missing task → Fox.empty → 404
   `Could not find or access the requested resource.`); >1 layer of a requested type → 400 multiLayers…;
   tracing store; skeleton: `POST /tracings/skeleton/:id/duplicate?token&newAnnotationId&newTracingId&ownerId
   &requestingUserId&editPosition&editRotation[&boundingBox]` (long) or fresh skeleton `save`; volume:
   temp data source under newAnnotationId + `POST /tracings/volume/:id/duplicate?...&minMag&maxMag` (long,
   no boundingBox, as Scala) or fresh volume base + `volume/save`. RPC failures keep upstream status.
7. fresh skeleton bases (createSkeletonTracingBase: one tree/node id 1 + branch point, red, datasetName
   "unused", non-empty box) and fresh volume bases (createVolumeTracingBase, no fallback: datastore must
   exist else Fox.empty 404; mags filtered by task type magRestrictions → 400 magRestrictionsTooTight;
   non-empty task box else data source box; start position/rotation).
8. createTasks: one dataset among successful items, readable, usable; each has base/skeleton/volume
   (400 needsEitherSkeletonOrVolume); Slack notice for base tasks = tracing::info; tracing store (400);
   `POST /tracings/skeleton/saveMultiple` (SkeletonTracingsWithIds, one entry per item, long, JSON
   `List[Box[Boolean]]`) — failure fails the request with upstream status.

Per-task items (`{"status":200,"success":<task publicWrites>}` / `{"status":s,"error":msg}`), request order:
volume saves serial (failure → `Could not save volume tracing for new task.` keeping upstream status);
saveMultiple non-Full → 400 `Could not save skeleton tracing for new task.`; project by name in user org
under project read access → `Project with name “x” could not be found or accessed.`; script readable →
`Script “id” could not be found or accessed.`; team manager of project team or org admin: missing team →
`You do not have permission to administrate this team.`, false → `Empty` (Fox.assertTrue); then
`POST /tracings/annotation/save?annotationId=<fresh TracingBase id>` (proto: description "", v0, layers
Skeleton/"Skeleton", Volume/"Volume", earliest 0; failure → item with upstream status); then one tx:
task (total=pending=pendingInstances, domain trimmed, empty box → NULL, created now ms), experienceDomains
ON CONFLICT DO NOTHING, TracingBase annotation (requester, Internal, Active, OwnerOnly, name "",
description or "", layers stats `{}`); then `tasks::public_json(user, global=false)`. DB 4xx (e.g. check
violation for negative pendingInstances / short domain) → item `Invalid resource values.`; 5xx fail the request.
Warnings (after all items, as Scala): distinct project names in order; missing project fails the WHOLE
request (400 project notFound) even though other tasks were already created (Scala quirk kept, tested);
team not in dataset_allowedTeams ∪ cumulative folder teams and (no dataset teams or has a non-admin,
non-deactivated member outside them) → `Project team “T” has no read permission to dataset “D”.`;
unreadable team → Fox.empty 404.

## Reuse API for POST /tasks/createFromFiles (all pub(crate) in crate::task_creation)

- Types: `TaskParameters` (+ `Experience`, `BoundingBox`, `BaseAnnotation`), `TaskTypeFacts { id,
  tracing_type: TracingType, mag_restrictions }`, `VolumeBase { tracing, initial_data: Option<Vec<u8>> }`,
  `RequestedTask { params, skeleton, volume }`, `RequestedTaskResult = Result<RequestedTask, TaskFailure>`,
  `TaskFailure { message, status }` (`TaskFailure::new(msg)` = plain 400 Box failure),
  `CreationServices` (axum extractor: TracingStoreClient + AnnotationProvider).
- `find_task_type(pool, user, id) -> ApiResult<Option<TaskTypeFacts>>` (createFromFiles maps None to
  `TaskType.notFound ~> 404`), `assert_batch_limit(n, &tt)`, `add_new_ids(&mut params, &tt)`
  (addNewIdsToTaskParametersBoxed: only on Ok items), `find_readable_dataset(pool, user, id)`.
- `skeleton_tracing_base(bbox, pos, rot)`, `volume_tracing_base(pool, &DatasetFacts, &UsableSource, bbox,
  pos, rot, mag_restrictions)` (fillInMissingTracings for hybrid).
- `create_tasks(pool, &services, Vec<RequestedTaskResult>, &tt, &user) -> ApiResult<Value>` =
  TaskCreationService.createTasks incl. all-failed short-circuit (items `Err`), saveMultiple, volume saves
  with `initial_data` → `POST /tracings/volume/:id/initialData?annotationId&minMag&maxMag` (long,
  application/octet-stream), inserts, warnings; returns the TaskCreationResult JSON to wrap in 200.
- Message consts/fns: NO_TASKS, NOT_ON_SAME_TASK_TYPE, NOT_ON_SAME_DATASET, DATASET_OF_OTHER_ORGA,
  NEEDS_EITHER_SKELETON_OR_VOLUME, SAVE_SKELETON_FAILED, SAVE_VOLUME_FAILED, NOT_ONE_ANNOTATION,
  batch_limit_exceeded, task_type_not_found, project_not_found.
  createFromFiles must do its own project-by-name + isTeamManagerOrAdminOf (Fox.assertTrue) checks first,
  addVolumeFallbackBoundingBoxes and buildFullParamsFromFiles.

## Deviations

- Per task, the AnnotationProto RPC runs BEFORE the DB writes and task + experience + TracingBase are one
  transaction (Scala inserts the task first, so an RPC failure leaves a task without TracingBase there;
  here no rows). Orphaned tracing-store data on later failures, as in Scala.
- Tasks are processed sequentially (Scala starts per-task futures concurrently); result order is identical.
- saveMultiple response shorter than the request: missing entries treated as Empty (Scala's lazyZip would
  drop those tasks from the result).
- RPC transport failures without upstream status → 400 with the crate ServiceError message (crate convention).
- `resolveBaseTaskId` takes the earliest (created, _id) non-cancelled readable Task annotation (Scala: arbitrary head).
- serde integer parsing rejects `1.0` for Int fields (Play accepts integral doubles).

## Parent notes

- POST /tasks NEEDS the long-RPC timeout exemption in lib.rs `uses_long_rpc`: `(&Method::POST, ["tasks"])`
  (saveMultiple, skeleton/volume duplicate and initialData are `withLongTimeout`). Also needed later for
  `["tasks", "createFromFiles"]`.
- Regenerate inventory (`python3 tools/route_inventory.py`).
- Volume bases from the JSON route are fully implemented (fresh + duplicated). Not implemented here:
  createFromFiles (NML parsing, multipart, fallback bounding boxes) — next agent.

## Status / Done / Next / Evidence

Status: COMPLETE.
Done: route + reuse core + 4 unit tests (java double literals/box literal, Play TaskParameters format,
batch limit + ids per tracing type, skeleton base shape); tests/task_creation.rs 6 DB tests with a recording
mock tracing store: skeleton tasks (rows, TracingBase + layers, pending, experience domain, saveMultiple/
annotation-save bodies, task JSON, warnings none/Team B), hybrid + volume fresh bases (volume proto box/mags/
position, layers), per-task volume save failure (500 item, no rows), base annotation duplication (skeleton
duplicate query keys/values, fresh volume for missing layer, volume duplicate with minMag, base via finished
task, notOneAnnotation, unknown base 404, invalid id 400, duplicate 502 → whole failure), validation/permission
failures with no RPC and no rows (401, invalid JSON, missing field, noTasks, differing type/dataset, task type
unreadable 400, foreign org, unknown/unusable dataset, batch limits 100/1000, mags too tight), per-task items
(Empty for non-manager, script not found, negative pending 400, saveMultiple Failure, annotation save 503
keeps status, unknown project fails whole request after creating others), saveMultiple 503 whole failure,
no tracing store 400.
Evidence (verify-a, PG 55439): `cargo test --test task_creation -- --include-ignored` 6 passed (2 runs);
`cargo test --lib task_creation` 4 passed; `cargo clippy --locked --offline --all-targets -- -D warnings`
exit 0; `rustfmt --edition 2024 --check` on both files clean.
