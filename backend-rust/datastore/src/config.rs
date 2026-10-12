//! Typed datastore configuration, read from `WK_DS_*` environment variables.
//!
//! Every key mirrors a key of the Scala `DataStoreConfig` / `standalone-datastore.conf`
//! (plus the Play `http.*` / parser / request-timeout settings the Scala service relies on),
//! with the Scala default. The mapping table lives in
//! `backend-rust/checkpoints/datastore-ds0a.md`.
//!
//! Value formats follow HOCON where the Scala config used HOCON types:
//! durations (`10 minutes`, `5 seconds`, `30s`, bare number = milliseconds),
//! memory sizes (`250M`, `1G`, bare number = bytes) and booleans
//! (`true/false/yes/no/on/off`). Lists of objects and strings are JSON arrays.

use std::{
    collections::HashMap,
    fmt,
    net::IpAddr,
    path::{Component, Path, PathBuf},
    time::Duration,
};

use serde::Deserialize;

/// A configuration value that must never be printed.
#[derive(Clone, PartialEq, Eq)]
pub struct Secret(String);

impl Secret {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("[redacted]")
    }
}

#[derive(Debug)]
pub struct ConfigError(pub String);

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for ConfigError {}

/// Default of `datastore.key` in `standalone-datastore.conf`. Production deployments must override it.
pub const DEFAULT_KEY: &str = "something-secur3";

#[derive(Clone, Debug)]
pub struct DatastoreConfig {
    pub http: HttpConfig,
    /// `datastore.key`: shared secret used to authenticate against WEBKNOSSOS.
    pub key: Secret,
    /// `datastore.name`
    pub name: String,
    pub webknossos: WebknossosConfig,
    pub base_directories: Vec<BaseDirectory>,
    /// `datastore.localDirectoryWhitelist`
    pub local_directory_whitelist: Vec<String>,
    /// `datastore.writeVirtualDatasetsMirror`
    pub write_virtual_datasets_mirror: bool,
    pub watch_file_system: WatchFileSystemConfig,
    /// `datastore.upload.deleteTemporaryFilesAfterUpload`
    pub upload_delete_temporary_files_after_upload: bool,
    pub cache: CacheConfig,
    pub ad_hoc_mesh: AdHocMeshConfig,
    pub redis: RedisConfig,
    /// `datastore.agglomerateTree.maxEdges`
    pub agglomerate_tree_max_edges: u64,
    /// `datastore.agglomerateGraph.maxEdges`
    pub agglomerate_graph_max_edges: u64,
    /// `datastore.dataVaults.credentials` (valid entries only, like Scala's `CredentialConfigReader`).
    pub data_vault_credentials: Vec<DataVaultCredential>,
    /// Number of `datastore.dataVaults.credentials` entries Scala would silently drop.
    pub skipped_data_vault_credentials: usize,
    pub slack_notifications: SlackNotificationsConfig,
}

#[derive(Clone, Debug)]
pub struct HttpConfig {
    /// `http.uri`: public URI of this datastore.
    pub uri: String,
    /// `http.address` (Play default 0.0.0.0).
    pub address: IpAddr,
    /// `http.port`
    pub port: u16,
    /// `play.server.pekko.requestTimeout`
    pub request_timeout: Duration,
    /// `play.http.parser.maxMemoryBuffer`: limit for bodies parsed in memory (JSON, text).
    pub max_memory_buffer: u64,
    /// `play.http.parser.maxDiskBuffer`: overall request body limit.
    pub max_disk_buffer: u64,
    /// Not a Scala key: grace period for in-flight requests after SIGTERM / ctrl-c.
    pub shutdown_timeout: Duration,
}

#[derive(Clone, Debug)]
pub struct WebknossosConfig {
    /// `datastore.webKnossos.uri`
    pub uri: String,
    /// `datastore.webKnossos.pingInterval`
    pub ping_interval: Duration,
}

/// One entry of `datastore.baseDirectories` (Scala `BaseDirConfig`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BaseDirectory {
    /// Absolute local path, or a normalized remote URI such as `s3://endpoint/bucket/prefix`.
    pub path: String,
    pub is_remote: bool,
    pub organization_id: Option<String>,
    pub allows_upload: bool,
    pub do_scan: bool,
}

#[derive(Clone, Debug)]
pub struct WatchFileSystemConfig {
    pub enabled: bool,
    pub interval: Duration,
    pub initial_delay: Duration,
}

