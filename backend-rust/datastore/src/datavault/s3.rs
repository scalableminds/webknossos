//! Scala `S3DataVault`, the client-relevant parts of `storage/S3ClientPool` and
//! `helpers/S3UriUtils`, over plain HTTP requests signed with [`super::sigv4`].
//!
//! Client semantics kept from the AWS SDK configuration in `S3ClientPool`:
//! - credentials: the vault credential, else `AWS_ACCESS_KEY_ID`/`AWS_ACCESS_KEY` environment
//!   credentials, else anonymous (unsigned requests);
//! - Amazon hosts: region `us-east-1` with cross-region access (a redirect / region-mismatch
//!   response is retried once in the bucket's region, learned from `x-amz-bucket-region`, the
//!   error body or a `HeadBucket` request; the region is then remembered per bucket);
//! - non-Amazon path-style hosts (custom endpoints like MinIO): path-style requests against
//!   `https://<authority>` if a probe `GET` over HTTPS gets any response, else `http://`; signing
//!   region per `AwsHostNameUtils.parseSigningRegion(authority, "s3")`, default `us-east-1`.

use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant, SystemTime},
};

use bytes::Bytes;
use percent_encoding::percent_decode_str;
use quick_xml::{Reader, events::Event};
use reqwest::{Client, Method, StatusCode, header::HeaderMap};
use tokio::sync::OnceCell;

use super::{
    BoxFuture, ByteRange, DataVault, Encoding, RawRead, RemoteUri, UPath, VaultError, VaultResult,
    sigv4::{self, AwsCredentials, SigningRequest},
};
use crate::error::DsError;

pub const SCHEME_S3: &str = "s3";
/// Region of the SDK clients in Scala (`Region.US_EAST_1`).
pub const DEFAULT_REGION: &str = "us-east-1";
/// DNS host names cannot exceed this length (Scala `maxHostLength`).
const MAX_HOST_LENGTH: usize = 253;
/// Timeout of the custom-endpoint HTTPS probe (Play WS would wait for its global timeout).
const PROTOCOL_PROBE_TIMEOUT: Duration = Duration::from_secs(30);
/// Timeout of a single S3 request.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(600);

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

/// Process-wide S3 settings (Scala reads them from the environment / SDK defaults).
#[derive(Debug, Clone, Default)]
pub struct S3Options {
    /// Environment credentials, used when a vault has no credential (Scala
    /// `EnvironmentVariableCredentialsProvider`). `Err` = present but incomplete.
    pub env_credentials: Option<Result<AwsCredentials, String>>,
    /// Base URL replacing the Amazon S3 endpoints (path-style). Only for tests.
    pub aws_endpoint_override: Option<String>,
}

impl S3Options {
    pub fn from_env() -> Self {
        Self {
            env_credentials: AwsCredentials::from_env_vars(|name| std::env::var(name).ok()),
            aws_endpoint_override: None,
        }
    }
}

#[derive(Debug)]
enum Endpoint {
    /// Amazon S3 (cross-region access); `override_base` replaces the regional endpoints.
    Aws { override_base: Option<String> },
    /// Custom endpoint (forced path style).
    Custom {
        authority: String,
        protocol: OnceCell<&'static str>,
        region: String,
    },
}

/// HTTP client for S3 requests: redirects are handled by the cross-region logic, not followed
/// (a followed redirect would carry a signature for the wrong host), and transfer encodings are
/// passed through to `VaultPath`.
pub fn build_s3_http_client() -> Client {
    Client::builder()
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .no_zstd()
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
    /// Cross-region access: bucket → region learned from redirects.
    bucket_regions: Mutex<HashMap<String, String>>,
}

