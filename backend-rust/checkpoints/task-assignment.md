# Task assignment checkpoint (POST /tasks/:id/assign)

2026-10-10. Owner: task-assignment sub-agent (target /tmp/webknossos-rust-verify-c). Owns src/task_assignment.rs, tests/task_assignment.rs, this file. `task_assignment::router(jobs_enabled)` signature unchanged (already merged by parent; jobs flag unused). No other files edited, no visibility changes (uses existing pub(crate) `users::READ_ACCESS_PREDICATE`, `annotation_access::READ_PREDICATE`, `dataset_access::READ_PREDICATE`, `tasks::public_json`, `annotation_duplicate::{DuplicateAnnotationRequest, duplicate_in_tracing_store}`).

## Contract (TaskController.assignOne)

SecuredAction (401). Order, all reads in the requester's access context:
1. `userService.findOneCached(userId)`: users_ + UserDAO.readAccessQ (manages a shared team, org admin, or self). Empty → 404 `Could not find or access the requested resource.`
2. `taskDAO.findOne(id)`: tasks_ + TaskDAO.readAccessQ (project team member or admin of the team's org). Empty → 404 (same message). Deleted task → 404.
3. `projectDAO.findOne(task._project)`: projects_ + ProjectDAO.readAccessQ. Empty → 404.
4. `Fox.assertTrue(isTeamManagerOrAdminOf(requester, project._team)) ?~> notAllowed` → 400 `You are not authorized to view or edit this resource.` (assertTrue DOES stop on false; no `~>` status → 400). Team read globally from teams_.
5. `Fox.assertTrue(isTeamManagerOrAdminOf(requester, assignee)) ?~> notAllowed` → 400 (effectively implied by step 1).
6. `taskDAO.assignOneTo(id, userId) ?~> task.unavailable` → 400 `There is currently no task available.` No team/experience/duplicate-assignment checks for the assignee (Scala parity; same user can get several instances).
7. createAnnotationFor + abort-on-failure; the createAnnotationFor failure is returned unwrapped (Play rendering: Fox failure 400, ParamFailure keeps upstream RPC status, DB faults crate convention).
8. `Ok(taskService.publicWrites(task)(GlobalAccessContext))` — plain task JSON (no `messages`), via `tasks::public_json(.., global=true)`.

Query: `userId` missing → 400 `Missing parameter: userId`; invalid → 400 crate ObjectId message (auth checked first, crate convention). Path id accepts Play's prefixed form.

createAnnotationFor (context user = requester here, = assignee in `request`): TracingBase of the task (annotations_, typ TracingBase, state<>Cancelled, AnnotationDAO.readAccessQ) else 400 `Failed to retrieve annotation base id.`; dataset (datasets_ + dataset READ_PREDICATE, no sharing token) else 400 `Dataset “d” for annotation “base” does not exist or could not be accessed.`; not usable → 400 `Dataset “d” is not imported or incomplete.`; first tracing store (400 `Tracing store could not be found or accessed.`) + duplicate RPC (source = base, newAnnotationId = Initializing id, ownerId = base owner, requestingUserId = assignee, isFromTask=false, no version/box); updateInitialized: `_dataset`, description, visibility, name, tags, tracingTime, collaborationMode from the base; `_user` = assignee, state Active, typ Task, created = modified = now (ms), isDeleted false; layers deleted + re-inserted (statistics `{}`), one transaction. isLockedByOwner stays false (not in Scala's UPDATE).

pendingInstances: only via schema triggers — Initializing insert decrements; Initializing→Active keeps it; abort DELETE increments again.

No compound-cache invalidation and no time tracking (Scala's assignOne does neither).

## Reuse API (for POST /user/tasks/request, TaskController.request)

All in `crate::task_assignment`, pub(crate):
- `lock_task_with_pending_instances(&mut PgConnection, task_id) -> ApiResult<bool>` — `SELECT .. FROM tasks WHERE _id AND NOT isDeleted AND pendingInstances>0 FOR UPDATE`.
- `insert_initializing_annotation(&mut PgConnection, task_id, user_id) -> ApiResult<Option<ObjectId>>` — the assignOneTo/assignNext INSERT (Initializing, Internal, '', tags {}, tracingTime 0, placeholder dataset `datasets_ LIMIT 1`; None if no dataset exists → unavailable). Call with the task row locked in the same tx.
- `assign_one_to(&PgPool, task_id, user_id) -> ApiResult<Option<ObjectId>>` — lock + insert + commit; None → `TASK_UNAVAILABLE`.
- `create_annotation_for(&PgPool, &ServiceClients, context_user: &AuthUser, assignee_id, task_id, &initializing_id) -> Result<(), ProviderError>`.
- `abort_initializing_annotation(&PgPool, &id) -> ApiResult<()>` — deletes layers + row only while still Initializing.
- `initialize_task_annotation(..same args as create_annotation_for..) -> ApiResult<()>` — create + abort on failure; returns the create error (or the abort error if abort fails).
- consts `TASK_UNAVAILABLE`, `NOT_ALLOWED`, `BASE_ID_FAILED`.

Suggested `request` flow: auth user → getAllowedTeamsForNextTask + isTeamManagerOrAdminOfOrg → tx: select the next task (findNextTaskQ: experience join, team filter, no previous Task annotation of the user unless Cancelled+manager, pending>0, not paused, priority DESC) `FOR UPDATE SKIP LOCKED` (or `FOR UPDATE` + recheck) → `insert_initializing_annotation` → commit; none → 400 `TASK_UNAVAILABLE` → `initialize_task_annotation(pool, clients, &user, &user.id, task, &id)` → annotation publicWrites + `messages:[{success: "You have been assigned a new task."}]` (Msg.Task.assigned; add the const there). Check the "tooManyOpenOnes"/allowed-teams logic in TaskService.getAllowedTeamsForNextTask.

## Deviations

- Concurrency: READ COMMITTED transaction with `FOR UPDATE` row lock + `pendingInstances > 0` recheck instead of a SERIALIZABLE statement with 50 retries. Equivalent outcome, deterministic; tested with 4 concurrent requests for the last instance (exactly one 200, others 400 unavailable).
- updateInitialized only touches a live Initializing row (`WHERE state='Initializing' AND NOT isDeleted`); a vanished/soft-deleted row → failure 400 `Could not find or access the requested resource.` + abort. Scala would resurrect a concurrently soft-deleted row (and re-decrement pending).
- Duplicate RPC uses the default request timeout (inherits annotation_duplicate's pending parent TODO: move RPC into TracingStoreClient with the long 2 h transport). Parent: `uses_long_rpc` exemption in lib.rs should include `POST /tasks/{id}/assign` (and later `/user/tasks/request`).
- Response task JSON skips Scala's second requester-context `taskDAO.findOne(id)` (already checked in step 2).
- Tracing-store data created by the RPC is orphaned when updateInitialized fails (as in Scala).

## Status / Done / Next / Evidence

Status: COMPLETE.
Done: route + reusable helpers + 1 unit test in src/task_assignment.rs; tests/task_assignment.rs, 3 DB tests with a recording mock tracing store that also observes the DB during the RPC: (1) success: exact RPC path/method/empty body/query keys+order/params, row Initializing (pending already decremented) during RPC → Active with base fields + duplicated layers `{}`, base untouched, task JSON status pending/active, admin repeat assignment, pending 0 → 400 unavailable without RPC/rows, 4-way concurrent last-instance race; (2) 401, missing/invalid userId 400, unknown user / unreadable user / foreign admin / unknown task / deleted task 404, plain member 400 notAllowed, other-team manager 400 notAllowed, no RPC or rows; (3) upstream 500/404/400 status kept without body leak, invalid protobuf 400, colliding tracing id 409, unusable dataset 400, unreadable dataset 400, no tracing store 400, cancelled TracingBase 400 base-id message — all leave pendingInstances, annotations and layers unchanged, no Initializing leftovers.
Next: parent — add `/tasks/{id}/assign` to `uses_long_rpc`, regenerate inventory, central verification. Next agent — `/user/tasks/request` using the reuse API above.
Evidence (verify-c, PG 55439): `cargo test --locked --offline --test task_assignment -- --include-ignored` → 3 passed, 0 failed (4 consecutive runs); `cargo test --lib task_assignment` → 1 passed; `cargo clippy --locked --offline --all-targets -- -D warnings` → exit 0; `rustfmt --edition 2024 --check` on both files → clean.
