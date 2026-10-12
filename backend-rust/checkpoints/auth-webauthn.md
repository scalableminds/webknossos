# WebAuthn / passkeys checkpoint (W1 registration + W2 authentication, 2026-10-10)

## Status
DONE (W1): POST /auth/webauthn/register/start and /register/finalize in `src/auth_webauthn.rs`; strict CBOR + COSE_Key codec in `src/cbor.rs`.
DONE (W2): POST /auth/webauthn/auth/start and /auth/finalize in the same `router()` (shared `WebAuthnStores`). All four WebAuthn routes are implemented; parent should regenerate the inventory.

## Config source (no lib.rs/config.rs change)
`router()` signature unchanged. Handlers read the router-wide `Extension<MiscState>`:
- enabled = `features.passkeysEnabled` (WK_PASSKEYS_ENABLED, after certificate feature overrides, exactly like Scala `conf.Features.passkeysEnabled`).
- https = `public_uri.starts_with("https://")` (Scala `usesHttps`); origin = public URI; rpId = its host (`new Origin(http.uri).getHost`).
Challenge stores are a router-local `Extension<WebAuthnStores>` created in `router()` (cloned `api` routers share the Arc). In-process, 2-minute expiry, pop-once, expired entries purged on insert (Scala TemporaryStore is in-process as well).

## Contract (Scala AuthenticationController + webauthn4j 0.31.9 non-strict manager)
- Both: SecuredAction (401), then 400 `Passkeys are not enabled for this WEBKNOSSOS instance.` / 400 `Passkeys are only supported with HTTPS.`
- start: 200 options `{authenticatorSelection{requireResidentKey:true,residentKey:"required",userVerification:"preferred"}, attestation:"none", challenge:b64url(32 random), excludeCredentials:[{id:b64url(credId from serializedAttestedCredential), type}], pubKeyCredParams:[-8,-7,-257], timeout:120000, rp{id:host,name:host}, user{displayName:"first last", id:b64url(multiUserId ascii), name:email}}` + `Set-Cookie: webauthn-registration=<uuid>; Max-Age=120; Expires=..; Path=/; Secure; HTTPOnly; SameSite=Strict`. Any unparsable live credential row -> 500 `Failed to fetch Passkeys` (Scala DAO parse failure).
- finalize body `{name, key: PublicKeyCredential JSON}`. Order: parse key (400) -> cookie missing (404 `Could not find or access the requested resource.`) -> pop challenge (401 `Timeout during registration. Please try again.`; challenge is consumed even if verification then fails) -> verify (400) -> insert (any DB error incl. unique (_multiUser, credentialId) violation, also against soft-deleted rows -> 500 `Failed to add Passkey`) -> 200 `{"message":"Key registered successfully"}`. Cookie not cleared.
- Verification (RegistrationParameters(uv=false, up=true)): clientData type `webauthn.create`, challenge bytes equal (b64url, padding optional), origin equal by scheme/host/effective port (path ignored), crossOrigin=true rejected (webauthn4j BadTopOrigin); rpIdHash = SHA-256(rpId); UP required; UV not required; BS without BE rejected; RFU flag bits ignored; AT required; credential alg in {-8,-7,-257}; attestation fmt `none` with empty attStmt.
- authData layout (as webauthn4j): ED with zero remaining bytes = no extensions; extension bytes without ED, or any trailing bytes -> reject; attestationObject must be exactly {fmt, attStmt, authData}, no trailing bytes.

