//! Scala `S3DataVault`, the client-relevant parts of `storage/S3ClientPool` and
//! `helpers/S3UriUtils`. Requests go through the `object_store` crate's S3 client; this module
//! keeps WEBKNOSSOS' uri styles and the client choices of `S3ClientPool`:
//! - credentials: the vault credential, else `AWS_ACCESS_KEY_ID`/`AWS_ACCESS_KEY` environment
//!   credentials, else anonymous (unsigned requests);
//! - Amazon hosts: the region of a regional endpoint uri, else the bucket's region from one
//!   `HeadBucket` request (Scala `getBucketRegion`), falling back to `us-east-1`;
//! - non-Amazon path-style hosts (custom endpoints like MinIO): path-style requests against
//!   `https://<authority>` if a probe `GET` over HTTPS gets any response, else `http://`; signing
//!   region per `AwsHostNameUtils.parseSigningRegion(authority, "s3")`, default `us-east-1`.

use std::{
    collections::HashMap,
    fmt,
    sync::{Arc, LazyLock, Mutex, PoisonError},
    time::{Duration, Instant},
};

use object_store::{
    aws::{AmazonS3Builder, AwsAuthorizer, AwsCredential},
    client::HttpRequestBody,
};
use reqwest::Client;
use tokio::sync::OnceCell;

use super::{
    BoxFuture, ByteRange, DataVault, RawRead, RemoteUri, RetryPolicy, ToRemoteUri, UPath,
    VaultError, VaultResult,
    cloud::{self, CloudObjectStore, StoreResult},
};
use crate::error::DsError;

mod upload;

pub const SCHEME_S3: &str = "s3";
/// Region of the SDK clients in Scala (`Region.US_EAST_1`).
pub const DEFAULT_REGION: &str = "us-east-1";
/// DNS host names cannot exceed this length (Scala `maxHostLength`).
const MAX_HOST_LENGTH: usize = 253;
/// Timeout of the custom-endpoint HTTPS probe (Play WS would wait for its global timeout).
const PROTOCOL_PROBE_TIMEOUT: Duration = Duration::from_secs(30);
/// Timeout of the bucket-region lookup.
const REGION_LOOKUP_TIMEOUT: Duration = Duration::from_secs(30);

// ---------------------------------------------------------------------------------------------
// S3UriUtils
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
enum S3UriStyle {
    /// `s3://bucket-name/key-name`
    Short,
    /// `s3://bucket-name.s3.region.amazonaws.com/key-name`
    VirtualHosted(String),
    /// `s3://endpoint/bucket-name/key-name`
    Path,
}

fn is_word_dot_dash(s: &str) -> bool {
    !s.is_empty()
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'-'))
}

/// Scala `virtualHostedStyleHostRegex` `^(.+?)\.s3([.-][\w.-]+)?\.amazonaws\.com$`.
fn virtual_hosted_bucket(host: &str) -> Option<String> {
    let rest = host.strip_suffix(".amazonaws.com")?;
    (1..rest.len())
        .filter(|&i| rest[i..].starts_with(".s3"))
        .find(|&i| {
            let after = &rest[i + 3..];
            after.is_empty()
                || ((after.starts_with('.') || after.starts_with('-'))
                    && is_word_dot_dash(&after[1..]))
        })
        .map(|i| rest[..i].to_owned())
}

/// Scala `amazonEndpointHostRegex` `^s3([.-][\w.-]+)?\.amazonaws\.com$`.
fn is_amazon_endpoint_host(host: &str) -> bool {
    host.strip_suffix(".amazonaws.com").is_some_and(|rest| {
        rest == "s3"
            || ((rest.starts_with("s3.") || rest.starts_with("s3-"))
                && is_word_dot_dash(&rest[3..]))
    })
}

fn style_of(uri: &RemoteUri) -> Option<S3UriStyle> {
    let host = uri
        .host()
        .filter(|h| !h.is_empty() && h.len() <= MAX_HOST_LENGTH)?;
    Some(if let Some(bucket) = virtual_hosted_bucket(host) {
        S3UriStyle::VirtualHosted(bucket)
    } else if is_amazon_endpoint_host(host)
        || uri.port().is_some()
        || host == "localhost"
        || host.contains('.')
    {
        S3UriStyle::Path
    } else {
        S3UriStyle::Short
    })
}

