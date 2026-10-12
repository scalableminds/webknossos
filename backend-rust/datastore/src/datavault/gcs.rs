//! Scala `GoogleCloudDataVault` over the GCS JSON API.
//!
//! Authentication replaces `google-auth-library`'s `ServiceAccountCredentials`: an RS256-signed
//! JWT assertion (ring) is exchanged at the key's `token_uri` for an OAuth access token, which is
//! cached until five minutes before it expires. Without a credential, requests are anonymous
//! (public buckets) unless `GOOGLE_APPLICATION_CREDENTIALS` names a service-account key file
//! (the only application-default-credentials source supported here).
//!
//! Reads request `Accept-Encoding: gzip` so GCS never transcodes: the stored bytes are returned
//! with their stored `Content-Encoding` (Scala `shouldReturnRawInputStream(true)` + the blob
//! info's `contentEncoding`), and `VaultPath` decodes them.

use std::{
    sync::Arc,
    time::{Duration, Instant, SystemTime},
};

use base64::{
    Engine,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};
use bytes::Bytes;
use reqwest::{Client, RequestBuilder, Response, StatusCode, header};
use ring::{rand::SystemRandom, signature};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::Mutex;

use super::{
    BoxFuture, ByteRange, DataVault, Encoding, RawRead, RemoteUri, UPath, VaultError, VaultResult,
    sigv4::uri_encode,
};
use crate::error::DsError;

pub const DEFAULT_GCS_ENDPOINT: &str = "https://storage.googleapis.com";
const DEFAULT_TOKEN_URI: &str = "https://oauth2.googleapis.com/token";
/// `HttpStorageOptions` scope.
const STORAGE_SCOPE: &str = "https://www.googleapis.com/auth/devstorage.full_control";
/// Tokens are refreshed this long before they expire (google-auth-library margin).
const TOKEN_EXPIRY_MARGIN: Duration = Duration::from_secs(5 * 60);
const JWT_LIFETIME_SECONDS: u64 = 3600;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(600);

/// Process-wide GCS settings.
#[derive(Debug, Clone)]
pub struct GcsOptions {
    /// JSON API base URL.
    pub endpoint: String,
    /// Application default credentials: the service-account key from
    /// `GOOGLE_APPLICATION_CREDENTIALS` (JSON text), used when a vault has no credential.
    pub default_service_account_json: Option<String>,
}

impl Default for GcsOptions {
    fn default() -> Self {
        Self {
            endpoint: DEFAULT_GCS_ENDPOINT.into(),
            default_service_account_json: None,
        }
    }
}

impl GcsOptions {
    pub fn from_env() -> Self {
        Self {
            endpoint: DEFAULT_GCS_ENDPOINT.into(),
            default_service_account_json: std::env::var("GOOGLE_APPLICATION_CREDENTIALS")
                .ok()
                .filter(|p| !p.is_empty())
                .and_then(|path| std::fs::read_to_string(path).ok()),
        }
    }
}

#[derive(Deserialize)]
struct ServiceAccountKey {
    client_email: String,
    private_key: String,
    #[serde(default)]
    private_key_id: Option<String>,
    #[serde(default)]
    token_uri: Option<String>,
}

/// OAuth access tokens for one service account (Scala `ServiceAccountCredentials`).
pub struct ServiceAccountTokenSource {
    client_email: String,
    key_id: Option<String>,
    token_uri: String,
    key_pair: signature::RsaKeyPair,
    client: Client,
    cached: Mutex<Option<(String, Instant)>>,
}

impl std::fmt::Debug for ServiceAccountTokenSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ServiceAccountTokenSource")
            .field("client_email", &self.client_email)
            .field("token_uri", &self.token_uri)
            .finish_non_exhaustive()
    }
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    expires_in: Option<u64>,
}

fn pem_to_der(pem: &str) -> Result<Vec<u8>, String> {
    let body: String = pem
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with("-----"))
        .collect();
    STANDARD
        .decode(body)
        .map_err(|_| "Invalid PKCS#8 data.".to_owned())
}

