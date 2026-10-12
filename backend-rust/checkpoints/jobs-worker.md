# Jobs worker routes (batch J3)

Owner files: `src/job_workers.rs`, `tests/job_workers.rs`, focused edits in `src/jobs.rs`
(`JobsConfig.job_token_expiry`, `Job::is_valid` pub(crate), dropped one dead_code allow, doc comment).
Shared edits: `src/lib.rs` (`pub mod job_workers;`, `.merge(job_workers::router(&jobs, auth_routes.auth_idle_timeout))`
before the jobs router), `src/config.rs` (env `WK_JOB_TOKEN_EXPIRY_SECONDS`, default 604800 = jobExpiry 7 days).
`tests/server_boundary.rs` untouched (JobsConfig built via Default).

## Status
- Status: done (4/4 routes implemented, wired, tested).
- Done: GET /jobs/request, POST /jobs/:id/status, POST /jobs/:id/attachVoxelyticsWorkflow,
  POST /jobs/:id/attachDatasetToInference. `/jobs/request` beats `/jobs/{id}` (axum/matchit static priority; tested).
- In-flight: none.
- Next step: coordinator regenerates MIGRATION_STATUS.md; document WK_JOB_TOKEN_EXPIRY_SECONDS in .env.example/README.
- Evidence: tests/job_workers.rs 4 DB tests (8 repeated runs green), 2 unit tests in src/job_workers.rs;
  clippy --all-targets -D warnings clean; rustfmt clean on touched files.

## Contract notes (J3)
- Worker auth: `?key=` against workers_ (not deleted); missing/unknown key or unparsable worker (unknown supported
  command) -> 400 "Could not find this worker in the database.". No jobs-enabled check (as Scala). Missing key query
  param -> 400 "Invalid query parameters.".
- request: one READ COMMITTED transaction: worker row FOR UPDATE (serializes polls of one worker), heartbeat
  NOW() + lastReportedVersion only when workerVersion given and different; reserveNextJobs up to 10 iterations with
  high (convert_to_wkw, export_tiff) / low (all others incl. legacy) unfinished counts vs maxParallel*, pending
  counts restricted to supported commands; reserveNextJob claims the oldest (created, _id) pending, unassigned,
  non-manual job of the datastore via `FOR UPDATE SKIP LOCKED` + `_worker IS NULL` (replaces Scala's SERIALIZABLE
  retry loop; no double assignment). Response {"to_run", "to_cancel"} (ORDER BY created, _id), to_run minus to_cancel;
  each entry {"job_id","command","job_kwargs": args + "user_auth_token"}, where every poll creates a NEW Job token
  for the owner (expiry jobExpiry, idle = auth idle timeout, old tokens kept). Missing owner (users_) -> 404 generic.
  Job parse failure -> 400 "Parsing failed for a row in webknossos.jobs during list query".
- status: body JobStatus {latestRunId?, state, returnValue?, started?, ended?, errorDetails? (object)}; Instants as
  millis number/string or ISO. Invalid body -> 400 "Invalid JSON request body." (Play renders JsError JSON; simplified).
  Unknown job (jobs_) -> 404 generic. updateStatus writes NULL for absent optionals. No check that the job belongs
  to the reporting worker (as Scala). SUCCESS -> pending credit reservation Complete/Spent (400 "Could not perform
  credit transaction."); state changed to FAILURE/CANCELLED -> jobs::refund_transaction_for_job (failed/cancelled
  comment; 400 "Could not perform credit transaction refund."). convert_to_wkw FAILURE -> DatasetDAO.deleteDataset of
  args dataset_directory_name/organization_id (missing -> 400 "Could not clean up failed job.", also on repeat).
  DEVIATION: Scala auto-commits each step (status persists even if cleanup/credits fail); here the job row is locked
  and status+cleanup+credits are one transaction. Success response: 200 empty body.
- trackStatusChange (after commit, fire-and-forget, only if before not SUCCESS/FAILURE): mails via MailSender with
  exact DefaultMails subjects and plain-text bodies (success link = public URI + result link), failed mail skipped if
  retriedBySuperUser; analytics `failed_job` {command}; log lines. cleanUpUploadFiles: DELETE
  `<datastore.url>/data/datasets/upload/dataset/cleanUpUploadFiles?organizationId&directoryName&jobId&token=<rpc>`
  when a convert_to_wkw job just ended (SUCCESS/FAILURE/CANCELLED).
- attachVoxelyticsWorkflow: body JSON string; worker -> features.voxelyticsEnabled (400 Voxelytics notEnabled) ->
  organizationIdForJobId (base tables; 400 "Job could not be found or accessed.") -> create workflow with name
  "initializing worker workflow" if absent (ON CONFLICT DO NOTHING instead of check+upsert; keeps a real name) ->
  set jobs._voxelytics_workflowHash. One transaction. 200 empty.
- attachDatasetToInference: body JSON string (directory name); worker -> org (400 Job notFound) -> datasets_ by
  directoryName+org (404 generic) -> aiInferences_ by _inferenceJob (400 "Could not find requested AI inference.") ->
  set _newDataset. 200 empty.

## Gaps
- Job tokens (tokenType 'Job') are NOT accepted by `auth::authenticate` (only Authentication/DataStore); Scala
  accepts any token type, so workers' `user_auth_token` calls to WK user routes fail on the Rust backend. Needs an
  auth.rs decision (not owned here).
- Not ported: Slack notifications (WorkerLivenessService too), Mailchimp HasUploadedOwnDataset tag, duration labels.
- Mail bodies are plain-text renditions (no HTML templates), like the rest of the Rust mail module.
