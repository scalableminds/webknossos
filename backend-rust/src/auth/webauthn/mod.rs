//! WebAuthn (passkey) ceremonies. Scala: AuthenticationController
//! webauthnRegisterStart/webauthnRegisterFinalize and
//! webauthnAuthStart/webauthnAuthFinalize with webauthn4j 0.31.9
//! `createNonStrictWebAuthnManager` and `WebAuthnCredentialDAO`.
//!
//! Challenges, client data, authenticator data, COSE keys, signatures and
//! the signature counter are verified by `webauthn-rs-core`. This module adds
//! the webauthn4j rules the crate does not apply (tokenBinding, crossOrigin
//! on authentication, attestation format `none` only, strict authenticator
//! data layout) and the Scala-compatible credential row codec; see
//! checkpoints/auth-webauthn.md.
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use webknossos_common::bytes::{array, u32_be};

use axum::{
    Json, Router,
    extract::State,
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::post,
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{Value as JsonValue, json};
use sqlx::PgExecutor;

pub(crate) mod dao;
use webauthn_rs_core::{
    WebauthnCore,
    error::WebauthnError,
    proto::{
        AttestationConveyancePreference, AttestationFormat, AttestationMetadata,
        AuthenticationState, COSEAlgorithm, COSEKey, CreationChallengeResponse, Credential,
        ParsedAttestation, ParsedAttestationData, PublicKeyCredential, RegisterPublicKeyCredential,
        RegisteredExtensions, RegistrationState, UserVerificationPolicy,
    },
};

use crate::{
    AppState,
    auth::AuthUser,
    auth::browser::{BrowserAuthConfig, login_user, request_cookie},
    error::{ApiError, ApiResult},
    extract::Json as JsonBody,
    mail::MailSender,
    system::application_info::MiscState,
    util::cbor::{CoseKey, Value},
    util::id::ObjectId,
};

/// Scala `webauthnTimeout = 2 minutes` (cookie Max-Age, options timeout and
/// challenge store expiry).
pub(crate) const CHALLENGE_TIMEOUT: Duration = Duration::from_secs(120);
pub(crate) const REGISTRATION_COOKIE: &str = "webauthn-registration";
pub(crate) const ASSERTION_COOKIE: &str = "webauthn-session";
/// Offered in this order: EdDSA, ES256, RS256.
pub(crate) const PUB_KEY_ALGORITHMS: [COSEAlgorithm; 3] = [
    COSEAlgorithm::EDDSA,
    COSEAlgorithm::ES256,
    COSEAlgorithm::RS256,
];

pub(crate) const MSG_UNAUTHORIZED: &str = "Passkey authentication failed.";
const MSG_REGISTRATION_TIMEOUT: &str = "Timeout during registration. Please try again.";
const MSG_AUTHENTICATION_TIMEOUT: &str = "Timeout during authentication. Please try again.";
const MSG_INVALID_REGISTRATION: &str = "Passkey registration could not be verified.";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/webauthn/register/start", post(register_start))
        .route("/auth/webauthn/register/finalize", post(register_finalize))
        .route("/auth/webauthn/auth/start", post(auth_start))
        .route("/auth/webauthn/auth/finalize", post(auth_finalize))
}

// ---------------------------------------------------------------------------
// Challenge storage (Scala TemporaryStore[String, WebAuthnChallenge]).

/// In-process session-id -> ceremony state store with expiry; `pop` removes.
pub(crate) struct ChallengeStore<T>(Arc<Mutex<ChallengeMap<T>>>);

/// session id -> (ceremony state, expiry).
type ChallengeMap<T> = HashMap<String, (T, Instant)>;

const MAX_PENDING_CHALLENGES: usize = 10_000;

impl<T> Clone for ChallengeStore<T> {
    fn clone(&self) -> Self {
        Self(Arc::clone(&self.0))
    }
}

impl<T> Default for ChallengeStore<T> {
    fn default() -> Self {
        Self(Arc::default())
    }
}

impl<T> ChallengeStore<T> {
    pub(crate) fn insert(&self, session_id: String, challenge: T, ttl: Duration) {
        let now = Instant::now();
        let mut map = self.0.lock().unwrap_or_else(|e| e.into_inner());
        // Unauthenticated callers can start ceremonies, so the store is bounded: expired entries
        // are only swept once it grows, and at capacity the entry closest to expiry is evicted.
        if map.len() >= MAX_PENDING_CHALLENGES / 8 {
            map.retain(|_, (_, expiry)| *expiry > now);
        }
        if map.len() >= MAX_PENDING_CHALLENGES
            && let Some(oldest) = map
                .iter()
                .min_by_key(|(_, (_, expiry))| *expiry)
                .map(|(key, _)| key.clone())
        {
            map.remove(&oldest);
        }
        map.insert(session_id, (challenge, now + ttl));
    }

