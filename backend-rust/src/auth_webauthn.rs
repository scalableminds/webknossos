//! WebAuthn (passkey) ceremonies. Scala: AuthenticationController
//! webauthnRegisterStart/webauthnRegisterFinalize and
//! webauthnAuthStart/webauthnAuthFinalize with webauthn4j 0.31.9
//! `createNonStrictWebAuthnManager` and `WebAuthnCredentialDAO`.
//!
//! Shared building blocks (challenge stores, relying-party checks, client
//! data / authenticator data verification and the Scala-compatible
//! credential row codec) are `pub(crate)` so the authentication ceremony can
//! reuse them; see checkpoints/auth-webauthn.md.
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use axum::{
    Extension, Json, Router,
    extract::State,
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::post,
};
use base64::{
    Engine,
    alphabet::URL_SAFE,
    engine::{
        DecodePaddingMode, GeneralPurpose, GeneralPurposeConfig, general_purpose::URL_SAFE_NO_PAD,
    },
};
use chrono::Utc;
use ring::digest::{SHA256, digest};
use serde::Deserialize;
use serde_json::{Value as JsonValue, json};
use sqlx::PgExecutor;

use crate::{
    AppState,
    application_info::MiscState,
    auth::AuthUser,
    browser_auth::{BrowserAuthConfig, login_user, request_cookie},
    cbor::{self, CoseKey, Value},
    error::{ApiError, ApiResult},
    extract::Json as JsonBody,
    id::ObjectId,
    mail::MailSender,
};

/// Scala `webauthnTimeout = 2 minutes` (cookie Max-Age, options timeout and
/// challenge store expiry).
pub(crate) const CHALLENGE_TIMEOUT: Duration = Duration::from_secs(120);
pub(crate) const REGISTRATION_COOKIE: &str = "webauthn-registration";
pub(crate) const ASSERTION_COOKIE: &str = "webauthn-session";
/// Offered in this order: EdDSA, ES256, RS256.
pub(crate) const PUB_KEY_ALGORITHMS: [i64; 3] = [cbor::ALG_EDDSA, cbor::ALG_ES256, cbor::ALG_RS256];

pub(crate) const MSG_NOT_ENABLED: &str = "Passkeys are not enabled for this WEBKNOSSOS instance.";
pub(crate) const MSG_REQUIRES_HTTPS: &str = "Passkeys are only supported with HTTPS.";
pub(crate) const MSG_UNAUTHORIZED: &str = "Passkey authentication failed.";
const MSG_REGISTRATION_TIMEOUT: &str = "Timeout during registration. Please try again.";
const MSG_AUTHENTICATION_TIMEOUT: &str = "Timeout during authentication. Please try again.";
const MSG_INVALID_REGISTRATION: &str = "Passkey registration could not be verified.";
const MSG_NOT_FOUND: &str = "Could not find or access the requested resource.";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/webauthn/register/start", post(register_start))
        .route("/auth/webauthn/register/finalize", post(register_finalize))
        .route("/auth/webauthn/auth/start", post(auth_start))
        .route("/auth/webauthn/auth/finalize", post(auth_finalize))
        .layer(Extension(WebAuthnStores::default()))
}

// ---------------------------------------------------------------------------
// Challenge storage (Scala TemporaryStore[String, WebAuthnChallenge]).

/// In-process session-id -> challenge store with expiry; `pop` removes.
#[derive(Clone, Default)]
pub(crate) struct ChallengeStore(Arc<Mutex<ChallengeMap>>);

/// session id -> (challenge, expiry).
type ChallengeMap = HashMap<String, (Vec<u8>, Instant)>;

impl ChallengeStore {
    pub(crate) fn insert(&self, session_id: String, challenge: Vec<u8>, ttl: Duration) {
        let now = Instant::now();
        let mut map = self.0.lock().unwrap_or_else(|e| e.into_inner());
        map.retain(|_, (_, expiry)| *expiry > now);
        map.insert(session_id, (challenge, now + ttl));
    }

    pub(crate) fn pop(&self, session_id: &str) -> Option<Vec<u8>> {
        let mut map = self.0.lock().unwrap_or_else(|e| e.into_inner());
        map.remove(session_id)
            .filter(|(_, expiry)| *expiry > Instant::now())
            .map(|(challenge, _)| challenge)
    }
}

/// Router-local extension: one store per ceremony, as Scala injects two.
#[derive(Clone, Default)]
pub(crate) struct WebAuthnStores {
    pub registration: ChallengeStore,
    pub assertion: ChallengeStore,
}

/// 32 random challenge bytes and a fresh UUID session id.
pub(crate) fn new_challenge() -> ApiResult<(String, Vec<u8>)> {
    let mut challenge = vec![0u8; 32];
    getrandom::fill(&mut challenge).map_err(|_| ApiError::internal())?;
    Ok((uuid::Uuid::new_v4().to_string(), challenge))
}

