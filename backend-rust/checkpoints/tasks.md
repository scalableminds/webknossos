# Task routes migration checkpoint

Updated: 2026-10-08. Agent: tasks_stage2. Ownership: `src/tasks.rs`, `tests/tasks.rs` (plus this checkpoint). Parent owns wiring, route inventory, migration docs, central Cargo checks.

## Finished implementation

Eight routes: GET/PUT/DELETE `/tasks/{id}`, POST `/tasks/list`, GET `/taskTypes/{id}/tasks`, GET `/projects/{id}/tasks`, GET `/tasks/experienceDomains`, GET `/user/tasks/peek`.

Task JSON resolves a live noncancelled TracingBase annotation under requester annotation visibility and applies the shared `dataset_access::READ_PREDICATE`. Status active count applies the same annotation read scope. Task type JSON uses parent-exposed `task_types::PUBLIC_TASK_TYPE` under global access; script lookup is requester organization scoped (global for peek), owner compact JSON uses parent-exposed `scripts::SELECT_SCRIPT` matching ScriptService's global owner serialization. Missing script serializes null. All TaskService fields preserved, no invented parent response.

Read requires project team membership or organization admin; list requires manager/admin. Live team and project organization are explicitly scoped, including peek, following parent's security review. Project task pagination preserves descending task id and optional X-Total-Count header. Project manager permission uses held SQL connection to avoid deadlock with a one-connection pool.

PUT validates the full Scala TaskParameters body but mutates only pending instance count by adjusting totalInstances; it locks project then task, holds managed live team through commit, uses checked arithmetic, and relies on schema trigger to adjust pendingInstances. DELETE soft-deletes task and annotations transactionally; annotation counter triggers continue to run.

Peek uses experience domain/level, user team memberships (even admins), pending count, project priority/paused state, exclusion of prior user Task annotations, and manager/admin exception for Cancelled annotations. Response serialization uses global context, matching Scala. No assignment side effect.

## Explicit exclusions

POST `/tasks`, POST `/tasks/createFromFiles`, POST `/user/tasks/request`, POST `/tasks/{id}/assign` remain unimplemented because correct creation/assignment requires tracing service calls and rollback compensation. No stubs or success responses added.

## Tests and checks

`rustfmt --edition 2024 src/tasks.rs tests/tasks.rs` run successfully. Parent central compile currently running; no Cargo commands run by this agent to avoid shared target lock contention.

One unit test covers full update body validation and vector shape. Four ignored isolated-database integration tests cover full JSON and requester annotation/dataset privacy, manager lists/filters/pagination/count/domain org scoping, updates/negative rollback/concurrent absolute pending updates/soft-delete counter triggers, and peek experiences/cancellations/global privacy/no side effects.

## Pending and next step

Parent will wire modules and run compile/Clippy/test plus ignored PostgreSQL tests on 55439. Fix any reported failure in owned files. Independently review fixture/query SQL and add regression coverage for one-connection pagination and stale cross-organization membership if useful. Update this checkpoint after central results and any changes.

## Central results update

Compile passed. First ignored DB test run failed in all four fixtures before reaching routes: tasktypes.settings_branchpointsallowed and settings_somaclickingallowed require explicit values. Fixture insert now supplies both true; schema required columns reviewed. Parent notified to rerun. Added one-connection project pagination regression and stale foreign team membership peek regression.

## Verified result

Parent central compiler passed. After fixing required tasktype fixture booleans, all four task database integration tests passed against the real isolated schema on PostgreSQL port 55439. This includes the one-connection pool and stale foreign membership regressions. Implementation complete in owned files; parent handles full final checks and migration inventory/docs. Additional parent-requested work: read-only review of dataset layers/attachments/transforms serialization while dataset agent writes tests. Do not edit dataset-owned files.

## Dataset read-only review milestone (2026-10-09)

Confirmed full_layers attachments wrapper, singleton selection, realPath fallback, upload-pending exclusions, uint24-derived channel count, mags/resolutions array shape and unsigned largestSegmentId encoding against Scala DAO/writers. Reported actionable gaps to parent and dataset agent: transformations need type-specific validation and opposite-field removal; axisOrder needs typed parsing/canonical JSON (invalid axisOrder omitted, null optional and unknown keys dropped); mappings must deduplicate to match Scala Set. Dataset agent acknowledged and is implementing all three. No dataset-owned files edited. Dataset agent requested additional read-only configuration merge/access review; proceeding without edits.

## Configuration read-only review milestone (2026-10-09)

Reviewed all four configuration routes against ConfigurationController, DatasetConfigurationService, UserService, UserDatasetConfigurationDAO, SecuredSQLDAO, and ThumbnailCachingService. Normal merge order/access, requested volume layers, personal per-layer invalid-entry skipping, admin whole-map invalid-entry skipping, and cache invalidation match.

Reported important admin PUT access gap: initial global dataset lookup does not make downstream datasetDAO.updateAdminViewConfiguration global. It calls assertUpdateAccess in requester context, default updateAccessQ is readAccessQ. Current Rust lock_edit(require_read=false) incorrectly permits foreign organization dataset managers to update unreadable datasets; dataset agent told to require read as well and test it.

Reported reference lock gap: personal PUT FOR KEY SHARE does not block soft-delete non-key UPDATE; use FOR SHARE to hold live existence through inserts.

Reported malformed datasource read gap: configuration complete() currently selects layer configs directly without DatasetService.allLayersFor's voxel-size and full layer validation. Scala malformed usable datasource causes personal POST saved and default attempts to fail then return {}, and admin GET errors. Dataset agent informed; no owned configuration/dataset edits made.
