//! Single sign-on routes of AuthenticationController: the Discourse SSO
//! endpoint (`GET /auth/sso`) and the OpenID Connect authorization-code flow
//! (`GET /auth/oidc/login`, `GET /auth/oidc/callback`, OpenIdConnectClient).
//!
//! Token validation follows jwt-scala 11.0.4 `JwtJson.decodeJson(token,
//! publicKey)` as used by Play: the first `kty=RSA`, `use=sig` key of the
//! provider JWKS verifies RS256/RS384/RS512 signatures of the access token
//! and the optional id token, `exp`/`nbf` are enforced without leeway.
//! Deliberately stricter than Play: the id token's `aud` must contain the
//! client id, `exp`/`nbf` must be integers when present, RSA keys must be
//! 2048–8192 bits (ring). Play has no `state`/`nonce` and no issuer check;
//! neither does this port.
use std::{collections::HashMap, fmt, sync::Arc, time::Duration};

use axum::{
    Extension, Json, Router,
    extract::{RawQuery, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use base64::{
    Engine, alphabet,
    engine::{DecodePaddingMode, GeneralPurpose, GeneralPurposeConfig, general_purpose::STANDARD},
};
use ring::{hmac, signature};
use serde::Deserialize;
use serde_json::{Map, Value, json};
use subtle::ConstantTimeEq;

use crate::{
    AppState,
    application_info::MiscState,
    auth::OptionalAuthUser,
    browser_auth::{BrowserAuthConfig, login_user},
    browser_auth_onboarding::{
        NewAccount, ORGANIZATION_COLUMNS, OrganizationRow, admin_notifier_mail,
        initial_team_memberships, insert_account, organization_messages,
    },
    error::{ApiError, ApiResult},
    mail::{MailSender, templates},
};

pub(crate) mod messages {
    pub const AUTHENTICATION_FAILED: &str =
        "Could not register or log in via single sign-on (SSO/OIDC).";
    pub const CONFIGURATION_INVALID: &str = "SSO/OIDC configuration is invalid.";
    pub const NOT_ENABLED: &str = "SSO is not enabled";
    pub const DISCOVERY_FAILED: &str = "Could not fetch the SSO/OIDC provider configuration.";
    pub const USER_INFO_FAILED: &str = "Failed to extract user info from id token or access token";
    pub const INVALID_SIGNATURE: &str = "Invalid signature";
    pub const NONCE_MISSING: &str = "Nonce is missing";
    pub const RETURN_URL_MISSING: &str = "Return url is missing";
    pub const DISCOURSE_LOGIN_REDIRECT: &str =
        "/auth/login?redirectPage=http://discuss.webknossos.org";
}

/// `singleSignOn.openIdConnect.*`, `features.openIdConnectEnabled` and
/// `webKnossos.user.ssoKey`. Defaults mirror conf/application.conf.
#[derive(Clone)]
pub struct OidcConfig {
    pub enabled: bool,
    pub provider_url: String,
    pub client_id: String,
    /// `None` when configured empty (no HTTP basic auth at the token endpoint).
    pub client_secret: Option<String>,
    pub scope: String,
    pub verbose_logging: bool,
    /// Discourse SSO HMAC key; empty means unconfigured.
    pub sso_key: String,
    pub http_timeout: Duration,
}

impl Default for OidcConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            provider_url: "http://localhost:8080/auth/realms/master/".into(),
            client_id: "myclient".into(),
            client_secret: Some("myClientSecret".into()),
            scope: "openid profile email".into(),
            verbose_logging: false,
            sso_key: String::new(),
            http_timeout: Duration::from_secs(30),
        }
    }
}

impl fmt::Debug for OidcConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("OidcConfig")
            .field("enabled", &self.enabled)
            .field("provider_url", &self.provider_url)
            .field("client_id", &self.client_id)
            // Label avoids the word so leak checks on Debug output stay strict.
            .field(
                "client_credential_configured",
                &self.client_secret.is_some(),
            )
            .field("scope", &self.scope)
            .field("verbose_logging", &self.verbose_logging)
            .field(
                "sso_key",
                &(!self.sso_key.is_empty()).then_some("[redacted]"),
            )
            .field("http_timeout", &self.http_timeout)
            .finish()
    }
}