/// Play `Cookie(name, value, maxAge=120, secure, httpOnly, SameSite=Strict)`.
pub(crate) fn challenge_cookie(name: &str, session_id: &str) -> HeaderValue {
    let max_age = CHALLENGE_TIMEOUT.as_secs();
    let expires = Utc::now() + chrono::Duration::seconds(max_age as i64);
    HeaderValue::from_str(&format!(
        "{name}={session_id}; Max-Age={max_age}; Expires={}; Path=/; Secure; HTTPOnly; SameSite=Strict",
        expires.format("%a, %d %b %Y %H:%M:%S GMT")
    ))
    .expect("cookie is header-safe")
}

// ---------------------------------------------------------------------------
// Relying party (conf.Http.uri / features.passkeysEnabled).

pub(crate) struct RelyingParty {
    pub origin: url::Url,
    /// `new Origin(conf.Http.uri).getHost`.
    pub rp_id: String,
}

/// `passkeysEnabled` (effective features incl. certificate overrides, as
/// Scala's WkConf) then `http.uri` starts with https://, both 400.
pub(crate) fn relying_party(misc: &MiscState) -> ApiResult<RelyingParty> {
    let config = misc.config();
    let enabled = config
        .features
        .get("passkeysEnabled")
        .and_then(JsonValue::as_bool);
    if enabled != Some(true) {
        return Err(ApiError::bad_request(MSG_NOT_ENABLED));
    }
    if !config.public_uri.starts_with("https://") {
        return Err(ApiError::bad_request(MSG_REQUIRES_HTTPS));
    }
    let origin = url::Url::parse(&config.public_uri).map_err(|_| ApiError::internal())?;
    let rp_id = origin.host_str().ok_or_else(ApiError::internal)?.to_owned();
    Ok(RelyingParty { origin, rp_id })
}

impl RelyingParty {
    /// webauthn4j `Origin.equals`: scheme, host and effective port (path ignored).
    pub(crate) fn origin_matches(&self, actual: &str) -> bool {
        url::Url::parse(actual).is_ok_and(|actual| {
            actual.scheme() == self.origin.scheme()
                && actual.host_str() == self.origin.host_str()
                && actual.port_or_known_default() == self.origin.port_or_known_default()
        })
    }

    pub(crate) fn rp_id_hash(&self) -> [u8; 32] {
        digest(&SHA256, self.rp_id.as_bytes())
            .as_ref()
            .try_into()
            .expect("SHA-256 is 32 bytes")
    }
}

// ---------------------------------------------------------------------------
// Parsing and verification shared by both ceremonies.

/// webauthn4j accepts base64url with or without padding.
pub(crate) fn decode_base64url(text: &str) -> Option<Vec<u8>> {
    const LENIENT: GeneralPurpose = GeneralPurpose::new(
        &URL_SAFE,
        GeneralPurposeConfig::new().with_decode_padding_mode(DecodePaddingMode::Indifferent),
    );
    LENIENT.decode(text).ok()
}

/// CollectedClientData checks: type, challenge bytes, origin; a
/// `crossOrigin: true` ceremony is rejected (no cross-origin allowance).
pub(crate) fn verify_client_data(
    raw: &[u8],
    expected_type: &str,
    challenge: &[u8],
    rp: &RelyingParty,
) -> Result<(), &'static str> {
    let data: JsonValue = serde_json::from_slice(raw).map_err(|_| "clientDataJSON")?;
    if data.get("type").and_then(JsonValue::as_str) != Some(expected_type) {
        return Err("type");
    }
    let sent = data
        .get("challenge")
        .and_then(JsonValue::as_str)
        .and_then(decode_base64url);
    if sent.as_deref() != Some(challenge) {
        return Err("challenge");
    }
    let origin = data.get("origin").and_then(JsonValue::as_str);
    if !origin.is_some_and(|origin| rp.origin_matches(origin)) {
        return Err("origin");
    }
    if data.get("crossOrigin").and_then(JsonValue::as_bool) == Some(true) {
        return Err("crossOrigin");
    }
    // TokenBindingVerifier with no server token binding id: an unknown
    // status, or "present" with an id, is rejected.
    if let Some(binding) = data.get("tokenBinding").filter(|b| !b.is_null()) {
        let id = binding.get("id").filter(|id| !id.is_null());
        match binding.get("status").and_then(JsonValue::as_str) {
            Some("supported" | "not-supported") => {}
            Some("present") if id.is_none() => {}
            _ => return Err("tokenBinding"),
        }
    }
    Ok(())
}

pub(crate) const FLAG_UP: u8 = 0x01;
pub(crate) const FLAG_UV: u8 = 0x04;
pub(crate) const FLAG_BE: u8 = 0x08;
pub(crate) const FLAG_BS: u8 = 0x10;
pub(crate) const FLAG_AT: u8 = 0x40;
pub(crate) const FLAG_ED: u8 = 0x80;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AttestedCredential {
    pub aaguid: [u8; 16],
    pub credential_id: Vec<u8>,
    pub key: CoseKey,
}