fn path_without_leading_slash(uri: &RemoteUri) -> String {
    let path = uri.path();
    path.strip_prefix('/').unwrap_or(&path).to_owned()
}

fn first_path_segment_and_rest(uri: &RemoteUri) -> (Option<String>, String) {
    let path = path_without_leading_slash(uri);
    match path.split_once('/') {
        None => (Some(path).filter(|p| !p.is_empty()), String::new()),
        Some((first, rest)) => (
            Some(first.to_owned()).filter(|p| !p.is_empty()),
            rest.to_owned(),
        ),
    }
}

/// Scala `S3UriUtils.hostBucketFromUri`.
pub fn host_bucket_from_uri(uri: &RemoteUri) -> Option<String> {
    match style_of(uri)? {
        S3UriStyle::Short => uri.host().map(str::to_owned),
        S3UriStyle::VirtualHosted(bucket) => Some(bucket),
        S3UriStyle::Path => first_path_segment_and_rest(uri).0,
    }
}

/// Scala `S3UriUtils.objectKeyFromUri`.
pub fn object_key_from_uri(uri: &RemoteUri) -> Result<String, DsError> {
    match style_of(uri) {
        Some(S3UriStyle::Short | S3UriStyle::VirtualHosted(_)) => {
            Ok(path_without_leading_slash(uri))
        }
        Some(S3UriStyle::Path) => Ok(first_path_segment_and_rest(uri).1),
        None => Err(DsError::failure(format!("Not a valid s3 uri: {uri}"))),
    }
}

fn check_scheme_is_s3(uri: &RemoteUri) -> Result<(), DsError> {
    if uri.scheme() == SCHEME_S3 {
        Ok(())
    } else {
        Err(DsError::failure(format!(
            "Remote path has wrong schema for this feature. Expected {SCHEME_S3}, got {}.",
            uri.scheme()
        )))
    }
}

/// Scala `S3UriUtils.hostBucketFromUPath`.
pub fn host_bucket_from_upath(upath: &UPath) -> Result<String, DsError> {
    let uri = upath.to_remote_uri()?;
    check_scheme_is_s3(&uri)?;
    host_bucket_from_uri(&uri).ok_or_else(DsError::empty)
}

/// Scala `S3UriUtils.objectKeyFromUPath`.
pub fn object_key_from_upath(upath: &UPath) -> Result<String, DsError> {
    let uri = upath.to_remote_uri()?;
    check_scheme_is_s3(&uri)?;
    object_key_from_uri(&uri)
}

/// Scala `S3UriUtils.isNonAmazonHost`: path-style uri whose host is not an Amazon host.
pub fn is_non_amazon_host(uri: &RemoteUri) -> bool {
    style_of(uri) == Some(S3UriStyle::Path)
        && !uri.host().is_some_and(|h| h.ends_with(".amazonaws.com"))
}

/// Scala `S3UriUtils.isShortStyle`.
pub fn is_short_style(uri: &RemoteUri) -> bool {
    uri.scheme() == SCHEME_S3 && style_of(uri) == Some(S3UriStyle::Short)
}

/// Scala `S3UriUtils.awsEndpointHost`.
pub fn aws_endpoint_host(region: Option<&str>) -> String {
    region.map_or_else(
        || "s3.amazonaws.com".to_owned(),
        |r| format!("s3.{r}.amazonaws.com"),
    )
}

/// Scala `S3UriUtils.withEndpointHost`: `s3://bucket/key` to `s3://endpoint/bucket/key`.
pub fn with_endpoint_host(short_style_uri: &RemoteUri, endpoint_host: &str) -> String {
    format!(
        "{}://{endpoint_host}/{}{}",
        short_style_uri.scheme(),
        short_style_uri.host().unwrap_or("null"),
        short_style_uri.raw_path()
    )
}

/// Scala `S3UriUtils.uriLiteralForObjectKey`: path-style uris keep their endpoint.
pub fn uri_literal_for_object_key(uri: &RemoteUri, bucket: &str, object_key: &str) -> String {
    if style_of(uri) == Some(S3UriStyle::Path) {
        format!(
            "{}://{}/{bucket}/{object_key}",
            uri.scheme(),
            uri.authority().unwrap_or("null")
        )
    } else {
        format!("{}://{bucket}/{object_key}", uri.scheme())
    }
}

