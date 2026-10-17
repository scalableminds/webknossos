use std::{collections::HashMap, fmt, net::SocketAddr, time::Duration};

/// Database URLs contain passwords, so neither configuration type prints them.
#[derive(Clone)]
pub struct DatabaseConfig {
    pub url: String,
    pub min_connections: u32,
    pub max_connections: u32,
    pub acquire_timeout: Duration,
    /// PostgreSQL session `TimeZone`. Play's JDBC sessions use the JVM default zone; the shared
    /// schema depends on it (`hand_out_monthly_free_credits` month boundaries, the zone-less
    /// `annotation_mutexes.expiry` column), so both backends must agree. `None` keeps sqlx's UTC.
    pub session_time_zone: Option<String>,
}

impl fmt::Debug for DatabaseConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("DatabaseConfig")
            .field("url", &"[redacted]")
            .field("min_connections", &self.min_connections)
            .field("max_connections", &self.max_connections)
            .field("acquire_timeout", &self.acquire_timeout)
            .field("session_time_zone", &self.session_time_zone)
            .finish()
    }
}

#[derive(Clone, Debug)]
pub struct Config {
    pub bind: SocketAddr,
    /// Separate listener for `GET /metrics` (`WK_METRICS_BIND`); `None` disables metrics serving.
    pub metrics_bind: Option<SocketAddr>,
    pub database: DatabaseConfig,
    pub public_url: url::Url,
    pub email_verification_enabled: bool,
    pub jobs_enabled: bool,
    pub jobs: crate::job::routes::JobsConfig,
    pub annotation_mutex_expiry: Duration,
    pub time_tracking: TimeTrackingConfig,
    pub auth_routes: crate::auth::routes::AuthRouteConfig,
    pub browser_auth: crate::auth::browser::BrowserAuthConfig,
    pub service_client: crate::stores::client::ServiceClientConfig,
    pub allow_delete_datasets: bool,
    pub datasets: crate::dataset::options::DatasetRouteConfig,
    pub request_timeout: Duration,
    pub shutdown_timeout: Duration,
    pub body_limit: usize,
    pub misc: crate::system::application_info::MiscConfig,
    pub voxelytics: crate::voxelytics::VoxelyticsConfig,
    pub oidc: crate::auth::oidc::OidcConfig,
    pub mail: crate::mail::MailConfig,
    pub housekeeping: crate::background::housekeeping::HousekeepingConfig,
    pub slack: crate::slack::SlackConfig,
    pub credit_ticker: crate::background::credit_ticker::CreditTickerConfig,
    pub used_storage: crate::organization::storage::UsedStorageConfig,
    pub worker_liveness: crate::background::worker_liveness::WorkerLivenessConfig,
}

/// `webKnossos.user.timeTrackingPause` and `timeTrackingOnlyWithSignificantChanges`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TimeTrackingConfig {
    pub interaction: crate::time::interaction::TimeInteractionConfig,
    pub only_with_significant_changes: bool,
}

/// Resolves the database session time zone like the JVM resolves its default zone on Unix
/// (`TZ`, then the `/etc/localtime` link target, then UTC), unless `WK_DB_TIME_ZONE` overrides it.
/// Run Play and Rust with the same zone (ideally both UTC) while they share a database.
pub(crate) fn session_time_zone(
    explicit: Option<&String>,
    tz: Option<&String>,
    localtime_link: Option<std::path::PathBuf>,
) -> Result<String, ConfigError> {
    let valid = |zone: &str| {
        !zone.is_empty()
            && zone.len() <= 64
            && zone
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '_' | '+' | '-'))
    };
    if let Some(zone) = explicit {
        return if valid(zone) {
            Ok(zone.clone())
        } else {
            Err(ConfigError(
                "WK_DB_TIME_ZONE must be an IANA time zone name such as UTC or Europe/Berlin"
                    .into(),
            ))
        };
    }
    let from_tz = tz.map(|zone| zone.trim_start_matches(':').to_owned());
    let from_link = localtime_link.and_then(|link| {
        let text = link.to_string_lossy().into_owned();
        text.split_once("zoneinfo/")
            .map(|(_, zone)| zone.to_owned())
    });
    Ok(from_tz
        .filter(|zone| valid(zone))
        .or(from_link.filter(|zone| valid(zone)))
        .unwrap_or_else(|| "UTC".into()))
}

#[derive(Debug)]
pub struct ConfigError(pub String);

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for ConfigError {}

/// Durations are capped like Scala's `FiniteDuration` settings read as Int seconds; this also
/// keeps timestamp and millisecond arithmetic from overflowing.
const MAX_SECONDS: u64 = i32::MAX as u64;