impl AttestedCredential {
    /// Parse `aaguid || u16 length || credentialId || COSE key` from the
    /// start of `bytes`; returns the consumed length.
    fn parse_prefix(bytes: &[u8]) -> Result<(Self, usize), &'static str> {
        if bytes.len() < 18 {
            return Err("attested credential data");
        }
        let aaguid: [u8; 16] = bytes[..16].try_into().expect("16 bytes");
        let id_len = usize::from(u16::from_be_bytes([bytes[16], bytes[17]]));
        let id_end = 18 + id_len;
        if id_len == 0 || bytes.len() < id_end {
            return Err("credential id");
        }
        let (key, key_len) = cbor::decode_prefix(&bytes[id_end..]).map_err(|_| "COSE key")?;
        let key = CoseKey::from_value(&key).map_err(|_| "COSE key")?;
        Ok((
            Self {
                aaguid,
                credential_id: bytes[18..id_end].to_vec(),
                key,
            },
            id_end + key_len,
        ))
    }

    /// webauthn4j `AttestedCredentialDataConverter.convert` output, stored in
    /// `webauthnCredentials.serializedAttestedCredential`.
    pub(crate) fn to_webauthn4j_bytes(&self) -> Vec<u8> {
        let mut out = self.aaguid.to_vec();
        out.extend((self.credential_id.len() as u16).to_be_bytes());
        out.extend(&self.credential_id);
        out.extend(self.key.to_webauthn4j_cbor());
        out
    }

    /// Inverse of [`Self::to_webauthn4j_bytes`]; exact consumption.
    pub(crate) fn from_webauthn4j_bytes(bytes: &[u8]) -> Result<Self, &'static str> {
        let (credential, used) = Self::parse_prefix(bytes)?;
        if used != bytes.len() {
            return Err("trailing bytes");
        }
        Ok(credential)
    }
}

#[derive(Clone, Debug)]
pub(crate) struct AuthenticatorData {
    pub rp_id_hash: [u8; 32],
    pub flags: u8,
    pub sign_count: u32,
    pub attested: Option<AttestedCredential>,
    /// Authenticator extension outputs (text-keyed map) when ED is set.
    pub extensions: Option<Value>,
}

impl AuthenticatorData {
    /// Layout rules as webauthn4j: AT/ED decide the optional parts, ED with no
    /// remaining bytes means no extensions, any other leftover is an error.
    pub(crate) fn parse(bytes: &[u8]) -> Result<Self, &'static str> {
        if bytes.len() < 37 {
            return Err("authenticator data too short");
        }
        let rp_id_hash: [u8; 32] = bytes[..32].try_into().expect("32 bytes");
        let flags = bytes[32];
        let sign_count = u32::from_be_bytes(bytes[33..37].try_into().expect("4 bytes"));
        let mut rest = &bytes[37..];
        let attested = if flags & FLAG_AT != 0 {
            let (credential, used) = AttestedCredential::parse_prefix(rest)?;
            rest = &rest[used..];
            Some(credential)
        } else {
            None
        };
        let extensions = if flags & FLAG_ED != 0 && !rest.is_empty() {
            let value = cbor::decode(rest).map_err(|_| "extensions")?;
            if value.as_map().is_none() {
                return Err("extensions");
            }
            rest = &[];
            Some(value)
        } else {
            None
        };
        if !rest.is_empty() {
            return Err("authenticator data has trailing bytes");
        }
        Ok(Self {
            rp_id_hash,
            flags,
            sign_count,
            attested,
            extensions,
        })
    }

    /// rpIdHash, UP required (UV only preferred), BS requires BE.
    pub(crate) fn verify_common(&self, rp: &RelyingParty) -> Result<(), &'static str> {
        if self.rp_id_hash != rp.rp_id_hash() {
            return Err("rpIdHash");
        }
        if self.flags & FLAG_UP == 0 {
            return Err("user presence");
        }
        if self.flags & FLAG_BS != 0 && self.flags & FLAG_BE == 0 {
            return Err("backup state");
        }
        Ok(())
    }

    /// `serializedExtensions` JSON (Jackson view of the extension outputs).
    /// credProtect must be 1..=3 like webauthn4j's typed output.
    pub(crate) fn extensions_json(&self) -> Result<JsonValue, &'static str> {
        let Some(extensions) = &self.extensions else {
            return Ok(json!({}));
        };
        if let Some(level) = extensions.get_text("credProtect")
            && !matches!(level.as_integer(), Some(1..=3))
        {
            return Err("credProtect");
        }
        extensions.to_json().map_err(|_| "extensions")
    }
}

/// A parsed `PublicKeyCredential` registration response (webauthn4j
/// `parseRegistrationResponseJSON`). Only the "none" attestation format is
/// accepted (see checkpoint deviations).
struct Registration {
    client_data_json: Vec<u8>,
    auth_data: AuthenticatorData,
    credential: AttestedCredential,
    attestation_format: String,
    attestation_statement_empty: bool,
}