/// AWS SDK `AwsHostNameUtils.parseSigningRegion(authority, "s3")` for non-Amazon hosts: the
/// regex `^(?:.+\.)?s3[.-]([a-z0-9-]+)\.` (greedy prefix, so the last candidate wins).
pub fn parse_signing_region(authority: &str) -> Option<String> {
    let bytes = authority.as_bytes();
    let candidates = (2..bytes.len())
        .rev()
        .filter(|&p| bytes[p - 1] == b'.')
        .chain(std::iter::once(0));
    for position in candidates {
        let rest = &authority[position..];
        let Some(after) = rest
            .strip_prefix("s3.")
            .or_else(|| rest.strip_prefix("s3-"))
        else {
            continue;
        };
        let run = after
            .bytes()
            .take_while(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
            .count();
        if run > 0 && after.as_bytes().get(run) == Some(&b'.') {
            return Some(after[..run].to_owned());
        }
    }
    None
}

// ---------------------------------------------------------------------------------------------
// Vault
// ---------------------------------------------------------------------------------------------

/// Retries of read, listing and bucket requests: the AWS SDK v2 standard retry mode of Scala's
/// default (non-upload) S3 client.
pub const DEFAULT_READ_RETRY: RetryPolicy = RetryPolicy {
    attempts: 3,
    initial_delay: Duration::from_millis(100),
};

/// Retries of managed uploads (Scala's upload S3 client `StandardRetryStrategy`).
pub const UPLOAD_RETRY: RetryPolicy = RetryPolicy {
    attempts: 10,
    initial_delay: Duration::from_millis(100),
};

/// Static AWS credentials.
#[derive(Clone, PartialEq, Eq, Hash)]
pub struct AwsCredentials {
    pub access_key_id: String,
    pub secret_access_key: String,
    /// `AWS_SESSION_TOKEN` (sent as `x-amz-security-token`).
    pub session_token: Option<String>,
}

impl AwsCredentials {
    pub fn new(access_key_id: impl Into<String>, secret_access_key: impl Into<String>) -> Self {
        Self {
            access_key_id: access_key_id.into(),
            secret_access_key: secret_access_key.into(),
            session_token: None,
        }
    }

    /// Scala `EnvironmentVariableCredentialsProvider` (only consulted when no credential is set
    /// and `AWS_ACCESS_KEY_ID` or `AWS_ACCESS_KEY` exists). `Err` when the secret is missing.
    pub fn from_env_vars(get: impl Fn(&str) -> Option<String>) -> Option<Result<Self, String>> {
        let non_empty = |name: &str| get(name).filter(|v| !v.trim().is_empty());
        if get("AWS_ACCESS_KEY_ID").is_none() && get("AWS_ACCESS_KEY").is_none() {
            return None;
        }
        let Some(access_key_id) =
            non_empty("AWS_ACCESS_KEY_ID").or_else(|| non_empty("AWS_ACCESS_KEY"))
        else {
            return Some(Err(
                "Unable to load credentials from system settings. Access key must be specified either via environment variable (AWS_ACCESS_KEY_ID) or system property (aws.accessKeyId).".into(),
            ));
        };
        let Some(secret_access_key) =
            non_empty("AWS_SECRET_ACCESS_KEY").or_else(|| non_empty("AWS_SECRET_KEY"))
        else {
            return Some(Err(
                "Unable to load credentials from system settings. Secret key must be specified either via environment variable (AWS_SECRET_ACCESS_KEY) or system property (aws.secretAccessKey).".into(),
            ));
        };
        Some(Ok(Self {
            access_key_id: access_key_id.trim().to_owned(),
            secret_access_key: secret_access_key.trim().to_owned(),
            session_token: non_empty("AWS_SESSION_TOKEN").map(|t| t.trim().to_owned()),
        }))
    }
}

impl fmt::Debug for AwsCredentials {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AwsCredentials")
            .field("access_key_id", &self.access_key_id)
            .field("secret", &"[redacted]")
            .finish()
    }
}

