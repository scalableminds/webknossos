# Main-app gap inventory (non-route behavior Scala does that Rust does not)

Status: DONE (read-only research agent, 2026-10-11). No source files edited.
Scope: `app/`, `conf/application.conf`, `util/`, `webknossos-tracingstore/.../cleanup/CleanUpService.scala`
(WkCleanUpService) vs. `backend-rust/src` + checkpoints. Route registration is complete (287/287) and is NOT
covered here.

## 0. Key structural facts

- `backend-rust/src/main.rs` starts **no background tasks at all**: HTTP server + graceful shutdown only. There is no
  scheduler abstraction in the crate. Scala has 8 `IntervalScheduler` services + 5 `WkCleanUpService` jobs + 2 raw
  `scheduleWithFixedDelay` loggers (ThreadPool, Slick pool).
- Scala's `IntervalScheduler` (`webknossos-datastore/app/.../helpers/IntervalScheduler.scala`): initial delay
  (default 10 s), 100 ms inner poll, next tick only `tickerInterval` after the previous tick COMPLETED, never
  overlapping, `tickerEnabled` flag, cancelled on shutdown. `CleanUpService.register` = plain fixed delay, skipped
  during shutdown, result/failure only logged.
- Coexistence hazard: while Play still runs against the same DB (current mode, Rust does not proxy) Scala's tickers
  keep running. Any Rust ticker must therefore be individually switchable (env flag, default OFF until cutover) and
  should take a `pg_try_advisory_lock` per ticker so several Rust replicas (or Rust+Scala, if Scala ever takes the
  same lock — it does not today) never run the same job concurrently. Non-idempotent side effects (Slack liveness
  notices, heartbeat analytics, Mailchimp) would otherwise be duplicated.
- No outgoing-integration clients exist in the crate: no SMTP transport, no Slack client, no Mailchimp client.
  `analytics::track` (src/analytics.rs:222) IS ported and forwards/stores like Scala; only call sites are missing.
- `lettre` (or any SMTP crate) is NOT in the offline cargo cache (`/tmp/webknossos-rust-cargo`); the parent must
  run a networked `cargo fetch` and own Cargo.toml/Cargo.lock for the SMTP work. Slack/Mailchimp can reuse `reqwest`
  (already a dependency); Mailchimp needs MD5 of the lowercased email (`md-5 0.10.6` is in the cache).
- Correctness without the cleanup jobs is preserved: expired tokens/invites are rejected at read time, expired mutexes
  can be reclaimed (annotation_mutex.rs), thumbnails are filtered by `created > NOW() - 10 days`
  (thumbnails.rs:102-105). The cleanup jobs are housekeeping (table growth), not behavior.

## 1. Gap table (priority order)

Legend: MISSING = nothing in Rust; PARTIAL = logic exists but not triggered; LOG-ONLY = call site present but only
`tracing` output.

### G1. SMTP mail delivery — LOG-ONLY — priority P0 (blocks real use of reset/invite/verification)
- Scala: `app/mail/Mailer.scala` (actor started in `app/Startup.scala:140-151`), commons-email, HTML templates
  `app/views/mail/*.scala.html` wrapped by `emailBaseTemplate`, From = `mail.defaultSender`, optional Reply-To
  (help mail), `additionalFooter`, `logToStdout`, TLSv1.2, sends only when `mail.smtp.host` non-empty.
- Rust: `src/mail.rs` — `LogMailer` default (logs subject + recipient count). `Mail` struct lacks from/replyTo/
  html body. All 16 Scala send sites have Rust counterparts EXCEPT the pricing-plan expiry reminder (G8).
  Bodies are plain-text renditions (product decision D1).
- Config: `mail.logToStdout`, `mail.smtp.{host,port=465,tls=true,auth=true,user,pass}`, `mail.defaultSender`,
  `mail.supportEmail` (Rust already has WK_SUPPORT_EMAIL), `mail.additionalFooter`.
