use std::{collections::HashMap, fmt, net::SocketAddr, time::Duration};

/// Database URLs contain passwords, so neither configuration type prints them.
#[derive(Clone)]
pub struct DatabaseConfig {
    pub url: String,
    pub min_connections: u32,
    pub max_connections: u32,
    pub acquire_timeout: Duration,
}

impl fmt::Debug for DatabaseConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("DatabaseConfig")
            .field("url", &"[redacted]")
            .field("min_connections", &self.min_connections)
            .field("max_connections", &self.max_connections)
            .field("acquire_timeout", &self.acquire_timeout)
            .finish()
    }
}

#[derive(Clone, Debug)]
pub struct Config {
    pub bind: SocketAddr,
    pub database: DatabaseConfig,
    pub public_url: url::Url,
    pub email_verification_enabled: bool,
    pub jobs_enabled: bool,
    pub jobs: crate::jobs::JobsConfig,
    pub annotation_mutex_expiry: Duration,
    pub time_tracking: TimeTrackingConfig,
    pub auth_routes: crate::auth_routes::AuthRouteConfig,
    pub browser_auth: crate::browser_auth::BrowserAuthConfig,
    pub service_client: crate::service_clients::ServiceClientConfig,
    pub allow_delete_datasets: bool,
    pub datasets: crate::dataset_options::DatasetRouteConfig,
    pub request_timeout: Duration,
    pub shutdown_timeout: Duration,
    pub body_limit: usize,
    pub misc: crate::application_info::MiscConfig,
    pub voxelytics: crate::voxelytics::VoxelyticsConfig,
    pub oidc: crate::auth_oidc::OidcConfig,
    pub mail: crate::mail::MailConfig,
    pub housekeeping: crate::housekeeping::HousekeepingConfig,
    pub slack: crate::slack::SlackConfig,
    pub credit_ticker: crate::credit_ticker::CreditTickerConfig,
    pub used_storage: crate::dataset_storage::UsedStorageConfig,
    pub worker_liveness: crate::worker_liveness::WorkerLivenessConfig,
}

/// `webKnossos.user.timeTrackingPause` and `timeTrackingOnlyWithSignificantChanges`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TimeTrackingConfig {
    pub interaction: crate::time_interaction::TimeInteractionConfig,
    pub only_with_significant_changes: bool,
}