#[derive(Clone, Debug)]
pub struct CacheConfig {
    pub mapping_max_entries: u64,
    pub image_array_chunks_max_size_bytes: u64,
    pub agglomerate_file: AgglomerateFileCacheConfig,
}

#[derive(Clone, Debug)]
pub struct AgglomerateFileCacheConfig {
    pub max_file_handle_entries: u64,
    pub max_segment_id_entries: u64,
    pub block_size: u64,
    pub cumsum_max_reader_range: u64,
}

#[derive(Clone, Debug)]
pub struct AdHocMeshConfig {
    pub timeout: Duration,
    pub actor_pool_size: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RedisConfig {
    pub address: String,
    pub port: u16,
}

impl RedisConfig {
    /// Scala `RedisTemporaryStore.authority`.
    pub fn authority(&self) -> String {
        format!("{}:{}", self.address, self.port)
    }
}

/// A global data vault credential (Scala `CredentialConfigReader.getCredential`).
#[derive(Clone, Debug, PartialEq)]
pub enum DataVaultCredential {
    S3AccessKey {
        name: String,
        key_id: String,
        secret: Secret,
    },
    HttpBasicAuth {
        name: String,
        username: String,
        password: Secret,
    },
    GoogleServiceAccount {
        name: String,
        /// The service-account JSON document (validated to be JSON).
        secret_json: Secret,
    },
    HttpToken {
        name: String,
        token: Secret,
    },
}

#[derive(Clone)]
pub struct SlackNotificationsConfig {
    /// `slackNotifications.uri` (webhook URLs embed a secret token).
    pub uri: Secret,
    pub verbose_logging_enabled: bool,
}

impl fmt::Debug for SlackNotificationsConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SlackNotificationsConfig")
            .field("uri_configured", &!self.uri.expose().is_empty())
            .field("verbose_logging_enabled", &self.verbose_logging_enabled)
            .finish()
    }
}

const DEFAULT_BASE_DIRECTORIES: &str =
    r#"[{"path":"binaryData","organizationId":null,"allowsUpload":true,"doScan":true}]"#;

impl DatastoreConfig {
    pub fn from_env() -> Result<Self, ConfigError> {
        let cwd = std::env::current_dir()
            .map_err(|e| ConfigError(format!("cannot determine working directory: {e}")))?;
        Self::from_values(&std::env::vars().collect(), &cwd)
    }

    /// Defaults only (as if no `WK_DS_*` variable were set), relative paths resolved against `cwd`.
    pub fn defaults(cwd: &Path) -> Self {
        Self::from_values(&HashMap::new(), cwd).expect("Scala defaults are valid")
    }