fn parse_registration(key: &JsonValue) -> Result<Registration, &'static str> {
    let response = key.get("response").ok_or("response")?;
    let field = |name| {
        response
            .get(name)
            .and_then(JsonValue::as_str)
            .and_then(decode_base64url)
            .ok_or(name)
    };
    let client_data_json = field("clientDataJSON")?;
    let attestation =
        cbor::decode(&field("attestationObject")?).map_err(|_| "attestationObject")?;
    let entries = attestation.as_map().ok_or("attestationObject")?;
    if entries
        .iter()
        .any(|(k, _)| !matches!(k.as_text(), Some("fmt" | "attStmt" | "authData")))
    {
        return Err("attestationObject");
    }
    let format = attestation
        .get_text("fmt")
        .and_then(Value::as_text)
        .ok_or("fmt")?
        .to_owned();
    let statement = attestation
        .get_text("attStmt")
        .and_then(Value::as_map)
        .ok_or("attStmt")?;
    let auth_data = attestation
        .get_text("authData")
        .and_then(Value::as_bytes)
        .ok_or("authData")?;
    let auth_data = AuthenticatorData::parse(auth_data)?;
    let credential = auth_data
        .attested
        .clone()
        .ok_or("attested credential data")?;
    Ok(Registration {
        client_data_json,
        auth_data,
        credential,
        attestation_format: format,
        attestation_statement_empty: statement.is_empty(),
    })
}

/// RegistrationParameters(serverProperty, pubKeyCredParams, uv=false, up=true).
fn verify_registration(
    registration: &Registration,
    challenge: &[u8],
    rp: &RelyingParty,
) -> Result<(), &'static str> {
    verify_client_data(
        &registration.client_data_json,
        "webauthn.create",
        challenge,
        rp,
    )?;
    registration.auth_data.verify_common(rp)?;
    if !PUB_KEY_ALGORITHMS.contains(&registration.credential.key.algorithm()) {
        return Err("algorithm");
    }
    if registration.attestation_format != "none" || !registration.attestation_statement_empty {
        return Err("attestation statement");
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Credential rows (webknossos.webauthnCredentials, WebAuthnCredentialDAO).

/// `AttestationStatementEnvelope` as Jackson writes it for "none".
pub(crate) fn none_attestation_statement_json() -> JsonValue {
    json!({"attestationStatement": {}, "fmt": "none", "format": "none"})
}

/// Non-deleted credentials of an account (`findAllForUser`), parsed like the
/// Scala DAO; any malformed row fails the whole lookup.
pub(crate) async fn credentials_for_multi_user<'e>(
    executor: impl PgExecutor<'e>,
    multi_user: &str,
) -> ApiResult<Result<Vec<(String, AttestedCredential)>, &'static str>> {
    let rows: Vec<(String, Vec<u8>)> = sqlx::query_as(
        "SELECT _id, serializedAttestedCredential FROM webknossos.webauthnCredentials_ WHERE _multiUser = $1 ORDER BY _id",
    )
    .bind(multi_user)
    .fetch_all(executor)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, bytes)| Ok((id, AttestedCredential::from_webauthn4j_bytes(&bytes)?)))
        .collect())
}

async fn multi_user_of(state: &AppState, user: &AuthUser) -> ApiResult<(String, String, String)> {
    sqlx::query_as(
        "SELECT m._id, m.email, m.firstName || ' ' || m.lastName FROM webknossos.users_ u JOIN webknossos.multiUsers_ m ON m._id = u._multiUser WHERE u._id = $1",
    )
    .bind(&user.id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::not_found(MSG_NOT_FOUND))
}

// ---------------------------------------------------------------------------
// Handlers.

async fn register_start(
    State(state): State<AppState>,
    Extension(misc): Extension<MiscState>,
    Extension(stores): Extension<WebAuthnStores>,
    user: AuthUser,
) -> ApiResult<Response> {
    let rp = relying_party(&misc)?;
    let (multi_user, email, full_name) = multi_user_of(&state, &user).await?;
    let credentials = credentials_for_multi_user(&state.pool, &multi_user)
        .await
        .ok()
        .and_then(Result::ok)
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to fetch Passkeys",
            )
        })?;
    let exclude: Vec<JsonValue> = credentials
        .iter()
        .map(|(_, c)| json!({"id": URL_SAFE_NO_PAD.encode(&c.credential_id), "type": "public-key"}))
        .collect();
    let (session_id, challenge) = new_challenge()?;
    let encoded_challenge = URL_SAFE_NO_PAD.encode(&challenge);
    stores
        .registration
        .insert(session_id.clone(), challenge, CHALLENGE_TIMEOUT);
    let params: Vec<JsonValue> = PUB_KEY_ALGORITHMS
        .iter()
        .map(|alg| json!({"alg": alg, "type": "public-key"}))
        .collect();
    let options = json!({
        "authenticatorSelection": {
            "requireResidentKey": true,
            "residentKey": "required",
            "userVerification": "preferred",
        },
        "attestation": "none",
        "challenge": encoded_challenge,
        "excludeCredentials": exclude,
        "pubKeyCredParams": params,
        "timeout": CHALLENGE_TIMEOUT.as_millis() as u64,
        "rp": {"id": rp.rp_id, "name": rp.rp_id},
        "user": {
            "displayName": full_name,
            "id": URL_SAFE_NO_PAD.encode(multi_user.as_bytes()),
            "name": email,
        },
    });
    let mut response = Json(options).into_response();
    response.headers_mut().append(
        header::SET_COOKIE,
        challenge_cookie(REGISTRATION_COOKIE, &session_id),
    );
    Ok(response)
}