/// Parses the OIDC settings from environment values (called by config.rs).
///
/// WK_OIDC_ENABLED=false, WK_OIDC_PROVIDER_URL, WK_OIDC_CLIENT_ID,
/// WK_OIDC_CLIENT_SECRET (empty disables basic auth), WK_OIDC_SCOPE,
/// WK_OIDC_VERBOSE_LOGGING=false, WK_OIDC_HTTP_TIMEOUT_SECONDS=30, WK_SSO_KEY="".
pub fn config_from_values(values: &HashMap<String, String>) -> Result<OidcConfig, String> {
    let defaults = OidcConfig::default();
    let text = |name: &str| values.get(name).map(|value| value.trim().to_owned());
    let boolean = |name: &str| -> Result<bool, String> {
        match text(name) {
            None => Ok(false),
            Some(value) => value
                .parse()
                .map_err(|_| format!("{name} must be true or false")),
        }
    };
    let http_timeout = match text("WK_OIDC_HTTP_TIMEOUT_SECONDS") {
        None => defaults.http_timeout,
        Some(value) => match value.parse::<u64>() {
            Ok(seconds) if (1..=3600).contains(&seconds) => Duration::from_secs(seconds),
            _ => {
                return Err("WK_OIDC_HTTP_TIMEOUT_SECONDS must be between 1 and 3600".to_owned());
            }
        },
    };
    Ok(OidcConfig {
        enabled: boolean("WK_OIDC_ENABLED")?,
        provider_url: text("WK_OIDC_PROVIDER_URL").unwrap_or(defaults.provider_url),
        client_id: text("WK_OIDC_CLIENT_ID").unwrap_or(defaults.client_id),
        client_secret: match values.get("WK_OIDC_CLIENT_SECRET") {
            None => defaults.client_secret,
            Some(secret) if secret.is_empty() => None,
            Some(secret) => Some(secret.clone()),
        },
        scope: text("WK_OIDC_SCOPE").unwrap_or(defaults.scope),
        verbose_logging: boolean("WK_OIDC_VERBOSE_LOGGING")?,
        sso_key: values.get("WK_SSO_KEY").cloned().unwrap_or_default(),
        http_timeout,
    })
}

struct Oidc {
    config: OidcConfig,
    http: reqwest::Client,
}

pub fn router(config: OidcConfig) -> Router<AppState> {
    let http = reqwest::Client::builder()
        .timeout(config.http_timeout)
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    Router::new()
        .route("/auth/sso", get(single_sign_on))
        .route("/auth/oidc/login", get(login_via_open_id_connect))
        .route("/auth/oidc/callback", get(open_id_callback))
        .layer(Extension(Arc::new(Oidc { config, http })))
}

fn see_other(location: &str) -> Response {
    (StatusCode::SEE_OTHER, [(header::LOCATION, location)]).into_response()
}

fn query_param(query: Option<&str>, name: &str) -> Option<String> {
    url::form_urlencoded::parse(query.unwrap_or_default().as_bytes())
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.into_owned())
}

// ---------------------------------------------------------------------------
// Discourse SSO (GET /auth/sso)