    pub(crate) fn pop(&self, session_id: &str) -> Option<T> {
        let mut map = self.0.lock().unwrap_or_else(|e| e.into_inner());
        map.remove(session_id)
            .filter(|(_, expiry)| *expiry > Instant::now())
            .map(|(challenge, _)| challenge)
    }
}

/// One challenge store per ceremony, as Scala injects two; shared by all routes of an app.
#[derive(Clone, Default)]
pub struct WebAuthnStores {
    pub(crate) registration: ChallengeStore<RegistrationState>,
    pub(crate) assertion: ChallengeStore<AuthenticationState>,
}

/// A fresh UUID ceremony session id (the challenge cookie value).
fn new_session_id() -> String {
    uuid::Uuid::new_v4().to_string()
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
        return Err(ApiError::bad_request(crate::msg::passkeys::NOT_ENABLED));
    }
    if !config.public_uri.starts_with("https://") {
        return Err(ApiError::bad_request(crate::msg::passkeys::REQUIRES_HTTPS));
    }
    let origin = url::Url::parse(&config.public_uri).map_err(|_| ApiError::internal())?;
    let rp_id = origin.host_str().ok_or_else(ApiError::internal)?.to_owned();
    Ok(RelyingParty { origin, rp_id })
}

impl RelyingParty {
    /// The ceremony verifier. Origins match like webauthn4j `Origin.equals`:
    /// scheme, host and effective port (path ignored), no subdomains.
    pub(crate) fn verifier(&self) -> WebauthnCore {
        WebauthnCore::new_unsafe_experts_only(
            &self.rp_id,
            &self.rp_id,
            vec![self.origin.clone()],
            CHALLENGE_TIMEOUT,
            Some(false),
            Some(false),
        )
    }
}

// ---------------------------------------------------------------------------
// Parsing and verification shared by both ceremonies.

/// CollectedClientData checks webauthn4j applies and webauthn-rs-core does
/// not: a `crossOrigin: true` ceremony is rejected (the crate only checks it
/// on registration) and so is a token binding (the crate ignores it). Type,
/// challenge and origin are verified by the crate.
pub(crate) fn verify_client_data_bindings(raw: &[u8]) -> Result<(), &'static str> {
    let data: JsonValue = serde_json::from_slice(raw).map_err(|_| "clientDataJSON")?;
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
        let aaguid: [u8; 16] = array(bytes);
        let id_len = usize::from(u16::from_be_bytes([bytes[16], bytes[17]]));
        let id_end = 18 + id_len;
        if id_len == 0 || bytes.len() < id_end {
            return Err("credential id");
        }
        let (key, key_len) =
            crate::util::cbor::decode_prefix(&bytes[id_end..]).map_err(|_| "COSE key")?;
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
        let flags = bytes[32];
        let sign_count = u32_be(&bytes[33..]);
        let mut rest = &bytes[37..];
        let attested = if flags & FLAG_AT != 0 {
            let (credential, used) = AttestedCredential::parse_prefix(rest)?;
            rest = &rest[used..];
            Some(credential)
        } else {
            None
        };
        let extensions = if flags & FLAG_ED != 0 && !rest.is_empty() {
            let value = crate::util::cbor::decode(rest).map_err(|_| "extensions")?;
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
            flags,
            sign_count,
            attested,
            extensions,
        })
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

/// A `PublicKeyCredential` registration response (webauthn4j
/// `parseRegistrationResponseJSON`) with the attestation object decoded for
/// storage. Only the "none" attestation format is accepted (see checkpoint
/// deviations).
struct Registration {
    response: RegisterPublicKeyCredential,
    auth_data: AuthenticatorData,
    credential: AttestedCredential,
    attestation_format: String,
    attestation_statement_empty: bool,
}

fn parse_registration(key: &JsonValue) -> Result<Registration, &'static str> {
    let response: RegisterPublicKeyCredential =
        serde_json::from_value(key.clone()).map_err(|_| "response")?;
    let attestation = crate::util::cbor::decode(response.response.attestation_object.as_ref())
        .map_err(|_| "attestationObject")?;
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
        response,
        auth_data,
        credential,
        attestation_format: format,
        attestation_statement_empty: statement.is_empty(),
    })
}

