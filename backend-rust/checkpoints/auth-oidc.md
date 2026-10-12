# OIDC / SSO checkpoint (auth-oidc agent, 2026-10-10)

## Status
DONE: GET /auth/sso (Discourse SSO), GET /auth/oidc/login, GET /auth/oidc/callback in `src/auth_oidc.rs`; 6 PG integration tests (mock OIDC provider) in `tests/auth_oidc.rs`, 4 unit tests.

## Config (config_from_values; disabled by default; mirrors conf/application.conf)
| env | default | Scala key |
|---|---|---|
| WK_OIDC_ENABLED | false | features.openIdConnectEnabled |
| WK_OIDC_PROVIDER_URL | http://localhost:8080/auth/realms/master/ | singleSignOn.openIdConnect.providerUrl (discovery = providerUrl + ".well-known/openid-configuration", plain concat, needs trailing /) |
| WK_OIDC_CLIENT_ID | myclient | ...clientId |
| WK_OIDC_CLIENT_SECRET | myClientSecret (empty string = no basic auth) | ...clientSecret |
| WK_OIDC_SCOPE | openid profile email | ...scope |
| WK_OIDC_VERBOSE_LOGGING | false | ...verboseLoggingEnabled (Rust never logs tokens) |
| WK_OIDC_HTTP_TIMEOUT_SECONDS | 30 (1..3600) | (Rust only) |
| WK_SSO_KEY | "" | webKnossos.user.ssoKey |
logoutRedirectUrl is already WK_LOGOUT_REDIRECT_URL (auth_routes). Callback URL = BrowserAuthConfig.public_uri + `/api/auth/oidc/callback`. Debug redacts secret and sso key.

## Contract
- login: disabled -> 400 text/plain `SSO is not enabled`; empty provider URL -> 400 JSON `SSO/OIDC configuration is invalid.`; discovery each request (requires authorization_endpoint, token_endpoint, userinfo_endpoint, jwks_uri); 200 `{"redirect_url": "<authorization_endpoint>?client_id=..&redirect_uri=..&scope=..&response_type=code"}` (Java URLEncoder encoding, fixed order). No state/nonce (as Play).
- callback: disabled -> 400 JSON `SSO is not enabled`; first `code` query value or literal `missing code`; `state` ignored (as Play). Token POST form grant_type/client_id/redirect_uri/code/scope, HTTP Basic client_id:secret when secret set. Any discovery/token/JWKS/JWT failure -> 400 `Could not register or log in via single sign-on (SSO/OIDC).`
- Verification (jwt-scala 11.0.4 decodeJson(token, publicKey)): key = first JWKS key with kty=RSA && use=sig (JWKS parse requires kty/alg/use strings on every key, as Play's format), kid ignored; BOTH access token and optional id token must be RS256/RS384/RS512 JWTs with valid signature (opaque access tokens fail, as Play); `exp*1000 <= now` rejected, `nbf*1000 > now` rejected, no leeway; alg none/HS*/ES* rejected.
- User info: given_name, family_name, email (strings) from id token claims else access token claims; missing -> 400 `Failed to extract user info from id token or access token`.
- Login/signup: exact-email userFromMultiUserEmail (last active identity else first active). Found -> browser_auth::login_user(skip_email_verification=true). Not found -> single non-deleted organization (else 400 Msg.Organization.ambiguous), organization team membership, active, isEmailVerified=true, PasswordInfo Empty, not admin/datasetManager/owner, new-user mail (unless wkorg) + admin notifier mail after commit; no user-limit/name validation/registerToDefaultOrga check (as Play). Then login. Response 303 Location /dashboard + Set-Cookie.
- /auth/sso: missing sso/sig -> 400; anonymous -> 303 `/auth/login?redirectPage=http://discuss.webknossos.org`; empty key + logged in -> 500 (Play HmacUtils throws); sig != lowercase hex HMAC-SHA256(key, sso) (constant time) -> 400 text `Invalid signature`; payload lenient Base64 + form parse; missing nonce/return_sso_url -> 400 JSON; 303 to `return_url?sso=<urlenc base64(nonce=<raw>&email=..&external_id=..&username=<abbreviatedName>&name=..)>&sig=<hmac>`. Not gated by WK_OIDC_ENABLED.

## Deviations (all stricter or non-observable)
- Stricter: id token `aud` must equal / contain client_id (Play checks no aud); `exp`/`nbf` must be integers when present (Play ignores non-numeric); RSA modulus must be 2048..8192 bits (ring). No issuer check (Play has none).
- Discovery failure on /auth/oidc/login -> 400 `Could not fetch the SSO/OIDC provider configuration.` (Play: RPC error text, upstream status). Token errors always 400 (Play may propagate upstream status).
- Mails/new user creation are one transaction; admin-notifier recipient missing is logged and skipped (shared onboarding decision). Login log label stays "password form" inside login_user plus an OIDC info line.
- Parent TODO: /api/features `openIdConnectEnabled` is still hard-coded false in application_info.rs; should reflect WK_OIDC_ENABLED. config.rs/.env.example/README should list the env names above.

## Visibility changes
`src/browser_auth_onboarding.rs`: `ORGANIZATION_COLUMNS`, `initial_team_memberships`, `admin_notifier_mail` -> pub(crate).

## Evidence
- `cargo test --test auth_oidc -- --include-ignored` (verify-a): 6 passed, 0 failed. `cargo test --lib auth_oidc`: 4 passed.
- rustfmt --edition 2024 --check on owned files + browser_auth_onboarding.rs: clean. Whole-crate `clippy --all-targets -D warnings` clean except 5 `doc_lazy_continuation` errors in another agent's src/task_assignment.rs (with that lint allowed: clean).

## Next
None for this batch. WebAuthn ceremonies remain separate.
