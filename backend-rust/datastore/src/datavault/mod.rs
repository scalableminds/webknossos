//! Data vaults: uniform byte access to local files, HTTP(S), S3 and Google Cloud Storage.
//!
//! Scala truth: `datastore/datavault/*` (`DataVault`, `VaultPath`, `ByteRange`, `Encoding`,
//! `FileSystemDataVault`, `HttpsDataVault`, `S3DataVault`, `GoogleCloudDataVault`),
//! `datastore/helpers/{UPath,S3UriUtils}` and `datastore/storage/{DataVaultService,S3ClientPool,
//! DataVaultCredentials}`. See ../checkpoints/datastore-ds1b.md for decisions and deviations.
//!
//! Scala `Fox` results distinguish `Empty` (resource missing) from `Failure`; vault reads keep that
//! distinction as [`VaultError::NotFound`] so chunk readers can fall back to fill values.

mod credential;
mod file;
pub mod gcs;
mod http;
pub mod s3;
mod service;
pub mod sigv4;
mod uri;
mod zip;

use std::{fmt, future::Future, io::Read, pin::Pin, sync::Arc};

use axum::http::StatusCode;
use bytes::Bytes;
use serde::de::DeserializeOwned;

use crate::error::DsError;

/// The canonical `UPath` lives in `crate::models::upath` (shared with the data source models).
pub use crate::models::upath::{LocalPath, RemotePath, UPath};
pub use credential::DataVaultCredential;
pub use file::FileSystemDataVault;
pub use gcs::{GcsOptions, GoogleCloudDataVault, ServiceAccountTokenSource};
pub use http::HttpsDataVault;
pub use s3::{S3DataVault, S3Options};
pub use service::{
    CredentialLookup, CredentializedUPath, DataVaultService, DataVaultServiceOptions,
    MSG_MAG_PATH_NOT_ABSOLUTE, MSG_SETUP_FAILED, VAULT_CACHE_CAPACITY,
};
pub use sigv4::AwsCredentials;
pub use uri::RemoteUri;
pub use zip::ZipDataVault;

/// Boxed future used by the object-safe vault traits.
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Scala `Fox` outcome of a vault operation: `Empty` or `Failure`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VaultError {
    /// Scala `Empty` (e.g. HTTP 404, `NoSuchKey`, missing local file).
    NotFound,
    Failure(DsError),
}

pub type VaultResult<T> = Result<T, VaultError>;

impl VaultError {
    pub fn failure(message: impl Into<String>) -> Self {
        Self::Failure(DsError::failure(message))
    }

    /// Scala `Fox.failure(e.getMessage / e.toString, Full(e))`.
    pub fn exception(exception: impl fmt::Display) -> Self {
        Self::Failure(DsError::from_exception(exception))
    }

    /// Scala `?->`: annotate failures only, pass `Empty` through.
    pub fn annotate(self, message: impl Into<String>) -> Self {
        match self {
            Self::NotFound => Self::NotFound,
            Self::Failure(error) => Self::Failure(error.wrap(message)),
        }
    }

    /// Scala `?~>`: annotate failures, turn `Empty` into a failure with this message.
    pub fn wrap(self, message: impl Into<String>) -> Self {
        match self {
            Self::NotFound => Self::Failure(DsError::failure(message)),
            Self::Failure(error) => Self::Failure(error.wrap(message)),
        }
    }

    pub fn is_not_found(&self) -> bool {
        matches!(self, Self::NotFound)
    }
}

impl From<DsError> for VaultError {
    fn from(error: DsError) -> Self {
        Self::Failure(error)
    }
}

impl From<VaultError> for DsError {
    fn from(error: VaultError) -> Self {
        match error {
            VaultError::NotFound => DsError::empty(),
            VaultError::Failure(error) => error,
        }
    }
}

impl fmt::Display for VaultError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound => f.write_str("Empty"),
            Self::Failure(error) => f.write_str(&error.message),
        }
    }
}

/// Scala `ByteRange` (`StartEndExclusiveByteRange`, `SuffixLengthByteRange`, `CompleteByteRange`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ByteRange {
    /// `[start, end)`.
    StartEnd {
        start: u64,
        end: u64,
    },
    /// The last `length` bytes.
    Suffix {
        length: u64,
    },
    Complete,
}

impl ByteRange {
    pub fn start_end_exclusive(start: u64, end: u64) -> Self {
        Self::StartEnd { start, end }
    }

    pub fn start_end_inclusive(start: u64, end: u64) -> Self {
        Self::StartEnd {
            start,
            end: end + 1,
        }
    }

    pub fn suffix(length: u64) -> Self {
        Self::Suffix { length }
    }

    /// Number of requested bytes for `StartEnd` (Scala `length`, may be 0 for inverted ranges).
    pub fn length(&self) -> Option<u64> {
        match self {
            Self::StartEnd { start, end } => Some(end.saturating_sub(*start)),
            Self::Suffix { length } => Some(*length),
            Self::Complete => None,
        }
    }

