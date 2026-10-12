//! Play's `Application` controller (build info, feature flags, certificate
//! check, help mail) plus the configuration shared by the remaining
//! "misc" controllers (analytics, credits, pricing, terms of service,
//! initial data). Defaults follow `conf/application.conf` unless noted.
use std::{
    collections::{HashMap, HashSet},
    fmt,
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    Extension, Router,
    extract::State,
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{Map, Value, json};

use crate::{
    AppState,
    auth::AuthUser,
    config::ConfigError,
    error::{ApiError, ApiResult},
    extract::Json,
    mail::{MailSender, templates},
};

pub const CURRENT_API_VERSION: i32 = 16;
pub const OLDEST_SUPPORTED_API_VERSION: i32 = 10;
/// sbt-buildinfo `scalaVersion`/`sbtVersion` of the Play build (build.sbt,
/// project/build.properties); kept so the `/buildinfo` shape is unchanged.
pub const SCALA_VERSION: &str = "3.8.4";
pub const SBT_VERSION: &str = "1.12.9";
/// `backendAnalytics.uri` default in conf/application.conf.
pub const DEFAULT_ANALYTICS_URI: &str = "https://events-relay.webknossos.org/events";

#[derive(Clone)]
pub struct BuildInfo {
    pub commit_hash: String,
    pub commit_date: String,
    pub ci_build: String,
    pub ci_tag: String,
}

impl BuildInfo {
    /// sbt-buildinfo's `webknossosVersion`: CI tag, else CI build, else "dev".
    pub fn version(&self) -> String {
        if !self.ci_tag.is_empty() {
            self.ci_tag.clone()
        } else if !self.ci_build.is_empty() {
            self.ci_build.clone()
        } else {
            "dev".into()
        }
    }
}

impl Default for BuildInfo {
    fn default() -> Self {
        Self {
            commit_hash: "<getting commit hash failed>".into(),
            commit_date: "<getting git date failed>".into(),
            ci_build: String::new(),
            ci_tag: String::new(),
        }
    }
}

#[derive(Clone)]
pub struct TermsOfServiceConfig {
    pub enabled: bool,
    pub url: String,
    pub acceptance_deadline: DateTime<Utc>,
    pub version: i32,
}

#[derive(Clone)]
pub struct AnalyticsConfig {
    pub uri: String,
    pub key: String,
    pub session_pause: Duration,
    pub save_to_database_enabled: bool,
    pub verbose_logging_enabled: bool,
    /// `uri|key` pairs; parsed lazily like Play (a malformed entry fails ingestion).
    pub well_known_uris: Vec<String>,
}

#[derive(Clone)]
pub struct SampleOrganizationConfig {
    pub enabled: bool,
    pub email: String,
    pub email2: String,
    pub password: String,
    pub token: String,
    pub is_super_user: bool,
}

#[derive(Clone)]
pub struct LocalStoreConfig {
    pub name: String,
    pub key: String,
    pub public_uri: String,
}

#[derive(Clone)]
pub struct MiscConfig {
    pub public_uri: String,
    pub jobs_enabled: bool,
    pub is_wkorg_instance: bool,
    /// Effective `features` object (config + certificate feature overrides).
    pub features: Map<String, Value>,
    pub operator_data: String,
    pub terms_of_service: TermsOfServiceConfig,
    pub support_email: String,
    pub monthly_free_milli_credits: i32,
    /// `webKnossos.tasks.maxOpenPerUser`.
    pub max_open_tasks_per_user: i64,
    pub analytics: AnalyticsConfig,
    pub sample_organization: SampleOrganizationConfig,
    pub local_datastore: Option<LocalStoreConfig>,
    pub local_tracingstore: Option<LocalStoreConfig>,
    pub authenticator_expiry: Duration,
    pub certificate_public_key: Option<String>,
    pub certificate: Option<String>,
    pub build_info: BuildInfo,
}

impl fmt::Debug for MiscConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Keys, passwords, tokens and certificates are never printed.
        f.debug_struct("MiscConfig")
            .field("public_uri", &self.public_uri)
            .field("jobs_enabled", &self.jobs_enabled)
            .field("terms_of_service_enabled", &self.terms_of_service.enabled)
            .field("analytics_uri", &self.analytics.uri)
            .field(
                "analytics_save_to_database_enabled",
                &self.analytics.save_to_database_enabled,
            )
            .field(
                "sample_organization_enabled",
                &self.sample_organization.enabled,
            )
            .field("local_datastore", &self.local_datastore.is_some())
            .field("local_tracingstore", &self.local_tracingstore.is_some())
            .field("certificate_configured", &self.certificate.is_some())
            .finish_non_exhaustive()
    }
}