## Storage format (webknossos.webauthnCredentials; verified against webauthn4j 0.31.9 oracle)
- `_id` new ObjectId, `credentialId` raw bytes, `name`, `userVerified`=UV, `backupEligible`=BE, `backupState`=BS, `signatureCount` = signCount as i32 (wraps like `toInt`), isDeleted false.
- `serializedAttestedCredential` = aaguid(16) || u16 BE id length || credentialId || COSE key RE-ENCODED like Jackson: definite map, minimal heads, unknown labels dropped, label order EC2 `1,2(kid),3,-1,-2,-3`; OKP `1,2,3,-1,-2`; RSA `-2,1,-1,2,3`.
- `serializedAttestationStatement` = `{"attestationStatement":{},"fmt":"none","format":"none"}` (Jackson writes both fmt and format).
- `serializedExtensions` = Jackson tree of the authData extension map (`{}` when absent): ints, text, bools, arrays, maps; byte strings as standard padded base64; credProtect must be 1..3.
- Oracle: /tmp/wk-webauthn-oracle/Oracle.java (javac/java against Coursier jars webauthn4j-core 0.31.9, jackson 3.2.1, annotations 2.22) runs the exact Scala flow; its outputs are pinned in unit tests (`replays_webauthn4j_registrations`, `attested_credential_matches_webauthn4j_serialization`, `cose_keys_reencode_like_webauthn4j`).