    pub fn from_values(values: &HashMap<String, String>, cwd: &Path) -> Result<Self, ConfigError> {
        let env = Env(values);
        let http_port: u16 = env.parse("WK_DS_HTTP_PORT", "9090")?;
        if http_port == 0 {
            return Err(ConfigError("WK_DS_HTTP_PORT must not be 0".into()));
        }
        let http = HttpConfig {
            uri: env.http_uri("WK_DS_HTTP_URI", "http://localhost:9090")?,
            address: env.parse("WK_DS_HTTP_ADDRESS", "0.0.0.0")?,
            port: http_port,
            request_timeout: env.positive_duration("WK_DS_REQUEST_TIMEOUT", "10000s")?,
            max_memory_buffer: env.size("WK_DS_PARSER_MAX_MEMORY_BUFFER", "250M")?,
            max_disk_buffer: env.size("WK_DS_PARSER_MAX_DISK_BUFFER", "1G")?,
            shutdown_timeout: env.duration("WK_DS_SHUTDOWN_TIMEOUT", "30 seconds")?,
        };
        if usize::try_from(http.max_disk_buffer).is_err() {
            return Err(ConfigError(
                "WK_DS_PARSER_MAX_DISK_BUFFER exceeds the address space".into(),
            ));
        }

        let key = env.get("WK_DS_KEY", DEFAULT_KEY);
        if key.is_empty() {
            return Err(ConfigError("WK_DS_KEY must not be empty".into()));
        }
        let name = env.get("WK_DS_NAME", "standalone-9090");
        if name.is_empty() {
            return Err(ConfigError("WK_DS_NAME must not be empty".into()));
        }

        let redis = RedisConfig {
            address: env.get("WK_DS_REDIS_ADDRESS", "localhost"),
            port: env.parse("WK_DS_REDIS_PORT", "6379")?,
        };
        if redis.address.is_empty() || redis.port == 0 {
            return Err(ConfigError(
                "WK_DS_REDIS_ADDRESS must not be empty and WK_DS_REDIS_PORT must not be 0".into(),
            ));
        }

        let (data_vault_credentials, skipped_data_vault_credentials) =
            parse_credentials(&env.get("WK_DS_DATA_VAULTS_CREDENTIALS", "[]"))?;

        let slack_uri = env.get("WK_DS_SLACK_NOTIFICATIONS_URI", "");
        if !slack_uri.is_empty() {
            // Validate without echoing the (secret-bearing) value.
            parse_http_url(&slack_uri).map_err(|_| {
                ConfigError("WK_DS_SLACK_NOTIFICATIONS_URI must be an http(s) URL".into())
            })?;
        }

        Ok(Self {
            http,
            key: Secret(key),
            name,
            webknossos: WebknossosConfig {
                uri: env.http_uri("WK_DS_WEBKNOSSOS_URI", "http://localhost:9000")?,
                ping_interval: env
                    .positive_duration("WK_DS_WEBKNOSSOS_PING_INTERVAL", "10 minutes")?,
            },
            base_directories: parse_base_directories(
                &env.get("WK_DS_BASE_DIRECTORIES", DEFAULT_BASE_DIRECTORIES),
                cwd,
            )?,
            local_directory_whitelist: env.json("WK_DS_LOCAL_DIRECTORY_WHITELIST", "[]")?,
            write_virtual_datasets_mirror: env
                .bool("WK_DS_WRITE_VIRTUAL_DATASETS_MIRROR", "false")?,
            watch_file_system: WatchFileSystemConfig {
                enabled: env.bool("WK_DS_WATCH_FILE_SYSTEM_ENABLED", "true")?,
                interval: env.positive_duration("WK_DS_WATCH_FILE_SYSTEM_INTERVAL", "1 minute")?,
                initial_delay: env
                    .duration("WK_DS_WATCH_FILE_SYSTEM_INITIAL_DELAY", "5 seconds")?,
            },
            upload_delete_temporary_files_after_upload: env
                .bool("WK_DS_UPLOAD_DELETE_TEMPORARY_FILES_AFTER_UPLOAD", "false")?,
            cache: CacheConfig {
                mapping_max_entries: env.parse("WK_DS_CACHE_MAPPING_MAX_ENTRIES", "5")?,
                image_array_chunks_max_size_bytes: env.parse(
                    "WK_DS_CACHE_IMAGE_ARRAY_CHUNKS_MAX_SIZE_BYTES",
                    "2000000000",
                )?,
                agglomerate_file: AgglomerateFileCacheConfig {
                    max_file_handle_entries: env
                        .parse("WK_DS_CACHE_AGGLOMERATE_FILE_MAX_FILE_HANDLE_ENTRIES", "15")?,
                    max_segment_id_entries: env.parse(
                        "WK_DS_CACHE_AGGLOMERATE_FILE_MAX_SEGMENT_ID_ENTRIES",
                        "625000",
                    )?,
                    block_size: env.positive("WK_DS_CACHE_AGGLOMERATE_FILE_BLOCK_SIZE", "512")?,
                    cumsum_max_reader_range: env.positive(
                        "WK_DS_CACHE_AGGLOMERATE_FILE_CUMSUM_MAX_READER_RANGE",
                        "1310720",
                    )?,
                },
            },
            ad_hoc_mesh: AdHocMeshConfig {
                timeout: env.positive_duration("WK_DS_AD_HOC_MESH_TIMEOUT", "30 seconds")?,
                actor_pool_size: env.positive("WK_DS_AD_HOC_MESH_ACTOR_POOL_SIZE", "8")?,
            },
            redis,
            agglomerate_tree_max_edges: env.parse("WK_DS_AGGLOMERATE_TREE_MAX_EDGES", "1000000")?,
            agglomerate_graph_max_edges: env
                .parse("WK_DS_AGGLOMERATE_GRAPH_MAX_EDGES", "10000000")?,
            data_vault_credentials,
            skipped_data_vault_credentials,
            slack_notifications: SlackNotificationsConfig {
                uri: Secret(slack_uri),
                verbose_logging_enabled: env
                    .bool("WK_DS_SLACK_NOTIFICATIONS_VERBOSE_LOGGING_ENABLED", "false")?,
            },
        })
    }

    pub fn uses_default_key(&self) -> bool {
        self.key.expose() == DEFAULT_KEY
    }
}

struct Env<'a>(&'a HashMap<String, String>);