pub fn default_features() -> Map<String, Value> {
    let value = json!({
        "discussionBoard": "https://forum.image.sc/tag/webknossos",
        "discussionBoardRequiresAdmin": false,
        "hideNavbarLogin": false,
        "isWkorgInstance": false,
        "recommendWkorgInstance": true,
        "taskReopenAllowedInSeconds": 30,
        "allowDeleteDatasets": true,
        "jobsEnabled": false,
        "voxelyticsEnabled": false,
        "neuronInferralCostInMilliCreditsPerGVx": 1000,
        "mitochondriaInferralCostInMilliCreditsPerGVx": 1000,
        "nucleiInferralCostInMilliCreditsPerGVx": 1000,
        "instancesInferralCostInMilliCreditsPerGVx": 1000,
        "alignmentCostInMilliCreditsPerGVx": 500,
        "publicDemoDatasetUrl": "https://webknossos.org/datasets/scalable_minds/l4dense_motta_et_al_demo",
        "exportTiffMaxVolumeMVx": 1024,
        "exportTiffMaxEdgeLengthVx": 8192,
        "bucketSaveWarningThreshold": 1000,
        "defaultToLegacyBindings": false,
        "editableMappingsEnabled": true,
        "optInTabs": ["ConnectomeView"],
        "openIdConnectEnabled": false,
        "registerToDefaultOrgaEnabled": true,
        "segmentAnythingEnabled": false,
        "passkeysEnabled": false,
        "supportAiAgentUrl": "https://docs.webknossos.org/webhooks/webknossos/ask"
    });
    match value {
        Value::Object(map) => map,
        _ => unreachable!("literal object"),
    }
}

impl Default for MiscConfig {
    fn default() -> Self {
        Self {
            public_uri: "http://localhost:9000".into(),
            jobs_enabled: false,
            is_wkorg_instance: false,
            features: default_features(),
            operator_data: "\n    **This is a dev deployment**\n\n    Please add the information of the operator to comply with GDPR.\n  ".into(),
            terms_of_service: TermsOfServiceConfig {
                enabled: false,
                url: "https://webknossos.org/terms-of-service".into(),
                acceptance_deadline: DateTime::parse_from_rfc3339("2023-01-01T00:00:00Z")
                    .expect("valid literal")
                    .with_timezone(&Utc),
                version: 1,
            },
            support_email: "WEBKNOSSOS Support <support@webknossos.org>".into(),
            monthly_free_milli_credits: 2000,
            max_open_tasks_per_user: 5,
            analytics: AnalyticsConfig {
                uri: DEFAULT_ANALYTICS_URI.into(),
                key: String::new(),
                session_pause: Duration::from_secs(30 * 60),
                save_to_database_enabled: false,
                verbose_logging_enabled: false,
                well_known_uris: Vec::new(),
            },
            sample_organization: SampleOrganizationConfig {
                enabled: false,
                email: "sample@scm.io".into(),
                email2: "sample2@scm.io".into(),
                password: "secret".into(),
                token: "secretSampleUserToken".into(),
                is_super_user: true,
            },
            local_datastore: None,
            local_tracingstore: None,
            authenticator_expiry: Duration::from_secs(1_987_200_000),
            certificate_public_key: None,
            certificate: None,
            build_info: BuildInfo::default(),
        }
    }
}