- Agent `smtp-mailer` (~60 min): owned `src/mail.rs` (+ new `src/mail_smtp.rs`); add `SmtpMailer` (spawned task +
  bounded mpsc queue, fire-and-forget, never fails the request), `from`/`reply_to` on `Mail`, env
  `WK_MAIL_SMTP_HOST/PORT/TLS/AUTH/USER/PASS`, `WK_MAIL_DEFAULT_SENDER`, `WK_MAIL_LOG_TO_STDOUT`,
  `WK_MAIL_ADDITIONAL_FOOTER`; select SmtpMailer when host set, else LogMailer. Parent: Cargo (lettre w/ rustls,
  networked fetch), lib.rs wiring, .env.example. Test with a local SMTP sink (or a mock trait) — no real delivery.
  HTML templates are a separate follow-up (D1).

### G2. Background scheduler + housekeeping cleanup jobs — MISSING — P0 (enabler for G3-G10)
- Scala `app/Startup.scala:50-68` via `WkCleanUpService.register` (fixed delay, first run after one interval):
  - expired tokens soft-delete, every `silhouette.tokenAuthenticator.dataStoreExpiry` (1 day):
    `UPDATE webknossos.tokens SET isDeleted=TRUE WHERE expirationDateTime <= now` (`app/security/Token.scala:118`).
  - hard-delete soft-deleted tokens older than 7 days, daily (`Token.scala:123-130`).
  - expired invites soft-delete, daily (`app/models/user/Invite.scala:162`).
  - delete `Initializing` annotations older than 1 hour, daily (`app/models/annotation/Annotation.scala:752`).
  - delete thumbnails older than 10 days, daily (`app/models/dataset/ThumbnailService.scala:392,451`).
- Scala `app/models/annotation/AnnotationMutexService.scala:38-43`: hourly `DELETE ... annotation_mutexes WHERE
  expiry < NOW()` (IntervalScheduler, 10 s initial delay). README/coordinator already list it as pending.
- Rust: none of these run (`browser_auth_onboarding.rs:490` notes the invite job is not ported).
- Agent `scheduler-housekeeping` (~60 min): owned new `src/scheduler.rs` (IntervalScheduler equivalent: initial
  delay, delay-after-completion, no overlap, cancellation on shutdown signal, optional `pg_try_advisory_lock(key)`
  per job, `enabled` flag, structured completion/failure logs) + new `src/housekeeping.rs` (the 6 jobs above, SQL
  copied verbatim) + DB tests calling each job function directly. Parent wires `main.rs` (spawn + shutdown) and
  config (`WK_BACKGROUND_TASKS_ENABLED` master switch, default false while Play runs).

### G3. Free-credit ticker (revoke expired + monthly hand-out) — PARTIAL — P1 (billing-visible after cutover)
- Scala `app/models/organization/FreeCreditTransactionService.scala:27-35`: every 20 min `revokeExpiredCredits()`
  (`CreditTransaction.scala:~355-376`, serializable per organization, Slack warn on failed revocations) then
  `SELECT webknossos.hand_out_monthly_free_credits(jobs.monthlyFreeMilliCredits)`.
- Rust: revoke logic exists only inline in the superuser route handler `src/credit_transactions.rs:326`
  (`GET /maintenance/revokeExpiredCredits`); hand-out SQL only on organization creation (`src/organizations.rs:346`).
  Config `WK_JOBS_MONTHLY_FREE_MILLI_CREDITS` already exists (application_info.rs:301).
- Agent: fold into `scheduler-housekeeping` follow-up or small `credits-ticker` (~30-45 min): owned
  `src/credit_transactions.rs` (extract `revoke_expired_credits(pool) -> Vec<failed ids>`), register ticker.

### G4. Slack notifications — LOG-ONLY/MISSING — P1 (ops visibility)
- Scala client: `webknossos-datastore/.../slacknotification/SlackClient.scala` (POST `{"attachments":[{title:
  "<title> reported from WEBKNOSSOS at <http.uri>", text, color}]}`, rate limit 30 msgs/min, no-op if uri empty,
  `verboseLoggingEnabled` logs). Wrapper `app/telemetry/SlackNotificationService.scala`.