/// Process-wide S3 settings (Scala reads them from the environment / SDK defaults).
#[derive(Debug, Clone)]
pub struct S3Options {
    /// Environment credentials, used when a vault has no credential (Scala
    /// `EnvironmentVariableCredentialsProvider`). `Err` = present but incomplete.
    pub env_credentials: Option<Result<AwsCredentials, String>>,
    /// Base URL replacing the Amazon S3 endpoints (path-style). Only for tests.
    pub aws_endpoint_override: Option<String>,
    /// Retries of every request (managed uploads use [`UPLOAD_RETRY`]).
    pub read_retry: RetryPolicy,
}

impl Default for S3Options {
    fn default() -> Self {
        Self {
            env_credentials: None,
            aws_endpoint_override: None,
            read_retry: DEFAULT_READ_RETRY,
        }
    }
}

impl S3Options {
    pub fn from_env() -> Self {
        Self {
            env_credentials: AwsCredentials::from_env_vars(|name| std::env::var(name).ok()),
            ..Self::default()
        }
    }
}

#[derive(Debug)]
enum Endpoint {
    /// Amazon S3; `override_base` replaces the regional endpoints.
    Aws { override_base: Option<String> },
    /// Custom endpoint (forced path style).
    Custom { authority: String, region: String },
}

/// HTTP client for the bucket-region lookup and the custom-endpoint protocol probe (object
/// requests use `object_store`'s own client).
pub fn build_s3_http_client() -> Client {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(120))
        .build()
        .unwrap_or_else(|_| Client::new())
}

pub struct S3DataVault {
    uri: RemoteUri,
    bucket: Option<String>,
    credentials: Result<Option<AwsCredentials>, String>,
    client: Client,
    endpoint: Endpoint,
    retry: RetryPolicy,
    /// Built on first use: it needs the bucket region or the endpoint protocol.
    store: OnceCell<StoreResult>,
}

impl fmt::Debug for S3DataVault {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("S3DataVault")
            .field("uri", &self.uri.as_str())
            .field("bucket", &self.bucket)
            .field(
                "access_key_id",
                &self
                    .credentials
                    .as_ref()
                    .ok()
                    .and_then(Option::as_ref)
                    .map(|c| c.access_key_id.as_str()),
            )
            .field("endpoint", &self.endpoint)
            .finish()
    }
}

/// Bucket names that can be used as a virtual host over TLS.
fn is_virtual_host_compatible(bucket: &str) -> bool {
    (3..=63).contains(&bucket.len())
        && bucket
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && !bucket.starts_with('-')
        && !bucket.ends_with('-')
}

/// `HeadBucket` answers per request url (bucket regions never change), shared by all vaults so
/// that exploring a bucket and reading from it look its region up once.
static BUCKET_REGIONS: LazyLock<Mutex<HashMap<String, Option<String>>>> =
    LazyLock::new(Mutex::default);

fn cached_bucket_region(url: &str) -> Option<Option<String>> {
    BUCKET_REGIONS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get(url)
        .cloned()
}

/// SigV4 headers of an unpayloaded `HEAD` request in `us-east-1`.
fn signed_head_bucket_headers(url: &str, credentials: &AwsCredentials) -> Vec<(String, String)> {
    let credential = AwsCredential {
        key_id: credentials.access_key_id.clone(),
        secret_key: credentials.secret_access_key.clone(),
        token: credentials.session_token.clone(),
    };
    let Ok(mut request) = axum::http::Request::head(url).body(HttpRequestBody::empty()) else {
        return Vec::new();
    };
    cloud::install_crypto_provider();
    if AwsAuthorizer::new(&credential, "s3", DEFAULT_REGION)
        .try_authorize(&mut request, None)
        .is_err()
    {
        return Vec::new();
    }
    request
        .headers()
        .iter()
        .filter_map(|(name, value)| Some((name.to_string(), value.to_str().ok()?.to_owned())))
        .collect()
}