impl Env<'_> {
    fn get(&self, name: &str, default: &str) -> String {
        self.0
            .get(name)
            .cloned()
            .unwrap_or_else(|| default.to_owned())
    }

    fn parse<T: std::str::FromStr>(&self, name: &str, default: &str) -> Result<T, ConfigError> {
        self.get(name, default)
            .trim()
            .parse()
            .map_err(|_| ConfigError(format!("{name} has an invalid value")))
    }

    fn positive(&self, name: &str, default: &str) -> Result<u64, ConfigError> {
        match self.parse::<u64>(name, default)? {
            0 => Err(ConfigError(format!("{name} must be positive"))),
            value => Ok(value),
        }
    }

    fn bool(&self, name: &str, default: &str) -> Result<bool, ConfigError> {
        parse_bool(&self.get(name, default))
            .ok_or_else(|| ConfigError(format!("{name} must be a boolean")))
    }

    fn duration(&self, name: &str, default: &str) -> Result<Duration, ConfigError> {
        parse_duration(&self.get(name, default))
            .ok_or_else(|| ConfigError(format!("{name} must be a duration such as `30 seconds`")))
    }

    fn positive_duration(&self, name: &str, default: &str) -> Result<Duration, ConfigError> {
        let value = self.duration(name, default)?;
        if value.is_zero() {
            return Err(ConfigError(format!("{name} must be positive")));
        }
        Ok(value)
    }

    fn size(&self, name: &str, default: &str) -> Result<u64, ConfigError> {
        parse_size(&self.get(name, default))
            .ok_or_else(|| ConfigError(format!("{name} must be a size such as `250M`")))
    }

    fn json<T: for<'de> Deserialize<'de>>(
        &self,
        name: &str,
        default: &str,
    ) -> Result<T, ConfigError> {
        serde_json::from_str(&self.get(name, default)).map_err(|e| {
            ConfigError(format!(
                "{name} must be a JSON value of the documented shape: {e}"
            ))
        })
    }

    fn http_uri(&self, name: &str, default: &str) -> Result<String, ConfigError> {
        let value = self.get(name, default);
        parse_http_url(&value).map_err(|e| ConfigError(format!("{name}: {e}")))?;
        Ok(value.trim_end_matches('/').to_owned())
    }
}

fn parse_http_url(value: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(value).map_err(|e| format!("invalid URL: {e}"))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("must be an http(s) URL with a host".into());
    }
    Ok(url)
}