- Call sites (none deliver in Rust):
  - `Startup.scala:116` startup notice; `Startup.scala:135` SQL schema mismatch (Rust does no full schema diff).
  - `CreditTransaction.scala:373` failed credit revocations (Rust logs, credits-publications.md:47).
  - `DatasetService.scala:796` info on new uploaded dataset (Rust: remote_datastore_dataset_report.rs, gap noted in
    remote-datastore-dataset-report.md:16).
  - `TaskCreationService.scala:472` base-annotation task creation (Rust tracing::info, task_creation.rs:1276).
  - `JobService.scala:76,102` failed/successful job with duration labels + workflow/result links (Rust
    job_workers.rs ~574-660 sends mails/analytics but no Slack; jobs-worker.md:57).
  - `Worker.scala:148,155` worker missing/returned (see G5).
  - `AuthenticationController.scala:936` suspicious registration names (Rust log-only,
    browser_auth_onboarding.rs:188).
- Config: `slackNotifications.uri`, `slackNotifications.verboseLoggingEnabled`.
- Agent `slack-client` (~45-60 min): owned new `src/slack.rs` (client + rate limiter, Secret-wrapped uri, Debug
  redaction) + replacing the log-only lines in job_workers.rs, task_creation.rs, browser_auth_onboarding.rs,
  remote_datastore_dataset_report.rs, credit_transactions.rs (one-line edits; coordinate ownership). Parent: config
  `WK_SLACK_NOTIFICATIONS_URI`, `WK_SLACK_NOTIFICATIONS_VERBOSE_LOGGING_ENABLED`, AppState/Extension wiring.
  Include job duration labels (`JobService.durationLabel`).

### G5. Worker liveness monitor — MISSING — P2 (depends on G2+G4)
- Scala `app/models/job/Worker.scala:111-160` `WorkerLivenessService`: every 1 min (1 min initial delay) checks all
  workers' `lastHeartBeat` against `jobs.workerLivenessTimeout`; Slack warn "Worker missing" once, re-reported after
  `jobs.workerLivenessReReportInterval` (1 h, in-memory TemporaryStore), Slack success "Worker return".
- Rust: liveness is only computed for API output (`WK_WORKER_LIVENESS_TIMEOUT_SECONDS`). No re-report config.
- Agent: part of `slack-client` follow-up, or `worker-liveness` (~30 min) owning new `src/worker_liveness.rs`.

### G6. Server-side analytics call sites + 24 h heartbeat — PARTIAL — P2
- Ported: create/open/upload/download/update(_view_only) annotation, run_job, failed_job, upload_dataset, frontend.
- Missing (`grep` confirms no event names in Rust):
  - `signup` — `AuthenticationController.scala:208,826` (Rust browser_auth_onboarding.rs register / org create).
  - `send_invites` — `AuthenticationController.scala:368`.
  - `join_organization` — `AuthenticationController.scala:337,778` (Rust `join_organization_as`,
    browser_auth_onboarding.rs:393).
  - `open_dataset` — `DatasetController.scala:439` (Rust datasets.rs read route).
  - `change_dataset_settings` — `DatasetController.scala:498,525`, `LegacyApiController.scala:176`.
  - `webknossos_heartbeat` — `app/models/analytics/AnalyticsService.scala:93-101`, every 24 h (10 s initial delay),
    oldest active user + buildinfo JSON (analytics.rs:10 documents it as not ported).
- Agent `analytics-call-sites` (~45 min): owned edits in browser_auth_onboarding.rs, datasets.rs/dataset_update.rs,
  legacy_datasets.rs + heartbeat job registered via G2. Match event property shapes in
  `app/models/analytics/AnalyticsEvent.scala:105-240`.

### G7. Organization used-storage scan — PARTIAL — P2 (storage quota / pricing display)
- Scala `app/models/storage/UsedStorageService.scala:53-115`: tick every `webKnossos.fetchUsedStorage.tickerInterval`
  (10 min, 1 min initial delay); `findNotRecentlyScanned(rescanInterval=24h, scansPerTick=10)`; for each datastore
  with `reportUsedStorageEnabled` POST `{dataStore}/data/datasets/measureUsedStorage/{orga}` in batches of 200 paths,
  replace `organization_usedStorage_mags/_attachments`, `updateLastStorageScanTime`, 5 s pause per organization.
- Rust: only per-dataset refresh `src/dataset_storage.rs:116 refresh_for_dataset` (after uploads/updates).
- Config: `webKnossos.fetchUsedStorage.{rescanInterval,tickerInterval,scansPerTick}`.
- Agent `used-storage-scan` (~60 min): owned `src/dataset_storage.rs` (generalize to per-organization scan) + job.

