# analytics-call-sites (G6) checkpoint

Status: DONE 2026-11-03 (started 2026-10-11).
Done: Scala research. Call sites (Scala -> Rust):
- signup: AuthenticationController.createUser (register, OIDC first login, createUserInOrganization) + createOrganizationWithAdmin
  -> browser_auth_onboarding.rs register/create_user_in_organization/create_organization_with_admin, auth_oidc.rs login_or_signup.
  props {"had_invite": bool}; actor = the NEW user.
- join_organization: joinOrganization (actor = requesting OLD identity), createOrganizationWithExistingUser (actor = body.userId user).
  props {"joined_organization_id": orgId}. NOT tracked in OrganizationController.addUser.
- send_invites: props {"recipient_count": n}, after all invites.
- open_dataset: DatasetController.read, logged-in only, after publicWrites. props dataset_id, dataset_name,
  dataset_organization_id, dataset_uploader_multiuser_id (null if no uploader; event dropped if uploader user missing).
- change_dataset_settings: update (datasets.rs update_metadata), updatePartial + legacy updatePartialV12 (same Rust handler
  dataset_update.rs update_partial). props {"dataset_id"}.
- heartbeat: IntervalScheduler 24 h, initial 10 s, always on; oldest active user (users_ NOT isDeactivated ORDER BY created),
  props {"build_info": buildInfoJson}.
Next: implement analytics.rs helpers (track_for_user_id, track_open_dataset, heartbeat spawn), call sites, tests.
Milestone (impl): analytics.rs helpers + heartbeat, call sites in browser_auth_onboarding.rs (5), auth_oidc.rs (1),
datasets.rs (read, update_metadata), dataset_update.rs (update_partial); application_info::build_info_json made pub(crate).
cargo check --all-targets passes. Next: tests/analytics_call_sites.rs.
Milestone (tests): tests/analytics_call_sites.rs 3/3 pass (onboarding, datasets, heartbeat); tests/analytics 3/3.
(Superseded: MiscState now lives in AppState and handlers extract `State<MiscState>`; no `Extension` layer is left
in src/ or tests/.)

Finish 2026-11-03:
- Re-checked all call sites against `AuthenticationController.scala`, `DatasetController.scala`,
  `LegacyApiController.scala` and `AnalyticsEvent.scala` (names, properties, actor, logged-in-only open_dataset).
  No gaps found. Note: `signup` for register/OIDC/createUserInOrganization comes from Play's shared private
  `createUser`; createOrganizationWithAdmin tracks it separately.
- `main.rs` now calls `system::analytics::spawn_heartbeat(pool, state.misc.clone())` (shares the router's
  analytics session map) and shuts it down with the other background jobs. The enable decision is
  `heartbeat_schedule` (unit-tested); new unit test `enabled_heartbeat_spawns_its_job` covers the start path for
  both outputs; the lock-key uniqueness test now also covers worker-liveness, pricing-reminder, realpath-scan and
  mailchimp job names.
- Deviations from Play: heartbeat job disabled when neither `WK_ANALYTICS_URI` nor database saving is configured
  (Play ticks but its event is a no-op); per-tick advisory lock (Play has none); events fire after the creating
  transaction commits, so a failed later step (e.g. ToS acceptance in createOrganizationWithAdmin) sends no
  `signup` (Play tracked before it and kept the partially created user).
- Verification (backend-rust/): `make check` fails only on the two known pre-existing overlong lines
  (src/slack.rs:287, src/background/credit_ticker.rs:28); clippy -D warnings, route_inventory --check,
  datastore_route_inventory --check, check_sql_placeholders all pass. `cargo test --locked -p webknossos-backend`:
  lib 301 passed; integration 66 passed, 332 ignored; doc 0 passed, 1 ignored. With
  `WK_RUST_TEST_DATABASE_URL` and `--include-ignored`: lib 301, integration 398, doc 1 passed, 0 failed.