/// HOCON booleans.
pub fn parse_bool(value: &str) -> Option<bool> {
    match value.trim() {
        "true" | "yes" | "on" => Some(true),
        "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

fn split_number_unit(value: &str) -> Option<(&str, &str)> {
    let value = value.trim();
    let end = value
        .find(|c: char| !(c.is_ascii_digit() || c == '.'))
        .unwrap_or(value.len());
    let (number, unit) = value.split_at(end);
    if number.is_empty() {
        return None;
    }
    Some((number, unit.trim()))
}

/// HOCON duration format (bare numbers are milliseconds).
pub fn parse_duration(value: &str) -> Option<Duration> {
    let (number, unit) = split_number_unit(value)?;
    let nanos_per_unit: f64 = match unit {
        "ns" | "nano" | "nanos" | "nanosecond" | "nanoseconds" => 1.0,
        "us" | "micro" | "micros" | "microsecond" | "microseconds" => 1e3,
        "" | "ms" | "milli" | "millis" | "millisecond" | "milliseconds" => 1e6,
        "s" | "second" | "seconds" => 1e9,
        "m" | "minute" | "minutes" => 60e9,
        "h" | "hour" | "hours" => 3600e9,
        "d" | "day" | "days" => 86400e9,
        _ => return None,
    };
    if let Ok(whole) = number.parse::<u64>() {
        // Exact integer arithmetic for the common case.
        let nanos = u128::from(whole) * nanos_per_unit as u128;
        let secs = u64::try_from(nanos / 1_000_000_000).ok()?;
        return Some(Duration::new(secs, (nanos % 1_000_000_000) as u32));
    }
    let nanos = number.parse::<f64>().ok()? * nanos_per_unit;
    Duration::try_from_secs_f64(nanos / 1e9).ok()
}

/// HOCON memory-size format (bare numbers are bytes; single letters are powers of two).
pub fn parse_size(value: &str) -> Option<u64> {
    let (number, unit) = split_number_unit(value)?;
    let factor: u64 = match unit {
        "" | "B" | "b" | "byte" | "bytes" => 1,
        "K" | "k" | "Ki" | "KiB" | "kibibyte" | "kibibytes" => 1 << 10,
        "kB" | "kilobyte" | "kilobytes" => 1_000,
        "M" | "m" | "Mi" | "MiB" | "mebibyte" | "mebibytes" => 1 << 20,
        "MB" | "megabyte" | "megabytes" => 1_000_000,
        "G" | "g" | "Gi" | "GiB" | "gibibyte" | "gibibytes" => 1 << 30,
        "GB" | "gigabyte" | "gigabytes" => 1_000_000_000,
        "T" | "t" | "Ti" | "TiB" | "tebibyte" | "tebibytes" => 1 << 40,
        "TB" | "terabyte" | "terabytes" => 1_000_000_000_000,
        _ => return None,
    };
    number.parse::<u64>().ok()?.checked_mul(factor)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawBaseDirectory {
    path: String,
    #[serde(default)]
    organization_id: Option<String>,
    allows_upload: bool,
    do_scan: bool,
}

/// Mirrors Scala `BaseDirConfigReader.read`.
fn parse_base_directories(raw: &str, cwd: &Path) -> Result<Vec<BaseDirectory>, ConfigError> {
    let entries: Vec<RawBaseDirectory> = serde_json::from_str(raw).map_err(|e| {
        ConfigError(format!(
            "WK_DS_BASE_DIRECTORIES must be a JSON array of {{path, organizationId, allowsUpload, doScan}}: {e}"
        ))
    })?;
    let mut parsed = Vec::with_capacity(entries.len());
    for entry in entries {
        let (path, is_remote) = normalize_base_path(&entry.path, cwd)
            .ok_or_else(|| ConfigError(format!("Invalid path: {}", entry.path)))?;
        parsed.push(BaseDirectory {
            path,
            is_remote,
            organization_id: entry.organization_id,
            allows_upload: entry.allows_upload,
            do_scan: entry.do_scan,
        });
    }
    if parsed.iter().any(|dir| dir.do_scan && dir.is_remote) {
        return Err(ConfigError(
            "WK_DS_BASE_DIRECTORIES: Cannot enable doScan on remote paths.".into(),
        ));
    }
    for a in &parsed {
        for b in &parsed {
            if a.path != b.path && path_starts_with(&a.path, &b.path) {
                return Err(ConfigError(format!(
                    "WK_DS_BASE_DIRECTORIES: Configured path {} is a subpath of {}. Configured base directories must not be nested.",
                    a.path, b.path
                )));
            }
        }
    }
    if parsed.is_empty() {
        return Err(ConfigError(
            "WK_DS_BASE_DIRECTORIES: The config does not contain any baseDirectory entries. At least one is required."
                .into(),
        ));
    }
    Ok(parsed)
}

/// Subset of Scala `UPath.fromString(..).toAbsolute` needed for base directories:
/// local paths are made absolute and lexically normalized, remote URIs are segment-normalized.
/// Zip-entry paths and the full UPath model follow in DS1b.
fn normalize_base_path(literal: &str, cwd: &Path) -> Option<(String, bool)> {
    if let Some((scheme, rest)) = literal.split_once("://") {
        if scheme.is_empty() {
            return None;
        }
        if scheme.contains("file") {
            let path = Path::new(rest);
            if !path.is_absolute() {
                return None;
            }
            return Some((normalize_local(path).to_string_lossy().into_owned(), false));
        }
        let mut segments: Vec<&str> = Vec::new();
        for segment in rest.split('/') {
            match segment {
                "" | "." => {}
                ".." => {
                    segments.pop();
                }
                other => segments.push(other),
            }
        }
        if segments.is_empty() {
            return None;
        }
        return Some((format!("{scheme}://{}", segments.join("/")), true));
    }
    if literal.is_empty() {
        return None;
    }
    let path = Path::new(literal);
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    };
    Some((
        normalize_local(&absolute).to_string_lossy().into_owned(),
        false,
    ))
}

fn normalize_local(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

fn path_starts_with(path: &str, prefix: &str) -> bool {
    path == prefix
        || path
            .strip_prefix(prefix)
            .is_some_and(|rest| rest.starts_with('/') || prefix.ends_with('/'))
}

#[derive(Deserialize)]
struct RawCredential {
    #[serde(rename = "type")]
    kind: Option<String>,
    name: Option<String>,
    identifier: Option<String>,
    secret: Option<String>,
}

/// Mirrors Scala `CredentialConfigReader.getCredential`: incomplete entries are dropped (counted), not fatal.
fn parse_credentials(raw: &str) -> Result<(Vec<DataVaultCredential>, usize), ConfigError> {
    // Do not include serde's message: it can quote parts of the secret-bearing input.
    let entries: Vec<RawCredential> = serde_json::from_str(raw).map_err(|_| {
        ConfigError(
            "WK_DS_DATA_VAULTS_CREDENTIALS must be a JSON array of {type, name, identifier, secret} objects with string values"
                .into(),
        )
    })?;
    let total = entries.len();
    let credentials: Vec<DataVaultCredential> = entries
        .into_iter()
        .filter_map(|entry| {
            let name = entry.name?;
            match entry.kind?.as_str() {
                "S3AccessKey" => Some(DataVaultCredential::S3AccessKey {
                    name,
                    key_id: entry.identifier?,
                    secret: Secret(entry.secret?),
                }),
                "HttpBasicAuth" => Some(DataVaultCredential::HttpBasicAuth {
                    name,
                    username: entry.identifier?,
                    password: Secret(entry.secret?),
                }),
                "GoogleServiceAccount" => {
                    let secret = entry.secret?;
                    serde_json::from_str::<serde_json::Value>(&secret).ok()?;
                    Some(DataVaultCredential::GoogleServiceAccount {
                        name,
                        secret_json: Secret(secret),
                    })
                }
                "HttpToken" => Some(DataVaultCredential::HttpToken {
                    name,
                    token: Secret(entry.secret?),
                }),
                _ => None,
            }
        })
        .collect();
    let skipped = total - credentials.len();
    Ok((credentials, skipped))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cwd() -> PathBuf {
        PathBuf::from("/srv/wk")
    }

    fn load(pairs: &[(&str, &str)]) -> Result<DatastoreConfig, ConfigError> {
        let values = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        DatastoreConfig::from_values(&values, &cwd())
    }

    #[test]
    fn defaults_match_standalone_datastore_conf() {
        let config = DatastoreConfig::defaults(&cwd());
        assert_eq!(config.http.uri, "http://localhost:9090");
        assert_eq!(config.http.port, 9090);
        assert_eq!(config.http.address.to_string(), "0.0.0.0");
        assert_eq!(config.http.request_timeout, Duration::from_secs(10_000));
        assert_eq!(config.http.max_memory_buffer, 250 << 20);
        assert_eq!(config.http.max_disk_buffer, 1 << 30);
        assert_eq!(config.key.expose(), "something-secur3");
        assert!(config.uses_default_key());
        assert_eq!(config.name, "standalone-9090");
        assert_eq!(config.webknossos.uri, "http://localhost:9000");
        assert_eq!(config.webknossos.ping_interval, Duration::from_secs(600));
        assert_eq!(
            config.base_directories,
            vec![BaseDirectory {
                path: "/srv/wk/binaryData".into(),
                is_remote: false,
                organization_id: None,
                allows_upload: true,
                do_scan: true,
            }]
        );
        assert!(config.local_directory_whitelist.is_empty());
        assert!(!config.write_virtual_datasets_mirror);
        assert!(config.watch_file_system.enabled);
        assert_eq!(config.watch_file_system.interval, Duration::from_secs(60));
        assert_eq!(
            config.watch_file_system.initial_delay,
            Duration::from_secs(5)
        );
        assert!(!config.upload_delete_temporary_files_after_upload);
        assert_eq!(config.cache.mapping_max_entries, 5);
        assert_eq!(
            config.cache.image_array_chunks_max_size_bytes,
            2_000_000_000
        );
        assert_eq!(config.cache.agglomerate_file.max_file_handle_entries, 15);
        assert_eq!(
            config.cache.agglomerate_file.max_segment_id_entries,
            625_000
        );
        assert_eq!(config.cache.agglomerate_file.block_size, 512);
        assert_eq!(
            config.cache.agglomerate_file.cumsum_max_reader_range,
            1_310_720
        );
        assert_eq!(config.ad_hoc_mesh.timeout, Duration::from_secs(30));
        assert_eq!(config.ad_hoc_mesh.actor_pool_size, 8);
        assert_eq!(config.redis.authority(), "localhost:6379");
        assert_eq!(config.agglomerate_tree_max_edges, 1_000_000);
        assert_eq!(config.agglomerate_graph_max_edges, 10_000_000);
        assert!(config.data_vault_credentials.is_empty());
        assert_eq!(config.skipped_data_vault_credentials, 0);
        assert!(config.slack_notifications.uri.expose().is_empty());
        assert!(!config.slack_notifications.verbose_logging_enabled);
    }

    #[test]
    fn overrides_are_parsed() {
        let config = load(&[
            ("WK_DS_HTTP_PORT", "9191"),
            ("WK_DS_HTTP_URI", "https://ds.example.org/"),
            ("WK_DS_HTTP_ADDRESS", "127.0.0.1"),
            ("WK_DS_KEY", "k3y"),
            ("WK_DS_NAME", "ds-1"),
            ("WK_DS_WEBKNOSSOS_PING_INTERVAL", "2 hours"),
            ("WK_DS_WATCH_FILE_SYSTEM_ENABLED", "off"),
            ("WK_DS_WATCH_FILE_SYSTEM_INITIAL_DELAY", "0"),
            ("WK_DS_AD_HOC_MESH_TIMEOUT", "1500ms"),
            ("WK_DS_PARSER_MAX_DISK_BUFFER", "2GB"),
            ("WK_DS_REDIS_ADDRESS", "redis"),
            ("WK_DS_REDIS_PORT", "6380"),
            ("WK_DS_LOCAL_DIRECTORY_WHITELIST", r#"["/data/a","/data/b"]"#),
            (
                "WK_DS_BASE_DIRECTORIES",
                r#"[{"path":"./data/../binaryData/","organizationId":null,"allowsUpload":true,"doScan":true},
                    {"path":"s3://minio:9000/bucket//orga/","organizationId":"orga","allowsUpload":true,"doScan":false},
                    {"path":"file:///mnt/x","allowsUpload":false,"doScan":true}]"#,
            ),
        ])
        .unwrap();
        assert_eq!(config.http.port, 9191);
        assert_eq!(config.http.uri, "https://ds.example.org");
        assert!(!config.uses_default_key());
        assert_eq!(config.webknossos.ping_interval, Duration::from_secs(7200));
        assert!(!config.watch_file_system.enabled);
        assert!(config.watch_file_system.initial_delay.is_zero());
        assert_eq!(config.ad_hoc_mesh.timeout, Duration::from_millis(1500));
        assert_eq!(config.http.max_disk_buffer, 2_000_000_000);
        assert_eq!(config.redis.authority(), "redis:6380");
        assert_eq!(config.local_directory_whitelist, ["/data/a", "/data/b"]);
        let paths: Vec<_> = config
            .base_directories
            .iter()
            .map(|d| (d.path.as_str(), d.is_remote, d.organization_id.as_deref()))
            .collect();
        assert_eq!(
            paths,
            [
                ("/srv/wk/binaryData", false, None),
                ("s3://minio:9000/bucket/orga", true, Some("orga")),
                ("/mnt/x", false, None),
            ]
        );
    }

    #[test]
    fn invalid_values_are_rejected() {
        for (name, value) in [
            ("WK_DS_HTTP_PORT", "0"),
            ("WK_DS_HTTP_PORT", "70000"),
            ("WK_DS_HTTP_URI", "localhost:9090"),
            ("WK_DS_WEBKNOSSOS_URI", "ftp://wk"),
            ("WK_DS_KEY", ""),
            ("WK_DS_NAME", ""),
            ("WK_DS_WEBKNOSSOS_PING_INTERVAL", "0s"),
            ("WK_DS_WEBKNOSSOS_PING_INTERVAL", "10 fortnights"),
            ("WK_DS_WATCH_FILE_SYSTEM_ENABLED", "maybe"),
            ("WK_DS_CACHE_MAPPING_MAX_ENTRIES", "-1"),
            ("WK_DS_AD_HOC_MESH_ACTOR_POOL_SIZE", "0"),
            ("WK_DS_PARSER_MAX_MEMORY_BUFFER", "12 parsecs"),
            ("WK_DS_REDIS_PORT", "0"),
            ("WK_DS_LOCAL_DIRECTORY_WHITELIST", "/a,/b"),
            ("WK_DS_BASE_DIRECTORIES", "[]"),
            (
                "WK_DS_BASE_DIRECTORIES",
                r#"[{"path":"x","allowsUpload":true}]"#,
            ),
            (
                "WK_DS_BASE_DIRECTORIES",
                r#"[{"path":"s3://e/b","allowsUpload":true,"doScan":true}]"#,
            ),
            (
                "WK_DS_BASE_DIRECTORIES",
                r#"[{"path":"/a","allowsUpload":true,"doScan":true},{"path":"/a/b","allowsUpload":true,"doScan":true}]"#,
            ),
            (
                "WK_DS_BASE_DIRECTORIES",
                r#"[{"path":"file://relative","allowsUpload":true,"doScan":true}]"#,
            ),
            ("WK_DS_DATA_VAULTS_CREDENTIALS", "{}"),
            ("WK_DS_SLACK_NOTIFICATIONS_URI", "not a url"),
        ] {
            assert!(
                load(&[(name, value)]).is_err(),
                "{name}={value} must be rejected"
            );
        }
    }

    #[test]
    fn sibling_base_directories_with_common_prefix_are_not_nested() {
        let config = load(&[(
            "WK_DS_BASE_DIRECTORIES",
            r#"[{"path":"/data/a","allowsUpload":true,"doScan":true},{"path":"/data/ab","allowsUpload":true,"doScan":true}]"#,
        )])
        .unwrap();
        assert_eq!(config.base_directories.len(), 2);
    }

    #[test]
    fn credentials_follow_scala_reader_and_are_redacted() {
        let config = load(&[(
            "WK_DS_DATA_VAULTS_CREDENTIALS",
            r#"[{"type":"S3AccessKey","name":"s3://bucket","identifier":"AKIA","secret":"s3-secret-value"},
                {"type":"HttpBasicAuth","name":"https://host","identifier":"user","secret":"basic-secret-value"},
                {"type":"GoogleServiceAccount","name":"gs://b","secret":"{\"private_key\":\"gcs-secret-value\"}"},
                {"type":"GoogleServiceAccount","name":"gs://c","secret":"not json"},
                {"type":"HttpToken","name":"https://t","secret":"token-secret-value"},
                {"type":"S3AccessKey","name":"s3://missing-secret","identifier":"x"},
                {"type":"Unknown","name":"x","secret":"y"},
                {"name":"no-type","secret":"z"}]"#,
        )])
        .unwrap();
        assert_eq!(config.data_vault_credentials.len(), 4);
        assert_eq!(config.skipped_data_vault_credentials, 4);
        assert_eq!(
            config.data_vault_credentials[0],
            DataVaultCredential::S3AccessKey {
                name: "s3://bucket".into(),
                key_id: "AKIA".into(),
                secret: Secret::new("s3-secret-value"),
            }
        );
        let debug = format!("{config:?}");
        for secret in [
            "s3-secret-value",
            "basic-secret-value",
            "gcs-secret-value",
            "token-secret-value",
            "something-secur3",
        ] {
            assert!(!debug.contains(secret), "Debug output leaks {secret}");
        }
        assert!(debug.contains("[redacted]"));
    }

    #[test]
    fn credential_parse_errors_do_not_echo_input() {
        let error = load(&[(
            "WK_DS_DATA_VAULTS_CREDENTIALS",
            r#"[{"type":"S3AccessKey","secret":12345678}]"#,
        )])
        .unwrap_err();
        assert!(!error.0.contains("12345678"));
    }

    #[test]
    fn slack_uri_is_redacted() {
        let config = load(&[(
            "WK_DS_SLACK_NOTIFICATIONS_URI",
            "https://hooks.slack.com/services/T000/B000/slack-secret-token",
        )])
        .unwrap();
        let debug = format!("{config:?}");
        assert!(!debug.contains("slack-secret-token"));
        assert!(debug.contains("uri_configured: true"));
    }

    #[test]
    fn hocon_durations_and_sizes() {
        assert_eq!(parse_duration("10 minutes"), Some(Duration::from_secs(600)));
        assert_eq!(parse_duration("1 minute"), Some(Duration::from_secs(60)));
        assert_eq!(parse_duration("2 hours"), Some(Duration::from_secs(7200)));
        assert_eq!(parse_duration("10000s"), Some(Duration::from_secs(10_000)));
        assert_eq!(parse_duration("250"), Some(Duration::from_millis(250)));
        assert_eq!(parse_duration("1.5 s"), Some(Duration::from_millis(1500)));
        assert_eq!(parse_duration("1 d"), Some(Duration::from_secs(86_400)));
        assert_eq!(parse_duration("s"), None);
        assert_eq!(parse_duration("5 lightyears"), None);
        assert_eq!(parse_size("250M"), Some(250 * 1024 * 1024));
        assert_eq!(parse_size("1G"), Some(1 << 30));
        assert_eq!(parse_size("1GB"), Some(1_000_000_000));
        assert_eq!(parse_size("512"), Some(512));
        assert_eq!(parse_size("99999999999T"), None);
        assert_eq!(parse_bool(" yes "), Some(true));
        assert_eq!(parse_bool("1"), None);
    }
}