fn hmac_sha256_hex(key: &str, value: &str) -> String {
    let key = hmac::Key::new(hmac::HMAC_SHA256, key.as_bytes());
    hmac::sign(&key, value.as_bytes())
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// commons-codec `Base64.decodeBase64`: both alphabets, optional padding,
/// characters outside the alphabet ignored.
fn decode_base64_lenient(value: &str) -> Vec<u8> {
    let mut cleaned: Vec<u8> = value
        .bytes()
        .filter_map(|byte| match byte {
            b'-' => Some(b'+'),
            b'_' => Some(b'/'),
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'+' | b'/' => Some(byte),
            _ => None,
        })
        .collect();
    if cleaned.len() % 4 == 1 {
        cleaned.pop();
    }
    let engine = GeneralPurpose::new(
        &alphabet::STANDARD,
        GeneralPurposeConfig::new()
            .with_decode_padding_mode(DecodePaddingMode::RequireNone)
            .with_decode_allow_trailing_bits(true),
    );
    engine.decode(cleaned).unwrap_or_default()
}

fn java_url_encode(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

async fn single_sign_on(
    State(state): State<AppState>,
    Extension(oidc): Extension<Arc<Oidc>>,
    OptionalAuthUser(user): OptionalAuthUser,
    RawQuery(query): RawQuery,
) -> ApiResult<Response> {
    let sso = query_param(query.as_deref(), "sso")
        .ok_or_else(|| ApiError::bad_request("Missing parameter: sso"))?;
    let sig = query_param(query.as_deref(), "sig")
        .ok_or_else(|| ApiError::bad_request("Missing parameter: sig"))?;
    let key = &oidc.config.sso_key;
    if key.is_empty() {
        tracing::warn!(
            "No SSO key configured! To use single-sign-on a sso key needs to be defined in the configuration."
        );
    }
    let Some(user) = user else {
        return Ok(see_other(messages::DISCOURSE_LOGIN_REDIRECT));
    };
    if key.is_empty() {
        // Play's HmacUtils throws for an empty key (500).
        return Err(ApiError::internal());
    }
    let expected = hmac_sha256_hex(key, &sso);
    if !bool::from(expected.as_bytes().ct_eq(sig.as_bytes())) {
        return Ok((StatusCode::BAD_REQUEST, messages::INVALID_SIGNATURE).into_response());
    }
    let payload = String::from_utf8_lossy(&decode_base64_lenient(&sso)).into_owned();
    let values: Vec<(String, String)> = url::form_urlencoded::parse(payload.as_bytes())
        .into_owned()
        .collect();
    let first = |name: &str| {
        values
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.clone())
    };
    let nonce = first("nonce").ok_or_else(|| ApiError::bad_request(messages::NONCE_MISSING))?;
    let return_url = first("return_sso_url")
        .ok_or_else(|| ApiError::bad_request(messages::RETURN_URL_MISSING))?;
    let (email, first_name, last_name): (String, String, String) = sqlx::query_as(
        r#"SELECT m.email, m.firstName, m.lastName FROM webknossos.users_ u
           JOIN webknossos.multiUsers_ m ON m._id = u._multiUser WHERE u._id = $1"#,
    )
    .bind(&user.id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Resource not found."))?;
    tracing::info!(user = %user.id, "User logged in to discuss.webknossos.org via WK SSO.");
    let abbreviated_name = format!(
        "{}{}",
        first_name
            .chars()
            .next()
            .map(String::from)
            .unwrap_or_default(),
        last_name
    )
    .to_lowercase()
    .replace(' ', "_");
    let return_payload = format!(
        "nonce={nonce}&email={}&external_id={}&username={}&name={}",
        java_url_encode(&email),
        java_url_encode(&user.id),
        java_url_encode(&abbreviated_name),
        java_url_encode(&format!("{first_name} {last_name}")),
    );
    let encoded = STANDARD.encode(return_payload.as_bytes());
    let signature = hmac_sha256_hex(key, &encoded);
    let location = format!(
        "{return_url}?sso={}&sig={signature}",
        java_url_encode(&encoded)
    );
    Ok(see_other(&location))
}

// ---------------------------------------------------------------------------
// OpenID Connect client

#[derive(Debug)]
struct ClientError(String);

impl<E: fmt::Display> From<E> for ClientError {
    fn from(error: E) -> Self {
        Self(error.to_string())
    }
}

#[derive(Deserialize)]
struct ProviderInfo {
    authorization_endpoint: String,
    token_endpoint: String,
    #[allow(dead_code)]
    userinfo_endpoint: String,
    jwks_uri: String,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    id_token: Option<String>,
    #[allow(dead_code)]
    token_type: String,
    #[allow(dead_code)]
    refresh_token: Option<String>,
    scope: Option<String>,
}

#[derive(Deserialize)]
struct JsonWebKeySet {
    keys: Vec<JsonWebKey>,
}

/// Play's format requires `kty`, `alg` and `use` on every key.
#[derive(Deserialize)]
struct JsonWebKey {
    kty: String,
    #[allow(dead_code)]
    alg: String,
    #[serde(rename = "use")]
    usage: String,
    n: Option<String>,
    e: Option<String>,
}

struct RsaKey {
    n: Vec<u8>,
    e: Vec<u8>,
}

impl Oidc {
    fn assert_valid(&self) -> ApiResult<()> {
        if !self.config.enabled {
            return Err(ApiError::bad_request(
                "SSO/OIDC is not enabled for this WEBKNOSSOS instance.",
            ));
        }
        if self.config.provider_url.is_empty() {
            return Err(ApiError::bad_request(messages::CONFIGURATION_INVALID));
        }
        Ok(())
    }

    fn log(&self, message: &str) {
        if self.config.verbose_logging {
            tracing::info!("{message}");
        }
    }

    async fn get_json<T: serde::de::DeserializeOwned>(&self, url: &str) -> Result<T, ClientError> {
        let response = self.http.get(url).send().await?.error_for_status()?;
        Ok(serde_json::from_slice(&response.bytes().await?)?)
    }

    /// Discovery (`<providerUrl>.well-known/openid-configuration`, plain concatenation).
    async fn discover(&self) -> Result<ProviderInfo, ClientError> {
        let url = format!(
            "{}.well-known/openid-configuration",
            self.config.provider_url
        );
        self.log(&format!("Fetching OIDC discovery document from {url}"));
        self.get_json(&url).await
    }

    async fn redirect_url(&self, callback_url: &str) -> ApiResult<String> {
        self.assert_valid()?;
        let info = self.discover().await.map_err(|error| {
            tracing::warn!(error = %error.0, "OIDC discovery failed");
            ApiError::bad_request(messages::DISCOVERY_FAILED)
        })?;
        let params = [
            ("client_id", self.config.client_id.as_str()),
            ("redirect_uri", callback_url),
            ("scope", self.config.scope.as_str()),
            ("response_type", "code"),
        ];
        let query = params
            .iter()
            .map(|(key, value)| format!("{key}={}", java_url_encode(value)))
            .collect::<Vec<_>>()
            .join("&");
        Ok(format!("{}?{query}", info.authorization_endpoint))
    }

    async fn first_rsa_key(&self, info: &ProviderInfo) -> Result<RsaKey, ClientError> {
        let set: JsonWebKeySet = self.get_json(&info.jwks_uri).await?;
        let key = set
            .keys
            .into_iter()
            .find(|key| key.kty == "RSA" && key.usage == "sig")
            .ok_or_else(|| {
                ClientError("No server RSA Public Key found in server key set".into())
            })?;
        let decode = |value: Option<String>, name: &str| -> Result<Vec<u8>, ClientError> {
            let bytes = URL_SAFE_INDIFFERENT
                .decode(value.ok_or_else(|| ClientError(format!("JWK {name} missing")))?)?;
            // java.math.BigInteger(1, bytes) ignores leading zero bytes.
            let start = bytes
                .iter()
                .position(|byte| *byte != 0)
                .unwrap_or(bytes.len());
            Ok(bytes[start..].to_vec())
        };
        Ok(RsaKey {
            n: decode(key.n, "n")?,
            e: decode(key.e, "e")?,
        })
    }

    /// getAndValidateTokens: (access token claims, optional id token claims).
    async fn tokens(
        &self,
        redirect_url: &str,
        code: &str,
    ) -> Result<(Map<String, Value>, Option<Map<String, Value>>), ClientError> {
        let info = self.discover().await?;
        let form = [
            ("grant_type", "authorization_code"),
            ("client_id", self.config.client_id.as_str()),
            ("redirect_uri", redirect_url),
            ("code", code),
            ("scope", self.config.scope.as_str()),
        ];
        let body: String = url::form_urlencoded::Serializer::new(String::new())
            .extend_pairs(form)
            .finish();
        let mut request = self
            .http
            .post(&info.token_endpoint)
            .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
            .body(body);
        if let Some(secret) = &self.config.client_secret {
            request = request.basic_auth(&self.config.client_id, Some(secret));
        }
        let response = request.send().await?.error_for_status()?;
        let tokens: TokenResponse = serde_json::from_slice(&response.bytes().await?)?;
        self.log(&format!(
            "Fetched oidc token for scope '{}', response scope: {:?}. Decoding...",
            self.config.scope, tokens.scope
        ));
        let key = self.first_rsa_key(&info).await?;
        let now_ms = chrono::Utc::now().timestamp_millis();
        let access = decode_jwt(&tokens.access_token, &key, now_ms)?;
        let id = match &tokens.id_token {
            Some(token) => {
                let claims = decode_jwt(token, &key, now_ms)?;
                if !audience_contains(&claims, &self.config.client_id) {
                    return Err(ClientError("id token audience mismatch".into()));
                }
                Some(claims)
            }
            None => None,
        };
        self.log("Decoded and verified oidc tokens.");
        Ok((access, id))
    }
}

const URL_SAFE_INDIFFERENT: GeneralPurpose = GeneralPurpose::new(
    &alphabet::URL_SAFE,
    GeneralPurposeConfig::new().with_decode_padding_mode(DecodePaddingMode::Indifferent),
);

/// jwt-scala `decodeJson(token, publicKey)` with default JwtOptions.
fn decode_jwt(token: &str, key: &RsaKey, now_ms: i64) -> Result<Map<String, Value>, ClientError> {
    let parts: Vec<&str> = token.split('.').collect();
    let [header64, claim64, signature64] = parts.as_slice() else {
        return Err(ClientError("JWT must have three parts".into()));
    };
    if signature64.is_empty() {
        return Err(ClientError("JWT signature missing".into()));
    }
    let header: Map<String, Value> =
        serde_json::from_slice(&URL_SAFE_INDIFFERENT.decode(header64)?)?;
    let algorithm: &'static signature::RsaParameters =
        match header.get("alg").and_then(Value::as_str) {
            Some("RS256") => &signature::RSA_PKCS1_2048_8192_SHA256,
            Some("RS384") => &signature::RSA_PKCS1_2048_8192_SHA384,
            Some("RS512") => &signature::RSA_PKCS1_2048_8192_SHA512,
            _ => return Err(ClientError("unsupported JWT algorithm".into())),
        };
    let signature_bytes = URL_SAFE_INDIFFERENT.decode(signature64)?;
    let message = format!("{header64}.{claim64}");
    signature::RsaPublicKeyComponents {
        n: key.n.as_slice(),
        e: key.e.as_slice(),
    }
    .verify(algorithm, message.as_bytes(), &signature_bytes)
    .map_err(|_| ClientError("Invalid signature for this token or wrong algorithm.".into()))?;
    let claims: Map<String, Value> =
        serde_json::from_slice(&URL_SAFE_INDIFFERENT.decode(claim64)?)?;
    let seconds = |name: &str| -> Result<Option<i64>, ClientError> {
        match claims.get(name) {
            None | Some(Value::Null) => Ok(None),
            Some(value) => value
                .as_i64()
                .map(Some)
                .ok_or_else(|| ClientError(format!("JWT {name} is not an integer"))),
        }
    };
    if let Some(exp) = seconds("exp")?
        && exp.saturating_mul(1000) <= now_ms
    {
        return Err(ClientError("JWT expired".into()));
    }
    if let Some(nbf) = seconds("nbf")?
        && nbf.saturating_mul(1000) > now_ms
    {
        return Err(ClientError("JWT not yet valid".into()));
    }
    Ok(claims)
}

fn audience_contains(claims: &Map<String, Value>, client_id: &str) -> bool {
    match claims.get("aud") {
        Some(Value::String(aud)) => aud == client_id,
        Some(Value::Array(auds)) => auds.iter().any(|aud| aud.as_str() == Some(client_id)),
        _ => false,
    }
}

// ---------------------------------------------------------------------------
// Routes

async fn login_via_open_id_connect(
    Extension(oidc): Extension<Arc<Oidc>>,
    Extension(browser): Extension<BrowserAuthConfig>,
) -> ApiResult<Response> {
    if !oidc.config.enabled {
        return Ok((StatusCode::BAD_REQUEST, "SSO is not enabled").into_response());
    }
    let url = oidc.redirect_url(&callback_url(&browser)).await?;
    Ok(Json(json!({ "redirect_url": url })).into_response())
}

fn callback_url(browser: &BrowserAuthConfig) -> String {
    format!("{}/api/auth/oidc/callback", browser.public_uri)
}

struct UserInfo {
    given_name: String,
    family_name: String,
    email: String,
}

fn user_info(claims: &Map<String, Value>) -> Option<UserInfo> {
    let field = |name: &str| claims.get(name).and_then(Value::as_str).map(str::to_owned);
    Some(UserInfo {
        given_name: field("given_name")?,
        family_name: field("family_name")?,
        email: field("email")?,
    })
}

async fn open_id_callback(
    State(state): State<AppState>,
    Extension(oidc): Extension<Arc<Oidc>>,
    Extension(browser): Extension<BrowserAuthConfig>,
    Extension(mailer): Extension<MailSender>,
    Extension(misc): Extension<MiscState>,
    headers: HeaderMap,
    RawQuery(query): RawQuery,
) -> ApiResult<Response> {
    if !oidc.config.enabled {
        return Err(ApiError::bad_request(messages::NOT_ENABLED));
    }
    oidc.assert_valid()
        .map_err(|_| ApiError::bad_request(messages::AUTHENTICATION_FAILED))?;
    let code = query_param(query.as_deref(), "code").unwrap_or_else(|| "missing code".into());
    let (access, id) = oidc
        .tokens(&callback_url(&browser), &code)
        .await
        .map_err(|error| {
            tracing::warn!(error = %error.0, "OIDC token retrieval or validation failed");
            ApiError::bad_request(messages::AUTHENTICATION_FAILED)
        })?;
    let info = user_info(id.as_ref().unwrap_or(&access))
        .ok_or_else(|| ApiError::bad_request(messages::USER_INFO_FAILED))?;
    login_or_signup(&state, &browser, &mailer, &misc, &headers, &info).await
}

/// userService.userFromMultiUserEmail (exact email match, like Play here).
async fn user_for_email(state: &AppState, email: &str) -> ApiResult<Option<String>> {
    let user_id: Option<Option<String>> = sqlx::query_scalar(
        r#"SELECT COALESCE(
             (SELECT u._id FROM webknossos.users_ u JOIN webknossos.organizations_ o ON o._id = u._organization
               WHERE u._id = m._lastLoggedInIdentity AND u._multiUser = m._id AND NOT u.isDeactivated),
             (SELECT u._id FROM webknossos.users_ u JOIN webknossos.organizations_ o ON o._id = u._organization
               WHERE u._multiUser = m._id AND NOT u.isDeactivated ORDER BY u.created, u._id LIMIT 1)
           ) FROM webknossos.multiUsers_ m WHERE m.email = $1"#,
    )
    .bind(email)
    .fetch_optional(&state.pool)
    .await?;
    Ok(user_id.flatten())
}

async fn login_or_signup(
    state: &AppState,
    browser: &BrowserAuthConfig,
    mailer: &MailSender,
    misc: &MiscState,
    headers: &HeaderMap,
    info: &UserInfo,
) -> ApiResult<Response> {
    let user_id = match user_for_email(state, &info.email).await? {
        Some(user_id) => user_id,
        None => {
            let user_id = create_user(state, browser, mailer, info).await?;
            tracing::info!(user = %user_id, "New user created via first OIDC single sign-on");
            // createUser: SignupEvent(user, hadInvite = false)
            crate::analytics::track_for_user(
                state,
                misc,
                &user_id,
                "signup",
                crate::analytics::properties("had_invite", false),
            );
            user_id
        }
    };
    // Email verification is assumed to be done by the provider.
    let cookie = login_user(&state.pool, browser, mailer, headers, &user_id, true).await?;
    tracing::info!(user = %user_id, "User logged in via OIDC single sign-on.");
    let mut response = see_other("/dashboard");
    response.headers_mut().append(header::SET_COOKIE, cookie);
    Ok(response)
}

/// AuthenticationController.createUser into the single default organization,
/// auto-activated, email verified, SSO-only (empty password info).
async fn create_user(
    state: &AppState,
    browser: &BrowserAuthConfig,
    mailer: &MailSender,
    info: &UserInfo,
) -> ApiResult<String> {
    let mut tx = state.pool.begin().await?;
    let organizations: Vec<OrganizationRow> = sqlx::query_as(&format!(
        "SELECT {ORGANIZATION_COLUMNS} FROM webknossos.organizations_ ORDER BY _id LIMIT 2"
    ))
    .fetch_all(&mut *tx)
    .await?;
    let organization = match organizations.as_slice() {
        [organization] => organization,
        _ => return Err(ApiError::bad_request(organization_messages::AMBIGUOUS)),
    };
    let team_memberships = initial_team_memberships(&mut tx, &organization.id, None).await?;
    let created = insert_account(
        &mut tx,
        browser,
        NewAccount {
            organization_id: &organization.id,
            email: &info.email,
            first_name: &info.given_name,
            last_name: &info.family_name,
            is_active: true,
            password: None,
            is_admin: false,
            is_dataset_manager: false,
            is_organization_owner: false,
            is_email_verified: true,
            team_memberships,
        },
    )
    .await
    .map_err(|error| {
        if error.status == StatusCode::BAD_REQUEST {
            error
        } else {
            ApiError::new(error.status, crate::browser_auth::messages::CREATE_FAILED)
        }
    })?;
    let full_name = format!("{} {}", info.given_name, info.family_name);
    let mut mails = created.mails;
    if !browser.is_wkorg_instance {
        mails.push(templates::new_user(&full_name, &info.email, true));
    }
    if let Some(mail) = admin_notifier_mail(
        &mut tx,
        browser,
        organization,
        &full_name,
        &info.email,
        true,
    )
    .await?
    {
        mails.push(mail);
    }
    tx.commit().await?;
    for mail in mails {
        mailer.send(mail);
    }
    Ok(created.user_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn configuration_defaults_follow_application_conf() {
        let config = config_from_values(&HashMap::new()).unwrap();
        assert!(!config.enabled);
        assert_eq!(
            config.provider_url,
            "http://localhost:8080/auth/realms/master/"
        );
        assert_eq!(config.client_id, "myclient");
        assert_eq!(config.client_secret.as_deref(), Some("myClientSecret"));
        assert_eq!(config.scope, "openid profile email");
        assert!(config.sso_key.is_empty());
        let values = HashMap::from([
            ("WK_OIDC_ENABLED".to_owned(), "true".to_owned()),
            ("WK_OIDC_CLIENT_SECRET".to_owned(), String::new()),
            ("WK_SSO_KEY".to_owned(), "k".to_owned()),
        ]);
        let config = config_from_values(&values).unwrap();
        assert!(config.enabled && config.client_secret.is_none());
        assert!(!format!("{config:?}").contains("\"k\""));
        let invalid = HashMap::from([("WK_OIDC_ENABLED".to_owned(), "yes".to_owned())]);
        assert!(config_from_values(&invalid).is_err());
    }

    #[test]
    fn url_encoding_matches_java_url_encoder() {
        assert_eq!(
            java_url_encode("openid profile email"),
            "openid+profile+email"
        );
        assert_eq!(
            java_url_encode("http://a/b?c=d&e*f-g.h_i~"),
            "http%3A%2F%2Fa%2Fb%3Fc%3Dd%26e*f-g.h_i%7E"
        );
    }

    #[test]
    fn lenient_base64_matches_commons_codec() {
        assert_eq!(decode_base64_lenient("bm9uY2U9YQ=="), b"nonce=a");
        assert_eq!(decode_base64_lenient("bm9uY2U9YQ"), b"nonce=a");
        assert_eq!(decode_base64_lenient("bm9u\nY2U9YQ=="), b"nonce=a");
    }

    #[test]
    fn audience_accepts_string_or_array() {
        let claims = |aud: Value| json!({ "aud": aud }).as_object().unwrap().clone();
        assert!(audience_contains(&claims(json!("c")), "c"));
        assert!(audience_contains(&claims(json!(["x", "c"])), "c"));
        assert!(!audience_contains(&claims(json!("x")), "c"));
        assert!(!audience_contains(&Map::new(), "c"));
    }
}