/// Parse the misc settings. `base` must already hold the other parsed
/// settings, so that feature flags backed by dedicated variables stay
/// consistent with the behavior of the routes that use them.
pub(crate) fn config_from_values(
    values: &HashMap<String, String>,
    base: &crate::config::Config,
) -> Result<MiscConfig, ConfigError> {
    let defaults = MiscConfig::default();
    let get = |name: &str| values.get(name).map(String::as_str);
    let text = |name: &str, default: &str| get(name).unwrap_or(default).to_owned();
    let boolean = |name: &str, default: bool| -> Result<bool, ConfigError> {
        get(name).map_or(Ok(default), |value| {
            value
                .parse()
                .map_err(|_| ConfigError(format!("{name} must be true or false")))
        })
    };
    let public_uri = base.public_url.as_str().trim_end_matches('/').to_owned();

    let mut features = default_features();
    if let Some(raw) = get("WK_FEATURES_JSON") {
        let Ok(Value::Object(overrides)) = serde_json::from_str::<Value>(raw) else {
            return Err(ConfigError("WK_FEATURES_JSON must be a JSON object".into()));
        };
        features.extend(overrides);
    }
    // Flags with their own variables are authoritative.
    for (key, value) in [
        ("allowDeleteDatasets", base.allow_delete_datasets),
        ("jobsEnabled", base.jobs_enabled),
        (
            "segmentAnythingEnabled",
            base.datasets.segment_anything_enabled,
        ),
        ("passkeysEnabled", base.auth_routes.passkeys_enabled),
        ("openIdConnectEnabled", base.oidc.enabled),
        ("isWkorgInstance", base.browser_auth.is_wkorg_instance),
        (
            "registerToDefaultOrgaEnabled",
            base.browser_auth.register_to_default_orga_enabled,
        ),
    ] {
        features.insert(key.into(), Value::Bool(value));
    }

    // Play bakes CERTIFICATE_PUBLIC_KEY in at build time; here it is read at startup.
    let certificate_public_key = get("WK_CERTIFICATE_PUBLIC_KEY")
        .or_else(|| get("CERTIFICATE_PUBLIC_KEY"))
        .filter(|key| !key.trim().is_empty())
        .map(str::to_owned);
    let certificate = get("CERTIFICATE").map(str::to_owned);
    apply_feature_overrides(
        &mut features,
        &feature_overrides(certificate_public_key.as_deref(), certificate.as_deref()),
    );

    let acceptance_deadline = match get("WK_TERMS_OF_SERVICE_ACCEPTANCE_DEADLINE") {
        Some(value) => DateTime::parse_from_rfc3339(value)
            .map(|d| d.with_timezone(&Utc))
            .map_err(|_| {
                ConfigError(
                    "WK_TERMS_OF_SERVICE_ACCEPTANCE_DEADLINE must be an RFC 3339 timestamp".into(),
                )
            })?,
        None => defaults.terms_of_service.acceptance_deadline,
    };
    let monthly_free_milli_credits = get("WK_JOBS_MONTHLY_FREE_MILLI_CREDITS")
        .map_or(Ok(defaults.monthly_free_milli_credits), str::parse)
        .map_err(|_| ConfigError("WK_JOBS_MONTHLY_FREE_MILLI_CREDITS must be an integer".into()))?;
    // Scala reads an Int; values outside it fail config loading.
    let max_open_tasks_per_user = get("WK_TASKS_MAX_OPEN_PER_USER")
        .map_or(Ok(defaults.max_open_tasks_per_user), |v| {
            v.parse::<i32>().map(i64::from)
        })
        .map_err(|_| ConfigError("WK_TASKS_MAX_OPEN_PER_USER must be an integer".into()))?;
    let session_pause = get("WK_ANALYTICS_SESSION_PAUSE_SECONDS")
        .map_or(Ok(defaults.analytics.session_pause.as_secs()), str::parse)
        .map(Duration::from_secs)
        .map_err(|_| {
            ConfigError("WK_ANALYTICS_SESSION_PAUSE_SECONDS must be an unsigned integer".into())
        })?;
    // An empty value disables forwarding, like Play's `uri = ""`.
    let analytics_uri = text("WK_ANALYTICS_URI", DEFAULT_ANALYTICS_URI);
    if !analytics_uri.is_empty() {
        let parsed = url::Url::parse(&analytics_uri)
            .map_err(|_| ConfigError("WK_ANALYTICS_URI must be an absolute URL".into()))?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err(ConfigError(
                "WK_ANALYTICS_URI must be an HTTP(S) URL".into(),
            ));
        }
    }
    let local_store = |prefix: &str| -> Result<Option<LocalStoreConfig>, ConfigError> {
        if !boolean(&format!("WK_LOCAL_{prefix}_ENABLED"), false)? {
            return Ok(None);
        }
        Ok(Some(LocalStoreConfig {
            name: text(&format!("WK_{prefix}_NAME"), "localhost"),
            key: text(&format!("WK_{prefix}_KEY"), "something-secure"),
            public_uri: text(&format!("WK_{prefix}_PUBLIC_URI"), &public_uri),
        }))
    };
    Ok(MiscConfig {
        jobs_enabled: base.jobs_enabled,
        is_wkorg_instance: base.browser_auth.is_wkorg_instance,
        features,
        operator_data: text("WK_OPERATOR_DATA", &defaults.operator_data),
        terms_of_service: TermsOfServiceConfig {
            enabled: base.browser_auth.terms_of_service_enabled,
            url: text("WK_TERMS_OF_SERVICE_URL", &defaults.terms_of_service.url),
            acceptance_deadline,
            version: base.browser_auth.terms_of_service_version,
        },
        support_email: text("WK_SUPPORT_EMAIL", &defaults.support_email),
        monthly_free_milli_credits,
        max_open_tasks_per_user,
        analytics: AnalyticsConfig {
            uri: analytics_uri,
            key: text("WK_ANALYTICS_KEY", ""),
            session_pause,
            save_to_database_enabled: boolean("WK_ANALYTICS_SAVE_TO_DATABASE_ENABLED", false)?,
            verbose_logging_enabled: boolean("WK_ANALYTICS_VERBOSE_LOGGING_ENABLED", false)?,
            well_known_uris: get("WK_ANALYTICS_WELL_KNOWN_URIS")
                .map(|list| {
                    list.split(',')
                        .map(str::trim)
                        .filter(|entry| !entry.is_empty())
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default(),
        },
        sample_organization: SampleOrganizationConfig {
            enabled: boolean("WK_SAMPLE_ORGANIZATION_ENABLED", false)?,
            email: text("WK_SAMPLE_USER_EMAIL", &defaults.sample_organization.email),
            email2: text(
                "WK_SAMPLE_USER_EMAIL2",
                &defaults.sample_organization.email2,
            ),
            password: text(
                "WK_SAMPLE_USER_PASSWORD",
                &defaults.sample_organization.password,
            ),
            token: text("WK_SAMPLE_USER_TOKEN", &defaults.sample_organization.token),
            is_super_user: boolean("WK_SAMPLE_USER_IS_SUPER_USER", true)?,
        },
        local_datastore: local_store("DATASTORE")?,
        local_tracingstore: local_store("TRACINGSTORE")?,
        authenticator_expiry: base.auth_routes.auth_expiry,
        certificate_public_key,
        certificate,
        build_info: BuildInfo {
            commit_hash: text("WK_BUILD_COMMIT_HASH", &defaults.build_info.commit_hash),
            commit_date: text("WK_BUILD_COMMIT_DATE", &defaults.build_info.commit_date),
            ci_build: text("CI_BUILD_NUM", ""),
            ci_tag: text("CI_TAG", ""),
        },
        public_uri,
    })
}

// ---------------------------------------------------------------------------
// Runtime state shared by misc handlers.

/// Installed as a request extension by the application router.
#[derive(Clone)]
pub struct MiscState(pub Arc<MiscRuntime>);

pub struct MiscRuntime {
    pub config: MiscConfig,
    /// AnalyticsSessionService: multiUser -> (last refresh, session id).
    pub analytics_sessions: Mutex<HashMap<String, (DateTime<Utc>, i64)>>,
    pub http: reqwest::Client,
}

impl MiscState {
    pub fn new(config: MiscConfig) -> Self {
        Self(Arc::new(MiscRuntime {
            config,
            analytics_sessions: Mutex::new(HashMap::new()),
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(30))
                .build()
                .unwrap_or_default(),
        }))
    }

    pub fn config(&self) -> &MiscConfig {
        &self.0.config
    }
}

