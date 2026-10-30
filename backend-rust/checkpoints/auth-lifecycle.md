# Authentication lifecycle migration checkpoint

Owner: delegated auth_routes_stage2 agent. Only owns `src/auth_routes.rs`, `tests/auth_routes.rs`, and this checkpoint. Parent owns Cargo/lib/auth/config/docs/inventory and all cargo execution.

## Completed
- Inspected Scala AuthenticationController/UserTokenController, token services/DAO, WEBKNOSSOS schema, and passkey DAO.
- Added `auth_routes::router(config: AuthRouteConfig) -> Router<AppState>` with GET/DELETE `/auth/token`, POST `/userToken/generate`, POST `/auth/logout`, POST `/auth/logoutEverywhere`, GET `/auth/webauthn/keys`, DELETE `/auth/webauthn/keys/{id}`.
- Lifecycle credentials retain the presented token using parent-exposed `auth::extract_token`, then use shared `authenticate`.
- Token issuance uses OS cryptographic random 16 bytes and URL-safe unpadded base64; uses bound transactional SQL and ObjectId IDs.
- Serialize all issuance and lifecycle mutations with multiuser lock then caller user lock. Revalidate current credential after locks, including expiry, idle timeout, account cutoff and duplicate token value rejection.
- GET token reuses only valid authentication tokens without renewing expiry; if none usable soft-deletes old Authentication entries and creates one. Deliberate security fix to Scala's expired/unfiltered reuse.
- Anonymous datastore generation returns `{ "token": "" }`; anonymous logout returns JSON redirect string. Explicit invalid credentials remain 401 using established Rust OptionalAuthUser behavior.
- DELETE token returns `{ "messages": "Token was deleted." }` or empty 200. Logout discards only current token. Logout everywhere updates every account identity cutoff and deletes all account datastore tokens in same transaction; Auth tokens are invalidated by cutoff.
- Passkey descriptor list returns only `id`,`name`, scoped to multiuser; delete is soft and scoped, with idempotent 200 `{}` for foreign/missing/deleted credential, matching the Scala DAO row-count behavior. Routes require passkeys enabled and public HTTPS.
- AuthRouteConfig fields: auth_expiry, datastore_expiry, auth_idle_timeout (Duration), passkeys_enabled, uses_https, logout_redirect_url. Defaults match Scala 23000-day auth expiry/idle, 1-day datastore expiry, passkeys false, redirect `/`.

## Tests and validation
Eight PG integration tests in tests/auth_routes.rs cover token reuse/creation/deletion/concurrent creation, replacing expired/idle-expired tokens without renewal, anonymous/authenticated datastore generation and configured expiry, single logout isolation/redirect, account-wide cutoff and datastore revocation across identities, concurrent issuance/logout invariant, passkey feature/HTTPS/ownership/soft-delete/descriptor behavior, and monotonic revocation cutoff with existing future timestamps. Parent reports first seven PG tests passed centrally. Eighth cutoff regression test added afterward; awaiting parent run.

## Pending
- Parent formatting, clippy and eighth test feedback. First seven PG tests passed. No cargo commands run by this agent.
- Authentication lock review completed: extractor UPDATE is autocommitted and releases token row lock before lifecycle transaction starts; lifecycle operations all lock multiuser then caller user before token mutations, so issuance/revocation operations serialize across identities. After wait, SQL rechecks caller token before proceeding. Added GREATEST cutoff assignment so clock skew cannot lower an existing account revocation cutoff and resurrect credentials.
- Same-account different-organization passkey descriptor access is covered. Consider duplicate live Authentication token-value tests.

## Limitations
No browser cookie/session or password/login/signup/email/SSO flows; no WebAuthn challenge/registration/authentication ceremonies. Only actual bearer credential lifecycle, plus existing passkey list/delete metadata. Route implementations do not claim browser session parity.

## Next step
Send parent final owned-file status and request eighth regression test run; parent completes centralized repository verification. Preserve all untracked task files; never use rm on macOS.

## Latest verification evidence
Parent final centralized PostgreSQL run: all eight auth lifecycle tests passed.