/// RegistrationParameters(serverProperty, pubKeyCredParams, uv=false, up=true):
/// the crate checks type, challenge, origin, crossOrigin, rpIdHash, UP, BS
/// without BE, the COSE key and its algorithm.
fn verify_registration(
    registration: &Registration,
    state: &RegistrationState,
    rp: &RelyingParty,
) -> Result<(), &'static str> {
    verify_client_data_bindings(registration.response.response.client_data_json.as_ref())?;
    if registration.attestation_format != "none" || !registration.attestation_statement_empty {
        return Err("attestation statement");
    }
    let verified = rp
        .verifier()
        .register_credential(&registration.response, state, None)
        .map_err(|_| "registration")?;
    if verified.attestation_format != AttestationFormat::None
        || verified.cred_id.as_ref() != registration.credential.credential_id.as_slice()
    {
        return Err("attested credential");
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
    multi_user: &ObjectId,
) -> ApiResult<Result<Vec<(String, AttestedCredential)>, &'static str>> {
    let rows = dao::find_all_for_multi_user(executor, multi_user).await?;
    Ok(rows
        .into_iter()
        .map(|(id, bytes)| Ok((id, AttestedCredential::from_webauthn4j_bytes(&bytes)?)))
        .collect())
}

async fn multi_user_of(state: &AppState, user: &AuthUser) -> ApiResult<(ObjectId, String, String)> {
    dao::find_multi_user_of_user(&state.pool, &user.id)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))
}

// ---------------------------------------------------------------------------
// Handlers.

async fn register_start(
    State(state): State<AppState>,
    State(misc): State<MiscState>,
    State(stores): State<WebAuthnStores>,
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
                crate::msg::passkeys::LIST_FAILED,
            )
        })?;
    let exclude: Vec<JsonValue> = credentials
        .iter()
        .map(|(_, c)| json!({"id": URL_SAFE_NO_PAD.encode(&c.credential_id), "type": "public-key"}))
        .collect();
    // The crate's options are not used: Scala's are returned instead. Excluded
    // credentials are only listed there; re-registering one fails at the
    // (_multiUser, credentialId) unique index like in Scala.
    let (options, ceremony) = registration_ceremony(
        &rp.verifier(),
        multi_user.as_str().as_bytes(),
        &email,
        &full_name,
    )
    .map_err(|_| ApiError::internal())?;
    let encoded_challenge = URL_SAFE_NO_PAD.encode(options.public_key.challenge.as_ref());
    let session_id = new_session_id();
    stores
        .registration
        .insert(session_id.clone(), ceremony, CHALLENGE_TIMEOUT);
    let params: Vec<JsonValue> = PUB_KEY_ALGORITHMS
        .iter()
        .map(|alg| json!({"alg": *alg as i64, "type": "public-key"}))
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
            "id": URL_SAFE_NO_PAD.encode(multi_user.as_str().as_bytes()),
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

/// Scala's creation options: attestation none, UV preferred, resident key
/// required, synced (backup eligible) authenticators allowed.
fn registration_ceremony(
    verifier: &WebauthnCore,
    user_id: &[u8],
    name: &str,
    display_name: &str,
) -> Result<(CreationChallengeResponse, RegistrationState), WebauthnError> {
    let builder = verifier
        .new_challenge_register_builder(user_id, name, display_name)?
        .attestation(AttestationConveyancePreference::None)
        .user_verification_policy(UserVerificationPolicy::Preferred)
        .credential_algorithms(PUB_KEY_ALGORITHMS.to_vec())
        .require_resident_key(true)
        .reject_synchronised_authenticators(false);
    verifier.generate_challenge_register(builder)
}

#[derive(Deserialize)]
struct RegistrationBody {
    name: String,
    key: JsonValue,
}

