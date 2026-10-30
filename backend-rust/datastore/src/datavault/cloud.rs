//! Shared plumbing of the S3 and GCS vaults, which are thin adapters over the `object_store`
//! crate: HTTP client settings, ranged reads, listings and the mapping of its errors to Scala's
//! `Empty`/`Failure` distinction.

use std::{borrow::Cow, sync::Arc, time::Duration};

use bytes::Bytes;
use object_store::{
    Attribute, BackoffConfig, ClientOptions, GetOptions, GetRange, ObjectStore, RetryConfig,
    list::{PaginatedListOptions, PaginatedListStore},
    path::Path,
};

use super::{ByteRange, Encoding, RawRead, RetryPolicy, VaultError, VaultResult};
use crate::error::DsError;

/// Timeout of a single request (large uploads and slow stores; `object_store` defaults to 30 s).
const REQUEST_TIMEOUT: Duration = Duration::from_secs(600);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(120);

/// An `object_store` backend that can also list page by page.
pub(super) trait CloudObjectStore: ObjectStore + PaginatedListStore {}

impl<T: ObjectStore + PaginatedListStore> CloudObjectStore for T {}

/// `object_store`'s HTTP client verifies TLS with rustls, whose process-wide crypto provider
/// must be chosen before the first client is built (the datastore uses ring, not aws-lc).
pub(super) fn install_crypto_provider() {
    // Fails only if a provider is already installed, which is just as good.
    let _ = rustls::crypto::ring::default_provider().install_default();
}

/// Client settings shared by the S3 and GCS stores. Stored transfer encodings are passed
/// through undecoded (`VaultPath` decodes them, like Scala).
pub(super) fn client_options(allow_http: bool) -> ClientOptions {
    install_crypto_provider();
    ClientOptions::new()
        .with_allow_http(allow_http)
        .with_timeout(REQUEST_TIMEOUT)
        .with_connect_timeout(CONNECT_TIMEOUT)
}

/// `object_store` retries I/O failures, throttling and server errors with exponential backoff.
pub(super) fn retry_config(policy: RetryPolicy) -> RetryConfig {
    RetryConfig {
        backoff: BackoffConfig {
            init_backoff: policy.initial_delay,
            max_backoff: Duration::from_secs(15),
            base: 2.0,
        },
        max_retries: policy.attempts.saturating_sub(1) as usize,
        retry_timeout: Duration::from_secs(3 * 60),
    }
}

/// `object_store` error as a vault failure; the message never contains credentials.
pub(super) fn failure(error: object_store::Error) -> VaultError {
    VaultError::Failure(DsError::from_exception(error))
}

/// Missing objects are Scala `Empty`, everything else a failure.
pub(super) fn read_failure(error: object_store::Error) -> VaultError {
    match error {
        object_store::Error::NotFound { .. } => VaultError::NotFound,
        other => failure(other),
    }
}

/// An object key as an `object_store` path. Keys with empty segments (`a//b`) or `.`/`..`
/// segments cannot be addressed.
pub(super) fn object_path(key: &str) -> VaultResult<Path> {
    Path::parse(key)
        .map_err(|e| VaultError::failure(format!("Unsupported object key “{key}”: {e}")))
}

/// Scala `readBytesEncodingAndRangeHeader` against an object store.
pub(super) async fn read(
    store: &dyn CloudObjectStore,
    key: &str,
    range: ByteRange,
) -> VaultResult<RawRead> {
    let location = object_path(key)?;
    let get_range = match range {
        ByteRange::Complete => None,
        ByteRange::StartEnd { start, end } if end > start => Some(GetRange::Bounded(start..end)),
        ByteRange::Suffix { length } if length > 0 => Some(GetRange::Suffix(length)),
        // Empty ranges are not valid HTTP ranges: only check that the object exists.
        ByteRange::StartEnd { .. } | ByteRange::Suffix { .. } => {
            let head = GetOptions {
                head: true,
                ..GetOptions::default()
            };
            let meta = store
                .get_opts(&location, head)
                .await
                .map_err(read_failure)?
                .meta;
            return Ok(RawRead {
                bytes: Bytes::new(),
                encoding: Encoding::Identity,
                content_range: range.to_content_range_header_with_length(meta.size),
            });
        }
    };
    let options = GetOptions {
        range: get_range,
        ..GetOptions::default()
    };
    let result = store
        .get_opts(&location, options)
        .await
        .map_err(read_failure)?;
    let encoding = result
        .attributes
        .get(&Attribute::ContentEncoding)
        .map(|value| value.as_ref().to_owned())
        // S3 reports objects uploaded with `aws-chunked` signing under that encoding.
        .filter(|encoding| encoding != "aws-chunked")
        .unwrap_or_default();
    let size = result.meta.size;
    let bytes = result.bytes().await.map_err(failure)?;
    let encoding = Encoding::from_rfc7231(&encoding)
        .map_err(|e| VaultError::Failure(e).wrap("could not get encoding"))?;
    Ok(RawRead {
        bytes,
        encoding,
        content_range: range.to_content_range_header_with_length(size),
    })
}

/// Direct sub-"directories" of `prefix` (keys ending in `/`) from the first listing page.
pub(super) async fn list_directory(
    store: &dyn CloudObjectStore,
    prefix: &str,
    max_keys: Option<usize>,
) -> VaultResult<Vec<String>> {
    let options = PaginatedListOptions {
        delimiter: Some(Cow::Borrowed("/")),
        max_keys,
        ..PaginatedListOptions::default()
    };
    let page = store
        .list_paginated(Some(prefix), options)
        .await
        .map_err(failure)?;
    Ok(page
        .result
        .common_prefixes
        .iter()
        .map(|path| format!("{path}/"))
        .collect())
}

/// Total size of all objects below `prefix`.
pub(super) async fn used_storage_bytes(
    store: &dyn CloudObjectStore,
    prefix: &str,
) -> VaultResult<u64> {
    let mut total = 0u64;
    let mut page_token = None;
    loop {
        let options = PaginatedListOptions {
            page_token,
            ..PaginatedListOptions::default()
        };
        let page = store
            .list_paginated(Some(prefix), options)
            .await
            .map_err(failure)?;
        total += page.result.objects.iter().map(|o| o.size).sum::<u64>();
        match page.page_token {
            Some(token) => page_token = Some(token),
            None => return Ok(total),
        }
    }
}

/// A built store, or why it could not be built (reported on use, like Scala's lazy clients).
pub(super) type StoreResult = Result<Arc<dyn CloudObjectStore>, String>;

pub(super) fn store_or_failure(store: &StoreResult) -> VaultResult<&dyn CloudObjectStore> {
    store
        .as_ref()
        .map(|store| store.as_ref())
        .map_err(|message| VaultError::Failure(DsError::from_exception(message)))
}
