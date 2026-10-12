//! Browser authentication: Silhouette 10.0.4 compatible signed cookies,
//! password login, and helpers shared by the onboarding/account modules.
//!
//! Cookie format (CookieAuthenticator without a backing repository):
//! `1-<hex HMAC-SHA1(pepper + base64 + pepper)>-<standard padded Base64 of JSON>`
//! with pepper `-mohiva-silhouette-signer-`. See `tests/fixtures/` for a
//! golden value produced by the real Silhouette classes.
use std::{
    collections::HashMap,
    fmt,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use axum::{
    Extension, Router,
    body::Bytes,
    extract::{FromRequest, Request, State},
    http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{CONTENT_TYPE, COOKIE, SET_COOKIE},
        request::Parts,
    },
    middleware::Next,
    response::{IntoResponse, Response},
    routing::post,
};
use base64::{
    Engine,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};
use chrono::{DateTime, TimeZone, Utc};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha1::{Digest, Sha1};
use sqlx::{PgPool, Postgres, Transaction};

use crate::{
    AppState,
    auth::AuthUser,
    error::{ApiError, ApiResult},
    id::ObjectId,
    mail::{Mail, MailSender, templates},
};

pub(crate) mod messages {
    pub const INVALID_CREDENTIALS: &str = "Incorrect email or password. Please try again.";
    pub const IS_DEACTIVATED: &str = "Your account has not been activated by an admin yet. Please contact your organization’s admin for help.";
    pub const NOT_VERIFIED: &str =
        "Your email address is not verified yet. A new verification email has been sent.";
    pub const PASSWORDS_DONT_MATCH: &str = "The two passwords do not match.";
    pub const EMAIL_TAKEN: &str = "An account with this email address already exists. Please log in instead or use a different email.";
    pub const INVALID_FIRST_NAME: &str = "Please check your first name for any special characters.";
    pub const INVALID_LAST_NAME: &str = "Please check your last name for any special characters.";
    pub const NOT_ALLOWED: &str = "You are not authorized to view or edit this resource.";
    pub const SUPER_USER_ONLY: &str = "This feature is currently only available for superusers.";
    pub const USER_NOT_FOUND: &str = "User could not be found or accessed.";
    pub const NOT_AUTHENTICATED: &str =
        "You are not authorized to view this resource. Please log in.";
    pub const TOKEN_INVALID: &str = "The supplied token is invalid or expired.";
    pub const CREATE_FAILED: &str = "Could not create user.";
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CookieSameSite {
    Strict,
    Lax,
    /// Play/Silhouette's "None" setting omits the attribute entirely.
    None,
}

/// Browser session and onboarding configuration. Mirrors
/// `silhouette.cookieAuthenticator.*`, `webKnossos.user.*`, `features.*` and
/// `webKnossos.termsOfService.*` from Play's application.conf.
#[derive(Clone)]
pub struct BrowserAuthConfig {
    /// Cookie signing is disabled (login refused, cookies ignored) without an
    /// explicitly configured secret. There is no built-in development secret.
    pub signer_secret: Option<String>,
    pub cookie_name: String,
    pub cookie_path: String,
    pub secure_cookie: bool,
    pub http_only_cookie: bool,
    pub same_site: CookieSameSite,
    pub use_fingerprinting: bool,
    pub authenticator_expiry: Duration,
    pub cookie_max_age: Duration,
    /// `http.uri` without trailing slash; used for links in mails.
    pub public_uri: String,
    pub email_verification_activated: bool,
    pub email_verification_required: bool,
    pub email_verification_grace_period: Duration,
    pub email_verification_link_expiry: Option<Duration>,
    pub invite_expiry: Duration,
    pub reset_password_expiry: Duration,
    /// Bearer token idle timeout applied to issued reset-password tokens.
    pub token_idle_timeout: Duration,
    pub register_to_default_orga_enabled: bool,
    pub is_wkorg_instance: bool,
    pub terms_of_service_enabled: bool,
    pub terms_of_service_version: i32,
    pub new_organization_mailing_list: String,
}

impl Default for BrowserAuthConfig {
    fn default() -> Self {
        const DAY: u64 = 86_400;
        Self {
            signer_secret: None,
            cookie_name: "id".into(),
            cookie_path: "/".into(),
            secure_cookie: false,
            http_only_cookie: true,
            same_site: CookieSameSite::Lax,
            use_fingerprinting: true,
            authenticator_expiry: Duration::from_secs(30 * DAY),
            cookie_max_age: Duration::from_secs(365 * DAY),
            public_uri: "http://localhost:9000".into(),
            email_verification_activated: false,
            email_verification_required: false,
            email_verification_grace_period: Duration::from_secs(7 * DAY),
            email_verification_link_expiry: Some(Duration::from_secs(30 * DAY)),
            invite_expiry: Duration::from_secs(14 * DAY),
            reset_password_expiry: Duration::from_secs(DAY),
            token_idle_timeout: Duration::from_secs(23_000 * DAY),
            register_to_default_orga_enabled: true,
            is_wkorg_instance: false,
            terms_of_service_enabled: false,
            terms_of_service_version: 1,
            new_organization_mailing_list: String::new(),
        }
    }
}

impl fmt::Debug for BrowserAuthConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("BrowserAuthConfig")
            // Never print the key (nor its field name, which log scanners flag).
            .field("signer", &self.signer_secret.as_ref().map(|_| "[redacted]"))
            .field("cookie_name", &self.cookie_name)
            .field("cookie_path", &self.cookie_path)
            .field("secure_cookie", &self.secure_cookie)
            .field("http_only_cookie", &self.http_only_cookie)
            .field("same_site", &self.same_site)
            .field("use_fingerprinting", &self.use_fingerprinting)
            .field("authenticator_expiry", &self.authenticator_expiry)
            .field("cookie_max_age", &self.cookie_max_age)
            .field("public_uri", &self.public_uri)
            .field(
                "email_verification_activated",
                &self.email_verification_activated,
            )
            .field(
                "email_verification_required",
                &self.email_verification_required,
            )
            .field("invite_expiry", &self.invite_expiry)
            .field(
                "register_to_default_orga_enabled",
                &self.register_to_default_orga_enabled,
            )
            .field("is_wkorg_instance", &self.is_wkorg_instance)
            .field("terms_of_service_enabled", &self.terms_of_service_enabled)
            .finish_non_exhaustive()
    }
}