#[derive(Deserialize)]
struct RegistrationBody {
    name: String,
    key: JsonValue,
}

async fn register_finalize(
    State(state): State<AppState>,
    Extension(misc): Extension<MiscState>,
    Extension(stores): Extension<WebAuthnStores>,
    user: AuthUser,
    headers: HeaderMap,
    JsonBody(body): JsonBody<RegistrationBody>,
) -> ApiResult<Json<JsonValue>> {
    let rp = relying_party(&misc)?;
    let registration = parse_registration(&body.key)
        .map_err(|_| ApiError::bad_request(MSG_INVALID_REGISTRATION))?;
    let session_id = request_cookie(&headers, REGISTRATION_COOKIE)
        .ok_or_else(|| ApiError::not_found(MSG_NOT_FOUND))?;
    let challenge = stores
        .registration
        .pop(&session_id)
        .ok_or_else(|| ApiError::new(StatusCode::UNAUTHORIZED, MSG_REGISTRATION_TIMEOUT))?;
    verify_registration(&registration, &challenge, &rp)
        .map_err(|_| ApiError::bad_request(MSG_INVALID_REGISTRATION))?;
    let extensions = registration
        .auth_data
        .extensions_json()
        .map_err(|_| ApiError::bad_request(MSG_INVALID_REGISTRATION))?;
    let (multi_user, _, _) = multi_user_of(&state, &user).await?;
    let flags = registration.auth_data.flags;
    let inserted = sqlx::query(
        "INSERT INTO webknossos.webauthnCredentials (_id, _multiUser, credentialId, name, userVerified, backupEligible, backupState, serializedAttestationStatement, serializedAttestedCredential, serializedExtensions, signatureCount) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
    )
    .bind(ObjectId::new().as_str())
    .bind(&multi_user)
    .bind(&registration.credential.credential_id)
    .bind(&body.name)
    .bind(flags & FLAG_UV != 0)
    .bind(flags & FLAG_BE != 0)
    .bind(flags & FLAG_BS != 0)
    .bind(none_attestation_statement_json())
    .bind(registration.credential.to_webauthn4j_bytes())
    .bind(extensions)
    // Scala `getCounter.toInt` wraps.
    .bind(registration.auth_data.sign_count as i32)
    .execute(&state.pool)
    .await;
    if inserted.is_err() {
        return Err(ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to add Passkey",
        ));
    }
    Ok(Json(json!({"message": "Key registered successfully"})))
}

// ---------------------------------------------------------------------------
// Authentication ceremony (webauthnAuthStart / webauthnAuthFinalize).

/// A parsed assertion (webauthn4j `parseAuthenticationResponseJSON`).
struct Assertion {
    /// `rawId`.
    credential_id: Vec<u8>,
    user_handle: Option<Vec<u8>>,
    client_data_json: Vec<u8>,
    auth_data_bytes: Vec<u8>,
    auth_data: AuthenticatorData,
    signature: Vec<u8>,
}

fn parse_assertion(key: &JsonValue) -> Result<Assertion, &'static str> {
    let base64_field = |value: Option<&JsonValue>, name| {
        value
            .and_then(JsonValue::as_str)
            .and_then(decode_base64url)
            .ok_or(name)
    };
    let credential_id = base64_field(key.get("rawId"), "rawId")?;
    let response = key.get("response").ok_or("response")?;
    let client_data_json = base64_field(response.get("clientDataJSON"), "clientDataJSON")?;
    // CollectedClientDataConverter parses eagerly.
    serde_json::from_slice::<JsonValue>(&client_data_json).map_err(|_| "clientDataJSON")?;
    let auth_data_bytes = base64_field(response.get("authenticatorData"), "authenticatorData")?;
    let auth_data = AuthenticatorData::parse(&auth_data_bytes)?;
    let signature = base64_field(response.get("signature"), "signature")?;
    let user_handle = match response.get("userHandle") {
        None | Some(JsonValue::Null) => None,
        value => Some(base64_field(value, "userHandle")?),
    };
    Ok(Assertion {
        credential_id,
        user_handle,
        client_data_json,
        auth_data_bytes,
        auth_data,
        signature,
    })
}