    /// HTTP `Range` header value (inclusive end), `None` for a complete read.
    pub fn to_range_header(&self) -> Option<String> {
        match self {
            Self::StartEnd { start, end } => Some(format!("bytes={start}-{}", *end as i128 - 1)),
            Self::Suffix { length } => Some(format!("bytes=-{length}")),
            Self::Complete => None,
        }
    }

    /// Scala `toContentRangeHeaderWithLength`.
    pub fn to_content_range_header_with_length(&self, total_length: u64) -> Option<String> {
        let total = total_length as i128;
        match self {
            Self::StartEnd { start, end } => {
                Some(format!("bytes {start}-{}/{total}", *end as i128 - 1))
            }
            Self::Suffix { length } => Some(format!(
                "bytes {}-{}/{total}",
                total - *length as i128,
                total - 1
            )),
            Self::Complete => None,
        }
    }

    /// Scala `successResponseCode`.
    pub fn success_status(&self) -> StatusCode {
        match self {
            Self::Complete => StatusCode::OK,
            _ => StatusCode::PARTIAL_CONTENT,
        }
    }

    /// Scala `ByteRange.fromRequest`: only `bytes=a-b` and `bytes=-n` are supported.
    pub fn from_range_header(header: Option<&str>) -> Result<Self, DsError> {
        let Some(value) = header else {
            return Ok(Self::Complete);
        };
        let invalid = || {
            DsError::failure(format!(
                "Invalid range header “{value}”, only single start-end byte ranges and suffix-ranges are supported."
            ))
        };
        let spec = value.strip_prefix("bytes=").ok_or_else(invalid)?;
        let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
        if let Some(length) = spec.strip_prefix('-') {
            if !digits(length) {
                return Err(invalid());
            }
            // Scala `toInt` throws (500) on overflow; reject as invalid instead.
            let length: i32 = length.parse().map_err(|_| invalid())?;
            return Ok(Self::suffix(length as u64));
        }
        let (start, end) = spec.split_once('-').ok_or_else(invalid)?;
        if !digits(start) || !digits(end) {
            return Err(invalid());
        }
        let start: i64 = start.parse().map_err(|_| invalid())?;
        let end: i64 = end.parse().map_err(|_| invalid())?;
        Ok(Self::start_end_inclusive(start as u64, end as u64))
    }
}

impl fmt::Display for ByteRange {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::StartEnd { start, end } => write!(f, "StartEndExclusiveByteRange({start},{end})"),
            Self::Suffix { length } => write!(f, "SuffixLengthByteRange({length})"),
            Self::Complete => f.write_str("CompleteByteRange()"),
        }
    }
}

/// Scala `Encoding` (transfer encodings understood by `VaultPath.readBytes`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Encoding {
    Gzip,
    Brotli,
    Identity,
}

impl Encoding {
    /// Scala `Encoding.fromRfc7231String`.
    pub fn from_rfc7231(value: &str) -> Result<Self, DsError> {
        match value {
            "gzip" | "x-gzip" => Ok(Self::Gzip),
            "br" => Ok(Self::Brotli),
            "identity" | "" => Ok(Self::Identity),
            other => Err(DsError::failure(format!("Unsupported encoding: {other}"))),
        }
    }

    pub fn to_rfc7231(self) -> Option<&'static str> {
        match self {
            Self::Gzip => Some("gzip"),
            Self::Brotli => Some("br"),
            Self::Identity => None,
        }
    }

    /// Scala enumeration value name.
    pub fn name(self) -> &'static str {
        match self {
            Self::Gzip => "gzip",
            Self::Brotli => "brotli",
            Self::Identity => "identity",
        }
    }

    /// Scala `VaultPath.decode`.
    pub fn decode(self, bytes: Bytes) -> Result<Bytes, DsError> {
        match self {
            Self::Identity => Ok(bytes),
            Self::Gzip => {
                // Scala `ZipIO.gunzip` reads a `GZIPInputStream` to the end (concatenated members).
                let mut out = Vec::new();
                flate2::read::MultiGzDecoder::new(&bytes[..])
                    .read_to_end(&mut out)
                    .map_err(|e| DsError::from_exception(format!("java.io.IOException: {e}")))?;
                Ok(Bytes::from(out))
            }
            Self::Brotli => {
                // Scala `decodeBrotli` stops at the first IOException and returns what was decoded.
                let mut out = Vec::new();
                let mut decoder = brotli_decompressor::Decompressor::new(&bytes[..], 4096);
                let mut buffer = [0u8; 8192];
                loop {
                    match decoder.read(&mut buffer) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => out.extend_from_slice(&buffer[..n]),
                    }
                }
                Ok(Bytes::from(out))
            }
        }
    }
}

impl fmt::Display for Encoding {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.name())
    }
}

/// Raw result of a vault read (Scala `(Array[Byte], Encoding.Value, Option[String])`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawRead {
    pub bytes: Bytes,
    pub encoding: Encoding,
    /// `Content-Range` header value for ranged reads, if known.
    pub content_range: Option<String>,
}