/// Parse `WK_COOKIE_*`, email verification, invite and onboarding settings.
/// Defaults follow Play's application.conf, except that the cookie signer
/// secret must be set explicitly to enable browser sessions.
pub(crate) fn config_from_values(
    values: &HashMap<String, String>,
    public_url: &url::Url,
    email_verification_activated: bool,
    token_idle_timeout: Duration,
) -> Result<BrowserAuthConfig, crate::config::ConfigError> {
    use crate::config::ConfigError;
    let defaults = BrowserAuthConfig::default();
    let get = |name: &str| values.get(name).map(String::as_str);
    let boolean = |name: &str, default: bool| -> Result<bool, ConfigError> {
        get(name).map_or(Ok(default), |value| {
            value
                .parse()
                .map_err(|_| ConfigError(format!("{name} must be true or false")))
        })
    };
    let seconds = |name: &str, default: Duration| -> Result<Duration, ConfigError> {
        get(name).map_or(Ok(default), |value| {
            value
                .parse::<u64>()
                .ok()
                .filter(|seconds| *seconds > 0 && *seconds <= i32::MAX as u64)
                .map(Duration::from_secs)
                .ok_or_else(|| ConfigError(format!("{name} must be a positive number of seconds")))
        })
    };
    let signer_secret = match get("WK_COOKIE_SIGNER_SECRET") {
        Some(secret) if secret.len() < 16 => {
            return Err(ConfigError(
                "WK_COOKIE_SIGNER_SECRET must contain at least 16 characters".into(),
            ));
        }
        secret => secret.map(str::to_owned),
    };
    let cookie_name = get("WK_COOKIE_NAME").unwrap_or("id").to_owned();
    let cookie_path = get("WK_COOKIE_PATH").unwrap_or("/").to_owned();
    let header_safe = |value: &str| {
        !value.is_empty()
            && value
                .bytes()
                .all(|b| b.is_ascii_graphic() && !matches!(b, b';' | b',' | b'=' | b'"'))
    };
    if !header_safe(&cookie_name) || !header_safe(&cookie_path) {
        return Err(ConfigError(
            "WK_COOKIE_NAME and WK_COOKIE_PATH must be nonempty cookie-safe tokens".into(),
        ));
    }
    let same_site = match get("WK_COOKIE_SAME_SITE").unwrap_or("Lax") {
        "Strict" => CookieSameSite::Strict,
        "Lax" => CookieSameSite::Lax,
        "None" => CookieSameSite::None,
        _ => {
            return Err(ConfigError(
                "WK_COOKIE_SAME_SITE must be Strict, Lax, or None".into(),
            ));
        }
    };
    let link_expiry = match get("WK_EMAIL_VERIFICATION_LINK_EXPIRY_SECONDS") {
        Some("none") => None,
        _ => Some(seconds(
            "WK_EMAIL_VERIFICATION_LINK_EXPIRY_SECONDS",
            Duration::from_secs(30 * 86_400),
        )?),
    };
    let terms_of_service_version = get("WK_TERMS_OF_SERVICE_VERSION")
        .map_or(Ok(1), str::parse)
        .map_err(|_| ConfigError("WK_TERMS_OF_SERVICE_VERSION must be an integer".into()))?;
    Ok(BrowserAuthConfig {
        signer_secret,
        cookie_name,
        cookie_path,
        secure_cookie: boolean("WK_COOKIE_SECURE", defaults.secure_cookie)?,
        http_only_cookie: boolean("WK_COOKIE_HTTP_ONLY", defaults.http_only_cookie)?,
        same_site,
        use_fingerprinting: boolean("WK_COOKIE_USE_FINGERPRINTING", defaults.use_fingerprinting)?,
        authenticator_expiry: seconds(
            "WK_COOKIE_AUTHENTICATOR_EXPIRY_SECONDS",
            defaults.authenticator_expiry,
        )?,
        cookie_max_age: seconds("WK_COOKIE_MAX_AGE_SECONDS", defaults.cookie_max_age)?,
        public_uri: public_url.as_str().trim_end_matches('/').to_owned(),
        email_verification_activated,
        email_verification_required: boolean("WK_EMAIL_VERIFICATION_REQUIRED", false)?,
        email_verification_grace_period: seconds(
            "WK_EMAIL_VERIFICATION_GRACE_PERIOD_SECONDS",
            defaults.email_verification_grace_period,
        )?,
        email_verification_link_expiry: link_expiry,
        invite_expiry: seconds("WK_INVITE_EXPIRY_SECONDS", defaults.invite_expiry)?,
        reset_password_expiry: seconds(
            "WK_RESET_PASSWORD_TOKEN_EXPIRY_SECONDS",
            defaults.reset_password_expiry,
        )?,
        token_idle_timeout,
        register_to_default_orga_enabled: boolean(
            "WK_REGISTER_TO_DEFAULT_ORGA_ENABLED",
            defaults.register_to_default_orga_enabled,
        )?,
        is_wkorg_instance: boolean("WK_IS_WKORG_INSTANCE", false)?,
        terms_of_service_enabled: boolean("WK_TERMS_OF_SERVICE_ENABLED", false)?,
        terms_of_service_version,
        new_organization_mailing_list: get("WK_NEW_ORGANIZATION_MAILING_LIST")
            .unwrap_or("")
            .to_owned(),
    })
}