impl ServiceAccountTokenSource {
    /// Parse a service-account key JSON (Scala `ServiceAccountCredentials.fromStream`). Errors
    /// never contain key material.
    pub fn from_json(secret_json: &str, client: Client) -> Result<Self, String> {
        let key: ServiceAccountKey = serde_json::from_str(secret_json).map_err(|_| {
            "Error reading service account credential from JSON, expecting 'client_id', 'client_email', 'private_key' and 'private_key_id'.".to_owned()
        })?;
        let der = pem_to_der(&key.private_key)?;
        let key_pair = signature::RsaKeyPair::from_pkcs8(&der)
            .map_err(|_| "Invalid PKCS#8 data.".to_owned())?;
        Ok(Self {
            client_email: key.client_email,
            key_id: key.private_key_id,
            token_uri: key
                .token_uri
                .filter(|u| !u.is_empty())
                .unwrap_or_else(|| DEFAULT_TOKEN_URI.into()),
            key_pair,
            client,
            cached: Mutex::new(None),
        })
    }

    /// The signed JWT bearer assertion for `now`.
    pub fn assertion(&self, now: SystemTime) -> Result<String, String> {
        let iat = now
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let mut header = json!({"alg": "RS256", "typ": "JWT"});
        if let Some(kid) = &self.key_id {
            header["kid"] = Value::String(kid.clone());
        }
        let claims = json!({
            "iss": self.client_email,
            "scope": STORAGE_SCOPE,
            "aud": self.token_uri,
            "iat": iat,
            "exp": iat + JWT_LIFETIME_SECONDS,
        });
        let signing_input = format!(
            "{}.{}",
            URL_SAFE_NO_PAD.encode(header.to_string()),
            URL_SAFE_NO_PAD.encode(claims.to_string())
        );
        let mut signature = vec![0u8; self.key_pair.public().modulus_len()];
        self.key_pair
            .sign(
                &signature::RSA_PKCS1_SHA256,
                &SystemRandom::new(),
                signing_input.as_bytes(),
                &mut signature,
            )
            .map_err(|_| "Failed to sign the service account assertion.".to_owned())?;
        Ok(format!(
            "{signing_input}.{}",
            URL_SAFE_NO_PAD.encode(signature)
        ))
    }

    /// A valid access token, fetched (once for concurrent callers) when missing or expiring.
    pub async fn access_token(&self) -> VaultResult<String> {
        let mut cached = self.cached.lock().await;
        if let Some((token, expires_at)) = cached.as_ref()
            && Instant::now() + TOKEN_EXPIRY_MARGIN < *expires_at
        {
            return Ok(token.clone());
        }
        let failure = |detail: String| {
            let message = format!(
                "Error getting access token for service account: {detail}, iss: {}",
                self.client_email
            );
            VaultError::Failure(DsError {
                exception: Some(format!("java.io.IOException: {message}")),
                ..DsError::failure(message)
            })
        };
        let assertion = self.assertion(SystemTime::now()).map_err(failure)?;
        let response = self
            .client
            .post(&self.token_uri)
            .form(&[
                ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
                ("assertion", assertion.as_str()),
            ])
            .timeout(Duration::from_secs(60))
            .send()
            .await
            .map_err(|e| failure(e.to_string()))?;
        let status = response.status();
        if !status.is_success() {
            return Err(failure(format!(
                "{} {}",
                status.as_u16(),
                status.canonical_reason().unwrap_or("")
            )));
        }
        let token: TokenResponse = response
            .json()
            .await
            .map_err(|_| failure("invalid token response".into()))?;
        let lifetime = Duration::from_secs(token.expires_in.unwrap_or(JWT_LIFETIME_SECONDS));
        *cached = Some((token.access_token.clone(), Instant::now() + lifetime));
        Ok(token.access_token)
    }
}

#[derive(Debug)]
pub struct GoogleCloudDataVault {
    uri: RemoteUri,
    /// Scala `uri.getAuthority` (bucket names may contain `_`, which `getHost` rejects).
    bucket: String,
    /// `None` = anonymous; `Some(Err)` = unusable credential (fails on use, like Scala's lazy
    /// `storageOptions`).
    token_source: Option<Result<Arc<ServiceAccountTokenSource>, String>>,
    client: Client,
    endpoint: String,
}

