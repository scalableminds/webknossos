# Organization / pricing / terms-of-service checkpoint (batch M4)

Scope: the remaining OrganizationController routes.

## Status
- Status: DONE. All 10 routes implemented; clippy clean; full suite (187 tests incl. ignored DB tests) green
- Done:
  - `src/organizations.rs`: `POST /organizations`, `DELETE /organizations/:id`
  - `src/terms_of_service.rs` (new): `GET /operatorData`, `GET /termsOfService`, `POST /termsOfService/accept`, `GET /termsOfService/acceptanceNeeded`
  - `src/pricing.rs` (new): `POST /pricing/upgradeRequest`, `GET /pricing/status`, `POST /pricing/updatePlan`, `GET /pricing/planUpdates`
  - `src/lib.rs`: modules + merges (additive)
  - `tests/organization_pricing.rs`: 5 PostgreSQL tests; unit tests in `pricing.rs`
- In-flight: none
- Next step: none for M4; coordinator regenerates MIGRATION_STATUS.md
- Gaps: listed below

## Contract notes
- Config reuse (no new env vars): `MiscConfig` (`application_info.rs`) supplies `operator_data` (`WK_OPERATOR_DATA`),
  `terms_of_service` (`WK_TERMS_OF_SERVICE_{ENABLED,VERSION,URL,ACCEPTANCE_DEADLINE}`), `is_wkorg_instance`,
  `support_email`, `monthly_free_milli_credits`, `public_uri`. Handlers read `Extension<MiscState>` and `Extension<MailSender>`,
  so tests must use `router_with_misc` (the bare `organizations::router()` lacks these extensions for create).
- `/operatorData`, `/termsOfService`: plain Actions with `Cache-Control: no-cache` (addNoCacheHeaderFallback).
- ToS accept: owner check (400) -> enabled (400) -> version (400) -> update; `?version` required (missing -> 400).
- acceptanceNeeded: `enabled && org.lastVersion < version`, deadline as epoch millis, `deadlinePassed`.
- Pricing status: `countAllForOrganization` with the paying-organization subquery (copied as `COUNT_USERS_FOR_ORGANIZATION`);
  isExceeded / isAlmostExceeded (users > limit-2 with >1 user, or paidUntil within 42 days).
- Upgrade request: admin (400) -> credits need owner (400) -> amounts > 0 (400) -> note <= 10000 UTF-16 units (400)
  -> org (404) -> plan must be Team/Power and an upgrade (400) -> AI add-on needs no aiPlan and >= Team tier (400)
  -> non-empty change list (400). Mail to `[support_email, requester]`, subject `WEBKNOSSOS Upgrade Request: <org name>`.
- updatePlan: JSON parsed first (crate-wide "Invalid JSON request body." on errors), then superuser (400 superUserOnly),
  org (404). Tristate fields (aiPlan, paidUntil, includedUsers, includedStorageBytes): absent = unchanged, null = reset.
  ByteCount accepts numbers or `<digits>[B|KB|MB|GB|TB]` (spaces/underscores ignored); Instant accepts millis or ISO.
  `created` defaults to now. Insert of plan update + org update in one transaction (Play: not transactional).
  Upgrade mails (PricingPlanFeatures.unlockedBy) to active owner/admins after commit; failures only logged.
- planUpdates: superuser or admin (400); own organization's updates ordered by created; unchanged tristate fields omitted,
  reset ones null; fallback `defaultPlanUpdate` ("Organization created", null limits omitted, aiPlan always present).
- POST /organizations: superuser (403 notAllowed) -> owner multiUser by email (400) -> createOrganization (400 idInvalid/idTaken)
  -> first active identity (404 Msg.notFound) -> joinOrganization as admin+owner with the org team -> 
  `hand_out_monthly_free_credits`. Reply: plain-text organization id. All in one transaction (Play: not transactional,
  so a late failure in Play leaves an orphan organization; here nothing is created).
- DELETE /organizations/:id: readable org (404 notFound(id)) -> isAdminOf (403) -> soft-delete org, soft-delete all its users,
  null `_lastLoggedInIdentity` pointing at them, revoke the request's bearer token (Silhouette discard); Play drops the
  discard result, so no Set-Cookie is sent. One transaction.

## Gaps / deviations
- Mail bodies are plain-text renditions (no HTML templates, no Reply-To), like the rest of the crate.
- `insert_organization` in organizations.rs duplicates the private `create_organization` helper in
  `browser_auth_onboarding.rs` (not owned by this batch); dedupe by making that helper `pub(crate)`.
- Deleted organization ids count as taken (base-table check, as in onboarding); Play's view lookup would instead
  fail on the primary key.
- Extractor order: authentication is checked before JSON body validation (crate convention); Play parses the body first.
- ByteCount strings that overflow i64 are rejected (Play would wrap or throw).