// ---------------------------------------------------------------------------
// Silhouette cookie codec

const SIGNER_PEPPER: &str = "-mohiva-silhouette-signer-";
const CREDENTIALS_PROVIDER: &str = "credentials";

#[derive(Clone, PartialEq, Eq)]
pub struct CookieAuthenticator {
    pub id: String,
    pub provider_id: String,
    pub user_id: String,
    pub last_used: DateTime<Utc>,
    pub expiration: DateTime<Utc>,
    /// Seconds, as serialized by Silhouette's FiniteDuration format.
    pub idle_timeout: Option<i64>,
    pub cookie_max_age: Option<i64>,
    pub fingerprint: Option<String>,
}

impl fmt::Debug for CookieAuthenticator {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("CookieAuthenticator")
            .field("id", &"[redacted]")
            .field("user_id", &self.user_id)
            .field("last_used", &self.last_used)
            .field("expiration", &self.expiration)
            .finish_non_exhaustive()
    }
}

#[derive(Serialize, Deserialize)]
struct LoginInfoJson {
    #[serde(rename = "providerID")]
    provider_id: String,
    #[serde(rename = "providerKey")]
    provider_key: String,
}

/// Field order matches play-json's macro-derived writes for the case class.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CookieJson {
    id: String,
    login_info: LoginInfoJson,
    last_used_date_time: String,
    expiration_date_time: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    idle_timeout: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cookie_max_age: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    fingerprint: Option<String>,
}

/// java.time ISO_ZONED_DATE_TIME for a UTC instant at millisecond precision,
/// as written by play-json's DefaultZonedDateTimeWrites (`...Z[UTC]`).
/// Java prints the minimal fraction (trailing zeros stripped).
pub fn format_zoned(instant: DateTime<Utc>) -> String {
    let millis = instant.timestamp_subsec_millis();
    let fraction = if millis == 0 {
        String::new()
    } else {
        format!(".{millis:03}").trim_end_matches('0').to_owned()
    };
    format!("{}{}Z[UTC]", instant.format("%Y-%m-%dT%H:%M:%S"), fraction)
}

/// Accepts ISO offset/zoned date times, with an optional `[Region]` suffix.
pub fn parse_zoned(value: &str) -> Option<DateTime<Utc>> {
    let without_zone = match value.find('[') {
        Some(index) if value.ends_with(']') => &value[..index],
        Some(_) => return None,
        None => value,
    };
    DateTime::parse_from_rfc3339(without_zone)
        .ok()
        .map(|date| date.with_timezone(&Utc))
}

fn hmac_hex(secret: &str, data: &str) -> String {
    let mut mac =
        Hmac::<Sha1>::new_from_slice(secret.as_bytes()).expect("HMAC accepts any key length");
    mac.update(SIGNER_PEPPER.as_bytes());
    mac.update(data.as_bytes());
    mac.update(SIGNER_PEPPER.as_bytes());
    hex(&mac.finalize().into_bytes())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// JcaSigner.sign
pub fn sign(secret: &str, data: &str) -> String {
    format!("1-{}-{data}", hmac_hex(secret, data))
}

/// JcaSigner.extract: version must be 1 and the signature must match in
/// constant time.
pub fn extract(secret: &str, signed: &str) -> Option<String> {
    let (version, rest) = signed.split_once('-')?;
    let (signature, data) = rest.split_once('-')?;
    if version != "1" || signature.is_empty() {
        return None;
    }
    let expected = hmac_hex(secret, data);
    let matches: bool =
        subtle::ConstantTimeEq::ct_eq(expected.as_bytes(), signature.as_bytes()).into();
    matches.then(|| data.to_owned())
}

impl CookieAuthenticator {
    pub fn to_json(&self) -> String {
        serde_json::to_string(&CookieJson {
            id: self.id.clone(),
            login_info: LoginInfoJson {
                provider_id: self.provider_id.clone(),
                provider_key: self.user_id.clone(),
            },
            last_used_date_time: format_zoned(self.last_used),
            expiration_date_time: format_zoned(self.expiration),
            idle_timeout: self.idle_timeout,
            cookie_max_age: self.cookie_max_age,
            fingerprint: self.fingerprint.clone(),
        })
        .expect("cookie JSON serializes")
    }

    pub fn serialize(&self, secret: &str) -> String {
        sign(secret, &STANDARD.encode(self.to_json()))
    }

    pub fn unserialize(value: &str, secret: &str) -> Option<Self> {
        let data = extract(secret, value)?;
        let json = STANDARD.decode(data).ok()?;
        let parsed: CookieJson = serde_json::from_slice(&json).ok()?;
        Some(Self {
            id: parsed.id,
            provider_id: parsed.login_info.provider_id,
            user_id: parsed.login_info.provider_key,
            last_used: parse_zoned(&parsed.last_used_date_time)?,
            expiration: parse_zoned(&parsed.expiration_date_time)?,
            idle_timeout: parsed.idle_timeout,
            cookie_max_age: parsed.cookie_max_age,
            fingerprint: parsed.fingerprint,
        })
    }

    /// Silhouette `isValid`: neither expired nor idle-timed-out.
    pub fn is_valid(&self, now: DateTime<Utc>) -> bool {
        let expired = self.expiration < now;
        let timed_out = self.idle_timeout.is_some_and(|seconds| {
            self.last_used + chrono::Duration::seconds(seconds.max(0)) < now
        });
        !expired && !timed_out
    }
}

/// DefaultFingerprintGenerator(includeRemoteAddress = false).
pub fn fingerprint(headers: &HeaderMap) -> String {
    let header = |name: &str| {
        headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
    };
    let source = format!(
        "{}:{}:{}:",
        header("user-agent"),
        header("accept-language"),
        header("accept-charset")
    );
    hex(&Sha1::digest(source.as_bytes()))
}

/// Last occurrence wins, like Play's name-keyed cookie map.
pub fn request_cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    let mut found = None;
    for header in headers.get_all(COOKIE) {
        let Ok(header) = header.to_str() else {
            continue;
        };
        for pair in header.split(';') {
            if let Some((key, value)) = pair.trim().split_once('=')
                && key.trim() == name
            {
                let value = value.trim();
                let value = value
                    .strip_prefix('"')
                    .and_then(|v| v.strip_suffix('"'))
                    .unwrap_or(value);
                found = Some(value.to_owned());
            }
        }
    }
    found
}