/// Typed reads of the environment values shared by every settings parser. Each error message
/// starts with the variable name.
#[derive(Clone, Copy)]
pub(crate) struct Env<'a>(&'a HashMap<String, String>);

impl<'a> Env<'a> {
    pub(crate) fn new(values: &'a HashMap<String, String>) -> Self {
        Self(values)
    }

    /// The raw value, if set.
    pub(crate) fn get(self, name: &str) -> Option<&'a str> {
        self.0.get(name).map(String::as_str)
    }

    /// The raw value, or `default` when unset.
    pub(crate) fn text(self, name: &str, default: &str) -> String {
        self.get(name).unwrap_or(default).to_owned()
    }

    /// `true` or `false`, surrounding whitespace ignored.
    pub(crate) fn bool(self, name: &str) -> Result<Option<bool>, ConfigError> {
        self.parse(name, "must be true or false")
    }

    pub(crate) fn bool_or(self, name: &str, default: bool) -> Result<bool, ConfigError> {
        Ok(self.bool(name)?.unwrap_or(default))
    }

    pub(crate) fn unsigned(self, name: &str) -> Result<Option<u64>, ConfigError> {
        self.parse(name, "must be an unsigned integer")
    }

    /// An unsigned integer greater than zero.
    pub(crate) fn positive(self, name: &str) -> Result<Option<u64>, ConfigError> {
        match self.unsigned(name)? {
            Some(0) => Err(ConfigError(format!("{name} must be greater than zero"))),
            value => Ok(value),
        }
    }

    /// Whole seconds up to `i32::MAX`; zero only with `allow_zero`.
    pub(crate) fn seconds(
        self,
        name: &str,
        allow_zero: bool,
    ) -> Result<Option<Duration>, ConfigError> {
        let seconds = if allow_zero {
            self.unsigned(name)?
        } else {
            self.positive(name)?
        };
        match seconds {
            Some(seconds) if seconds > MAX_SECONDS => Err(ConfigError(format!(
                "{name} exceeds the supported duration"
            ))),
            seconds => Ok(seconds.map(Duration::from_secs)),
        }
    }

    /// An absolute HTTP(S) URL with a host and without credentials, query or fragment.
    pub(crate) fn http_url(self, name: &str, raw: &str) -> Result<url::Url, ConfigError> {
        let invalid = || {
            ConfigError(format!(
                "{name} must be an absolute HTTP(S) URL without credentials, query or fragment"
            ))
        };
        let url = url::Url::parse(raw).map_err(|_| invalid())?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(invalid());
        }
        Ok(url)
    }

    fn parse<T: std::str::FromStr>(
        self,
        name: &str,
        expected: &str,
    ) -> Result<Option<T>, ConfigError> {
        self.get(name)
            .map(|value| {
                value
                    .trim()
                    .parse()
                    .map_err(|_| ConfigError(format!("{name} {expected}")))
            })
            .transpose()
    }
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_values(std::env::vars().collect())
    }

    fn from_values(values: HashMap<String, String>) -> Result<Self, ConfigError> {
        let env = Env::new(&values);
        let database_url = values
            .get("DATABASE_URL")
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| ConfigError("DATABASE_URL is required".into()))?
            .clone();
        let parsed_url = url::Url::parse(&database_url)
            .map_err(|_| ConfigError("DATABASE_URL must be a PostgreSQL URL".into()))?;
        if !matches!(parsed_url.scheme(), "postgres" | "postgresql") {
            return Err(ConfigError("DATABASE_URL must be a PostgreSQL URL".into()));
        }
        let min_connections = u32::try_from(env.unsigned("WK_DB_MIN_CONNECTIONS")?.unwrap_or(1))
            .map_err(|_| ConfigError("WK_DB_MIN_CONNECTIONS exceeds u32".into()))?;
        let max_connections =
            u32::try_from(env.positive("WK_DB_MAX_CONNECTIONS")?.unwrap_or(10))
                .map_err(|_| ConfigError("WK_DB_MAX_CONNECTIONS exceeds u32".into()))?;
        if min_connections > max_connections {
            return Err(ConfigError(
                "WK_DB_MIN_CONNECTIONS cannot exceed WK_DB_MAX_CONNECTIONS".into(),
            ));
        }
        let public_url = env.http_url(
            "WK_PUBLIC_URL",
            &env.text("WK_PUBLIC_URL", "http://localhost:9000"),
        )?;
        let mut service_client = crate::stores::client::ServiceClientConfig {
            request_timeout: env
                .seconds("WK_RPC_TIMEOUT_SECONDS", false)?
                .unwrap_or(Duration::from_secs(30)),
            connect_timeout: env
                .seconds("WK_RPC_CONNECT_TIMEOUT_SECONDS", false)?
                .unwrap_or(Duration::from_secs(5)),
            max_response_bytes: usize::try_from(
                env.positive("WK_RPC_MAX_RESPONSE_BYTES")?
                    .unwrap_or(67108864),
            )
            .map_err(|_| ConfigError("WK_RPC_MAX_RESPONSE_BYTES exceeds usize".into()))?,
            ..Default::default()
        };
        if let Some(token) = values.get("WK_RPC_TOKEN") {
            if token.is_empty() || token.chars().any(char::is_whitespace) {
                return Err(ConfigError(
                    "WK_RPC_TOKEN must be nonempty and contain no whitespace".into(),
                ));
            }
            service_client.rpc_token = token.clone();
        }
        let mut config = Self {
            bind: env
                .text("WK_BIND", "127.0.0.1:9001")
                .parse()
                .map_err(|_| ConfigError("WK_BIND must be an IP address and port".into()))?,
            metrics_bind: values
                .get("WK_METRICS_BIND")
                .filter(|value| !value.trim().is_empty())
                .map(|value| value.parse())
                .transpose()
                .map_err(|_| {
                    ConfigError("WK_METRICS_BIND must be an IP address and port".into())
                })?,
            database: DatabaseConfig {
                url: database_url,
                min_connections,
                max_connections,
                acquire_timeout: env
                    .seconds("WK_DB_ACQUIRE_TIMEOUT_SECONDS", false)?
                    .unwrap_or(Duration::from_secs(5)),
                session_time_zone: Some(session_time_zone(
                    values.get("WK_DB_TIME_ZONE"),
                    values.get("TZ"),
                    std::fs::read_link("/etc/localtime").ok(),
                )?),
            },
            auth_routes: crate::auth::routes::AuthRouteConfig {
                auth_expiry: env
                    .seconds("WK_AUTH_TOKEN_EXPIRY_SECONDS", false)?
                    .unwrap_or(Duration::from_secs(1987200000)),
                auth_idle_timeout: env
                    .seconds("WK_AUTH_TOKEN_IDLE_TIMEOUT_SECONDS", false)?
                    .unwrap_or(Duration::from_secs(1987200000)),
                datastore_expiry: env
                    .seconds("WK_DATASTORE_TOKEN_EXPIRY_SECONDS", false)?
                    .unwrap_or(Duration::from_secs(86400)),
                passkeys_enabled: env.bool_or("WK_PASSKEYS_ENABLED", false)?,
                uses_https: public_url.scheme() == "https",
                logout_redirect_url: env.text("WK_LOGOUT_REDIRECT_URL", "/"),
            },
            browser_auth: crate::auth::browser::config_from_values(
                &values,
                &public_url,
                env.bool_or("WK_EMAIL_VERIFICATION_ENABLED", true)?,
                env.seconds("WK_AUTH_TOKEN_IDLE_TIMEOUT_SECONDS", false)?
                    .unwrap_or(Duration::from_secs(1987200000)),
            )?,
            public_url,
            service_client,
            datasets: dataset_route_config(
                env,
                env.bool_or("WK_SEGMENT_ANYTHING_ENABLED", false)?,
            )?,
            allow_delete_datasets: env.bool_or("WK_ALLOW_DELETE_DATASETS", true)?,
            email_verification_enabled: env.bool_or("WK_EMAIL_VERIFICATION_ENABLED", true)?,
            jobs_enabled: env.bool_or("WK_JOBS_ENABLED", false)?,
            jobs: crate::job::routes::JobsConfig {
                worker_liveness_timeout: env
                    .seconds("WK_WORKER_LIVENESS_TIMEOUT_SECONDS", false)?
                    .unwrap_or(Duration::from_secs(60)),
                job_token_expiry: env
                    .seconds("WK_JOB_TOKEN_EXPIRY_SECONDS", false)?
                    .unwrap_or(Duration::from_secs(604800)),
            },
            annotation_mutex_expiry: env
                .seconds("WK_ANNOTATION_MUTEX_EXPIRY_SECONDS", false)?
                .unwrap_or(Duration::from_secs(120)),
            time_tracking: TimeTrackingConfig {
                interaction: i64::try_from(
                    env.positive("WK_TIME_TRACKING_PAUSE_MILLIS")?
                        .unwrap_or(60000),
                )
                .ok()
                .and_then(|millis| {
                    crate::time::interaction::TimeInteractionConfig::new(millis).ok()
                })
                .ok_or_else(|| {
                    ConfigError("WK_TIME_TRACKING_PAUSE_MILLIS is out of range".into())
                })?,
                only_with_significant_changes: env
                    .bool_or("WK_TIME_TRACKING_ONLY_WITH_SIGNIFICANT_CHANGES", false)?,
            },
            request_timeout: env
                .seconds("WK_REQUEST_TIMEOUT_SECONDS", false)?
                .unwrap_or(Duration::from_secs(30)),
            shutdown_timeout: env
                .seconds("WK_SHUTDOWN_TIMEOUT_SECONDS", false)?
                .unwrap_or(Duration::from_secs(30)),
            body_limit: usize::try_from(env.positive("WK_BODY_LIMIT_BYTES")?.unwrap_or(2097152))
                .map_err(|_| ConfigError("WK_BODY_LIMIT_BYTES exceeds usize".into()))?,
            misc: Default::default(),
            voxelytics: voxelytics_config(env)?,
            oidc: crate::auth::oidc::config_from_values(&values)?,
            mail: crate::mail::config_from_values(&values)?,
            housekeeping: crate::background::housekeeping::config_from_values(&values)?,
            slack: crate::slack::config_from_values(&values)?,
            credit_ticker: crate::background::credit_ticker::config_from_values(&values)?,
            used_storage: crate::organization::storage::config_from_values(&values)?,
            worker_liveness: crate::background::worker_liveness::config_from_values(&values)?,
        };
        config.misc = crate::system::application_info::config_from_values(&values, &config)?;
        Ok(config)
    }
}