#[derive(Debug)]
pub struct ConfigError(pub String);

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for ConfigError {}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_values(std::env::vars().collect())
    }

    fn from_values(values: HashMap<String, String>) -> Result<Self, ConfigError> {
        let get =
            |name: &str, default: &str| values.get(name).cloned().unwrap_or_else(|| default.into());
        let number = |name: &str, default: &str| -> Result<u64, ConfigError> {
            get(name, default)
                .parse()
                .map_err(|_| ConfigError(format!("{name} must be an unsigned integer")))
        };
        let positive = |name: &str, default: &str| -> Result<u64, ConfigError> {
            let value = number(name, default)?;
            if value == 0 {
                return Err(ConfigError(format!("{name} must be greater than zero")));
            }
            Ok(value)
        };
        let boolean = |name: &str, default: &str| -> Result<bool, ConfigError> {
            get(name, default)
                .parse()
                .map_err(|_| ConfigError(format!("{name} must be true or false")))
        };
        let token_duration = |name: &str, default: &str| -> Result<Duration, ConfigError> {
            let seconds = positive(name, default)?;
            // Match the supported Scala authenticator range; also prevent
            // overflowing timestamp or millisecond arithmetic at issuance.
            if seconds > i32::MAX as u64 {
                return Err(ConfigError(format!(
                    "{name} exceeds the supported duration"
                )));
            }
            Ok(Duration::from_secs(seconds))
        };
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
        let min_connections = u32::try_from(number("WK_DB_MIN_CONNECTIONS", "1")?)
            .map_err(|_| ConfigError("WK_DB_MIN_CONNECTIONS exceeds u32".into()))?;
        let max_connections = u32::try_from(positive("WK_DB_MAX_CONNECTIONS", "10")?)
            .map_err(|_| ConfigError("WK_DB_MAX_CONNECTIONS exceeds u32".into()))?;
        if min_connections > max_connections {
            return Err(ConfigError(
                "WK_DB_MIN_CONNECTIONS cannot exceed WK_DB_MAX_CONNECTIONS".into(),
            ));
        }
        let public_url = url::Url::parse(&get("WK_PUBLIC_URL", "http://localhost:9000"))
            .map_err(|_| ConfigError("WK_PUBLIC_URL must be an absolute HTTP(S) URL".into()))?;
        if !matches!(public_url.scheme(), "http" | "https")
            || public_url.host_str().is_none()
            || !public_url.username().is_empty()
            || public_url.password().is_some()
            || public_url.query().is_some()
            || public_url.fragment().is_some()
        {
            return Err(ConfigError("WK_PUBLIC_URL must be an absolute HTTP(S) URL without credentials, query or fragment".into()));
        }
        let mut service_client = crate::service_clients::ServiceClientConfig {
            request_timeout: Duration::from_secs(positive("WK_RPC_TIMEOUT_SECONDS", "30")?),
            connect_timeout: Duration::from_secs(positive("WK_RPC_CONNECT_TIMEOUT_SECONDS", "5")?),
            max_response_bytes: usize::try_from(positive("WK_RPC_MAX_RESPONSE_BYTES", "67108864")?)
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
            bind: get("WK_BIND", "127.0.0.1:9001")
                .parse()
                .map_err(|_| ConfigError("WK_BIND must be an IP address and port".into()))?,
            database: DatabaseConfig {
                url: database_url,
                min_connections,
                max_connections,
                acquire_timeout: Duration::from_secs(positive(
                    "WK_DB_ACQUIRE_TIMEOUT_SECONDS",
                    "5",
                )?),
            },
            auth_routes: crate::auth_routes::AuthRouteConfig {
                auth_expiry: token_duration("WK_AUTH_TOKEN_EXPIRY_SECONDS", "1987200000")?,
                auth_idle_timeout: token_duration(
                    "WK_AUTH_TOKEN_IDLE_TIMEOUT_SECONDS",
                    "1987200000",
                )?,
                datastore_expiry: token_duration("WK_DATASTORE_TOKEN_EXPIRY_SECONDS", "86400")?,
                passkeys_enabled: boolean("WK_PASSKEYS_ENABLED", "false")?,
                uses_https: public_url.scheme() == "https",
                logout_redirect_url: get("WK_LOGOUT_REDIRECT_URL", "/"),
            },
            browser_auth: crate::browser_auth::config_from_values(
                &values,
                &public_url,
                boolean("WK_EMAIL_VERIFICATION_ENABLED", "true")?,
                token_duration("WK_AUTH_TOKEN_IDLE_TIMEOUT_SECONDS", "1987200000")?,
            )?,
            public_url,
            service_client,
            datasets: dataset_route_config(
                &values,
                boolean("WK_SEGMENT_ANYTHING_ENABLED", "false")?,
            )?,
            allow_delete_datasets: boolean("WK_ALLOW_DELETE_DATASETS", "true")?,
            email_verification_enabled: boolean("WK_EMAIL_VERIFICATION_ENABLED", "true")?,
            jobs_enabled: boolean("WK_JOBS_ENABLED", "false")?,
            jobs: crate::jobs::JobsConfig {
                worker_liveness_timeout: Duration::from_secs(positive(
                    "WK_WORKER_LIVENESS_TIMEOUT_SECONDS",
                    "60",
                )?),
                job_token_expiry: token_duration("WK_JOB_TOKEN_EXPIRY_SECONDS", "604800")?,
            },
            annotation_mutex_expiry: token_duration("WK_ANNOTATION_MUTEX_EXPIRY_SECONDS", "120")?,
            time_tracking: TimeTrackingConfig {
                interaction: i64::try_from(positive("WK_TIME_TRACKING_PAUSE_MILLIS", "60000")?)
                    .ok()
                    .and_then(|millis| {
                        crate::time_interaction::TimeInteractionConfig::new(millis).ok()
                    })
                    .ok_or_else(|| {
                        ConfigError("WK_TIME_TRACKING_PAUSE_MILLIS is out of range".into())
                    })?,
                only_with_significant_changes: boolean(
                    "WK_TIME_TRACKING_ONLY_WITH_SIGNIFICANT_CHANGES",
                    "false",
                )?,
            },
            request_timeout: Duration::from_secs(positive("WK_REQUEST_TIMEOUT_SECONDS", "30")?),
            shutdown_timeout: Duration::from_secs(positive("WK_SHUTDOWN_TIMEOUT_SECONDS", "30")?),
            body_limit: usize::try_from(positive("WK_BODY_LIMIT_BYTES", "2097152")?)
                .map_err(|_| ConfigError("WK_BODY_LIMIT_BYTES exceeds usize".into()))?,
            misc: Default::default(),
            voxelytics: voxelytics_config(&values)?,
            oidc: crate::auth_oidc::config_from_values(&values).map_err(ConfigError)?,
            mail: crate::mail::config_from_values(&values).map_err(ConfigError)?,
            housekeeping: crate::housekeeping::config_from_values(&values).map_err(ConfigError)?,
            slack: crate::slack::config_from_values(&values).map_err(ConfigError)?,
            credit_ticker: crate::credit_ticker::config_from_values(&values)
                .map_err(ConfigError)?,
            used_storage: crate::dataset_storage::config_from_values(&values)
                .map_err(ConfigError)?,
            worker_liveness: crate::worker_liveness::config_from_values(&values)
                .map_err(ConfigError)?,
        };
        config.misc = crate::application_info::config_from_values(&values, &config)?;
        Ok(config)
    }
}