fn http_date(instant: DateTime<Utc>) -> String {
    instant.format("%a, %d %b %Y %H:%M:%S GMT").to_string()
}

/// Play's Set-Cookie rendering of the Silhouette authenticator cookie.
pub fn session_cookie_header(config: &BrowserAuthConfig, value: &str) -> HeaderValue {
    let max_age = config.cookie_max_age.as_secs();
    let expires = Utc::now() + chrono::Duration::seconds(max_age as i64);
    let mut cookie = format!(
        "{}={value}; Max-Age={max_age}; Expires={}; Path={}",
        config.cookie_name,
        http_date(expires),
        config.cookie_path
    );
    if config.secure_cookie {
        cookie.push_str("; Secure");
    }
    if config.http_only_cookie {
        cookie.push_str("; HTTPOnly");
    }
    match config.same_site {
        CookieSameSite::Strict => cookie.push_str("; SameSite=Strict"),
        CookieSameSite::Lax => cookie.push_str("; SameSite=Lax"),
        CookieSameSite::None => {}
    }
    HeaderValue::from_str(&cookie).expect("cookie names/values are header-safe")
}

/// Silhouette `discard`: `DiscardingCookie(name, path, domain, secure)`.
pub fn discarding_cookie_header(config: &BrowserAuthConfig) -> HeaderValue {
    let mut cookie = format!(
        "{}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path={}",
        config.cookie_name, config.cookie_path
    );
    if config.secure_cookie {
        cookie.push_str("; Secure");
    }
    HeaderValue::from_str(&cookie).expect("cookie names are header-safe")
}

pub(crate) fn random_base64url(bytes: usize) -> ApiResult<String> {
    let mut random = vec![0_u8; bytes];
    getrandom::fill(&mut random).map_err(|_| ApiError::internal())?;
    Ok(URL_SAFE_NO_PAD.encode(random))
}

pub(crate) fn random_hex(bytes: usize) -> ApiResult<String> {
    let mut random = vec![0_u8; bytes];
    getrandom::fill(&mut random).map_err(|_| ApiError::internal())?;
    Ok(hex(&random))
}

/// CookieAuthenticatorService.create + init for a user, returning Set-Cookie.
pub(crate) fn issue_cookie(
    config: &BrowserAuthConfig,
    headers: &HeaderMap,
    user_id: &str,
) -> ApiResult<HeaderValue> {
    let secret = signer_secret(config)?;
    let now = Utc
        .timestamp_millis_opt(Utc::now().timestamp_millis())
        .single()
        .ok_or_else(ApiError::internal)?;
    let expiry = chrono::Duration::from_std(config.authenticator_expiry)
        .map_err(|_| ApiError::internal())?;
    let cookie = CookieAuthenticator {
        id: random_base64url(16)?,
        provider_id: CREDENTIALS_PROVIDER.into(),
        user_id: user_id.to_owned(),
        last_used: now,
        expiration: now + expiry,
        idle_timeout: None,
        cookie_max_age: Some(config.cookie_max_age.as_secs() as i64),
        fingerprint: config.use_fingerprinting.then(|| fingerprint(headers)),
    };
    Ok(session_cookie_header(config, &cookie.serialize(secret)))
}

pub(crate) fn signer_secret(config: &BrowserAuthConfig) -> ApiResult<&str> {
    config.signer_secret.as_deref().ok_or_else(|| {
        ApiError::service_unavailable(
            "Browser sessions are not configured on this server (WK_COOKIE_SIGNER_SECRET).",
        )
    })
}

// ---------------------------------------------------------------------------
// Request authentication (used by crate::auth)

pub(crate) enum CookieOutcome {
    /// No usable cookie; bearer credentials are consulted next.
    Absent,
    Authenticated(Box<AuthUser>, Box<CookieAuthenticator>),
    /// A signed cookie took priority but yields no identity (expired, or the
    /// user is gone/inactive). Bearer credentials are ignored, as in Play.
    Rejected,
}

/// Set by [`cookie_middleware`]; requests a discarding Set-Cookie.
#[derive(Clone, Default)]
pub(crate) struct DiscardCookie(Arc<AtomicBool>);

#[derive(sqlx::FromRow)]
struct CookieUserRow {
    id: String,
    organization_id: String,
    is_admin: bool,
    is_dataset_manager: bool,
    is_superuser: bool,
    logged_out_everywhere: Option<DateTime<Utc>>,
    active: bool,
}