/// `voxelytics.*`: stale timeout and the Loki log store (disabled when the URI is empty).
fn voxelytics_config(env: Env<'_>) -> Result<crate::voxelytics::VoxelyticsConfig, ConfigError> {
    let seconds = |name: &str, default: u64| -> Result<Duration, ConfigError> {
        Ok(env
            .seconds(name, false)?
            .unwrap_or(Duration::from_secs(default)))
    };
    let uri = env.text("WK_VOXELYTICS_LOKI_URI", "").trim().to_owned();
    if !uri.is_empty() {
        env.http_url("WK_VOXELYTICS_LOKI_URI", &uri)?;
    }
    Ok(crate::voxelytics::VoxelyticsConfig {
        stale_timeout: seconds("WK_VOXELYTICS_STALE_TIMEOUT_SECONDS", 20 * 60)?,
        loki: crate::voxelytics::LokiConfig {
            uri,
            tenant: env.text("WK_VOXELYTICS_LOKI_TENANT", ""),
            user: env.text("WK_VOXELYTICS_LOKI_USER", ""),
            password: env.text("WK_VOXELYTICS_LOKI_PASSWORD", ""),
            startup_timeout: seconds("WK_VOXELYTICS_LOKI_STARTUP_TIMEOUT_SECONDS", 60)?,
        },
    })
}