async fn register_finalize(
    State(state): State<AppState>,
    State(misc): State<MiscState>,
    State(stores): State<WebAuthnStores>,
    user: AuthUser,
    headers: HeaderMap,
    JsonBody(body): JsonBody<RegistrationBody>,
) -> ApiResult<Json<JsonValue>> {
    let rp = relying_party(&misc)?;
    let registration = parse_registration(&body.key)
        .map_err(|_| ApiError::bad_request(MSG_INVALID_REGISTRATION))?;
    let session_id = request_cookie(&headers, REGISTRATION_COOKIE)
        .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    let ceremony = stores
        .registration
        .pop(&session_id)
        .ok_or_else(|| ApiError::new(StatusCode::UNAUTHORIZED, MSG_REGISTRATION_TIMEOUT))?;
    verify_registration(&registration, &ceremony, &rp)
        .map_err(|_| ApiError::bad_request(MSG_INVALID_REGISTRATION))?;
    let extensions = registration
        .auth_data
        .extensions_json()
        .map_err(|_| ApiError::bad_request(MSG_INVALID_REGISTRATION))?;
    let (multi_user, _, _) = multi_user_of(&state, &user).await?;
    let flags = registration.auth_data.flags;
    let inserted = dao::insert_credential(
        &state.pool,
        &multi_user,
        &registration.credential.credential_id,
        &body.name,
        flags & FLAG_UV != 0,
        flags & FLAG_BE != 0,
        flags & FLAG_BS != 0,
        none_attestation_statement_json(),
        registration.credential.to_webauthn4j_bytes(),
        extensions,
        // Scala `getCounter.toInt` wraps.
        registration.auth_data.sign_count as i32,
    )
    .await;
    if inserted.is_err() {
        return Err(ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            crate::msg::passkeys::ADD_FAILED,
        ));
    }
    Ok(Json(json!({"message": "Key registered successfully"})))
}

// ---------------------------------------------------------------------------
// Authentication ceremony (webauthnAuthStart / webauthnAuthFinalize).

/// A parsed assertion (webauthn4j `parseAuthenticationResponseJSON`) with
/// the authenticator data decoded under webauthn4j's layout rules.
struct Assertion {
    response: PublicKeyCredential,
    auth_data: AuthenticatorData,
}

fn parse_assertion(key: &JsonValue) -> Result<Assertion, &'static str> {
    let response: PublicKeyCredential =
        serde_json::from_value(key.clone()).map_err(|_| "response")?;
    // CollectedClientDataConverter parses eagerly.
    serde_json::from_slice::<JsonValue>(response.response.client_data_json.as_ref())
        .map_err(|_| "clientDataJSON")?;
    let auth_data = AuthenticatorData::parse(response.response.authenticator_data.as_ref())?;
    Ok(Assertion {
        response,
        auth_data,
    })
}

impl Assertion {
    /// `rawId`.
    fn credential_id(&self) -> &[u8] {
        self.response.raw_id.as_ref()
    }

    fn user_handle(&self) -> Option<&[u8]> {
        self.response
            .response
            .user_handle
            .as_ref()
            .map(|handle| handle.as_ref())
    }
}

/// A live credential row as `findByCredentialId` reads it.
struct StoredCredential {
    id: String,
    credential: AttestedCredential,
    backup_eligible: bool,
    /// `r.signaturecount.toLong` (may be negative after Scala's `toInt` wrap).
    sign_count: i64,
}

impl StoredCredential {
    /// The record the crate verifies against. UV is never enforced (Scala
    /// passes uv=false): `user_verified: false` with a `Preferred` policy
    /// skips the crate's "registered with UV" downgrade check.
    fn to_verifier_credential(&self) -> Result<Credential, &'static str> {
        let key: serde_cbor_2::Value =
            serde_cbor_2::from_slice(&self.credential.key.to_webauthn4j_cbor())
                .map_err(|_| "COSE key")?;
        Ok(Credential {
            cred_id: self.credential.credential_id.clone().into(),
            cred: COSEKey::try_from(&key).map_err(|_| "COSE key")?,
            counter: verifier_counter(self.sign_count),
            transports: None,
            user_verified: false,
            backup_eligible: self.backup_eligible,
            backup_state: false,
            registration_policy: UserVerificationPolicy::Preferred,
            extensions: RegisteredExtensions::none(),
            attestation: ParsedAttestation {
                data: ParsedAttestationData::None,
                metadata: AttestationMetadata::None,
            },
            attestation_format: AttestationFormat::None,
        })
    }
}

/// The crate rejects unless both counters are 0 or new > old, as webauthn4j
/// does. A negative stored counter (Scala's `toInt` wrap) accepts any new
/// value in webauthn4j, which a stored 0 does in the crate.
fn verifier_counter(stored: i64) -> u32 {
    u32::try_from(stored).unwrap_or(0)
}