/// `voxelytics.*`: stale timeout and the Loki log store (disabled when the URI is empty).
fn voxelytics_config(
    values: &HashMap<String, String>,
) -> Result<crate::voxelytics::VoxelyticsConfig, ConfigError> {
    let text = |name: &str| values.get(name).cloned().unwrap_or_default();
    let seconds = |name: &str, default: u64| -> Result<Duration, ConfigError> {
        match values.get(name) {
            None => Ok(Duration::from_secs(default)),
            Some(value) => value
                .parse::<u64>()
                .ok()
                .filter(|v| *v > 0 && *v <= i32::MAX as u64)
                .map(Duration::from_secs)
                .ok_or_else(|| ConfigError(format!("{name} must be a positive integer"))),
        }
    };
    let uri = text("WK_VOXELYTICS_LOKI_URI").trim().to_owned();
    if !uri.is_empty() {
        let parsed = url::Url::parse(&uri).map_err(|_| {
            ConfigError("WK_VOXELYTICS_LOKI_URI must be an absolute HTTP(S) URL".into())
        })?;
        if !matches!(parsed.scheme(), "http" | "https")
            || parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.query().is_some()
            || parsed.fragment().is_some()
        {
            return Err(ConfigError(
                "WK_VOXELYTICS_LOKI_URI must be an absolute HTTP(S) URL without credentials, query or fragment".into(),
            ));
        }
    }
    Ok(crate::voxelytics::VoxelyticsConfig {
        stale_timeout: seconds("WK_VOXELYTICS_STALE_TIMEOUT_SECONDS", 20 * 60)?,
        loki: crate::voxelytics::LokiConfig {
            uri,
            tenant: text("WK_VOXELYTICS_LOKI_TENANT"),
            user: text("WK_VOXELYTICS_LOKI_USER"),
            password: text("WK_VOXELYTICS_LOKI_PASSWORD"),
            startup_timeout: seconds("WK_VOXELYTICS_LOKI_STARTUP_TIMEOUT_SECONDS", 60)?,
        },
    })
}