### G8. Pricing-plan expiry reminder — MISSING — P3 (disabled by default; needs G1)
- Scala `app/models/organization/PricingPlanExpiryReminderService.scala:41-100`: enabled only if
  `webKnossos.pricingPlanExpiryReminder.enabled` (default false); every `tickerInterval` (6 h, 5 min delay);
  `findAllWithPlanExpiringBefore` (`Organization.scala:427`), lead times `leadTimesDays=[30,14,7]` /
  `trialLeadTimesDays=[7]`, records in `webknossos.organization_planExpiryReminders` (ON CONFLICT DO NOTHING) BEFORE
  mailing owner+admins `DefaultMails.pricingPlanExpiryReminderMail` (`app/mail/DefaultMails.scala:119`).
- Rust: no template, no job.
- Agent `pricing-expiry-reminder` (~45 min): owned new `src/pricing_reminder.rs` + template in mail.rs (coordinate
  with G1 owner) + pure tests for `crossedLeadTimesDays`/`leadTimesDaysFor`.

### G9. Mailchimp — MISSING (one debug log) — P3 (webknossos.org only; empty host = no-op)
- Scala `app/mail/MailchimpClient.scala` (PUT `{host}/lists/{listId}/members/{md5(email)}`, POST `.../tags`, GET
  tags, basic auth), `MailchimpTicker.scala:27-70` hourly (1 h initial delay) tags multiusers 21-22 days after
  registration as WasActive/WasInactiveInWeeksTwoAndThree.
- Call sites: register (`AuthenticationController.scala:215` RegisteredAsUser, `:839` RegisteredAsAdmin),
  HasInvitedTeam (`:369`), HasAnnotated (`AnnotationController.scala:255`; Rust debug log annotation_create.rs:512),
  HasViewedPublishedDataset (`DatasetController.scala:441`), HasUploadedOwnDataset (`DatasetService.scala:787`,
  `JobService.scala:108`).
- Config: `mail.mailchimp.{host,listId,user,password}`.
- Agent `mailchimp` (~60 min): owned new `src/mailchimp.rs` (client + ticker) + 6 one-line call sites.

### G10. Virtual-dataset realpath bulk scan — PARTIAL — P3
- Scala `app/models/dataset/VirtualDatasetsRealPathScanService.scala:27-56`: hourly, all virtual datasets grouped by
  datastore, `POST {datastore}/data/triggers/scanRealPathsForVirtual` (WKRemoteDataStoreClient.scala:196); the
  datastore answers via `PUT /datastores/:name/datasources/realpaths` (already ported, remote_datastore.rs:63).
- Rust: per-dataset `dataset_lifecycle::scan_realpaths_if_virtual` on create/update/report only.
- Agent: small job (~30 min) owned `src/dataset_lifecycle.rs` helper + job in housekeeping.

### G11. Startup tasks — PARTIAL — P3
- `Startup.scala:107-114` runs `InitialDataService.insert` at every boot: keeps local datastore/tracingstore rows in
  sync with config + pretrained AI models (+ sample org if enabled and DB empty). Rust only via
  `POST /triggers/initialData` (initial_data.rs:52); a Rust-only deployment must trigger it externally.
- `Startup.scala:99-102` `checkSchemaOnStartup`: `dbtool.js ensure-db` + full `check-db-schema` diff, Slack on
  mismatch. Rust checks only `releaseInformation.schemaVersion = 185` (db.rs:8) — deliberate, keep.
- Slack startup notice (G4). Temp-file cleanup stop hook not needed (Rust buffers in memory).
- Agent: parent-owned main.rs change (~20 min): optional `WK_INITIAL_DATA_ON_STARTUP` calling the existing
  insert function (sample org stays default OFF).

### G12. Diagnostics — MISSING — P4
- `ThreadPoolHealthLogger` (util) and `SlickPoolHealthLogger` every 10 min (`Startup.scala:72-75`). Rust could log
  `pool.size()/num_idle()` periodically via G2. No metrics/Prometheus in Scala either.

