# analytics-call-sites (G6) checkpoint

Status: IN PROGRESS 2026-10-11. Agent target dir /tmp/webknossos-rust-verify-b.
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
tests/datasets.rs + tests/dataset_update.rs now layer an offline MiscState (handlers extract Extension<MiscState>).
Next: run route-module suites (browser_auth_onboarding, auth_oidc, datasets, dataset_update, lib unit), clippy, fmt.