/// CombinedAuthenticatorService.retrieve + Silhouette's validity check +
/// identity lookup for the cookie half.
pub(crate) async fn authenticate_cookie(parts: &Parts, pool: &PgPool) -> ApiResult<CookieOutcome> {
    let Some(config) = parts.extensions.get::<BrowserAuthConfig>() else {
        return Ok(CookieOutcome::Absent);
    };
    let Some(secret) = config.signer_secret.as_deref() else {
        return Ok(CookieOutcome::Absent);
    };
    let Some(raw) = request_cookie(&parts.headers, &config.cookie_name) else {
        return Ok(CookieOutcome::Absent);
    };
    let Some(cookie) = CookieAuthenticator::unserialize(&raw, secret) else {
        return Ok(CookieOutcome::Absent);
    };
    if config.use_fingerprinting
        && cookie.fingerprint.as_deref() != Some(&fingerprint(&parts.headers))
    {
        return Ok(CookieOutcome::Absent);
    }
    let row = if ObjectId::parse(&cookie.user_id).is_ok() {
        sqlx::query_as::<_, CookieUserRow>(
            r#"SELECT u._id AS id, u._organization AS organization_id, u.isAdmin AS is_admin,
                 u.isDatasetManager AS is_dataset_manager, m.isSuperUser AS is_superuser,
                 u.loggedOutEverywhereTime AS logged_out_everywhere,
                 (NOT u.isDeactivated AND NOT m.isDeleted AND NOT o.isDeleted) AS active
               FROM webknossos.users_ u
               JOIN webknossos.multiUsers m ON m._id = u._multiUser
               JOIN webknossos.organizations o ON o._id = u._organization
               WHERE u._id = $1"#,
        )
        .bind(&cookie.user_id)
        .fetch_optional(pool)
        .await?
    } else {
        None
    };
    if let Some(row) = &row
        && let Some(cutoff) = row.logged_out_everywhere
        && cookie.last_used.timestamp_millis() <= cutoff.timestamp_millis()
    {
        return Ok(CookieOutcome::Absent);
    }
    if !cookie.is_valid(Utc::now()) {
        if let Some(discard) = parts.extensions.get::<DiscardCookie>() {
            discard.0.store(true, Ordering::Relaxed);
        }
        return Ok(CookieOutcome::Rejected);
    }
    match row {
        Some(row) if row.active => Ok(CookieOutcome::Authenticated(
            Box::new(AuthUser {
                id: row.id,
                organization_id: row.organization_id,
                is_admin: row.is_admin,
                is_dataset_manager: row.is_dataset_manager,
                is_superuser: row.is_superuser,
            }),
            Box::new(cookie),
        )),
        _ => Ok(CookieOutcome::Rejected),
    }
}

/// Whether the presented cookie is still accepted after account locks are held
/// (used to serialize against logout-everywhere).
pub(crate) async fn cookie_still_valid(
    tx: &mut Transaction<'_, Postgres>,
    user_id: &str,
    cookie: &CookieAuthenticator,
) -> ApiResult<bool> {
    let row: Option<(Option<DateTime<Utc>>,)> = sqlx::query_as(
        r#"SELECT u.loggedOutEverywhereTime FROM webknossos.users u
           JOIN webknossos.multiUsers m ON m._id = u._multiUser
           JOIN webknossos.organizations o ON o._id = u._organization
           WHERE u._id = $1 AND NOT u.isDeleted AND NOT u.isDeactivated
             AND NOT m.isDeleted AND NOT o.isDeleted"#,
    )
    .bind(user_id)
    .fetch_optional(&mut **tx)
    .await?;
    Ok(match row {
        None => false,
        Some((cutoff,)) => {
            cookie.user_id == user_id
                && cookie.is_valid(Utc::now())
                && cutoff.is_none_or(|cutoff| {
                    cookie.last_used.timestamp_millis() > cutoff.timestamp_millis()
                })
        }
    })
}

/// Global layer: lets cookie authentication request a discarding cookie
/// (Silhouette discards invalid authenticators) unless the handler already
/// set this cookie itself.
pub async fn cookie_middleware(mut request: Request, next: Next) -> Response {
    let config = request.extensions().get::<BrowserAuthConfig>().cloned();
    let discard = DiscardCookie::default();
    request.extensions_mut().insert(discard.clone());
    let mut response = next.run(request).await;
    if let Some(config) = config
        && discard.0.load(Ordering::Relaxed)
    {
        let prefix = format!("{}=", config.cookie_name);
        let already_set = response
            .headers()
            .get_all(SET_COOKIE)
            .iter()
            .any(|value| value.as_bytes().starts_with(prefix.as_bytes()));
        if !already_set {
            response
                .headers_mut()
                .append(SET_COOKIE, discarding_cookie_header(&config));
        }
    }
    response
}

// ---------------------------------------------------------------------------
// Play form binding (`Form.bindFromRequest` for AnyContent bodies)

/// Flattened form data from an urlencoded or JSON body, like Play's
/// `FormUtils.fromJson` (objects as `a.b`, arrays as `a[0]`).
pub(crate) struct FormBody(pub HashMap<String, String>);

impl<S: Send + Sync> FromRequest<S> for FormBody {
    type Rejection = ApiError;

    async fn from_request(request: Request, state: &S) -> ApiResult<Self> {
        let content_type = request
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(|value| {
                value
                    .split(';')
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_ascii_lowercase()
            })
            .unwrap_or_default();
        let bytes = Bytes::from_request(request, state)
            .await
            .map_err(|_| ApiError::bad_request("Invalid request body."))?;
        let mut data = HashMap::new();
        if content_type == "application/json" || content_type == "text/json" {
            let value: Value = serde_json::from_slice(&bytes)
                .map_err(|_| ApiError::bad_request("Invalid JSON request body."))?;
            flatten_json("", &value, &mut data);
        } else if content_type == "application/x-www-form-urlencoded" {
            let pairs: Vec<(String, String)> = serde_urlencoded::from_bytes(&bytes)
                .map_err(|_| ApiError::bad_request("Invalid form request body."))?;
            for (key, value) in pairs {
                data.entry(key).or_insert(value);
            }
        }
        Ok(Self(data))
    }
}