impl std::fmt::Debug for S3DataVault {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
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

/// A complete S3 response.
struct S3Response {
    status: StatusCode,
    headers: HeaderMap,
    body: Bytes,
}

impl S3Response {
    fn header(&self, name: &str) -> Option<String> {
        self.headers
            .get(name)
            .map(|v| String::from_utf8_lossy(v.as_bytes()).into_owned())
    }
}

/// Parsed S3 error body (`<Error><Code/><Message/><Region/></Error>`).
#[derive(Debug, Default)]
struct S3ErrorBody {
    code: Option<String>,
    message: Option<String>,
    region: Option<String>,
}

/// Text content of every leaf element as `(element path, text)`, entity references resolved.
fn xml_leaf_texts(body: &[u8]) -> Result<Vec<(Vec<String>, String)>, String> {
    let mut reader = Reader::from_reader(body);
    let mut stack: Vec<String> = Vec::new();
    let mut text = String::new();
    let mut leaves = Vec::new();
    let mut buffer = Vec::new();
    loop {
        match reader
            .read_event_into(&mut buffer)
            .map_err(|e| e.to_string())?
        {
            Event::Start(e) => {
                stack.push(e.local_name().as_ref().to_owned());
                text.clear();
            }
            Event::Text(t) => text.push_str(&t),
            Event::GeneralRef(reference) => {
                if let Some(c) = reference.resolve_char_ref().map_err(|e| e.to_string())? {
                    text.push(c);
                } else {
                    let name: &str = &reference;
                    text.push_str(match name {
                        "lt" => "<",
                        "gt" => ">",
                        "amp" => "&",
                        "apos" => "'",
                        "quot" => "\"",
                        other => return Err(format!("undeclared entity {other}")),
                    });
                }
            }
            Event::CData(c) => text.push_str(&c),
            Event::End(_) => {
                if !text.is_empty() {
                    leaves.push((stack.clone(), std::mem::take(&mut text)));
                }
                stack.pop();
            }
            Event::Eof => return Ok(leaves),
            _ => {}
        }
        buffer.clear();
    }
}

fn parse_error_body(body: &[u8]) -> S3ErrorBody {
    let mut parsed = S3ErrorBody::default();
    for (path, text) in xml_leaf_texts(body).unwrap_or_default() {
        match path
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>()
            .as_slice()
        {
            ["Error", "Code"] => parsed.code = Some(text),
            ["Error", "Message"] => parsed.message = Some(text),
            ["Error", "Region"] => parsed.region = Some(text),
            _ => {}
        }
    }
    parsed
}

/// AWS SDK `S3Exception` for an error response: `(class, getMessage)`.
fn sdk_exception(response: &S3Response) -> (&'static str, String) {
    let error = parse_error_body(&response.body);
    let class = match error.code.as_deref() {
        Some("NoSuchKey") => "NoSuchKeyException",
        Some("NoSuchBucket") => "NoSuchBucketException",
        _ => "S3Exception",
    };
    let mut details = vec![
        "Service: S3".to_owned(),
        format!("Status Code: {}", response.status.as_u16()),
        format!(
            "Request ID: {}",
            response
                .header("x-amz-request-id")
                .unwrap_or_else(|| "null".into())
        ),
    ];
    if let Some(extended) = response.header("x-amz-id-2") {
        details.push(format!("Extended Request ID: {extended}"));
    }
    let message = error.message.unwrap_or_else(|| "null".into());
    (class, format!("{message} ({})", details.join(", ")))
}

/// Scala `BoxFailure(e.getMessage, Full(e), Empty)` for an `S3Exception`.
fn sdk_failure(response: &S3Response) -> VaultError {
    let (class, message) = sdk_exception(response);
    VaultError::Failure(DsError {
        exception: Some(format!(
            "software.amazon.awssdk.services.s3.model.{class}: {message}"
        )),
        ..DsError::failure(message)
    })
}

fn transport_failure(error: reqwest::Error) -> VaultError {
    let message = format!("Unable to execute HTTP request: {error}");
    VaultError::Failure(DsError {
        exception: Some(format!(
            "software.amazon.awssdk.core.exception.SdkClientException: {message}"
        )),
        ..DsError::failure(message)
    })
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

/// One page of a `ListObjectsV2` response.
#[derive(Debug, Default)]
struct ListPage {
    common_prefixes: Vec<String>,
    sizes: Vec<u64>,
    is_truncated: bool,
    next_continuation_token: Option<String>,
}

fn parse_list_page(body: &[u8]) -> Result<ListPage, VaultError> {
    let leaves = xml_leaf_texts(body)
        .map_err(|e| VaultError::failure(format!("Could not parse S3 listing response: {e}")))?;
    let mut page = ListPage::default();
    let mut url_encoded = false;
    let mut raw_prefixes = Vec::new();
    for (path, text) in leaves {
        match path
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>()
            .as_slice()
        {
            [_, "CommonPrefixes", "Prefix"] => raw_prefixes.push(text),
            [_, "Contents", "Size"] => page.sizes.push(text.trim().parse().map_err(|_| {
                VaultError::failure(format!("Invalid object size in S3 listing: {text}"))
            })?),
            [_, "IsTruncated"] => page.is_truncated = text.trim() == "true",
            [_, "NextContinuationToken"] => page.next_continuation_token = Some(text),
            [_, "EncodingType"] => url_encoded = text.trim() == "url",
            _ => {}
        }
    }
    page.common_prefixes = raw_prefixes
        .into_iter()
        .map(|p| {
            if url_encoded {
                // SDK `SdkHttpUtils.urlDecode` (form decoding: `+` is a space).
                percent_decode_str(&p.replace('+', " "))
                    .decode_utf8_lossy()
                    .into_owned()
            } else {
                p
            }
        })
        .collect();
    Ok(page)
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
                protocol: OnceCell::new(),
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
            bucket_regions: Mutex::new(HashMap::new()),
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

    fn credentials(&self) -> VaultResult<Option<&AwsCredentials>> {
        match &self.credentials {
            Ok(credentials) => Ok(credentials.as_ref()),
            Err(message) => Err(VaultError::Failure(DsError {
                exception: Some(format!(
                    "software.amazon.awssdk.core.exception.SdkClientException: {message}"
                )),
                ..DsError::failure(message.clone())
            })),
        }
    }

    fn cached_region(&self, bucket: &str) -> String {
        self.bucket_regions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(bucket)
            .cloned()
            .unwrap_or_else(|| DEFAULT_REGION.to_owned())
    }

    /// Scala `S3ClientPool.determineProtocol`: `https` if a `GET https://<authority>` gets any
    /// response, else `http`.
    async fn custom_protocol(
        &self,
        authority: &str,
        cell: &OnceCell<&'static str>,
    ) -> &'static str {
        *cell
            .get_or_init(|| async {
                let probe = self
                    .client
                    .get(format!("https://{authority}"))
                    .timeout(PROTOCOL_PROBE_TIMEOUT)
                    .send()
                    .await;
                if probe.is_ok() { "https" } else { "http" }
            })
            .await
    }

    /// `(base url, path prefix for the bucket, signing region)`.
    async fn target(&self, bucket: &str, region: &str) -> (String, String, String) {
        match &self.endpoint {
            Endpoint::Custom {
                authority,
                protocol,
                region,
            } => {
                let protocol = self.custom_protocol(authority, protocol).await;
                (
                    format!("{protocol}://{authority}"),
                    format!("/{}", sigv4::uri_encode(bucket, true)),
                    region.clone(),
                )
            }
            Endpoint::Aws {
                override_base: Some(base),
            } => (
                base.clone(),
                format!("/{}", sigv4::uri_encode(bucket, true)),
                region.to_owned(),
            ),
            Endpoint::Aws {
                override_base: None,
            } => {
                if is_virtual_host_compatible(bucket) {
                    (
                        format!("https://{bucket}.s3.{region}.amazonaws.com"),
                        String::new(),
                        region.to_owned(),
                    )
                } else {
                    (
                        format!("https://s3.{region}.amazonaws.com"),
                        format!("/{}", sigv4::uri_encode(bucket, true)),
                        region.to_owned(),
                    )
                }
            }
        }
    }

    /// Send one signed request (`key = None` addresses the bucket itself).
    async fn send_once(
        &self,
        method: Method,
        bucket: &str,
        key: Option<&str>,
        query: &[(String, String)],
        range: Option<String>,
        region: &str,
    ) -> VaultResult<S3Response> {
        let (base, bucket_path, signing_region) = self.target(bucket, region).await;
        let path = match key {
            Some(key) => format!("{bucket_path}/{}", sigv4::uri_encode(key, false)),
            None if bucket_path.is_empty() => "/".to_owned(),
            None => bucket_path,
        };
        let query_string = sigv4::canonical_query_string(query);
        let url_string = if query_string.is_empty() {
            format!("{base}{path}")
        } else {
            format!("{base}{path}?{query_string}")
        };
        let url = reqwest::Url::parse(&url_string).map_err(|e| {
            VaultError::failure(format!("Invalid S3 request url {url_string}: {e}"))
        })?;
        let host = match (url.host_str(), url.port()) {
            (Some(host), Some(port)) => format!("{host}:{port}"),
            (Some(host), None) => host.to_owned(),
            (None, _) => String::new(),
        };
        let mut headers: Vec<(String, String)> = vec![("host".into(), host)];
        if let Some(range) = range {
            headers.push(("range".into(), range));
        }
        let credentials = self.credentials()?;
        if let Some(credentials) = credentials {
            let amz_date = sigv4::amz_date(SystemTime::now());
            headers.push((
                "x-amz-content-sha256".into(),
                sigv4::EMPTY_PAYLOAD_SHA256.into(),
            ));
            headers.push(("x-amz-date".into(), amz_date.clone()));
            if let Some(token) = &credentials.session_token {
                headers.push(("x-amz-security-token".into(), token.clone()));
            }
            let authorization = sigv4::authorization(
                credentials,
                &SigningRequest {
                    method: method.as_str(),
                    canonical_uri: url.path(),
                    query,
                    headers: &headers,
                    payload_sha256: sigv4::EMPTY_PAYLOAD_SHA256,
                },
                &signing_region,
                "s3",
                &amz_date,
            );
            headers.push(("authorization".into(), authorization));
        }
        let mut request = self.client.request(method, url).timeout(REQUEST_TIMEOUT);
        for (name, value) in headers.iter().filter(|(n, _)| n != "host") {
            request = request.header(name.as_str(), value.as_str());
        }
        let response = request.send().await.map_err(transport_failure)?;
        let status = response.status();
        let headers = response.headers().clone();
        let body = response.bytes().await.map_err(transport_failure)?;
        Ok(S3Response {
            status,
            headers,
            body,
        })
    }

    /// `send_once` plus SDK cross-region access for Amazon endpoints.
    async fn send(
        &self,
        method: Method,
        key: Option<&str>,
        query: &[(String, String)],
        range: Option<String>,
    ) -> VaultResult<S3Response> {
        let bucket = self.bucket()?;
        let region = match self.endpoint {
            Endpoint::Custom { .. } => DEFAULT_REGION.to_owned(),
            Endpoint::Aws { .. } => self.cached_region(bucket),
        };
        let response = self
            .send_once(method.clone(), bucket, key, query, range.clone(), &region)
            .await?;
        if matches!(self.endpoint, Endpoint::Custom { .. }) || response.status.is_success() {
            return Ok(response);
        }
        let Some(new_region) = self.redirect_region(bucket, &region, &response).await else {
            return Ok(response);
        };
        if new_region == region {
            return Ok(response);
        }
        tracing::debug!(bucket, region = %new_region, "S3 cross-region access: retrying in the bucket's region");
        self.bucket_regions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(bucket.to_owned(), new_region.clone());
        self.send_once(method, bucket, key, query, range, &new_region)
            .await
    }

    /// SDK `S3CrossRegionRedirectUtils`: 301/307, an `x-amz-bucket-region` header or an
    /// `AuthorizationHeaderMalformed` error mark a region redirect. The region comes from the
    /// header, the error body, or a `HeadBucket` request.
    async fn redirect_region(
        &self,
        bucket: &str,
        region: &str,
        response: &S3Response,
    ) -> Option<String> {
        let header_region = response.header("x-amz-bucket-region");
        let error = parse_error_body(&response.body);
        let is_redirect = matches!(response.status.as_u16(), 301 | 307)
            || header_region.as_deref().is_some_and(|r| r != region)
            || error.code.as_deref() == Some("AuthorizationHeaderMalformed");
        if !is_redirect {
            return None;
        }
        if let Some(region) = header_region.or(error.region) {
            return Some(region);
        }
        let head = self
            .send_once(Method::HEAD, bucket, None, &[], None, region)
            .await
            .ok()?;
        head.header("x-amz-bucket-region")
    }

    /// Scala `S3ClientPool.getBucketRegion` (HeadBucket; the header is present even for denied or
    /// anonymous requests).
    pub async fn bucket_region(&self) -> VaultResult<String> {
        let bucket = self.bucket()?;
        let region = self.cached_region(bucket);
        let response = self
            .send_once(Method::HEAD, bucket, None, &[], None, &region)
            .await?;
        response
            .header("x-amz-bucket-region")
            .ok_or(VaultError::NotFound)
    }

    fn object_key(path: &UPath) -> VaultResult<String> {
        object_key_from_upath(path).map_err(VaultError::Failure)
    }

    /// Scala `notFoundToFailure(client.listObjectsV2(..))`.
    async fn list_objects(&self, query: Vec<(String, String)>) -> VaultResult<ListPage> {
        let response = self.send(Method::GET, None, &query, None).await?;
        if !response.status.is_success() {
            return Err(sdk_failure(&response));
        }
        parse_list_page(&response.body)
    }
}

fn query(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
    pairs
        .iter()
        .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
        .collect()
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
            let result = async {
                let response = self
                    .send(Method::GET, Some(&key), &[], range.to_range_header())
                    .await?;
                if response.status.is_success() {
                    return Ok(response);
                }
                let error = parse_error_body(&response.body);
                let not_found = response.status == StatusCode::NOT_FOUND
                    && matches!(
                        error.code.as_deref(),
                        None | Some("NoSuchKey") | Some("NoSuchBucket")
                    );
                if not_found {
                    Err(VaultError::NotFound)
                } else {
                    Err(sdk_failure(&response))
                }
            }
            .await;
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
            let response = result?;
            let encoding = response
                .header("content-encoding")
                .filter(|e| e != "aws-chunked")
                .unwrap_or_default();
            let encoding = Encoding::from_rfc7231(&encoding)?;
            Ok(RawRead {
                content_range: response.header("content-range"),
                bytes: response.body,
                encoding,
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
            let prefix = Self::object_key(path)?;
            let bucket = self.bucket()?.to_owned();
            // Common prefixes may filter out some results, so request a few more first.
            let max_keys = (max_items + 5).to_string();
            let page = self
                .list_objects(query(&[
                    ("list-type", "2"),
                    ("prefix", &prefix),
                    ("delimiter", "/"),
                    ("max-keys", &max_keys),
                    ("encoding-type", "url"),
                ]))
                .await?;
            page.common_prefixes
                .iter()
                .take(max_items)
                .map(|key| {
                    UPath::parse(&uri_literal_for_object_key(&self.uri, &bucket, key))
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
            let raw_prefix = Self::object_key(path)?;
            let prefix = if raw_prefix.ends_with('/') {
                raw_prefix
            } else {
                format!("{raw_prefix}/")
            };
            let mut total = 0u64;
            let mut continuation: Option<String> = None;
            loop {
                let mut pairs = query(&[
                    ("list-type", "2"),
                    ("prefix", &prefix),
                    ("max-keys", "1000"),
                    ("encoding-type", "url"),
                ]);
                if let Some(token) = &continuation {
                    pairs.push(("continuation-token".into(), token.clone()));
                }
                let page = self.list_objects(pairs).await?;
                total += page.sizes.iter().sum::<u64>();
                match (page.is_truncated, page.next_continuation_token) {
                    (true, Some(token)) => continuation = Some(token),
                    _ => return Ok(total),
                }
            }
        })
    }

    fn kind(&self) -> &'static str {
        "S3DataVault"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn uri(s: &str) -> RemoteUri {
        RemoteUri::parse(s).unwrap()
    }

    #[test]
    fn uri_styles_like_scala() {
        let short = uri("s3://my-bucket/a/b/");
        assert_eq!(host_bucket_from_uri(&short).as_deref(), Some("my-bucket"));
        assert_eq!(object_key_from_uri(&short).unwrap(), "a/b/");
        assert!(is_short_style(&short));
        assert!(!is_non_amazon_host(&short));

        let virtual_hosted = uri("s3://bucket.with.dots.s3.us-west-2.amazonaws.com/k/x");
        assert_eq!(
            host_bucket_from_uri(&virtual_hosted).as_deref(),
            Some("bucket.with.dots")
        );
        assert_eq!(object_key_from_uri(&virtual_hosted).unwrap(), "k/x");
        assert_eq!(
            host_bucket_from_uri(&uri("s3://b.s3-us-west-2.amazonaws.com/k")).as_deref(),
            Some("b")
        );
        assert_eq!(
            host_bucket_from_uri(&uri("s3://b.s3.amazonaws.com/k")).as_deref(),
            Some("b")
        );

        let amazon_path = uri("s3://s3.eu-central-1.amazonaws.com/bucket/key/x");
        assert_eq!(
            host_bucket_from_uri(&amazon_path).as_deref(),
            Some("bucket")
        );
        assert_eq!(object_key_from_uri(&amazon_path).unwrap(), "key/x");
        assert!(!is_non_amazon_host(&amazon_path));

        let minio = uri("s3://localhost:9000/bucket/a%20b");
        assert!(is_non_amazon_host(&minio));
        assert_eq!(object_key_from_uri(&minio).unwrap(), "a b");
        assert_eq!(
            uri_literal_for_object_key(&minio, "bucket", "x/"),
            "s3://localhost:9000/bucket/x/"
        );
        assert_eq!(
            uri_literal_for_object_key(&short, "my-bucket", "x/"),
            "s3://my-bucket/x/"
        );
        assert!(is_non_amazon_host(&uri("s3://minio.example.com/bucket")));
        assert_eq!(
            host_bucket_from_uri(&uri("s3://minio.example.com")),
            None,
            "path style without bucket"
        );

        let underscore = uri("s3://my_bucket/key");
        assert_eq!(host_bucket_from_uri(&underscore), None);
        assert_eq!(
            object_key_from_uri(&underscore).unwrap_err().message,
            "Not a valid s3 uri: s3://my_bucket/key"
        );
        assert_eq!(
            object_key_from_upath(&UPath::parse("gs://b/k").unwrap())
                .unwrap_err()
                .message,
            "Remote path has wrong schema for this feature. Expected s3, got gs."
        );
        assert_eq!(
            with_endpoint_host(&short, &aws_endpoint_host(Some("eu-west-1"))),
            "s3://s3.eu-west-1.amazonaws.com/my-bucket/a/b/"
        );
        assert_eq!(aws_endpoint_host(None), "s3.amazonaws.com");
    }

    #[test]
    fn signing_region_like_aws_host_name_utils() {
        assert_eq!(
            parse_signing_region("s3.eu-central-1.wasabisys.com").as_deref(),
            Some("eu-central-1")
        );
        assert_eq!(
            parse_signing_region("bucket.s3-us-west-1.example.org:9000").as_deref(),
            Some("us-west-1")
        );
        assert_eq!(parse_signing_region("localhost:9000"), None);
        assert_eq!(parse_signing_region("fsn1.your-objectstorage.com"), None);
        assert_eq!(parse_signing_region("s3.example"), None);
        assert_eq!(
            parse_signing_region("x.s3.a.s3.b.example").as_deref(),
            Some("b"),
            "greedy prefix: last candidate wins"
        );
    }

    #[test]
    fn parses_listing_and_errors() {
        let page = parse_list_page(
            br#"<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>b</Name>
<Prefix>data/</Prefix><EncodingType>url</EncodingType><IsTruncated>true</IsTruncated>
<NextContinuationToken>tok&amp;1</NextContinuationToken>
<Contents><Key>data/x</Key><Size>10</Size></Contents><Contents><Key>data/y</Key><Size>5</Size></Contents>
<CommonPrefixes><Prefix>data/a+b%2Fc/</Prefix></CommonPrefixes></ListBucketResult>"#,
        )
        .unwrap();
        assert_eq!(page.common_prefixes, vec!["data/a b/c/"]);
        assert_eq!(page.sizes, vec![10, 5]);
        assert!(page.is_truncated);
        assert_eq!(page.next_continuation_token.as_deref(), Some("tok&1"));

        let error = parse_error_body(
            b"<Error><Code>AuthorizationHeaderMalformed</Code><Message>bad &lt;region&gt;</Message><Region>eu-west-1</Region></Error>",
        );
        assert_eq!(error.code.as_deref(), Some("AuthorizationHeaderMalformed"));
        assert_eq!(error.message.as_deref(), Some("bad <region>"));
        assert_eq!(error.region.as_deref(), Some("eu-west-1"));
        assert!(is_virtual_host_compatible("my-bucket"));
        assert!(!is_virtual_host_compatible("my.bucket"));
    }
}