impl S3DataVault {
    /// Scala `S3DataVault.create` + `S3ClientPool.getS3Client`: `credential` is the S3 access key
    /// (`S3DataVault.s3CredentialFrom`), `None` falls back to `options.env_credentials`/anonymous.
    pub fn new(
        uri: RemoteUri,
        credential: Option<AwsCredentials>,
        client: Client,
        options: &S3Options,
    ) -> Self {
        let credentials = match credential {
            Some(credential) => Ok(Some(credential)),
            None => match &options.env_credentials {
                Some(Ok(env)) => Ok(Some(env.clone())),
                Some(Err(message)) => Err(message.clone()),
                None => Ok(None),
            },
        };
        let endpoint = if is_non_amazon_host(&uri) {
            let authority = uri.authority().unwrap_or_default().to_owned();
            Endpoint::Custom {
                region: parse_signing_region(&authority).unwrap_or_else(|| DEFAULT_REGION.into()),
                authority,
            }
        } else {
            Endpoint::Aws {
                override_base: options
                    .aws_endpoint_override
                    .as_ref()
                    .map(|b| b.trim_end_matches('/').to_owned()),
            }
        };
        Self {
            bucket: host_bucket_from_uri(&uri),
            uri,
            credentials,
            client,
            endpoint,
            retry: options.read_retry,
            store: OnceCell::new(),
        }
    }

    fn bucket(&self) -> VaultResult<&str> {
        self.bucket.as_deref().ok_or_else(|| {
            VaultError::exception(format!(
                "java.lang.Exception: Could not parse S3 bucket for {}",
                self.uri
            ))
        })
    }

    /// The `object_store` client of this vault, built on first use.
    async fn store(&self) -> VaultResult<&dyn CloudObjectStore> {
        let bucket = self.bucket()?;
        let store = self
            .store
            .get_or_init(|| async { self.build_store(bucket).await })
            .await;
        cloud::store_or_failure(store)
    }

    async fn build_store(&self, bucket: &str) -> StoreResult {
        let mut builder = AmazonS3Builder::new()
            .with_bucket_name(bucket)
            .with_retry(cloud::retry_config(self.retry));
        let allow_http = match &self.endpoint {
            Endpoint::Custom { authority, region } => {
                let protocol = self.custom_protocol(authority).await;
                builder = builder
                    .with_endpoint(format!("{protocol}://{authority}"))
                    .with_region(region);
                protocol == "http"
            }
            Endpoint::Aws { override_base } => {
                let lookup = match self.region_from_uri() {
                    Some(region) => Ok(region),
                    None => self.bucket_region().await,
                };
                let region = match lookup {
                    Ok(region) => region,
                    Err(error) => {
                        if !error.is_not_found() {
                            tracing::info!(bucket, "Could not look up S3 bucket region: {error}");
                        }
                        DEFAULT_REGION.to_owned()
                    }
                };
                builder = builder.with_region(region);
                match override_base {
                    Some(base) => {
                        builder = builder.with_endpoint(base);
                        base.starts_with("http://")
                    }
                    None => {
                        builder = builder
                            .with_virtual_hosted_style_request(is_virtual_host_compatible(bucket));
                        false
                    }
                }
            }
        };
        builder = match self.credentials.clone()? {
            Some(credentials) => {
                let builder = builder
                    .with_access_key_id(credentials.access_key_id)
                    .with_secret_access_key(credentials.secret_access_key);
                match credentials.session_token {
                    Some(token) => builder.with_token(token),
                    None => builder,
                }
            }
            None => builder.with_skip_signature(true),
        };
        builder
            .with_client_options(cloud::client_options(allow_http))
            .build()
            .map(|store| Arc::new(store) as Arc<dyn CloudObjectStore>)
            .map_err(|error| error.to_string())
    }