impl GoogleCloudDataVault {
    /// Scala `GoogleCloudDataVault.create`: `secret_json` is the `GoogleServiceAccountCredential`
    /// secret (the service account key JSON).
    pub fn new(
        uri: RemoteUri,
        secret_json: Option<&str>,
        client: Client,
        options: &GcsOptions,
    ) -> Self {
        let secret = secret_json.or(options.default_service_account_json.as_deref());
        Self {
            bucket: uri.authority().unwrap_or("null").to_owned(),
            token_source: secret.map(|json| {
                ServiceAccountTokenSource::from_json(json, client.clone()).map(Arc::new)
            }),
            client,
            endpoint: options.endpoint.trim_end_matches('/').to_owned(),
            uri,
        }
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

    fn object_url(&self, name: &str) -> String {
        format!(
            "{}/storage/v1/b/{}/o/{}",
            self.endpoint,
            uri_encode(&self.bucket, true),
            uri_encode(name, true)
        )
    }

    async fn authorized(&self, request: RequestBuilder) -> VaultResult<RequestBuilder> {
        let request = request.timeout(REQUEST_TIMEOUT);
        match &self.token_source {
            None => Ok(request),
            Some(Ok(source)) => Ok(request.bearer_auth(source.access_token().await?)),
            Some(Err(message)) => Err(VaultError::Failure(DsError {
                exception: Some(format!("java.io.IOException: {message}")),
                ..DsError::failure(message.clone())
            })),
        }
    }

    async fn send(&self, request: RequestBuilder) -> VaultResult<Response> {
        self.authorized(request)
            .await?
            .send()
            .await
            .map_err(|e| storage_exception(e.to_string()))
    }

    /// Object listing pages (`delimiter` = Scala `currentDirectory()`).
    async fn list_page(
        &self,
        prefix: &str,
        delimiter: bool,
        page_token: Option<&str>,
    ) -> VaultResult<Value> {
        let mut url = reqwest::Url::parse(&format!(
            "{}/storage/v1/b/{}/o",
            self.endpoint,
            uri_encode(&self.bucket, true)
        ))
        .map_err(|e| VaultError::failure(e.to_string()))?;
        {
            let mut query = url.query_pairs_mut();
            query.append_pair("prefix", prefix);
            if delimiter {
                query.append_pair("delimiter", "/");
            }
            if let Some(token) = page_token {
                query.append_pair("pageToken", token);
            }
        }
        let response = self.send(self.client.get(url)).await?;
        if !response.status().is_success() {
            // Listing failures are failures (Scala `tryo`), including 404.
            return Err(error_from_response(response).await);
        }
        response
            .json()
            .await
            .map_err(|e| storage_exception(e.to_string()))
    }

    /// Zero-length reads still look up the blob (Scala reads nothing, then `storage.get`).
    async fn metadata(&self, name: &str) -> VaultResult<(u64, String)> {
        let request = self
            .client
            .get(self.object_url(name))
            .query(&[("fields", "size,contentEncoding")]);
        let response = self.send(request).await?;
        if response.status() == StatusCode::NOT_FOUND {
            return Err(VaultError::NotFound);
        }
        if !response.status().is_success() {
            return Err(error_from_response(response).await);
        }
        let value: Value = response
            .json()
            .await
            .map_err(|e| storage_exception(e.to_string()))?;
        let size = value
            .get("size")
            .and_then(Value::as_str)
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let encoding = value
            .get("contentEncoding")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        Ok((size, encoding))
    }
}

fn storage_exception(message: String) -> VaultError {
    VaultError::Failure(DsError {
        exception: Some(format!(
            "com.google.cloud.storage.StorageException: {message}"
        )),
        ..DsError::failure(message)
    })
}

/// `StorageException` from an error response (JSON API `error.message`, else the body text).
async fn error_from_response(response: Response) -> VaultError {
    let status = response.status();
    let body = response.bytes().await.unwrap_or_default();
    let message = serde_json::from_slice::<Value>(&body)
        .ok()
        .and_then(|v| v["error"]["message"].as_str().map(str::to_owned))
        .or_else(|| {
            let text = String::from_utf8_lossy(&body).trim().to_owned();
            (!text.is_empty()).then_some(text)
        })
        .unwrap_or_else(|| {
            format!(
                "{} {}",
                status.as_u16(),
                status.canonical_reason().unwrap_or("")
            )
        });
    storage_exception(message)
}

fn header_value(response: &Response, name: &str) -> Option<String> {
    response
        .headers()
        .get(name)
        .map(|v| String::from_utf8_lossy(v.as_bytes()).into_owned())
}

/// Total object size from `Content-Range: bytes a-b/total`.
fn total_from_content_range(value: &str) -> Option<u64> {
    value.rsplit_once('/').and_then(|(_, t)| t.parse().ok())
}

/// The requested slice of a complete object body (when a server ignored the `Range` header).
fn slice_complete(body: Bytes, range: ByteRange) -> Bytes {
    let len = body.len() as u64;
    match range {
        ByteRange::StartEnd { start, end } => {
            let start = start.min(len);
            body.slice(start as usize..end.clamp(start, len) as usize)
        }
        ByteRange::Suffix { length } => body.slice((len - length.min(len)) as usize..),
        ByteRange::Complete => body,
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
            if range.length() == Some(0) {
                let (size, encoding) = self.metadata(&name).await?;
                return Ok(RawRead {
                    bytes: Bytes::new(),
                    encoding: Encoding::from_rfc7231(&encoding)
                        .map_err(|e| VaultError::Failure(e).wrap("could not get encoding"))?,
                    content_range: range.to_content_range_header_with_length(size),
                });
            }
            let mut request = self
                .client
                .get(self.object_url(&name))
                .query(&[("alt", "media")])
                .header(header::ACCEPT_ENCODING, "gzip");
            if let Some(range_header) = range.to_range_header() {
                request = request.header(header::RANGE, range_header);
            }
            let response = self.send(request).await?;
            let status = response.status();
            if status == StatusCode::NOT_FOUND {
                return Err(VaultError::NotFound);
            }
            if !status.is_success() {
                return Err(error_from_response(response).await);
            }
            let stored_encoding = header_value(&response, "x-goog-stored-content-encoding")
                .or_else(|| header_value(&response, "content-encoding"))
                .unwrap_or_default();
            let content_range = header_value(&response, "content-range");
            let stored_size = header_value(&response, "x-goog-stored-content-length")
                .and_then(|v| v.parse::<u64>().ok())
                .or_else(|| content_range.as_deref().and_then(total_from_content_range));
            let mut bytes = response
                .bytes()
                .await
                .map_err(|e| storage_exception(e.to_string()))?;
            let size = stored_size.unwrap_or(bytes.len() as u64);
            if status == StatusCode::OK && !matches!(range, ByteRange::Complete) {
                bytes = slice_complete(bytes, range);
            }
            if let Some(requested) = range.length()
                && (bytes.len() as u64) < requested
            {
                // Scala `readFully` throws an `EOFException` (an `IOException`).
                return Err(VaultError::Failure(DsError::failure(format!(
                    "Unexpected end of stream while reading from GCS: got {} of {requested} requested bytes",
                    bytes.len()
                ))));
            }
            let encoding = Encoding::from_rfc7231(&stored_encoding)
                .map_err(|e| VaultError::Failure(e).wrap("could not get encoding"))?;
            Ok(RawRead {
                bytes,
                encoding,
                content_range: range.to_content_range_header_with_length(size),
            })
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
            let page = self.list_page(&name, true, None).await?;
            page.get("prefixes")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .take(max_items)
                .map(|prefix| {
                    UPath::parse(&format!("{}://{}/{prefix}", self.uri.scheme(), self.bucket))
                        .map_err(VaultError::Failure)
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
            let mut total = 0u64;
            let mut token: Option<String> = None;
            loop {
                let page = self.list_page(&name, false, token.as_deref()).await?;
                for item in page
                    .get("items")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                {
                    total += item
                        .get("size")
                        .and_then(|s| s.as_str().and_then(|s| s.parse().ok()).or(s.as_u64()))
                        .unwrap_or(0);
                }
                match page.get("nextPageToken").and_then(Value::as_str) {
                    Some(next) => token = Some(next.to_owned()),
                    None => return Ok(total),
                }
            }
        })
    }

    fn kind(&self) -> &'static str {
        "GoogleCloudDataVault"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slices_and_parses_ranges() {
        let body = Bytes::from_static(b"0123456789");
        assert_eq!(
            &slice_complete(body.clone(), ByteRange::start_end_exclusive(2, 5))[..],
            b"234"
        );
        assert_eq!(
            &slice_complete(body.clone(), ByteRange::suffix(3))[..],
            b"789"
        );
        assert_eq!(
            &slice_complete(body, ByteRange::start_end_exclusive(8, 20))[..],
            b"89"
        );
        assert_eq!(total_from_content_range("bytes 0-9/100"), Some(100));
        assert_eq!(total_from_content_range("bytes */*"), None);
    }

    #[test]
    fn rejects_invalid_service_account_without_leaking() {
        let error = ServiceAccountTokenSource::from_json(
            r#"{"client_email":"a@b","private_key":"-----BEGIN PRIVATE KEY-----\nU0VDUkVU\n-----END PRIVATE KEY-----"}"#,
            Client::new(),
        )
        .unwrap_err();
        assert_eq!(error, "Invalid PKCS#8 data.");
        assert!(ServiceAccountTokenSource::from_json("{}", Client::new()).is_err());
    }
}
