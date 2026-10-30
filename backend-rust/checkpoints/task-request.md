# Task request checkpoint (POST /user/tasks/request)

2026-10-10. Owner: task-request sub-agent (target /tmp/webknossos-rust-verify-c). Owns src/task_request.rs, tests/task_request.rs, this file. `task_request::router(jobs_enabled)` signature unchanged (jobs flag passed as a router-local Extension to annotation publicWrites). No other files edited, no visibility changes (reuses `task_assignment::{TASK_UNAVAILABLE, insert_initializing_annotation, initialize_task_annotation}`, `annotation_access::READ_PREDICATE`, `annotation_lists::full_json`).

## Contract (TaskController.request)

SecuredAction (401). Then:
1. TaskService.getAllowedTeamsForNextTask:
   - admin: all live teams (`teams_`) of the own organization; no open-task limit.
   - otherwise: `open` = count of the user's live `Active` `Task` annotations (AnnotationDAO readAccessQ) whose live task's live project team is NOT a team the user manages. `open < 5` (application.conf `webKnossos.tasks.maxOpenPerUser`) → all raw `user_team_roles` teams, else only managed teams. Empty → 400 `You already have too many open tasks.` (also for a user without any team — Scala parity).
2. isTeamManagerOrAdminOfOrg(user, own org) = isAdmin OR any team-manager membership.
3. TaskDAO.assignNext / findNextTaskQ: live task with `pendingInstances > 0`; JOIN `user_experiences` on domain with `neededExperience_value <= value` (user lacking the domain gets nothing); live, not paused project whose `_team` is in the allowed teams; no live `Task` annotation of the user for the task, except Cancelled ones when (2) is true; `ORDER BY projects.priority DESC LIMIT 1` (ties unordered, as in Scala). Insert Initializing annotation (shared `insert_initializing_annotation`; trigger decrements pending). Nothing → 400 `There is currently no task available.`
4. `initialize_task_annotation(pool, TracingStoreClient::long_clients(), &user, &user.id, task, id)` — duplicate RPC on the 2 h transport (lib.rs `uses_long_rpc` already lists this route); failure deletes the Initializing row (pending restored) and returns the createAnnotationFor error (upstream status kept, body not leaked).
5. `JsonOk(annotationService.publicWrites(annotation, Some(user)), Msg.Task.assigned)` → `annotation_lists::full_json` + `messages:[{success:"You have been assigned a new task."}]`, 200.

No compound-cache invalidation and no time tracking (Scala's request does neither).

## Concurrency

Each attempt: READ COMMITTED tx; candidate `SELECT … ORDER BY priority DESC LIMIT 1 FOR UPDATE OF t` (waits on a locked row; Postgres rechecks `pendingInstances` after the wait and falls through to the next candidate); then the complete findNextTaskQ predicate is re-evaluated for the locked id in a new statement snapshot (catches a concurrent request of the SAME user, whose annotation the first statement's snapshot could not see); then insert while holding the lock; commit. Failed recheck → rollback + retry, at most 50 attempts (Scala retryCount), then unavailable. SKIP LOCKED deliberately NOT used: it would hand a concurrent requester a lower-priority task or a spurious `task.unavailable` while the top task still has instances. Uncontended: identical pick to Scala.

## Deviations

- READ COMMITTED + row lock + recheck instead of SERIALIZABLE INSERT…SELECT with 50 retries (same outcome, no over-assignment).
- `maxOpenPerUser` hard-coded to the conf default 5 (`MAX_OPEN_TASKS_PER_USER`); parent TODO: config setting if needed.
- DB faults during selection → 500 (crate convention); Scala maps every assignNext failure to `task.unavailable`. Empty team list (admin org without teams) → unavailable, same as Scala (empty SQL tuple fails).
- Inherited from task_assignment: updateInitialized only updates a live Initializing row.

## Status / Done / Next / Evidence

Status: COMPLETE (focused).
Done: route in src/task_request.rs; tests/task_request.rs, 5 DB tests with a mock tracing store: (1) priority order across 3 projects, skipping higher-priority paused project, other-team project, too-high experience, other domain, pending 0, deleted task; exact experience match eligible; own previous instance excluded; unavailable after exhaustion; another user gets the remaining instance; response JSON + success message; RPC path/newAnnotationId; 401. (2) Cancelled own instance excludes for plain user, not for team manager; admin draws from non-member team, needs experience, ignores open limit. (3) teamless user → tooManyOpenOnes; 4 Active + 1 Finished still allowed; 5 Active → tooManyOpenOnes without RPC; managed team still served and its annotations not counted. (4) 8 concurrent users on 3 instances → exactly 3 OK (distinct users), 5 unavailable, pending 0, 3 RPCs; one user with 4 concurrent requests gets 4 distinct tasks. (5) upstream 500 and 400 keep status, no body leak, pending/annotations/layers restored; later success.
Next: parent — inventory regeneration, central verification.
Evidence (verify-c, PG 55439): `cargo test --locked --offline --test task_request -- --include-ignored` → 5 passed, 0 failed (4 consecutive runs); `rustfmt --edition 2024 --check` on both files → clean; `cargo clippy --locked --offline --all-targets -- -D warnings` → exit 0 (after auth_webauthn owner fixed its in-progress lints).