fn dataset_route_config(
    env: Env<'_>,
    segment_anything_enabled: bool,
) -> Result<crate::dataset::options::DatasetRouteConfig, ConfigError> {
    let external_path_deletion_key = match env.get("WK_EXTERNAL_PATH_DELETION_KEY") {
        Some(key) if key.is_empty() || key.chars().any(char::is_whitespace) => {
            return Err(ConfigError(
                "WK_EXTERNAL_PATH_DELETION_KEY must be nonempty and contain no whitespace".into(),
            ));
        }
        key => key.map(str::to_owned),
    };
    let mut upload_to_paths = crate::dataset::options::UploadToPathsConfig::default();
    if let Some(prefixes) = env.get("WK_UPLOAD_TO_PATHS_PREFIXES") {
        for prefix in prefixes.split(',').map(str::trim).filter(|p| !p.is_empty()) {
            let parsed = webknossos_common::upath::UPath::parse(prefix)
                .map(|p| p.to_absolute().to_string())
                .map_err(|_| {
                    ConfigError("WK_UPLOAD_TO_PATHS_PREFIXES must contain valid paths".into())
                })?;
            upload_to_paths.prefixes.push(parsed);
        }
    }
    if let Some(insert) = env.bool("WK_UPLOAD_TO_PATHS_INSERT_ORGANIZATION_DIRECTORY")? {
        upload_to_paths.insert_organization_directory = insert;
    }
    if let Some(infix) = env.get("WK_UPLOAD_TO_PATHS_INFIX") {
        upload_to_paths.infix = (!infix.is_empty()).then(|| infix.to_owned());
    }
    Ok(crate::dataset::options::DatasetRouteConfig {
        upload_to_paths,
        external_path_deletion_key,
        segment_anything_enabled,
        segment_anything: crate::dataset::options::SegmentAnythingConfig {
            uri: env.text("WK_SEGMENT_ANYTHING_URI", ""),
            user: env.text("WK_SEGMENT_ANYTHING_USER", ""),
            password: env.text("WK_SEGMENT_ANYTHING_PASSWORD", ""),
        },
    })
}

#[cfg(test)]
#[path = "config_tests.rs"]
mod tests;