/// A live credential row as `findByCredentialId` reads it.
struct StoredCredential {
    id: String,
    credential: AttestedCredential,
    backup_eligible: bool,
    /// `r.signaturecount.toLong` (may be negative after Scala's `toInt` wrap).
    sign_count: i64,
}

/// `AuthenticationDataVerifier.verify` with AuthenticationParameters(uv=false,
/// up=false, allowCredentials=null) for a stored credential record.
fn verify_assertion(
    assertion: &Assertion,
    stored: &StoredCredential,
    challenge: &[u8],
    rp: &RelyingParty,
) -> Result<(), &'static str> {
    let auth_data = &assertion.auth_data;
    if auth_data.attested.is_some() {
        return Err("attested credential data in assertion");
    }
    verify_client_data(&assertion.client_data_json, "webauthn.get", challenge, rp)?;
    if auth_data.rp_id_hash != rp.rp_id_hash() {
        return Err("rpIdHash");
    }
    // UP and UV are not required (Scala passes false for both).
    if auth_data.flags & FLAG_BS != 0 && auth_data.flags & FLAG_BE == 0 {
        return Err("backup state");
    }
    // BEFlagVerifier: BE must match the stored credential record.
    if (auth_data.flags & FLAG_BE != 0) != stored.backup_eligible {
        return Err("backup eligibility");
    }
    let mut message = assertion.auth_data_bytes.clone();
    message.extend(digest(&SHA256, &assertion.client_data_json).as_ref());
    if !stored.credential.key.verify(&message, &assertion.signature) {
        return Err("signature");
    }
    if !sign_count_acceptable(stored.sign_count, i64::from(auth_data.sign_count)) {
        return Err("signCount");
    }
    Ok(())
}

/// webauthn4j's malicious-counter check and the identical Scala re-check:
/// `(old == 0 && new == 0) || old < new`.
fn sign_count_acceptable(old: i64, new: i64) -> bool {
    (old <= 0 && new <= 0) || old < new
}

async fn auth_start(
    Extension(misc): Extension<MiscState>,
    Extension(stores): Extension<WebAuthnStores>,
) -> ApiResult<Response> {
    let rp = relying_party(&misc)?;
    let (session_id, challenge) = new_challenge()?;
    let encoded_challenge = URL_SAFE_NO_PAD.encode(&challenge);
    stores
        .assertion
        .insert(session_id.clone(), challenge, CHALLENGE_TIMEOUT);
    let options = json!({
        "challenge": encoded_challenge,
        "timeout": CHALLENGE_TIMEOUT.as_millis() as u64,
        "rpId": rp.rp_id,
        "userVerification": "preferred",
    });
    let mut response = Json(options).into_response();
    response.headers_mut().append(
        header::SET_COOKIE,
        challenge_cookie(ASSERTION_COOKIE, &session_id),
    );
    Ok(response)
}

#[derive(Deserialize)]
struct AuthenticationBody {
    /// Required like Play's `JsValue` field (an explicit null is allowed).
    #[serde(deserialize_with = "JsonValue::deserialize")]
    key: JsonValue,
}