impl Default for MiscState {
    fn default() -> Self {
        Self::new(MiscConfig::default())
    }
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/buildinfo", get(build_info))
        .route("/features", get(features))
        .route("/checkCertificate", get(check_certificate))
        .route("/helpEmail", post(help_email))
}

pub(crate) fn ok_empty() -> Response {
    StatusCode::OK.into_response()
}

pub(crate) async fn build_info_json(state: &AppState, config: &MiscConfig) -> Value {
    let schema_version: Option<i64> =
        sqlx::query_scalar("SELECT schemaVersion FROM webknossos.releaseInformation")
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten();
    let info = &config.build_info;
    json!({
        "webknossos": {
            "name": "webknossos",
            "scalaVersion": SCALA_VERSION,
            "sbtVersion": SBT_VERSION,
            "commitHash": info.commit_hash,
            "commitDate": info.commit_date,
            "ciBuild": info.ci_build,
            "ciTag": info.ci_tag,
            "version": info.version(),
        },
        "schemaVersion": schema_version,
        "httpApiVersioning": {
            "currentApiVersion": CURRENT_API_VERSION,
            "oldestSupportedApiVersion": OLDEST_SUPPORTED_API_VERSION,
        },
        "localDataStoreEnabled": config.local_datastore.is_some(),
        "localTracingStoreEnabled": config.local_tracingstore.is_some(),
    })
}