fn dataset_route_config(
    values: &HashMap<String, String>,
    segment_anything_enabled: bool,
) -> Result<crate::dataset_options::DatasetRouteConfig, ConfigError> {
    let external_path_deletion_key = match values.get("WK_EXTERNAL_PATH_DELETION_KEY") {
        Some(key) if key.is_empty() || key.chars().any(char::is_whitespace) => {
            return Err(ConfigError(
                "WK_EXTERNAL_PATH_DELETION_KEY must be nonempty and contain no whitespace".into(),
            ));
        }
        key => key.cloned(),
    };
    let text = |name: &str| values.get(name).cloned().unwrap_or_default();
    let mut upload_to_paths = crate::dataset_options::UploadToPathsConfig::default();
    if let Some(prefixes) = values.get("WK_UPLOAD_TO_PATHS_PREFIXES") {
        for prefix in prefixes.split(',').map(str::trim).filter(|p| !p.is_empty()) {
            let parsed = crate::dataset_source::normalize_upath(prefix)
                .and_then(|p| crate::dataset_source::upath_to_absolute(&p))
                .map_err(|_| {
                    ConfigError("WK_UPLOAD_TO_PATHS_PREFIXES must contain valid paths".into())
                })?;
            upload_to_paths.prefixes.push(parsed);
        }
    }
    if let Some(insert) = values.get("WK_UPLOAD_TO_PATHS_INSERT_ORGANIZATION_DIRECTORY") {
        upload_to_paths.insert_organization_directory = insert.parse().map_err(|_| {
            ConfigError(
                "WK_UPLOAD_TO_PATHS_INSERT_ORGANIZATION_DIRECTORY must be true or false".into(),
            )
        })?;
    }
    if let Some(infix) = values.get("WK_UPLOAD_TO_PATHS_INFIX") {
        upload_to_paths.infix = (!infix.is_empty()).then(|| infix.clone());
    }
    Ok(crate::dataset_options::DatasetRouteConfig {
        upload_to_paths,
        external_path_deletion_key,
        segment_anything_enabled,
        segment_anything: crate::dataset_options::SegmentAnythingConfig {
            uri: text("WK_SEGMENT_ANYTHING_URI"),
            user: text("WK_SEGMENT_ANYTHING_USER"),
            password: text("WK_SEGMENT_ANYTHING_PASSWORD"),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn values() -> HashMap<String, String> {
        HashMap::from([(
            "DATABASE_URL".into(),
            "postgres://user:secret@localhost/wk".into(),
        )])
    }
    #[test]
    fn config_defaults_and_secrets_are_safe() {
        let mut configured = values();
        configured.insert("WK_RPC_TOKEN".into(), "rpc-signing-secret".into());
        let config = Config::from_values(configured).unwrap();
        assert_eq!(config.bind, "127.0.0.1:9001".parse().unwrap());
        assert_eq!(config.annotation_mutex_expiry, Duration::from_secs(120));
        assert_eq!(config.time_tracking, TimeTrackingConfig::default());
        assert!(!format!("{config:?}").contains("secret"));
        assert!(Config::from_values(HashMap::new()).is_err());
    }
    #[test]
    fn invalid_pool_bounds_and_limits_are_rejected() {
        for (key, value) in [
            ("WK_DB_MAX_CONNECTIONS", "0"),
            ("WK_DB_MIN_CONNECTIONS", "11"),
            ("WK_BODY_LIMIT_BYTES", "0"),
            ("WK_REQUEST_TIMEOUT_SECONDS", "-1"),
            ("WK_BIND", "localhost"),
            ("WK_PUBLIC_URL", "javascript:alert(1)"),
            ("WK_PUBLIC_URL", "http://user:password@localhost"),
            ("DATABASE_URL", "sqlite://db"),
            ("WK_AUTH_TOKEN_EXPIRY_SECONDS", "2147483648"),
            ("WK_AUTH_TOKEN_IDLE_TIMEOUT_SECONDS", "0"),
            ("WK_DATASTORE_TOKEN_EXPIRY_SECONDS", "0"),
            ("WK_ANNOTATION_MUTEX_EXPIRY_SECONDS", "0"),
            ("WK_ANNOTATION_MUTEX_EXPIRY_SECONDS", "-1"),
            ("WK_ANNOTATION_MUTEX_EXPIRY_SECONDS", "2147483648"),
            ("WK_TIME_TRACKING_PAUSE_MILLIS", "0"),
            ("WK_TIME_TRACKING_ONLY_WITH_SIGNIFICANT_CHANGES", "yes"),
            ("WK_JOBS_ENABLED", "yes"),
            ("WK_PASSKEYS_ENABLED", "1"),
            ("WK_RPC_TOKEN", ""),
            ("WK_RPC_TOKEN", "token with spaces"),
            ("WK_RPC_TIMEOUT_SECONDS", "0"),
            ("WK_RPC_CONNECT_TIMEOUT_SECONDS", "0"),
            ("WK_RPC_MAX_RESPONSE_BYTES", "0"),
            ("WK_VOXELYTICS_STALE_TIMEOUT_SECONDS", "0"),
            ("WK_VOXELYTICS_LOKI_URI", "ftp://loki"),
            ("WK_VOXELYTICS_LOKI_URI", "http://user:pw@loki"),
        ] {
            let mut v = values();
            v.insert(key.into(), value.into());
            assert!(Config::from_values(v).is_err(), "{key}={value}");
        }
    }
}