/// Scala `DataVault`. Implementations are cheap to share (`Arc`) and internally synchronized.
///
/// `user_token` is Scala's `TokenContext.userTokenOpt`; only the HTTPS vault uses it (when the
/// target is this datastore itself).
pub trait DataVault: Send + Sync + fmt::Debug {
    fn read_bytes_encoding_and_range_header<'a>(
        &'a self,
        path: &'a UPath,
        range: ByteRange,
        user_token: Option<&'a str>,
    ) -> BoxFuture<'a, VaultResult<RawRead>>;

    /// Direct sub-"directories" of `path`, at most `max_items`.
    fn list_directory<'a>(
        &'a self,
        path: &'a UPath,
        max_items: usize,
        user_token: Option<&'a str>,
    ) -> BoxFuture<'a, VaultResult<Vec<UPath>>>;

    fn used_storage_bytes<'a>(
        &'a self,
        path: &'a UPath,
        user_token: Option<&'a str>,
    ) -> BoxFuture<'a, VaultResult<u64>>;

    /// Scala `dataVault.getClass.getSimpleName`.
    fn kind(&self) -> &'static str;
}

/// Scala `VaultPath`: a [`UPath`] bound to the vault that can read it.
#[derive(Clone)]
pub struct VaultPath {
    upath: UPath,
    vault: Arc<dyn DataVault>,
}

impl VaultPath {
    pub fn new(upath: UPath, vault: Arc<dyn DataVault>) -> Self {
        Self { upath, vault }
    }

    pub fn upath(&self) -> &UPath {
        &self.upath
    }

    pub fn vault(&self) -> &Arc<dyn DataVault> {
        &self.vault
    }

    /// Scala `readBytes(byteRange)`: read and undo the transfer encoding.
    pub async fn read_bytes(
        &self,
        range: ByteRange,
        user_token: Option<&str>,
    ) -> VaultResult<Bytes> {
        let raw = self
            .read_bytes_encoding_and_range_header(range, user_token)
            .await?;
        decode_raw(raw)
    }

    /// Scala `readBytesEncodingAndRangeHeader` (no decoding).
    pub async fn read_bytes_encoding_and_range_header(
        &self,
        range: ByteRange,
        user_token: Option<&str>,
    ) -> VaultResult<RawRead> {
        self.vault
            .read_bytes_encoding_and_range_header(&self.upath, range, user_token)
            .await
            .map_err(|e| e.annotate("Failed to read from vault path"))
    }

    /// Scala `readLastBytes(byteCount)`.
    pub async fn read_last_bytes(
        &self,
        byte_count: u64,
        user_token: Option<&str>,
    ) -> VaultResult<Bytes> {
        self.read_bytes(ByteRange::suffix(byte_count), user_token)
            .await
    }

    /// Scala `getUsedStorageBytes`.
    pub async fn used_storage_bytes(&self, user_token: Option<&str>) -> VaultResult<u64> {
        self.vault.used_storage_bytes(&self.upath, user_token).await
    }

    /// Scala `listDirectory(maxItems)`.
    pub async fn list_directory(
        &self,
        max_items: usize,
        user_token: Option<&str>,
    ) -> VaultResult<Vec<VaultPath>> {
        let children = self
            .vault
            .list_directory(&self.upath, max_items, user_token)
            .await?;
        Ok(children
            .into_iter()
            .map(|upath| VaultPath::new(upath, Arc::clone(&self.vault)))
            .collect())
    }

    /// Scala `parseAsJson[T]`.
    pub async fn parse_as_json<T: DeserializeOwned>(
        &self,
        user_token: Option<&str>,
    ) -> VaultResult<T> {
        let bytes = self.read_bytes(ByteRange::Complete, user_token).await?;
        serde_json::from_slice(&bytes)
            .map_err(|e| VaultError::failure(format!("JSON parsing failed: {e}")))
    }

    pub fn basename(&self) -> String {
        self.upath.basename()
    }

    pub fn parent(&self) -> VaultPath {
        VaultPath::new(self.upath.parent(), Arc::clone(&self.vault))
    }

    /// Scala `/`.
    pub fn join(&self, key: &str) -> VaultPath {
        VaultPath::new(self.upath.join(key), Arc::clone(&self.vault))
    }

    pub fn to_remote_uri(&self) -> Result<RemoteUri, DsError> {
        self.upath.to_remote_uri()
    }

    /// Scala `summary`.
    pub fn summary(&self) -> String {
        format!("VaultPath: {} for {}", self.upath, self.vault.kind())
    }
}

impl fmt::Display for VaultPath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.upath.fmt(f)
    }
}

impl fmt::Debug for VaultPath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.summary())
    }
}

fn decode_raw(raw: RawRead) -> VaultResult<Bytes> {
    let encoding = raw.encoding;
    encoding.decode(raw.bytes).map_err(|e| {
        VaultError::Failure(e).wrap(format!("Failed to decode {encoding}-encoded response."))
    })
}
