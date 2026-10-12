# Jobs core (batch J1)

Owner files: `src/jobs.rs`, `tests/jobs.rs`, focused edits in `src/credit_transactions.rs`.
Shared edits: `src/lib.rs` (`pub mod jobs;`, `jobs: JobsConfig` in RouteOptions + constructors,
`.merge(jobs::router(jobs_enabled, jobs, auth_routes.clone()))`), `src/config.rs` (`Config.jobs`,
env `WK_WORKER_LIVENESS_TIMEOUT_SECONDS`, default 60), `tests/server_boundary.rs` (`jobs: Default::default()`).

## Status
- Status: done (7/7 routes implemented, wired, tested; full suite green).
- Done: GET /jobs, GET /jobs/status, GET /jobs/getCreditCost, GET /jobs/:id, PATCH /jobs/:id/cancel,
  PATCH /jobs/:id/retry, GET /jobs/:id/export. credit_transactions paid-job JSON now uses
  `jobs::find_job` + `jobs::public_writes` (its own copy + result_link unit test removed; balance_error is pub(crate)).
- In-flight: none.
- Next step: coordinator regenerates MIGRATION_STATUS.md; add WK_WORKER_LIVENESS_TIMEOUT_SECONDS to .env.example/README.
- Evidence: tests/jobs.rs 3 DB tests pass, tests/credit_transactions.rs 3 pass, 3 unit tests in src/jobs.rs;
  clippy --all-targets -D warnings clean; rustfmt --check clean for touched files; full DB suite
  (`--no-fail-fast -- --include-ignored`, verify-b) all green incl. 55 lib unit tests.

## Contract notes (J1)
- Jobs-enabled check (400 "Long-running jobs are not enabled for this WEBKNOSSOS instance.") on list/get/cancel/retry
  only; status, getCreditCost and export have none (as in Scala).
- list: JobDAO.listAccessQ (own jobs or admin of owner's org; NO superuser/team-manager access), ORDER BY created DESC
  (+ _id tiebreak). Unknown `command` -> 404 generic. skipForDeletedDatasets keeps only jobs whose args.dataset_id is
  a dataset (base table) not in the unreported status list. Cost via LATERAL credit join WITHOUT access check.
- read/retry: job lookup failure -> 400 "Job could not be found or accessed."; cancel/export: empty -> 404 generic.
- JobDAO.readAccessQ: owner, members of teams the user manages, admin of owner's org, superuser.
- publicWrites quirks preserved: owner read with UserDAO access (superuser of another org -> 400 "User could not be
  found or accessed."); cost only if the requester can read the credit transaction (admin/dataset manager/team manager
  of the org or superuser). Responses of cancel/retry show the job as read BEFORE the mutation.
- cancel: one SERIALIZABLE transaction: manualState=CANCELLED; if worker state PENDING/STARTED refund the job's pending
  transaction (global access) with comment "Refund for cancelled job X."; refund failures -> 400 "Could not perform
  credit transaction refund." (Deviation: Scala committed the cancel even if the refund failed; here both roll back.)
- retry: 403 alreadyRetried unless superuser or lastRetry empty; reserveCreditsForRetry uses the REQUESTER's credit
  access (members see no transaction -> nothing reserved, as in Scala) and balance; insufficient -> 400
  notEnoughCredits; retryOne no-ops unless FAILURE/CANCELLED or manualState CANCELLED (reservation still inserted, as Scala).
- export: 303 to `<dataStore.publicUrl>/data/exports/<id>/download?token=<auth token>`; datastore lookup with
  onlyAllowedOrganization access -> 400 "Data store could not be found or accessed.". Token = findOrCreateTokenForUser,
  implemented in jobs.rs with the same usable-token filter as auth_routes::get_token (cleanup TODO: share one helper
  in auth_routes.rs; not my file).
- getCreditCost: BoundingBox.fromLiteral (exact Java regex incl. whitespace rules, Integer.parseInt) and unknown
  command -> 404 generic; unsupported command -> 400 "Unsupported job command X"; cost
  max(ceil(volume/1e9*perGVx) saturating i32, 0); per-GVx costs from MiscState features (WK_FEATURES_JSON overrides);
  balance with requester's credit read access (0 for members).
- status: all workers (global), supportedJobCommands deduped in DB order, lastHeartBeatIsRecent =
  now - lastHeartBeat < WK_WORKER_LIVENESS_TIMEOUT_SECONDS; jobsByState counts jobs_ with manualState NULL.
- Simplified: Play error chains (`?~>` on failures) are rendered as the top message only.

## Notes for later job batches (J2 run/*, J3 worker, J4 voxelytics, J5 AI models)
- Reuse from src/jobs.rs: `Job`, `JOB_COLUMNS`, `find_job`, `JOB_READ_ACCESS`, `public_writes`, `JobCompactInfo::into_json`,
  `result_link`, `JOB_COMMANDS`/`is_job_command`, `JOB_STATES`, `CREDIT_READ_ACCESS`, `milli_credit_balance`,
  `job_cost_in_milli_credits(features, command, volume)`, `parse_bounding_box`, `refund_transaction_for_job(conn, id,
  is_cancelled)` (J3 needs it with is_cancelled=false on FAILURE), `serializable`, `NOT_ENOUGH_CREDITS`.
- JobCommand.highPriorityJobs = {convert_to_wkw, export_tiff}; jobsWritingToStorage = {align_sections, compute_mesh_file,
  compute_segment_index_file, infer_instances, infer_mitochondria, infer_neurons, materialize_volume_annotation}
  (refused with 403 Msg.Job.storageExceeded when organization storage quota exceeded).
- JobService.submitJob: jobsEnabled check; worker selection = union of supportedJobCommands of ALL workers (workers_)
  of the datastore must contain the command else 400 "No worker supporting the requested job is available for the
  selected data store."; storage check; insert job (PENDING); analytics RunJobEvent.
- submitPaidJob: requires team manager/admin of org or dataset manager (400 paidNoAdminOrManager); cost via
  calculateJobCostInMilliCredits; hasEnoughCredits; reserveCredits (pending, comment) BEFORE submitJob; on submit
  failure refundTransactionWhenStartingJobFailed + 400 "Could not submit job."; then addJobIdToTransaction.
- Worker status update (J3) must: completeTransactionOfJob on SUCCESS, refund (isCancelled=false) on FAILURE/CANCELLED,
  trackStatusChange (Slack/mail, convert_to_wkw cleanup + cleanUpUploadFiles RPC), WKW conversion cleanUpIfFailed.
- parameterWrites (worker-facing) adds "user_auth_token" (job token type) to args: {"job_id","command","job_kwargs"}.