fn flatten_json(prefix: &str, value: &Value, data: &mut HashMap<String, String>) {
    match value {
        Value::Object(map) => {
            for (key, value) in map {
                let key = if prefix.is_empty() {
                    key.clone()
                } else {
                    format!("{prefix}.{key}")
                };
                flatten_json(&key, value, data);
            }
        }
        Value::Array(values) => {
            for (index, value) in values.iter().enumerate() {
                flatten_json(&format!("{prefix}[{index}]"), value, data);
            }
        }
        Value::Null => {}
        Value::String(value) if !prefix.is_empty() => {
            data.insert(prefix.to_owned(), value.clone());
        }
        other if !prefix.is_empty() => {
            data.insert(prefix.to_owned(), other.to_string());
        }
        _ => {}
    }
}

/// Field-by-field validation accumulating Play's error keys. Values are
/// never echoed in errors (Play's `bogusForm.toString` leaks passwords).
pub(crate) struct Form<'a> {
    data: &'a HashMap<String, String>,
    errors: Vec<String>,
}

impl<'a> Form<'a> {
    pub fn new(data: &'a HashMap<String, String>) -> Self {
        Self {
            data,
            errors: Vec::new(),
        }
    }

    fn error(&mut self, key: &str, message: &str) {
        self.errors.push(format!("{key}: {message}"));
    }

    /// `text`: the key must be present.
    pub fn text(&mut self, key: &str) -> String {
        match self.data.get(key) {
            Some(value) => value.clone(),
            None => {
                self.error(key, "error.required");
                String::new()
            }
        }
    }

    /// `nonEmptyText`
    pub fn non_empty(&mut self, key: &str) -> String {
        match self.data.get(key) {
            Some(value) if !value.trim().is_empty() => value.clone(),
            _ => {
                self.error(key, "error.required");
                String::new()
            }
        }
    }

    /// `email`
    pub fn email(&mut self, key: &str) -> String {
        match self.data.get(key) {
            Some(value) if is_valid_email(value) => value.clone(),
            Some(_) => {
                self.error(key, "error.email");
                String::new()
            }
            None => {
                self.error(key, "error.required");
                String::new()
            }
        }
    }

    fn present(&self, key: &str) -> Option<&String> {
        self.data.get(key).filter(|value| !value.is_empty())
    }

    /// `optional(nonEmptyText)`
    pub fn optional_non_empty(&mut self, key: &str) -> Option<String> {
        let value = self.present(key)?.clone();
        if value.trim().is_empty() {
            self.error(key, "error.required");
            return None;
        }
        Some(value)
    }

    /// `optional(text)`
    pub fn optional_text(&mut self, key: &str) -> Option<String> {
        self.present(key).cloned()
    }

    /// `optional(number)`
    pub fn optional_number(&mut self, key: &str) -> Option<i32> {
        let value = self.present(key)?.clone();
        match value.trim().parse() {
            Ok(number) => Some(number),
            Err(_) => {
                self.error(key, "error.number");
                None
            }
        }
    }

    /// `"password" -> tuple(password1 nonEmpty minLength 8, password2 nonEmpty)`
    /// verifying equality.
    pub fn new_password(&mut self, prefix: &str) -> String {
        let first_key = format!("{prefix}.password1");
        let password1 = self.non_empty(&first_key);
        let password2 = self.non_empty(&format!("{prefix}.password2"));
        if !password1.is_empty() && password1.chars().count() < 8 {
            self.error(&first_key, "error.minLength");
        }
        if !password1.is_empty() && !password2.is_empty() && password1 != password2 {
            self.error(prefix, messages::PASSWORDS_DONT_MATCH);
        }
        password1
    }

    pub fn finish(self) -> ApiResult<()> {
        if self.errors.is_empty() {
            Ok(())
        } else {
            Err(ApiError::bad_request(format!(
                "Invalid form: {}",
                self.errors.join("; ")
            )))
        }
    }
}

/// Play's `Constraints.emailAddress` pattern.
pub(crate) fn is_valid_email(value: &str) -> bool {
    let Some((local, domain)) = value.split_once('@') else {
        return false;
    };
    let local_ok = !local.is_empty()
        && local
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || ".!#$%&'*+/=?^_`{|}~-".contains(c));
    let domain_ok = domain.split('.').all(|label| {
        let bytes = label.as_bytes();
        !bytes.is_empty()
            && bytes.len() <= 63
            && bytes[0].is_ascii_alphanumeric()
            && bytes[bytes.len() - 1].is_ascii_alphanumeric()
            && bytes
                .iter()
                .all(|b| b.is_ascii_alphanumeric() || *b == b'-')
    });
    local_ok && domain_ok
}

// ---------------------------------------------------------------------------
// Passwords (PasswordHasher "SCrypt" = at.favre BCrypt 2a, cost 10)

const BCRYPT_COST: u32 = 10;
/// at.favre's strict long-password strategy rejects more than 72 bytes.
const BCRYPT_MAX_BYTES: usize = 72;

pub async fn hash_password(password: String) -> ApiResult<String> {
    if password.len() > BCRYPT_MAX_BYTES {
        return Err(ApiError::bad_request(
            "Password must not be longer than 72 bytes.",
        ));
    }
    tokio::task::spawn_blocking(move || {
        bcrypt::hash_with_result(password.as_bytes(), BCRYPT_COST)
            .map(|parts| parts.format_for_version(bcrypt::Version::TwoA))
    })
    .await
    .map_err(|_| ApiError::internal())?
    .map_err(|_| ApiError::internal())
}