### G13. Config/doc hygiene — P4
- `.env.example` lists ~45 vars; the crate reads ~95 `WK_*` vars (analytics, OIDC, Loki, SAM, sample org, upload
  paths, ToS, build info ...). Missing Scala config with no Rust equivalent: `mail.*`, `mail.mailchimp.*`,
  `slackNotifications.*`, `webKnossos.fetchUsedStorage.*`, `webKnossos.pricingPlanExpiryReminder.*`,
  `jobs.workerLivenessReReportInterval`, `silhouette.tokenAuthenticator` cleanup interval (dataStoreExpiry is present).
  Parent-owned README/.env.example pass after G1-G9 land.

## 2. Suggested agent split (bounded, file-owned)

1. `smtp-mailer` (G1) — mail.rs, mail_smtp.rs; parent: Cargo (networked fetch of lettre), lib.rs, config.
2. `scheduler-housekeeping` (G2 + mutex cleanup) — scheduler.rs, housekeeping.rs; parent: main.rs.
3. `credits-ticker` (G3) — credit_transactions.rs (after 2).
4. `slack-client` (G4) — slack.rs + log-only call sites.
5. `worker-liveness` (G5) — worker_liveness.rs (after 2+4).
6. `analytics-call-sites` (G6) — onboarding/datasets/legacy call sites + heartbeat job (after 2 for heartbeat).
7. `used-storage-scan` (G7) — dataset_storage.rs + job (after 2).
8. `pricing-expiry-reminder` (G8) — pricing_reminder.rs + template (after 1+2).
9. `mailchimp` (G9) — mailchimp.rs + ticker + call sites (after 2).
10. `realpath-scan` + startup initial data + pool health log (G10-G12) — dataset_lifecycle.rs helper; parent main.rs.

## 3. Documented user-visible deviations that may need a product decision

- D1 Mail bodies are plain text, no HTML templates/branding/footer, no Reply-To on help mail
  (browser-auth.md:16, misc-controllers.md:17, organization-pricing.md:46, jobs-worker.md:58).
- D2 No mail delivery at all until G1 (README; browser-auth.md "Email gap"): password reset, invites, email
  verification (required-verification accounts past grace period cannot log in) unusable.
- D3 Sample organization and local datastore/tracingstore modules default OFF (Play dev default ON);
  buildinfo `localDataStoreEnabled:false` (misc-controllers.md:16).
- D4 Fail-closed on Scala's discarded `Fox[Boolean]` permission checks (allowDownload, restrictions, team-manager
  updates, Voxelytics workflow ownership) — 403/401 where Play allowed (coordinator.md CRATE-WIDE DECISION,
  annotation-download.md, users-projects.md, voxelytics.md:48).
- D5 Error responses: no Play `chain` entries, crate-wide wording ("Invalid JSON request body.", "Invalid query
  parameters."), auth checked before body (401 vs 400), DB serialization conflicts -> 409, DB faults 5xx instead of
  400 "SQL Failure" (annotations.md:43, credits-publications.md:42-48, organization-pricing.md, time-reports.md).
- D6 Multi-step mutations are atomic (Play persisted partially) — e.g. job cancel+refund, task creation, AI models,
  user updates (jobs.md:32, task-creation.md:77, ai-models.md:17, users-projects.md:22).
- D7 checkCertificate supports ES256/ES384 only (no ES512), not cached for 1 h (misc-controllers.md:19).
- D8 Upload limits new vs Scala: zip 10k entries / 2 GiB / depth 8; 1 GiB multipart body held in memory
  (coordinator.md, annotation-upload.md:57); RPC response cap 64 MiB can reject large SAM inputs (datasets.md:27).
- D9 Annotation downloads buffered in memory; zip bytes not identical to Java ZipOutputStream
  (annotation-download.md:37).
- D10 Deterministic ORDER BY where Scala had none (lists, reports) (time-reports.md:22, annotation-download.md).
- D11 WebAuthn: only attestation `none`, stricter COSE/CBOR parsing, fixed error text (auth-webauthn.md:34).
- D12 Thumbnail in-memory cache not ported (DB cache only); updatePartial NULLs inboxSourceHash (datasets.md:27).
- D13 Stricter auth: /auth/resetPassword accepts only ResetPassword tokens; expired invites ignored; deleted rows'
  emails/org ids count as taken; cookie idle timeout not renewed (browser-auth.md:17-18).
- D14 Task request uses READ COMMITTED + row lock instead of SERIALIZABLE retry (same outcome) (task-request.md:22).