    /// Scala `S3ClientPool.determineProtocol`: `https` if a `GET https://<authority>` gets any
    /// response, else `http`.
    async fn custom_protocol(&self, authority: &str) -> &'static str {
        let probe = self
            .client
            .get(format!("https://{authority}"))
            .timeout(PROTOCOL_PROBE_TIMEOUT)
            .send()
            .await;
        if probe.is_ok() { "https" } else { "http" }
    }

    /// Scala `S3ClientPool.getBucketRegion`: the `x-amz-bucket-region` header of a `HeadBucket`
    /// request (signed with the vault's credentials for `us-east-1`; the header is present even
    /// for denied requests and region mismatches), `NotFound` if the response has none.
    pub async fn bucket_region(&self) -> VaultResult<String> {
        let bucket = self.bucket()?;
        let url = match &self.endpoint {
            Endpoint::Aws {
                override_base: Some(base),
            } => format!("{base}/{}", super::uri::uri_encode(bucket, true)),
            Endpoint::Aws {
                override_base: None,
            } if is_virtual_host_compatible(bucket) => format!("https://{bucket}.s3.amazonaws.com"),
            _ => format!(
                "https://s3.amazonaws.com/{}",
                super::uri::uri_encode(bucket, true)
            ),
        };
        if let Some(known) = cached_bucket_region(&url) {
            return known.ok_or(VaultError::NotFound);
        }
        let mut request = self.client.head(&url).timeout(REGION_LOOKUP_TIMEOUT);
        if let Some(credentials) = self.credentials.as_ref().ok().and_then(Option::as_ref) {
            for (name, value) in signed_head_bucket_headers(&url, credentials) {
                request = request.header(name, value);
            }
        }
        let response = request
            .send()
            .await
            .map_err(|e| VaultError::failure(format!("S3 bucket region lookup failed: {e}")))?;
        let region = response
            .headers()
            .get("x-amz-bucket-region")
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        // Only definitive answers are remembered, not throttling or server errors.
        let status = response.status();
        if region.is_some() || status.is_success() || matches!(status.as_u16(), 403 | 404) {
            BUCKET_REGIONS
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .insert(url, region.clone());
        }
        region.ok_or(VaultError::NotFound)
    }

    /// The region named by an Amazon regional endpoint uri (`s3.<region>.amazonaws.com`,
    /// `<bucket>.s3.<region>.amazonaws.com`), which needs no lookup.
    fn region_from_uri(&self) -> Option<String> {
        let host = self.uri.host()?;
        if !host.ends_with(".amazonaws.com") {
            return None;
        }
        parse_signing_region(host).filter(|region| region != "amazonaws")
    }

    fn object_key(path: &UPath) -> VaultResult<String> {
        object_key_from_upath(path).map_err(VaultError::Failure)
    }
}

impl DataVault for S3DataVault {
    fn read_bytes_encoding_and_range_header<'a>(
        &'a self,
        path: &'a UPath,
        range: ByteRange,
        _user_token: Option<&'a str>,
    ) -> BoxFuture<'a, VaultResult<RawRead>> {
        Box::pin(async move {
            let key = Self::object_key(path)?;
            let before = Instant::now();
            let result = async { cloud::read(self.store().await?, &key, range).await }.await;
            let authority = self.uri.authority().unwrap_or("null");
            let bucket = self.bucket.as_deref().unwrap_or("null");
            tracing::debug!(
                "S3 getObject request for s3://{authority}/{bucket}/{key} with range {range} took {} ms",
                before.elapsed().as_millis()
            );
            if let Err(VaultError::Failure(error)) = &result {
                tracing::warn!(
                    "Got failure {} for S3 getObject request s3://{authority}/{bucket}/{key}",
                    error.message
                );
            }
            result
        })
    }

    fn list_directory<'a>(
        &'a self,
        path: &'a UPath,
        max_items: usize,
        _user_token: Option<&'a str>,
    ) -> BoxFuture<'a, VaultResult<Vec<UPath>>> {
        Box::pin(async move {
            let prefix = Self::object_key(path)?;
            let bucket = self.bucket()?;
            // Common prefixes may filter out some results, so request a few more first.
            let keys =
                cloud::list_directory(self.store().await?, &prefix, Some(max_items + 5)).await?;
            keys.iter()
                .take(max_items)
                .map(|key| {
                    UPath::parse(&uri_literal_for_object_key(&self.uri, bucket, key))
                        .map_err(|e| VaultError::Failure(e.into()))
                })
                .collect()
        })
    }

    fn used_storage_bytes<'a>(
        &'a self,
        path: &'a UPath,
        _user_token: Option<&'a str>,
    ) -> BoxFuture<'a, VaultResult<u64>> {
        Box::pin(async move {
            let raw_prefix = Self::object_key(path)?;
            let prefix = if raw_prefix.ends_with('/') {
                raw_prefix
            } else {
                format!("{raw_prefix}/")
            };
            cloud::used_storage_bytes(self.store().await?, &prefix).await
        })
    }

    fn kind(&self) -> &'static str {
        "S3DataVault"
    }
}

#[cfg(test)]
mod datavault_s3_tests;