/// UserAwareAction without using the identity: like Play, credentials
/// (even invalid ones) never change the response.
async fn build_info(
    State(state): State<AppState>,
    Extension(misc): Extension<MiscState>,
) -> Response {
    // Used by external applications: keep stable, allow any origin.
    let mut response = axum::Json(build_info_json(&state, misc.config()).await).into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    headers.insert(
        header::ACCESS_CONTROL_MAX_AGE,
        HeaderValue::from_static("600"),
    );
    response
}

async fn features(Extension(misc): Extension<MiscState>) -> Response {
    // addNoCacheHeaderFallback
    (
        [(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"))],
        axum::Json(misc.config().features.clone()),
    )
        .into_response()
}

async fn check_certificate(Extension(misc): Extension<MiscState>) -> Response {
    let config = misc.config();
    let (valid, expires_at) = check_certificate_values(
        config.certificate_public_key.as_deref(),
        config.certificate.as_deref(),
        Utc::now().timestamp(),
    );
    let status = if valid {
        StatusCode::OK
    } else {
        StatusCode::BAD_REQUEST
    };
    (
        status,
        axum::Json(json!({"isValid": valid, "expiresAt": expires_at})),
    )
        .into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HelpEmailParameters {
    message: String,
    current_url: String,
}

async fn help_email(
    State(state): State<AppState>,
    Extension(misc): Extension<MiscState>,
    Extension(mailer): Extension<MailSender>,
    user: AuthUser,
    Json(body): Json<HelpEmailParameters>,
) -> ApiResult<Response> {
    let (organization_name, first_name, last_name, email): (String, String, String, String) =
        sqlx::query_as(
            r#"SELECT o.name, m.firstName, m.lastName, m.email FROM webknossos.users_ u
               JOIN webknossos.organizations_ o ON o._id = u._organization
               JOIN webknossos.multiUsers_ m ON m._id = u._multiUser WHERE u._id = $1"#,
        )
        .bind(&user.id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| ApiError::not_found("User could not be found or accessed."))?;
    let name = format!("{first_name} {last_name}");
    mailer.send(templates::help(
        &name,
        &email,
        &organization_name,
        &body.message,
        &body.current_url,
        &misc.config().support_email,
    ));
    Ok(ok_empty())
}

// ---------------------------------------------------------------------------
// CertificateValidationService

fn default_feature_overrides() -> HashMap<String, bool> {
    [
        ("openIdConnectEnabled", false),
        ("segmentAnythingEnabled", false),
        ("editableMappingsEnabled", false),
    ]
    .into_iter()
    .map(|(key, value)| (key.to_owned(), value))
    .collect()
}

enum PublicKey {
    P256(Vec<u8>),
    P384(Vec<u8>),
}

/// Decode a base64 X.509 SubjectPublicKeyInfo for an uncompressed P-256 or
/// P-384 point (the formats `KeyFactory.getInstance("EC")` accepts in practice).
fn parse_public_key(pem: &str) -> Option<PublicKey> {
    use base64::Engine;
    let cleaned: String = pem
        .lines()
        .filter(|line| !line.starts_with("-----"))
        .collect::<String>()
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect();
    let der = base64::engine::general_purpose::STANDARD
        .decode(cleaned)
        .ok()?;
    // id-ecPublicKey with prime256v1 / secp384r1, followed by the BIT STRING point.
    const P256_PREFIX: [u8; 26] = [
        0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08,
        0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
    ];
    const P384_PREFIX: [u8; 23] = [
        0x30, 0x76, 0x30, 0x10, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x05,
        0x2b, 0x81, 0x04, 0x00, 0x22, 0x03, 0x62, 0x00,
    ];
    if der.len() == P256_PREFIX.len() + 65 && der.starts_with(&P256_PREFIX) {
        return Some(PublicKey::P256(der[P256_PREFIX.len()..].to_vec()));
    }
    if der.len() == P384_PREFIX.len() + 97 && der.starts_with(&P384_PREFIX) {
        return Some(PublicKey::P384(der[P384_PREFIX.len()..].to_vec()));
    }
    None
}

/// Verify an ES256/ES384 JWT and return its claims, ignoring expiry (callers
/// inspect `exp` themselves, like Play's `JwtOptions(expiration = false)`).
/// `nbf` is still enforced, as jwt-scala does by default.
fn decode_jwt(token: &str, key: &PublicKey, now_seconds: i64) -> Option<Map<String, Value>> {
    use base64::Engine;
    let engine = base64::engine::general_purpose::URL_SAFE_NO_PAD;
    let mut parts = token.trim().split('.');
    let (header, payload, signature) = (parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some() {
        return None;
    }
    let header: Value = serde_json::from_slice(&engine.decode(header).ok()?).ok()?;
    let (algorithm, point): (&'static ring::signature::EcdsaVerificationAlgorithm, &[u8]) =
        match (header.get("alg")?.as_str()?, key) {
            ("ES256", PublicKey::P256(point)) => (&ring::signature::ECDSA_P256_SHA256_FIXED, point),
            ("ES384", PublicKey::P384(point)) => (&ring::signature::ECDSA_P384_SHA384_FIXED, point),
            _ => return None,
        };
    let signed = &token.trim()[..header_len(token.trim())?];
    let signature = engine.decode(signature).ok()?;
    ring::signature::UnparsedPublicKey::new(algorithm, point)
        .verify(signed.as_bytes(), &signature)
        .ok()?;
    let claims = match serde_json::from_slice(&engine.decode(payload).ok()?).ok()? {
        Value::Object(claims) => claims,
        _ => return None,
    };
    match claims.get("nbf") {
        None => Some(claims),
        Some(nbf) => (nbf.as_i64()? <= now_seconds).then_some(claims),
    }
}

fn header_len(token: &str) -> Option<usize> {
    let first = token.find('.')?;
    let second = token[first + 1..].find('.')?;
    Some(first + 1 + second)
}

/// checkCertificate: (isValid, expiresAt seconds).
pub(crate) fn check_certificate_values(
    public_key: Option<&str>,
    certificate: Option<&str>,
    now_seconds: i64,
) -> (bool, i64) {
    let Some(public_key) = public_key else {
        // No public key compiled in: always valid.
        return (true, 0);
    };
    let Some(key) = parse_public_key(public_key) else {
        tracing::error!("Could not deserialize the certificate public key");
        return (false, 0);
    };
    certificate
        .and_then(|certificate| decode_jwt(certificate, &key, now_seconds))
        .and_then(|claims| claims.get("exp").and_then(Value::as_i64))
        .map(|exp| (now_seconds < exp, exp))
        .unwrap_or((false, 0))
}

pub(crate) fn feature_overrides(
    public_key: Option<&str>,
    certificate: Option<&str>,
) -> HashMap<String, bool> {
    let Some(public_key) = public_key else {
        return HashMap::new();
    };
    let Some(key) = parse_public_key(public_key) else {
        return default_feature_overrides();
    };
    let now_seconds = Utc::now().timestamp();
    let Some(claims) =
        certificate.and_then(|certificate| decode_jwt(certificate, &key, now_seconds))
    else {
        return default_feature_overrides();
    };
    let mut overrides: HashMap<String, bool> = match claims.get("webknossos") {
        Some(Value::Object(map)) if map.values().all(Value::is_boolean) => map
            .iter()
            .map(|(key, value)| (key.clone(), value.as_bool().unwrap_or(false)))
            .collect(),
        _ => default_feature_overrides(),
    };
    for (key, value) in default_feature_overrides() {
        overrides.entry(key).or_insert(value);
    }
    overrides
}

/// WkConf: `features.k = override && configured` for every overridden key.
fn apply_feature_overrides(features: &mut Map<String, Value>, overrides: &HashMap<String, bool>) {
    let keys: HashSet<&String> = overrides.keys().collect();
    for key in keys {
        let configured = features.get(key).and_then(Value::as_bool).unwrap_or(false);
        features.insert(key.clone(), Value::Bool(overrides[key] && configured));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn certificate_defaults_follow_play() {
        assert_eq!(check_certificate_values(None, None, 0), (true, 0));
        assert_eq!(
            check_certificate_values(Some("not a key"), Some("a.b.c"), 0),
            (false, 0)
        );
        assert!(feature_overrides(None, None).is_empty());
        assert_eq!(
            feature_overrides(Some("bad"), None),
            default_feature_overrides()
        );
    }

    #[test]
    fn es256_certificates_are_verified() {
        use base64::Engine;
        use ring::signature::{ECDSA_P256_SHA256_FIXED_SIGNING, EcdsaKeyPair, KeyPair};
        let rng = ring::rand::SystemRandom::new();
        let pkcs8 = EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, &rng).unwrap();
        let pair = EcdsaKeyPair::from_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, pkcs8.as_ref(), &rng)
            .unwrap();
        let mut spki = vec![
            0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06,
            0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
        ];
        spki.extend_from_slice(pair.public_key().as_ref());
        let key = base64::engine::general_purpose::STANDARD.encode(&spki);
        let engine = base64::engine::general_purpose::URL_SAFE_NO_PAD;
        let sign = |claims: Value| {
            let signed = format!(
                "{}.{}",
                engine.encode(br#"{"alg":"ES256","typ":"JWT"}"#),
                engine.encode(claims.to_string())
            );
            let signature = pair.sign(&rng, signed.as_bytes()).unwrap();
            format!("{signed}.{}", engine.encode(signature.as_ref()))
        };
        let token = sign(json!({"exp": 2000, "webknossos": {"openIdConnectEnabled": true}}));
        assert_eq!(
            check_certificate_values(Some(&key), Some(&token), 1000),
            (true, 2000)
        );
        assert_eq!(
            check_certificate_values(Some(&key), Some(&token), 3000),
            (false, 2000)
        );
        let tampered = format!("{}x", &token[..token.len() - 1]);
        assert!(!check_certificate_values(Some(&key), Some(&tampered), 1000).0);
        let overrides = feature_overrides(Some(&key), Some(&token));
        assert!(overrides["openIdConnectEnabled"]);
        assert!(!overrides["segmentAnythingEnabled"]);
        let mut features = default_features();
        features.insert("openIdConnectEnabled".into(), Value::Bool(true));
        apply_feature_overrides(&mut features, &overrides);
        assert_eq!(features["openIdConnectEnabled"], true);
        assert_eq!(features["editableMappingsEnabled"], false);
    }
}