/// Only the "SCrypt" hasher can verify; "Empty" (SSO-only) accounts never match.
pub async fn verify_password(password: String, hasher: &str, hash: String) -> bool {
    if hasher != "SCrypt" || hash.is_empty() || password.len() > BCRYPT_MAX_BYTES {
        return false;
    }
    tokio::task::spawn_blocking(move || bcrypt::verify(password.as_bytes(), &hash).unwrap_or(false))
        .await
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Email verification (EmailVerificationService)

/// Scala FiniteDuration.toString for whole units.
pub(crate) fn duration_text(duration: Duration) -> String {
    let seconds = duration.as_secs();
    let (value, unit) = if seconds.is_multiple_of(86_400) {
        (seconds / 86_400, "day")
    } else if seconds.is_multiple_of(3_600) {
        (seconds / 3_600, "hour")
    } else if seconds.is_multiple_of(60) {
        (seconds / 60, "minute")
    } else {
        (seconds, "second")
    };
    if value == 1 {
        format!("1 {unit}")
    } else {
        format!("{value} {unit}s")
    }
}

/// sendEmailVerification: persist a fresh key and build the mail; the caller
/// sends the mail only after its transaction commits.
pub(crate) async fn create_email_verification(
    tx: &mut Transaction<'_, Postgres>,
    config: &BrowserAuthConfig,
    multi_user_id: &str,
) -> ApiResult<Mail> {
    let (email, first_name, last_name): (String, String, String) = sqlx::query_as(
        "SELECT email, firstName, lastName FROM webknossos.multiUsers_ WHERE _id = $1",
    )
    .bind(multi_user_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| ApiError::bad_request(messages::USER_NOT_FOUND))?;
    let key = random_base64url(32)?;
    let expiry_ms = config
        .email_verification_link_expiry
        .map(|expiry| i64::try_from(expiry.as_millis()).map_err(|_| ApiError::internal()))
        .transpose()?;
    sqlx::query(
        r#"INSERT INTO webknossos.emailVerificationKeys(_id, key, email, _multiUser, validUntil, isUsed)
           VALUES($1, $2, $3, $4,
             CASE WHEN $5::bigint IS NULL THEN NULL
               ELSE statement_timestamp() + $5::bigint * INTERVAL '1 millisecond' END,
             FALSE)"#,
    )
    .bind(ObjectId::new().as_str())
    .bind(&key)
    .bind(&email)
    .bind(multi_user_id)
    .bind(expiry_ms)
    .execute(&mut **tx)
    .await?;
    tracing::info!("Sending email verification mail");
    let link = format!("{}/verifyEmail/{key}", config.public_uri);
    let expiry_text = config.email_verification_link_expiry.map(duration_text);
    Ok(templates::email_verification(
        &format!("{first_name} {last_name}"),
        &email,
        &link,
        expiry_text.as_deref(),
    ))
}

// ---------------------------------------------------------------------------
// Login

pub fn router() -> Router<AppState> {
    Router::new().route("/auth/login", post(login))
}

#[derive(sqlx::FromRow)]
struct LoginCandidate {
    user_id: Option<String>,
    hasher: String,
    password_hash: String,
}

async fn login(
    State(state): State<AppState>,
    Extension(config): Extension<BrowserAuthConfig>,
    Extension(mailer): Extension<MailSender>,
    headers: HeaderMap,
    FormBody(data): FormBody,
) -> ApiResult<Response> {
    let mut form = Form::new(&data);
    let email = form.email("email");
    let password = form.non_empty("password");
    form.finish()?;
    signer_secret(&config)?;
    let email = email.to_lowercase();
    // userFromMultiUserEmail: the last logged-in identity if still active,
    // otherwise the first active identity of the account.
    let candidate = sqlx::query_as::<_, LoginCandidate>(
        r#"SELECT COALESCE(
             (SELECT u._id FROM webknossos.users_ u JOIN webknossos.organizations_ o ON o._id = u._organization
               WHERE u._id = m._lastLoggedInIdentity AND u._multiUser = m._id AND NOT u.isDeactivated),
             (SELECT u._id FROM webknossos.users_ u JOIN webknossos.organizations_ o ON o._id = u._organization
               WHERE u._multiUser = m._id AND NOT u.isDeactivated ORDER BY u.created, u._id LIMIT 1)
           ) AS user_id,
           m.passwordInfo_hasher::text AS hasher, m.passwordInfo_password AS password_hash
         FROM webknossos.multiUsers_ m WHERE m.email = $1"#,
    )
    .bind(&email)
    .fetch_optional(&state.pool)
    .await?;
    let invalid = || ApiError::bad_request(messages::INVALID_CREDENTIALS);
    let Some(LoginCandidate {
        user_id: Some(user_id),
        hasher,
        password_hash,
    }) = candidate
    else {
        return Err(invalid());
    };
    if !verify_password(password, &hasher, password_hash).await {
        return Err(invalid());
    }
    let cookie = login_user(&state.pool, &config, &mailer, &headers, &user_id, false).await?;
    let mut response = StatusCode::OK.into_response();
    response.headers_mut().append(SET_COOKIE, cookie);
    Ok(response)
}