/// `AuthenticationDataVerifier.verify` with AuthenticationParameters(uv=false,
/// up=false, allowCredentials=null) for a stored credential record. The crate
/// checks type, challenge, origin, rpIdHash, UP (stricter than webauthn4j),
/// BE against the record, BS without BE, the signature and the counter.
fn verify_assertion(
    assertion: &Assertion,
    stored: &StoredCredential,
    mut state: AuthenticationState,
    rp: &RelyingParty,
) -> Result<(), &'static str> {
    if assertion.auth_data.attested.is_some() {
        return Err("attested credential data in assertion");
    }
    verify_client_data_bindings(assertion.response.response.client_data_json.as_ref())?;
    state.set_allowed_credentials(vec![stored.to_verifier_credential()?]);
    rp.verifier()
        .authenticate_credential(&assertion.response, &state)
        .map_err(|_| "assertion")?;
    Ok(())
}

async fn auth_start(
    State(misc): State<MiscState>,
    State(stores): State<WebAuthnStores>,
) -> ApiResult<Response> {
    let rp = relying_party(&misc)?;
    // Discoverable credentials: the account is only known from the
    // assertion's userHandle, so the allowed credential is set at finalize.
    let verifier = rp.verifier();
    let builder = verifier
        .new_challenge_authenticate_builder(Vec::new(), Some(UserVerificationPolicy::Preferred))
        .map_err(|_| ApiError::internal())?;
    let (options, ceremony) = verifier
        .generate_challenge_authenticate(builder)
        .map_err(|_| ApiError::internal())?;
    let encoded_challenge = URL_SAFE_NO_PAD.encode(options.public_key.challenge.as_ref());
    let session_id = new_session_id();
    stores
        .assertion
        .insert(session_id.clone(), ceremony, CHALLENGE_TIMEOUT);
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
    State(misc): State<MiscState>,
    State(stores): State<WebAuthnStores>,
    State(browser): State<BrowserAuthConfig>,
    State(mailer): State<MailSender>,
    headers: HeaderMap,
    JsonBody(body): JsonBody<AuthenticationBody>,
) -> ApiResult<Response> {
    let rp = relying_party(&misc)?;
    let session_id = request_cookie(&headers, ASSERTION_COOKIE)
        .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    let ceremony = stores
        .assertion
        .pop(&session_id)
        .ok_or_else(|| ApiError::new(StatusCode::UNAUTHORIZED, MSG_AUTHENTICATION_TIMEOUT))?;
    let unauthorized = || ApiError::new(StatusCode::UNAUTHORIZED, MSG_UNAUTHORIZED);
    let assertion = parse_assertion(&body.key).map_err(|_| unauthorized())?;
    // userHandle = the multiUser id as ASCII bytes (register/start user.id).
    let multi_user_id = assertion
        .user_handle()
        .and_then(|handle| ObjectId::parse(&String::from_utf8_lossy(handle)).ok())
        .ok_or_else(unauthorized)?;
    let multi_user = dao::find_one_multi_user(&state.pool, &multi_user_id).await?;
    let (multi_user_id, last_identity) = multi_user.ok_or_else(unauthorized)?;
    let row =
        dao::find_one_by_credential_id(&state.pool, &multi_user_id, assertion.credential_id())
            .await?;
    let (id, attested, backup_eligible, sign_count) = row.ok_or_else(unauthorized)?;
    let stored = StoredCredential {
        id,
        credential: AttestedCredential::from_webauthn4j_bytes(&attested)
            .map_err(|_| unauthorized())?,
        backup_eligible,
        sign_count: i64::from(sign_count),
    };
    verify_assertion(&assertion, &stored, ceremony, &rp).map_err(|_| unauthorized())?;
    // updateSignCount binds the Long counter: values beyond INTEGER fail in
    // PostgreSQL, which Scala maps to 401 as well.
    dao::update_signature_count(
        &state.pool,
        &stored.id,
        i64::from(assertion.auth_data.sign_count),
    )
    .await
    .map_err(|_| unauthorized())?;
    let user_id = last_identity.ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    let cookie = login_user(&state.pool, &browser, &mailer, &headers, &user_id, false).await?;
    tracing::info!(user = %user_id, "User logged in via passkey/webauthn.");
    let mut response = StatusCode::OK.into_response();
    response.headers_mut().append(header::SET_COOKIE, cookie);
    Ok(response)
}

#[cfg(test)]
mod tests;