async fn auth_finalize(
    State(state): State<AppState>,
    Extension(misc): Extension<MiscState>,
    Extension(stores): Extension<WebAuthnStores>,
    Extension(browser): Extension<BrowserAuthConfig>,
    Extension(mailer): Extension<MailSender>,
    headers: HeaderMap,
    JsonBody(body): JsonBody<AuthenticationBody>,
) -> ApiResult<Response> {
    let rp = relying_party(&misc)?;
    let session_id = request_cookie(&headers, ASSERTION_COOKIE)
        .ok_or_else(|| ApiError::not_found(MSG_NOT_FOUND))?;
    let challenge = stores
        .assertion
        .pop(&session_id)
        .ok_or_else(|| ApiError::new(StatusCode::UNAUTHORIZED, MSG_AUTHENTICATION_TIMEOUT))?;
    let unauthorized = || ApiError::new(StatusCode::UNAUTHORIZED, MSG_UNAUTHORIZED);
    let assertion = parse_assertion(&body.key).map_err(|_| unauthorized())?;
    // userHandle = the multiUser id as ASCII bytes (register/start user.id).
    let multi_user_id = assertion
        .user_handle
        .as_deref()
        .and_then(|handle| ObjectId::parse(&String::from_utf8_lossy(handle)).ok())
        .ok_or_else(unauthorized)?;
    let multi_user: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT _id, _lastLoggedInIdentity FROM webknossos.multiUsers_ WHERE _id = $1",
    )
    .bind(multi_user_id.as_str())
    .fetch_optional(&state.pool)
    .await?;
    let (multi_user_id, last_identity) = multi_user.ok_or_else(unauthorized)?;
    let row: Option<(String, Vec<u8>, bool, i32)> = sqlx::query_as(
        "SELECT _id, serializedAttestedCredential, backupEligible, signatureCount FROM webknossos.webauthnCredentials_ WHERE _multiUser = $1 AND credentialId = $2",
    )
    .bind(&multi_user_id)
    .bind(&assertion.credential_id)
    .fetch_optional(&state.pool)
    .await?;
    let (id, attested, backup_eligible, sign_count) = row.ok_or_else(unauthorized)?;
    let stored = StoredCredential {
        id,
        credential: AttestedCredential::from_webauthn4j_bytes(&attested)
            .map_err(|_| unauthorized())?,
        backup_eligible,
        sign_count: i64::from(sign_count),
    };
    verify_assertion(&assertion, &stored, &challenge, &rp).map_err(|_| unauthorized())?;
    // updateSignCount binds the Long counter: values beyond INTEGER fail in
    // PostgreSQL, which Scala maps to 401 as well.
    sqlx::query("UPDATE webknossos.webauthnCredentials_ SET signatureCount = $2 WHERE _id = $1")
        .bind(&stored.id)
        .bind(i64::from(assertion.auth_data.sign_count))
        .execute(&state.pool)
        .await
        .map_err(|_| unauthorized())?;
    let user_id = last_identity.ok_or_else(|| ApiError::not_found(MSG_NOT_FOUND))?;
    let cookie = login_user(&state.pool, &browser, &mailer, &headers, &user_id, false).await?;
    tracing::info!(user = %user_id, "User logged in via passkey/webauthn.");
    let mut response = StatusCode::OK.into_response();
    response.headers_mut().append(header::SET_COOKIE, cookie);
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rp() -> RelyingParty {
        RelyingParty {
            origin: url::Url::parse("https://example.com").unwrap(),
            rp_id: "example.com".into(),
        }
    }

    #[test]
    fn origins_compare_like_webauthn4j() {
        let rp = rp();
        for ok in [
            "https://example.com",
            "https://example.com/",
            "https://example.com:443",
            "HTTPS://EXAMPLE.COM",
            "https://example.com/foo",
        ] {
            assert!(rp.origin_matches(ok), "{ok}");
        }
        for bad in [
            "http://example.com",
            "https://example.com:8443",
            "https://evil.com",
            "https://sub.example.com",
            "null",
            "",
        ] {
            assert!(!rp.origin_matches(bad), "{bad}");
        }
    }

    #[test]
    fn sign_count_rule_matches_webauthn4j_and_scala() {
        // (old, new, accepted): webauthn4j rejects unless both are 0 or new > old.
        for (old, new, ok) in [
            (0, 0, true),
            (0, 1, true),
            (3, 4, true),
            (3, 3, false),
            (3, 2, false),
            (3, 0, false),
            // Stored after Scala's `toInt` wrap.
            (-5, 0, true),
            (-5, 1, true),
        ] {
            assert_eq!(sign_count_acceptable(old, new), ok, "{old} -> {new}");
        }
    }

    #[test]
    fn token_binding_follows_webauthn4j() {
        let rp = rp();
        let challenge = [7u8; 32];
        let encoded = URL_SAFE_NO_PAD.encode(challenge);
        let check = |binding: JsonValue| {
            let data = json!({"type": "webauthn.get", "challenge": encoded, "origin": "https://example.com", "tokenBinding": binding});
            verify_client_data(data.to_string().as_bytes(), "webauthn.get", &challenge, &rp)
        };
        assert!(check(JsonValue::Null).is_ok());
        assert!(check(json!({"status": "supported"})).is_ok());
        assert!(check(json!({"status": "not-supported"})).is_ok());
        assert!(check(json!({"status": "present"})).is_ok());
        assert!(check(json!({"status": "present", "id": "AAAA"})).is_err());
        assert!(check(json!({"status": "bogus"})).is_err());
        assert!(check(json!({})).is_err());
    }

    #[test]
    fn challenge_store_pops_once_and_expires() {
        let store = ChallengeStore::default();
        store.insert("a".into(), vec![1], Duration::from_secs(60));
        store.insert("b".into(), vec![2], Duration::ZERO);
        assert_eq!(store.pop("a"), Some(vec![1]));
        assert_eq!(store.pop("a"), None);
        assert_eq!(store.pop("b"), None);
    }

    /// Oracle: webauthn4j 0.31.9 serialized this attested credential for an
    /// authenticator that sent the COSE key in reverse label order.
    #[test]
    fn attested_credential_matches_webauthn4j_serialization() {
        let stored = "0000000000000000000000000000000000100102030405060708090a0b0c0d0e0f10a50102032620012158206b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2962258204fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5";
        let bytes: Vec<u8> = (0..stored.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&stored[i..i + 2], 16).unwrap())
            .collect();
        let credential = AttestedCredential::from_webauthn4j_bytes(&bytes).unwrap();
        assert_eq!(credential.credential_id, (1..=16).collect::<Vec<u8>>());
        assert_eq!(credential.to_webauthn4j_bytes(), bytes);
        let mut trailing = bytes.clone();
        trailing.push(0);
        assert!(AttestedCredential::from_webauthn4j_bytes(&trailing).is_err());
        assert!(AttestedCredential::from_webauthn4j_bytes(&bytes[..40]).is_err());
    }

    /// Registration responses captured from the webauthn4j 0.31.9 oracle
    /// (challenge = 32 x 0x07, origin https://example.com): reversed COSE key
    /// order, BE+BS flags and a credProtect extension. Expected values are what
    /// Scala stored for them.
    #[test]
    fn replays_webauthn4j_registrations() {
        let rp = rp();
        let cdj = "eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIiwiY2hhbGxlbmdlIjoiQndjSEJ3Y0hCd2NIQndjSEJ3Y0hCd2NIQndjSEJ3Y0hCd2NIQndjSEJ3YyIsIm9yaWdpbiI6Imh0dHBzOi8vZXhhbXBsZS5jb20iLCJjcm9zc09yaWdpbiI6ZmFsc2V9";
        let attested = "0000000000000000000000000000000000100102030405060708090a0b0c0d0e0f10a50102032620012158206b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2962258204fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5";
        let cases = [
            (
                "o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YViUo3mm9u6vuaVeN4wRgDTidR5oL6ufLTCrE9ISVYbOGUdFAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAECAwQFBgcICQoLDA0ODxClIlggT-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfUhWCBrF9Hy4SxCR_i85uVjpEDydwN9gS3rM6D0oTlF2JjCliABAyYBAg",
                (true, false, false),
                json!({}),
            ),
            (
                "o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YViUo3mm9u6vuaVeN4wRgDTidR5oL6ufLTCrE9ISVYbOGUddAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAECAwQFBgcICQoLDA0ODxClAQIDJiABIVggaxfR8uEsQkf4vOblY6RA8ncDfYEt6zOg9KE5RdiYwpYiWCBP40Li_hp_m47n60p8D54WK84zV2sxXs7LtkBoN79R9Q",
                (true, true, true),
                json!({}),
            ),
            (
                "o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YViio3mm9u6vuaVeN4wRgDTidR5oL6ufLTCrE9ISVYbOGUfFAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAECAwQFBgcICQoLDA0ODxClAQIDJiABIVggaxfR8uEsQkf4vOblY6RA8ncDfYEt6zOg9KE5RdiYwpYiWCBP40Li_hp_m47n60p8D54WK84zV2sxXs7LtkBoN79R9aFrY3JlZFByb3RlY3QC",
                (true, false, false),
                json!({"credProtect": 2}),
            ),
        ];
        for (attestation, (uv, be, bs), extensions) in cases {
            let key =
                json!({"response": {"clientDataJSON": cdj, "attestationObject": attestation}});
            let registration = parse_registration(&key).unwrap();
            verify_registration(&registration, &[7; 32], &rp).unwrap();
            let bytes = registration.credential.to_webauthn4j_bytes();
            let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
            assert_eq!(hex, attested);
            let flags = registration.auth_data.flags;
            assert_eq!(
                (
                    flags & FLAG_UV != 0,
                    flags & FLAG_BE != 0,
                    flags & FLAG_BS != 0
                ),
                (uv, be, bs)
            );
            assert_eq!(
                registration.auth_data.extensions_json().unwrap(),
                extensions
            );
            assert!(verify_registration(&registration, &[8; 32], &rp).is_err());
        }
    }

    #[test]
    fn authenticator_data_layout_rules() {
        let mut base = vec![0u8; 32];
        base.push(FLAG_UP | FLAG_ED);
        base.extend([0, 0, 0, 5]);
        // ED without bytes: accepted, no extensions (webauthn4j).
        let parsed = AuthenticatorData::parse(&base).unwrap();
        assert_eq!(parsed.sign_count, 5);
        assert!(parsed.extensions.is_none());
        let mut with_ext = base.clone();
        with_ext.extend([0xa1, 0x6b]);
        with_ext.extend(b"credProtect");
        with_ext.push(0x02);
        let parsed = AuthenticatorData::parse(&with_ext).unwrap();
        assert_eq!(parsed.extensions_json().unwrap(), json!({"credProtect": 2}));
        let last = with_ext.len() - 1;
        with_ext[last] = 0x09;
        assert!(
            AuthenticatorData::parse(&with_ext)
                .unwrap()
                .extensions_json()
                .is_err()
        );
        // Extensions without ED, or AT without data: rejected.
        let mut no_ed = with_ext.clone();
        no_ed[32] = FLAG_UP;
        assert!(AuthenticatorData::parse(&no_ed).is_err());
        let mut at = base.clone();
        at[32] = FLAG_UP | FLAG_AT;
        assert!(AuthenticatorData::parse(&at).is_err());
        assert!(AuthenticatorData::parse(&base[..36]).is_err());
    }
}