## Reuse API for W2 (auth/start + auth/finalize), all in auth_webauthn.rs unless noted
- `WebAuthnStores { registration, assertion }` (Extension, already layered by `router()`; add W2 routes to the same `router()` so they share it); `ChallengeStore::{insert(session, challenge, ttl), pop(session)}`; `new_challenge() -> (uuid, 32 bytes)`; `challenge_cookie(ASSERTION_COOKIE, session)`; `CHALLENGE_TIMEOUT`.
- `relying_party(&MiscState) -> ApiResult<RelyingParty>` (feature + https 400s); `RelyingParty::{origin_matches, rp_id_hash, rp_id}`.
- `verify_client_data(raw, "webauthn.get", challenge, &rp)`; `AuthenticatorData::parse(bytes)` + `verify_common(&rp)` (rpIdHash, UP, BE/BS); `decode_base64url`; flag consts `FLAG_*`; `MSG_UNAUTHORIZED`.
- `credentials_for_multi_user(executor, multi_user)` -> rows `(id, AttestedCredential)`; `AttestedCredential::from_webauthn4j_bytes` parses Scala-created rows; W2 should select by `(_multiUser, credentialId)` from `webauthnCredentials_` and parse `serializedAttestedCredential`.
- `cbor::CoseKey::verify(message, signature)` (ring: ES256 ASN.1 DER, Ed25519, RS256 PKCS#1 2048..8192 bits); W2 message = authenticatorData || SHA-256(clientDataJSON). Scala auth: userHandle = multiUser id string bytes, UV/UP not required, then signCount rule `(old==0 && new==0) || old < new` checked AFTER updating signatureCount (Scala order), login via `_lastLoggedInIdentity`.

## Deviations (stricter or non-observable)
- Only attestation format `none` accepted (webauthn4j non-strict also accepts packed/tpm/android/apple/fido-u2f with null verifiers); we request `attestation:"none"`, which browsers honor by sending fmt `none`.
- COSE key: alg required and must match kty; EC2 must be P-256 with 32-byte x/y, OKP Ed25519 32-byte x, RSA non-empty n/e (webauthn4j stores mismatched curves/short coordinates; those keys could never authenticate). No on-curve check (neither does webauthn4j at registration). key_ops/baseIV labels are dropped rather than stored.
- CBOR: indefinite lengths, tags, floats, unusual simple values, duplicate map keys and depth > 16 rejected (Jackson accepts some); non-minimal heads accepted.
- Error text for parse/verify failures is a fixed `Passkey registration could not be verified.` (Scala echoes the Java exception message); the status (400) matches. Strict COSE checks fail at parse (before the challenge is popped) rather than at verify.
- Extension values that are byte strings serialize as base64 like Jackson's generic tree; typed webauthn4j outputs other than credProtect are not range-checked.

## W2 contract (Scala webauthnAuthStart/webauthnAuthFinalize + webauthn4j 0.31.9 AuthenticationDataVerifier, read from bytecode)
- Both are plain `Action` (no login needed). start: 400 notEnabled / requiresHttps, then 200 `{challenge:b64url(32), timeout:120000, rpId:host, userVerification:"preferred"}` (hints None omitted) + `Set-Cookie: webauthn-session=<uuid>; Max-Age=120; Expires=..; Path=/; Secure; HTTPOnly; SameSite=Strict`; challenge in the assertion store (2 min).
- finalize body `{key}` (missing key -> 400 JSON validation, before everything; explicit null allowed). Order: notEnabled/requiresHttps 400 -> cookie missing 404 `Could not find or access the requested resource.` -> pop challenge else 401 `Timeout during authentication. Please try again.` (consumed even if later steps fail) -> every following failure 401 `Passkey authentication failed.`: parse (rawId = credentialId, response.clientDataJSON/authenticatorData/signature b64url, userHandle optional) -> userHandle as UTF-8 ObjectId -> multiUser (multiUsers_) -> credential by (_multiUser, credentialId) in webauthnCredentials_ (soft-deleted rejected) -> verify -> UPDATE signatureCount (bound as i64 like Scala's Long; > INT max fails in PG -> 401) -> `_lastLoggedInIdentity` NULL -> 404 (Fox Empty; counter already updated) -> `browser_auth::login_user(.., skip_email_verification=false)` (400 invalid credentials / deactivated / unverified as password login) -> 200 empty body + session Set-Cookie.
- Verify (AuthenticationParameters(uv=false, up=false, allowCredentials=null)): no AT data in authData; clientData type `webauthn.get`, challenge, origin, crossOrigin true rejected, tokenBinding (unknown status or `present` with id rejected; also applies to registration now); rpIdHash; UP and UV NOT required; BS without BE rejected; BEFlagVerifier: presented BE must equal stored backupEligible; signature over authData || SHA-256(clientDataJSON) with the stored COSE key; counter: reject unless (old<=0 && new<=0) || new > old (webauthn4j throws MaliciousCounterValueException BEFORE Scala's update, so a regression never changes the stored counter; Scala's later re-check is then redundant).

## W2 deviations
- Credential row parse only decodes serializedAttestedCredential (Scala also parses serializedExtensions/attestation statement; malformed ones would also give 401 there, we accept them). Client extension results and authenticator extension outputs are not type-checked (webauthn4j parses them; unusual values could fail there).
- Missing/non-UTF-8 userHandle -> 401 (Scala `new String(null)` would throw; outcome there is an internal failure). Log line label "passkey/webauthn" is emitted by the handler (login_user also logs its generic line).
- No webauthn4j oracle replay for assertions; rules were taken from javap of AuthenticationDataVerifier/BEFlagVerifier/BEBSFlagsVerifier/TokenBindingVerifier/AssertionSignatureVerifier.

## Visibility changes
None outside owned files (W2 uses existing pub(crate) `browser_auth::login_user`).

## Evidence
- `cargo test --lib -- cbor auth_webauthn` (verify-a): 14 passed (cbor 9 incl. 20k-case mutation fuzz, auth_webauthn 5 incl. oracle replay).
- `cargo test --test auth_webauthn -- --include-ignored` (verify-a): 2 passed (feature gates for both routes, 401, exact options/cookie, Scala-row exclusion, deleted rows ignored, malformed row 500; 7 bad ceremonies each 400 then 401 on retry, missing cookie 404, malformed key 400, unknown session 401, happy-path row byte-equal, duplicate 500, per-account uniqueness, BE/BS/!UV flags).

- W2 (verify-a): `cargo test --lib -- auth_webauthn cbor` 16 passed (+ sign-count rule, tokenBinding); `cargo test --test auth_webauthn -- --include-ignored` 4 passed: auth start options/cookie/feature gates/anonymous/missing key 400; finalize registers an ES256 key via W1 then: 16 bad assertions each 401 + 401 timeout on retry (wrong challenge, origin x2, rpId, client type, unknown credential, bad signature, signCount equal/lower/zero, missing/foreign/malformed userHandle, BS w/o BE, BE mismatch, AT present) with counter unchanged; missing cookie 404; unknown session 401; UP-only assertion with NULL _lastLoggedInIdentity -> 404 after counter update; success 200 + `id=` cookie that authenticates GET /api/user via the full router; replay 401; soft-deleted credential 401. Clippy all-targets -D warnings clean; rustfmt --check clean.

## Next
None for WebAuthn. Parent: regenerate MIGRATION_STATUS/inventory (4 WebAuthn routes now registered).