/// AuthenticationController.loginUser: returns the Set-Cookie value.
pub(crate) async fn login_user(
    pool: &PgPool,
    config: &BrowserAuthConfig,
    mailer: &MailSender,
    headers: &HeaderMap,
    user_id: &str,
    skip_email_verification: bool,
) -> ApiResult<HeaderValue> {
    let mut tx = pool.begin().await?;
    let row: Option<(String, bool, bool, bool)> = sqlx::query_as(
        r#"SELECT m._id, u.isDeactivated, m.isEmailVerified,
             m.emailChangeDate + $2::bigint * INTERVAL '1 millisecond' > statement_timestamp()
           FROM webknossos.users_ u JOIN webknossos.multiUsers_ m ON m._id = u._multiUser
           JOIN webknossos.organizations_ o ON o._id = u._organization
           WHERE u._id = $1 FOR UPDATE OF m"#,
    )
    .bind(user_id)
    .bind(i64::try_from(config.email_verification_grace_period.as_millis()).unwrap_or(i64::MAX))
    .fetch_optional(&mut *tx)
    .await?;
    let (multi_user_id, deactivated, verified, within_grace) =
        row.ok_or_else(|| ApiError::bad_request(messages::INVALID_CREDENTIALS))?;
    if deactivated {
        return Err(ApiError::bad_request(messages::IS_DEACTIVATED));
    }
    let cookie = issue_cookie(config, headers, user_id)?;
    if !skip_email_verification
        && config.email_verification_activated
        && config.email_verification_required
        && !verified
        && !within_grace
    {
        // assertEmailVerifiedOrResendVerificationMail: persist the new key,
        // send it, then reject the login.
        let mail = create_email_verification(&mut tx, config, &multi_user_id).await?;
        tx.commit().await?;
        mailer.send(mail);
        return Err(ApiError::bad_request(messages::NOT_VERIFIED));
    }
    sqlx::query("UPDATE webknossos.multiUsers SET _lastLoggedInIdentity = $2 WHERE _id = $1")
        .bind(&multi_user_id)
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE webknossos.users SET lastActivity = statement_timestamp() WHERE _id = $1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    tracing::info!(user = %user_id, "User logged in via password form.");
    Ok(cookie)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zoned_dates_match_java_iso_zoned_output() {
        let date = Utc.timestamp_millis_opt(1_791_504_000_123).unwrap();
        assert_eq!(format_zoned(date), "2026-10-09T00:00:00.123Z[UTC]");
        let date = Utc.timestamp_millis_opt(1_791_504_000_120).unwrap();
        assert_eq!(format_zoned(date), "2026-10-09T00:00:00.12Z[UTC]");
        let date = Utc.timestamp_millis_opt(1_791_504_000_000).unwrap();
        assert_eq!(format_zoned(date), "2026-10-09T00:00:00Z[UTC]");
        for value in [
            "2026-10-09T00:00:00.123Z[UTC]",
            "2026-10-09T00:00:00.123Z",
            "2026-10-09T02:00:00.123+02:00[Europe/Berlin]",
        ] {
            assert_eq!(
                parse_zoned(value).unwrap().timestamp_millis(),
                1_791_504_000_123
            );
        }
        assert!(parse_zoned("2026-10-09T00:00:00Z[UTC").is_none());
    }

    #[test]
    fn email_constraint_matches_play_pattern() {
        for valid in ["a@b", "first.last+tag@example.co.uk", "x_y@a-b.c"] {
            assert!(is_valid_email(valid), "{valid}");
        }
        for invalid in [
            "", "a", "@b", "a@", "a@-b.c", "a@b-.c", "a@b..c", "a b@c", "a@b@c",
        ] {
            assert!(!is_valid_email(invalid), "{invalid}");
        }
    }

    #[test]
    fn json_bodies_flatten_like_play_form_utils() {
        let mut data = HashMap::new();
        flatten_json(
            "",
            &serde_json::json!({"email":"a@b","password":{"password1":"x","password2":"y"},"n":3,"b":true,"z":null,"l":["q"]}),
            &mut data,
        );
        assert_eq!(data["password.password1"], "x");
        assert_eq!(data["n"], "3");
        assert_eq!(data["b"], "true");
        assert_eq!(data["l[0]"], "q");
        assert!(!data.contains_key("z"));
    }

    #[test]
    fn configuration_defaults_follow_play_and_validate_input() {
        let url = url::Url::parse("https://wk.example/").unwrap();
        let idle = Duration::from_secs(60);
        let config = config_from_values(&HashMap::new(), &url, false, idle).unwrap();
        assert!(config.signer_secret.is_none());
        assert_eq!(config.public_uri, "https://wk.example");
        assert_eq!(config.cookie_name, "id");
        assert_eq!(config.same_site, CookieSameSite::Lax);
        assert!(config.use_fingerprinting && config.http_only_cookie && !config.secure_cookie);
        assert_eq!(
            config.authenticator_expiry,
            Duration::from_secs(30 * 86_400)
        );
        let values = HashMap::from([
            (
                "WK_COOKIE_SIGNER_SECRET".to_owned(),
                "a-sufficiently-long-key".to_owned(),
            ),
            (
                "WK_EMAIL_VERIFICATION_LINK_EXPIRY_SECONDS".to_owned(),
                "none".to_owned(),
            ),
            ("WK_COOKIE_SAME_SITE".to_owned(), "None".to_owned()),
        ]);
        let config = config_from_values(&values, &url, true, idle).unwrap();
        assert_eq!(config.same_site, CookieSameSite::None);
        assert!(config.email_verification_link_expiry.is_none());
        assert!(!format!("{config:?}").contains("sufficiently"));
        for (key, value) in [
            ("WK_COOKIE_SIGNER_SECRET", "short"),
            ("WK_COOKIE_SAME_SITE", "lax"),
            ("WK_COOKIE_NAME", "a;b"),
            ("WK_COOKIE_MAX_AGE_SECONDS", "0"),
            ("WK_IS_WKORG_INSTANCE", "yes"),
            ("WK_TERMS_OF_SERVICE_VERSION", "x"),
        ] {
            let values = HashMap::from([(key.to_owned(), value.to_owned())]);
            assert!(
                config_from_values(&values, &url, false, idle).is_err(),
                "{key}={value}"
            );
        }
        assert_eq!(duration_text(Duration::from_secs(30 * 86_400)), "30 days");
        assert_eq!(duration_text(Duration::from_secs(3_600)), "1 hour");
    }

    #[test]
    fn signatures_reject_tampering_and_other_versions() {
        let signed = sign("secret", "data");
        assert_eq!(extract("secret", &signed).as_deref(), Some("data"));
        assert!(extract("other", &signed).is_none());
        assert!(extract("secret", &signed.replacen("1-", "2-", 1)).is_none());
        assert!(extract("secret", &format!("{signed}x")).is_none());
        assert!(extract("secret", "data").is_none());
    }
}
