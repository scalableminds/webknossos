# Slack notifications (G4) checkpoint

Status: DONE (agent slack-client, 2026-10-11). Parent TODO: one main.rs block (below).

## Scala truth
- `webknossos-datastore/.../slacknotification/SlackClient.scala`, `app/telemetry/SlackNotificationService.scala`.
- Body `{"attachments":[{"title":"<title> reported from WEBKNOSSOS at <http.uri>","text":<msg>,"color":<c>}]}`;
  colors warn `#ff8a00`, info `#333ccc`, success `#049b4a`, error `#e10000`.
- Rate limit: fixed window, synchronized; a message more than 1 min after the window start opens a new window
  (count 1), otherwise allowed while count < 30. Empty uri: no-op (verbose: log). `rpc.postJson` is not awaited.

## Config (Config.slack, `slack::config_from_values`)
- `WK_SLACK_NOTIFICATIONS_URI` (`slackNotifications.uri`, default empty = disabled; must be absolute http(s)).
- `WK_SLACK_NOTIFICATIONS_VERBOSE_LOGGING_ENABLED` (default false).
- `WK_PUBLIC_URL` (`http.uri`) for titles and links. Appended to `.env.example`.

## Implementation (src/slack.rs)
- `SlackNotificationService` (Arc, clones share one `RateLimiter`), `warn/info/success/error`,
  `notice_failed_job_request`, `notice_base_annotation_task_creation`, `notice_slow_request`, `notice_startup`,
  `notice_dataset_added` (spawned org-name lookup), `notice_worker_missing/_return` (for G5),
  `notice_schema_mismatch` (awaits the POST, process exits afterwards).
- Send: rate limit checked synchronously, POST on a spawned task (30 s timeout); errors/non-2xx only logged,
  webhook URI never logged (`error.without_url()`, Debug redacts it).
- Handlers: `FromRequestParts` extractor reading the router-wide `Extension` (lib.rs build_router); missing
  extension -> disabled service.
- Process-wide service for code without request context: `slack::install_global(&config.slack)`, `slack::global()`
  (disabled until installed), `slack::notice_startup(version)`.
- Helpers: `format_duration` (Formatter.formatDuration), `job_duration_label`, `result_link_slack_formatted`,
  `workflow_link_slack_formatted`, `format_heartbeat` (ISO_INSTANT, ms precision).

## Call sites
| Scala | Rust |
|---|---|
| JobService.scala:76 failed job | job_workers.rs `track_status_change` (POST /api/jobs/:id/status), warn `Failed job[ (for superuser)]` |
| JobService.scala:102 successful job | same, success `Successful job[ (for superuser)]`, result + workflow links |
| AuthenticationController.scala:936 suspicious names | browser_auth_onboarding.rs `notify_on_suspicious_names` (register + createOrganizationWithAdmin) |
| DatasetService.scala:796 dataset added | remote_datastore_dataset_report.rs (`upload without conversion`, only !needsConversion) and dataset_explore.rs add (`via explore+add`) |
| TaskCreationService.scala:472 base tasks | task_creation.rs `create_tasks` via `CreationServices.slack` (POST /tasks, createFromFiles) |
| CreditTransaction.scala:373 failed revocations | credit_transactions.rs `notify_failed_revocations` via `slack::global()` (route + credit ticker) |
| Startup.scala:135 schema mismatch | db.rs `connect` via `slack::global()` |
| Startup.scala:116 startup | `slack::notice_startup(version)`, called from main.rs (parent) |
| Worker.scala:148,155 liveness | helpers `notice_worker_missing/_return` ready; no Rust liveness monitor yet (G5) |

Parent main.rs (insert right after `let config = Config::from_env()?;`, line 23, i.e. before `db::connect`):
```rust
let slack = webknossos_backend::slack::install_global(&config.slack);
```
and after `let pool = db::connect(...)` (line 24):
```rust
slack.notice_startup(&config.misc.build_info.version());
```
(Optionally lib.rs could layer `slack::global()` when installed, so routes and background code share one rate
limit; currently they are two instances with 30 msgs/min each.)

## Deviations
- Schema mismatch text: Rust only compares `releaseInformation.schemaVersion` (no dbtool diff), message
  "The database schema version is not 185 ... which this backend requires."; Rust then refuses to start.
- Rate-limit log line logs only the title (Scala logs the full JSON message which may contain user names).
- Request-scoped service and global service have separate rate limiters (see above).
- `noticeSlowRequest`/`noticeFailedJobRequest` (logTime/log wrappers in JobController/AnnotationController/
  DatasetController) are not wired: no generic slow-request/failed-request middleware in Rust (not part of G4).
- Explore+add: only the Slack part of `trackNewDataset` (analytics/Mailchimp unchanged there).

## Evidence
- Unit: 9 `slack::tests` (payload JSON, colors, rate-limit window incl. strict `>`, config/redaction,
  formatDuration, job labels, heartbeat label, disabled/global).
- tests/slack.rs: mock webhook; direct service payloads + 30/min limit; DB test through POST /api/jobs/:id/status
  (failure + superuser success with workflow link) and POST /api/auth/register (suspicious vs normal name).
- clippy `--all-targets -D warnings` clean; rustfmt --check clean on edited files.
- Full suite (verify-a, --include-ignored, --no-fail-fast, 2026-10-11, log /tmp/webknossos-rust-slack-full.log):
  584 passed, 3 failed, 0 ignored, 90 harnesses. The 3 failures are all in tests/used_storage_scan.rs (another
  agent's in-flight G7 work: FK violations while seeding fixtures), unrelated to Slack; tests/slack.rs 2/2 pass.
