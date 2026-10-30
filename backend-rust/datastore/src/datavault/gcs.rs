//! Scala `GoogleCloudDataVault`, over the `object_store` crate's GCS client.
//!
//! Authentication: the vault's service-account key (Scala `GoogleServiceAccountCredential`),
//! else the key file named by `GOOGLE_APPLICATION_CREDENTIALS`, else anonymous requests
//! (public buckets).
//!
//! Reads send `Accept-Encoding: gzip` so GCS never transcodes: the stored bytes are returned
//! with their stored `Content-Encoding` (Scala `shouldReturnRawInputStream(true)`), and
//! `VaultPath` decodes them.

use std::{sync::Arc, time::Duration};

use object_store::gcp::GoogleCloudStorageBuilder;
use reqwest::header::{ACCEPT_ENCODING, HeaderMap, HeaderValue};

use super::{
    BoxFuture, ByteRange, DataVault, RawRead, RemoteUri, RetryPolicy, ToRemoteUri, UPath,
    VaultError, VaultResult,
    cloud::{self, CloudObjectStore, StoreResult},
};

pub const DEFAULT_GCS_ENDPOINT: &str = "https://storage.googleapis.com";

/// google-cloud-storage's default `RetrySettings` (6 attempts, 1 s initial delay, multiplier 2),
/// which Scala's `StorageOptions` use for every vault request.
pub const DEFAULT_READ_RETRY: RetryPolicy = RetryPolicy {
    attempts: 6,
    initial_delay: Duration::from_secs(1),
};

/// Process-wide GCS settings.
#[derive(Debug, Clone)]
pub struct GcsOptions {
    /// Base URL of the storage API.
    pub endpoint: String,
    /// Application default credentials: the service-account key from
    /// `GOOGLE_APPLICATION_CREDENTIALS` (JSON text), used when a vault has no credential.
    pub default_service_account_json: Option<String>,
    pub read_retry: RetryPolicy,
}

impl Default for GcsOptions {
    fn default() -> Self {
        Self {
            endpoint: DEFAULT_GCS_ENDPOINT.into(),
            default_service_account_json: None,
            read_retry: DEFAULT_READ_RETRY,
        }
    }
}

impl GcsOptions {
    pub fn from_env() -> Self {
        Self {
            default_service_account_json: std::env::var("GOOGLE_APPLICATION_CREDENTIALS")
                .ok()
                .filter(|p| !p.is_empty())
                .and_then(|path| std::fs::read_to_string(path).ok()),
            ..Self::default()
        }
    }
}

pub struct GoogleCloudDataVault {
    uri: RemoteUri,
    /// Scala `uri.getAuthority` (bucket names may contain `_`, which `getHost` rejects).
    bucket: String,
    /// An unusable credential fails on use, like Scala's lazy `storageOptions`.
    store: StoreResult,
}

impl std::fmt::Debug for GoogleCloudDataVault {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GoogleCloudDataVault")
            .field("uri", &self.uri.as_str())
            .field("bucket", &self.bucket)
            .finish_non_exhaustive()
    }
}

fn build_store(bucket: &str, secret_json: Option<&str>, options: &GcsOptions) -> StoreResult {
    let endpoint = options.endpoint.trim_end_matches('/');
    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT_ENCODING, HeaderValue::from_static("gzip"));
    let client_options =
        cloud::client_options(endpoint.starts_with("http://")).with_default_headers(headers);
    let builder = GoogleCloudStorageBuilder::new()
        .with_bucket_name(bucket)
        .with_base_url(endpoint)
        .with_retry(cloud::retry_config(options.read_retry))
        .with_client_options(client_options);
    let builder = match secret_json {
        Some(json) => builder.with_service_account_key(json),
        None => builder.with_skip_signature(true),
    };
    builder
        .build()
        .map(|store| Arc::new(store) as Arc<dyn CloudObjectStore>)
        // object_store's credential errors name the problem, never key material.
        .map_err(|error| error.to_string())
}

impl GoogleCloudDataVault {
    /// Scala `GoogleCloudDataVault.create`: `secret_json` is the `GoogleServiceAccountCredential`
    /// secret (the service account key JSON).
    pub fn new(uri: RemoteUri, secret_json: Option<&str>, options: &GcsOptions) -> Self {
        let secret = secret_json.or(options.default_service_account_json.as_deref());
        let bucket = uri.authority().unwrap_or("null").to_owned();
        Self {
            store: build_store(&bucket, secret, options),
            bucket,
            uri,
        }
    }

    fn store(&self) -> VaultResult<&dyn CloudObjectStore> {
        cloud::store_or_failure(&self.store)
    }

    /// Scala `getObjectName`: the decoded path without its first character.
    fn object_name(path: &UPath) -> VaultResult<String> {
        let uri = path.to_remote_uri()?;
        let path = uri.path();
        let mut chars = path.chars();
        if chars.next().is_none() {
            return Err(VaultError::exception(
                "java.lang.UnsupportedOperationException: tail of empty String",
            ));
        }
        Ok(chars.as_str().to_owned())
    }
}

impl DataVault for GoogleCloudDataVault {
    fn read_bytes_encoding_and_range_header<'a>(
        &'a self,
        path: &'a UPath,
        range: ByteRange,
        _user_token: Option<&'a str>,
    ) -> BoxFuture<'a, VaultResult<RawRead>> {
        Box::pin(async move {
            let name = Self::object_name(path)?;
            cloud::read(self.store()?, &name, range).await
        })
    }

    fn list_directory<'a>(
        &'a self,
        path: &'a UPath,
        max_items: usize,
        _user_token: Option<&'a str>,
    ) -> BoxFuture<'a, VaultResult<Vec<UPath>>> {
        Box::pin(async move {
            let name = Self::object_name(path)?;
            // Scala `getValues`: the first page only.
            let prefixes = cloud::list_directory(self.store()?, &name, None).await?;
            prefixes
                .iter()
                .take(max_items)
                .map(|prefix| {
                    UPath::parse(&format!("{}://{}/{prefix}", self.uri.scheme(), self.bucket))
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
            let name = Self::object_name(path)?;
            cloud::used_storage_bytes(self.store()?, &name).await
        })
    }

    fn kind(&self) -> &'static str {
        "GoogleCloudDataVault"
    }
}
