//! Data vaults (DS1b): S3 and GCS reads, listings, credentials and retries through the
//! `object_store` clients against local mock servers, and `DataVaultService` dispatch, cache and
//! whitelist.

use crate::mock_wk;

use std::{
    collections::HashMap,
    io::Write,
    net::SocketAddr,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use axum::{
    Router,
    http::{HeaderMap, Method, StatusCode, Uri},
    response::{IntoResponse, Response},
};
use base64::{
    Engine,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};
use mock_wk::{MockWk, Reply};
use serde_json::{Value, json};
use webknossos_datastore::datavault::ToRemoteUri;
use webknossos_datastore::{
    clients::wk::WkClient,
    datavault::{
        AwsCredentials, ByteRange, CredentialLookup, CredentializedUPath, DataVault,
        DataVaultCredential, DataVaultService, DataVaultServiceOptions, Encoding, GcsOptions,
        GoogleCloudDataVault, HttpsDataVault, MSG_MAG_PATH_NOT_ABSOLUTE, MSG_SETUP_FAILED,
        RetryPolicy, S3DataVault, S3Options, UPath, VaultError, VaultPath,
    },
    error::{DsError, DsResult},
    models::{datasource::MagLocator, geometry::Vec3Int},
};

// ---------------------------------------------------------------------------------------------
// Mock object store
// ---------------------------------------------------------------------------------------------

#[derive(Clone, Debug)]
struct Req {
    method: String,
    /// Raw (still percent-encoded) path.
    path: String,
    query: Vec<(String, String)>,
    headers: HeaderMap,
}

impl Req {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name).and_then(|v| v.to_str().ok())
    }

    fn query_value(&self, name: &str) -> Option<&str> {
        self.query
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }
}

struct Resp {
    status: u16,
    headers: Vec<(&'static str, String)>,
    body: Vec<u8>,
}

impl Resp {
    fn new(status: u16, body: impl Into<Vec<u8>>) -> Self {
        Self {
            status,
            headers: Vec::new(),
            body: body.into(),
        }
    }

    fn with(mut self, name: &'static str, value: impl Into<String>) -> Self {
        self.headers.push((name, value.into()));
        self
    }
}

struct Mock {
    addr: SocketAddr,
    requests: Arc<Mutex<Vec<Req>>>,
}

impl Mock {
    async fn start(handler: impl Fn(&Req) -> Resp + Send + Sync + 'static) -> Self {
        let requests: Arc<Mutex<Vec<Req>>> = Arc::default();
        let recorded = Arc::clone(&requests);
        let handler = Arc::new(handler);
        let app = Router::new().fallback(move |method: Method, uri: Uri, headers: HeaderMap| {
            let recorded = Arc::clone(&recorded);
            let handler = Arc::clone(&handler);
            async move {
                let req = Req {
                    method: method.to_string(),
                    path: uri.path().to_owned(),
                    query: url::form_urlencoded::parse(uri.query().unwrap_or("").as_bytes())
                        .into_owned()
                        .collect(),
                    headers,
                };
                let resp = handler(&req);
                recorded.lock().unwrap().push(req);
                let mut response: Response =
                    (StatusCode::from_u16(resp.status).unwrap(), resp.body).into_response();
                for (name, value) in resp.headers {
                    response.headers_mut().insert(name, value.parse().unwrap());
                }
                response
            }
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        Self { addr, requests }
    }

    fn base(&self) -> String {
        format!("http://{}", self.addr)
    }

    fn requests(&self) -> Vec<Req> {
        self.requests.lock().unwrap().clone()
    }
}

fn upath(s: &str) -> UPath {
    UPath::parse(s).unwrap()
}

fn failure(error: VaultError) -> DsError {
    match error {
        VaultError::Failure(error) => error,
        VaultError::NotFound => panic!("expected a failure, got Empty"),
    }
}

fn gzip(data: &[u8]) -> Vec<u8> {
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    encoder.write_all(data).unwrap();
    encoder.finish().unwrap()
}

// ---------------------------------------------------------------------------------------------
// S3 (object_store client against a mock endpoint)
// ---------------------------------------------------------------------------------------------

fn pairs(items: &[(&str, &str)]) -> Vec<(String, String)> {
    items
        .iter()
        .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
        .collect()
}

fn s3_vault(path: &str, credential: Option<AwsCredentials>, options: &S3Options) -> S3DataVault {
    S3DataVault::new(
        upath(path).to_remote_uri().unwrap(),
        credential,
        reqwest::Client::new(),
        options,
    )
}

/// Retries as in production, without the waiting.
const FAST_RETRY: RetryPolicy = RetryPolicy {
    attempts: 3,
    initial_delay: Duration::from_millis(1),
};

fn s3_override(mock: &Mock) -> S3Options {
    S3Options {
        env_credentials: None,
        aws_endpoint_override: Some(mock.base()),
        read_retry: FAST_RETRY,
    }
}

const LAST_MODIFIED: &str = "Wed, 21 Oct 2026 07:28:00 GMT";

/// An object response with the metadata headers real stores send.
fn object(status: u16, body: impl Into<Vec<u8>>) -> Resp {
    Resp::new(status, body)
        .with("etag", "\"e1\"")
        .with("last-modified", LAST_MODIFIED)
}

/// `bytes=a-b` / `bytes=-n` served from `data` like S3 and GCS do.
fn ranged(req: &Req, data: &[u8]) -> Resp {
    let len = data.len();
    let Some(spec) = req.header("range").and_then(|r| r.strip_prefix("bytes=")) else {
        return object(200, data.to_vec());
    };
    let (start, end) = match spec.split_once('-').unwrap() {
        ("", suffix) => (len - suffix.parse::<usize>().unwrap().min(len), len - 1),
        (start, end) => (
            start.parse().unwrap(),
            end.parse::<usize>().unwrap().min(len - 1),
        ),
    };
    object(206, data[start..=end].to_vec())
        .with("content-range", format!("bytes {start}-{end}/{len}"))
}

/// Requests of the vault itself (without the unsigned bucket-region lookup).
fn object_requests(mock: &Mock) -> Vec<Req> {
    mock.requests()
        .into_iter()
        .filter(|r| r.method != "HEAD" || r.path.matches('/').count() > 1)
        .collect()
}

#[tokio::test]
async fn s3_signed_range_suffix_and_complete_reads() {
    let mock = Mock::start(|req| ranged(req, b"0123456789")).await;
    let vault = s3_vault(
        "s3://my-bucket/data/x%20y.bin",
        Some(AwsCredentials::new("AKID", "SECRET")),
        &s3_override(&mock),
    );
    let path = upath("s3://my-bucket/data/x%20y.bin");
    let read = |range| vault.read_bytes_encoding_and_range_header(&path, range, None);
    let ranged = read(ByteRange::start_end_exclusive(2, 6)).await.unwrap();
    assert_eq!(&ranged.bytes[..], b"2345");
    assert_eq!(ranged.encoding, Encoding::Identity);
    assert_eq!(ranged.content_range.as_deref(), Some("bytes 2-5/10"));
    let suffix = read(ByteRange::suffix(3)).await.unwrap();
    assert_eq!(&suffix.bytes[..], b"789");
    assert_eq!(suffix.content_range.as_deref(), Some("bytes 7-9/10"));
    let complete = read(ByteRange::Complete).await.unwrap();
    assert_eq!(&complete.bytes[..], b"0123456789");
    assert_eq!(complete.content_range, None);
    // A range past the end is clamped like S3 does.
    let clamped = read(ByteRange::start_end_exclusive(8, 20)).await.unwrap();
    assert_eq!(&clamped.bytes[..], b"89");

    let requests = object_requests(&mock);
    assert_eq!(requests.len(), 4);
    for req in &requests {
        assert_eq!(req.method, "GET");
        assert_eq!(req.path, "/my-bucket/data/x%20y.bin");
        assert!(req.query.is_empty());
        let authorization = req.header("authorization").unwrap();
        assert!(authorization.starts_with("AWS4-HMAC-SHA256 Credential=AKID/"));
        assert!(authorization.contains("/us-east-1/s3/aws4_request"));
    }
    assert_eq!(requests[0].header("range"), Some("bytes=2-5"));
    assert_eq!(requests[1].header("range"), Some("bytes=-3"));
    assert_eq!(requests[2].header("range"), None);
}

#[tokio::test]
async fn s3_zero_length_read_only_checks_the_object() {
    let mock = Mock::start(|req| match req.path.as_str() {
        "/b/k" => object(200, "").with("content-length", "10"),
        _ => Resp::new(404, ""),
    })
    .await;
    let vault = s3_vault("s3://b/k", None, &s3_override(&mock));
    let read = vault
        .read_bytes_encoding_and_range_header(
            &upath("s3://b/k"),
            ByteRange::start_end_exclusive(4, 4),
            None,
        )
        .await
        .unwrap();
    assert!(read.bytes.is_empty());
    assert_eq!(read.content_range.as_deref(), Some("bytes 4-3/10"));
    let missing = vault
        .read_bytes_encoding_and_range_header(
            &upath("s3://b/other"),
            ByteRange::start_end_exclusive(4, 4),
            None,
        )
        .await
        .unwrap_err();
    assert_eq!(missing, VaultError::NotFound);
    assert!(object_requests(&mock).iter().all(|r| r.method == "HEAD"));
}

#[tokio::test]
async fn http_range_requests_keep_the_credential_headers() {
    let mock = Mock::start(|req| match req.method.as_str() {
        "HEAD" => Resp::new(200, "")
            .with("accept-ranges", "bytes")
            .with("content-length", "10"),
        _ => Resp::new(206, "2345").with("content-range", "bytes 2-5/10"),
    })
    .await;
    let url = format!("{}/data.bin", mock.base());
    let path = upath(&url);
    for (credential, header, expected) in [
        (
            DataVaultCredential::XAuthToken {
                name: "x".into(),
                token_value: "secret".into(),
                user: None,
                organization: None,
            },
            "x-auth-token",
            "secret",
        ),
        (basic_credential(), "authorization", "Basic YWxpY2U6cHc="),
    ] {
        let vault = HttpsDataVault::new(
            Some(credential),
            reqwest::Client::new(),
            "http://datastore.invalid",
        );
        let read = vault
            .read_bytes_encoding_and_range_header(&path, ByteRange::start_end_exclusive(2, 6), None)
            .await
            .unwrap_or_else(|e| panic!("{e:?}"));
        assert_eq!(read.bytes.as_ref(), b"2345");
        let requests = mock.requests();
        let ranged = requests
            .iter()
            .rev()
            .find(|r| r.method == "GET")
            .expect("range request");
        assert_eq!(ranged.header("range"), Some("bytes=2-5"));
        assert_eq!(ranged.header(header), Some(expected));
    }
}

#[tokio::test]
async fn s3_anonymous_and_env_session_credentials() {
    let mock = Mock::start(|_| object(200, "ok")).await;
    let path = upath("s3://my-bucket/k");
    let anonymous = s3_vault("s3://my-bucket/k", None, &s3_override(&mock));
    anonymous
        .read_bytes_encoding_and_range_header(&path, ByteRange::Complete, None)
        .await
        .unwrap();

    let mut env = AwsCredentials::new("ENVID", "ENVSECRET");
    env.session_token = Some("session-tok".into());
    let options = S3Options {
        env_credentials: Some(Ok(env.clone())),
        ..s3_override(&mock)
    };
    s3_vault("s3://my-bucket/k", None, &options)
        .read_bytes_encoding_and_range_header(&path, ByteRange::Complete, None)
        .await
        .unwrap();

    // An explicit credential wins over the environment.
    s3_vault(
        "s3://my-bucket/k",
        Some(AwsCredentials::new("OWN", "S")),
        &options,
    )
    .read_bytes_encoding_and_range_header(&path, ByteRange::Complete, None)
    .await
    .unwrap();

    let incomplete = S3Options {
        env_credentials: Some(Err(
            "Unable to load credentials from system settings.".into()
        )),
        ..s3_override(&mock)
    };
    let error = s3_vault("s3://my-bucket/k", None, &incomplete)
        .read_bytes_encoding_and_range_header(&path, ByteRange::Complete, None)
        .await
        .unwrap_err();
    assert_eq!(
        failure(error).message,
        "Unable to load credentials from system settings."
    );

    let requests: Vec<Req> = object_requests(&mock);
    assert_eq!(requests.len(), 3);
    assert_eq!(requests[0].header("authorization"), None);
    assert_eq!(requests[0].header("x-amz-date"), None);
    assert_eq!(
        requests[1].header("x-amz-security-token"),
        Some("session-tok")
    );
    let authorization = requests[1].header("authorization").unwrap();
    assert!(authorization.starts_with("AWS4-HMAC-SHA256 Credential=ENVID/"));
    assert!(authorization.contains("x-amz-security-token"));
    assert!(
        requests[2]
            .header("authorization")
            .unwrap()
            .starts_with("AWS4-HMAC-SHA256 Credential=OWN/")
    );
}

#[tokio::test]
async fn s3_maps_not_found_to_empty_and_errors_to_failures() {
    let mock = Mock::start(|req| match req.path.as_str() {
        "/b/missing" => Resp::new(
            404,
            "<Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>",
        ),
        "/b/nobucket" => Resp::new(404, "<Error><Code>NoSuchBucket</Code></Error>"),
        "/b/denied" => Resp::new(
            403,
            "<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>",
        ),
        "/b/gz" => object(200, gzip(b"hello")).with("content-encoding", "gzip"),
        "/b/chunked" => object(200, "raw").with("content-encoding", "aws-chunked"),
        _ => Resp::new(500, ""),
    })
    .await;
    let options = s3_override(&mock);
    let vault: Arc<dyn DataVault> = Arc::new(s3_vault("s3://b/", None, &options));
    let read = |key: &str| {
        let vault = Arc::clone(&vault);
        let path = upath(&format!("s3://b/{key}"));
        async move {
            vault
                .read_bytes_encoding_and_range_header(&path, ByteRange::Complete, None)
                .await
        }
    };
    assert_eq!(read("missing").await.unwrap_err(), VaultError::NotFound);
    assert_eq!(read("nobucket").await.unwrap_err(), VaultError::NotFound);
    let denied = failure(read("denied").await.unwrap_err());
    assert!(denied.message.contains("403"), "{}", denied.message);
    assert!(
        denied.message.contains("Access Denied"),
        "{}",
        denied.message
    );
    let gz = read("gz").await.unwrap();
    assert_eq!(gz.encoding, Encoding::Gzip);
    let decoded = VaultPath::new(upath("s3://b/gz"), Arc::clone(&vault))
        .read_bytes(ByteRange::Complete, None)
        .await
        .unwrap();
    assert_eq!(&decoded[..], b"hello");
    assert_eq!(read("chunked").await.unwrap().encoding, Encoding::Identity);
    // `VaultPath` keeps `Empty` and annotates failures.
    let vault_path = VaultPath::new(upath("s3://b/missing"), Arc::clone(&vault));
    assert!(
        vault_path
            .read_bytes(ByteRange::Complete, None)
            .await
            .unwrap_err()
            .is_not_found()
    );
}

#[tokio::test]
async fn s3_transient_failures_are_retried() {
    let flaky = AtomicUsize::new(0);
    let mock = Mock::start(move |req| match req.path.as_str() {
        "/b/flaky" if flaky.fetch_add(1, Ordering::SeqCst) == 0 => Resp::new(
            503,
            "<Error><Code>SlowDown</Code><Message>Reduce your request rate.</Message></Error>",
        ),
        "/b/flaky" => Resp::new(500, "<Error><Code>InternalError</Code></Error>"),
        "/b/throttled" => Resp::new(429, ""),
        "/b/denied" => Resp::new(
            403,
            "<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>",
        ),
        "/b/missing" => Resp::new(404, "<Error><Code>NoSuchKey</Code></Error>"),
        _ => object(200, "data"),
    })
    .await;
    let options = s3_override(&mock);
    let vault = s3_vault("s3://b/", None, &options);
    let read = |key: &str| {
        let path = upath(&format!("s3://b/{key}"));
        let vault = &vault;
        async move {
            vault
                .read_bytes_encoding_and_range_header(&path, ByteRange::Complete, None)
                .await
        }
    };
    let attempts = |key: &str| {
        mock.requests()
            .iter()
            .filter(|r| r.path == format!("/b/{key}"))
            .count()
    };
    let error = failure(read("flaky").await.unwrap_err());
    assert_eq!(attempts("flaky"), 3);
    assert!(error.message.contains("500"), "{}", error.message);
    assert!(read("throttled").await.is_err());
    assert_eq!(attempts("throttled"), 3);
    assert!(read("denied").await.is_err());
    assert_eq!(attempts("denied"), 1);
    assert_eq!(read("missing").await.unwrap_err(), VaultError::NotFound);
    assert_eq!(attempts("missing"), 1);

    let recovering = AtomicUsize::new(0);
    let mock = Mock::start(move |req| {
        if req.method == "HEAD" {
            return Resp::new(404, "");
        }
        match recovering.fetch_add(1, Ordering::SeqCst) {
            0 | 1 => Resp::new(503, "<Error><Code>ServiceUnavailable</Code></Error>"),
            _ => ranged(req, b"0123456789"),
        }
    })
    .await;
    let vault = s3_vault("s3://b/", None, &s3_override(&mock));
    let read = vault
        .read_bytes_encoding_and_range_header(
            &upath("s3://b/k"),
            ByteRange::start_end_exclusive(3, 6),
            None,
        )
        .await
        .unwrap();
    assert_eq!(&read.bytes[..], b"345");
    let requests = object_requests(&mock);
    assert_eq!(requests.len(), 3);
    assert!(
        requests
            .iter()
            .all(|r| r.header("range") == Some("bytes=3-5"))
    );
}

#[tokio::test]
async fn s3_bucket_region_is_looked_up_once_and_used_for_signing() {
    let mock = Mock::start(|req| match req.method.as_str() {
        "HEAD" => Resp::new(403, "").with("x-amz-bucket-region", "eu-west-1"),
        _ => object(200, "data"),
    })
    .await;
    let vault = s3_vault(
        "s3://bucket/k",
        Some(AwsCredentials::new("AKID", "SECRET")),
        &s3_override(&mock),
    );
    assert_eq!(vault.bucket_region().await.unwrap(), "eu-west-1");
    let path = upath("s3://bucket/k");
    for _ in 0..2 {
        let read = vault
            .read_bytes_encoding_and_range_header(&path, ByteRange::Complete, None)
            .await
            .unwrap();
        assert_eq!(&read.bytes[..], b"data");
    }
    let requests = mock.requests();
    let lookups: Vec<&Req> = requests.iter().filter(|r| r.method == "HEAD").collect();
    assert_eq!(lookups.len(), 1, "the region is cached");
    assert_eq!(lookups[0].path, "/bucket");
    // Signed with the vault's credentials for the default region, like Scala's `HeadBucket`.
    let authorization = lookups[0].header("authorization").unwrap();
    assert!(authorization.starts_with("AWS4-HMAC-SHA256 Credential=AKID/"));
    assert!(authorization.contains("/us-east-1/s3/aws4_request"));
    let reads: Vec<&Req> = requests.iter().filter(|r| r.method == "GET").collect();
    assert_eq!(reads.len(), 2);
    for read in reads {
        assert!(
            read.header("authorization")
                .unwrap()
                .contains("/eu-west-1/s3/aws4_request")
        );
    }
}

#[tokio::test]
async fn s3_listing_and_used_storage() {
    let mock = Mock::start(|req| {
        if req.query_value("delimiter").is_some() {
            return Resp::new(
                200,
                r#"<?xml version="1.0" encoding="UTF-8"?><ListBucketResult>
<CommonPrefixes><Prefix>data/a/</Prefix></CommonPrefixes>
<CommonPrefixes><Prefix>data/b c/</Prefix></CommonPrefixes>
<CommonPrefixes><Prefix>data/d/</Prefix></CommonPrefixes></ListBucketResult>"#,
            );
        }
        let entry = |key: &str, size: u64| {
            format!(
                "<Contents><Key>{key}</Key><Size>{size}</Size><LastModified>2026-10-21T07:28:00.000Z</LastModified></Contents>"
            )
        };
        match req.query_value("continuation-token") {
            None => Resp::new(
                200,
                format!(
                    "<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>t 1</NextContinuationToken>{}{}</ListBucketResult>",
                    entry("data/x", 10),
                    entry("data/y", 20)
                ),
            ),
            Some(_) => Resp::new(
                200,
                format!(
                    "<ListBucketResult><IsTruncated>false</IsTruncated>{}</ListBucketResult>",
                    entry("data/z", 12)
                ),
            ),
        }
    })
    .await;
    let vault = s3_vault("s3://bucket/data/", None, &s3_override(&mock));
    let listed = vault
        .list_directory(&upath("s3://bucket/data/"), 2, None)
        .await
        .unwrap();
    let listed: Vec<String> = listed.iter().map(UPath::to_string).collect();
    assert_eq!(listed, vec!["s3://bucket/data/a/", "s3://bucket/data/b c/"]);
    let size = vault
        .used_storage_bytes(&upath("s3://bucket/data"), None)
        .await
        .unwrap();
    assert_eq!(size, 42);

    let requests = object_requests(&mock);
    assert_eq!(requests.len(), 3);
    assert_eq!(requests[0].path, "/bucket");
    let query = |req: &Req| {
        let mut q = req.query.clone();
        q.sort();
        q
    };
    assert_eq!(
        query(&requests[0]),
        pairs(&[
            ("delimiter", "/"),
            ("list-type", "2"),
            ("max-keys", "7"),
            ("prefix", "data/"),
        ])
    );
    assert_eq!(
        query(&requests[1]),
        pairs(&[("list-type", "2"), ("prefix", "data/")])
    );
    assert_eq!(requests[2].query_value("continuation-token"), Some("t 1"));
}

#[tokio::test]
async fn s3_listing_not_found_is_a_failure() {
    let mock = Mock::start(|_| {
        Resp::new(
            404,
            "<Error><Code>NoSuchBucket</Code><Message>The specified bucket does not exist</Message></Error>",
        )
    })
    .await;
    let vault = s3_vault("s3://bucket/data/", None, &s3_override(&mock));
    let error = vault
        .list_directory(&upath("s3://bucket/data/"), 2, None)
        .await
        .unwrap_err();
    let error = failure(error);
    assert!(
        error
            .message
            .contains("The specified bucket does not exist"),
        "{}",
        error.message
    );
}

#[tokio::test]
async fn s3_custom_endpoint_uses_path_style_over_http() {
    let mock = Mock::start(|req| ranged(req, b"minio-data")).await;
    let path = format!("s3://{}/bucket/dir/key.bin", mock.addr);
    // The AWS override must not apply to custom endpoints.
    let options = S3Options {
        env_credentials: None,
        aws_endpoint_override: Some("http://127.0.0.1:1".into()),
        read_retry: FAST_RETRY,
    };
    let vault = s3_vault(
        &path,
        Some(AwsCredentials::new("MINIO", "MINIOSECRET")),
        &options,
    );
    let read = vault
        .read_bytes_encoding_and_range_header(
            &upath(&path),
            ByteRange::start_end_exclusive(0, 5),
            None,
        )
        .await
        .unwrap();
    assert_eq!(&read.bytes[..], b"minio");
    let requests = mock.requests();
    assert_eq!(
        requests.len(),
        1,
        "the HTTPS probe never reaches the plain HTTP server as HTTP"
    );
    assert_eq!(requests[0].path, "/bucket/dir/key.bin");
    assert_eq!(
        requests[0].header("host"),
        Some(mock.addr.to_string().as_str())
    );
    let authorization = requests[0].header("authorization").unwrap();
    assert!(authorization.starts_with("AWS4-HMAC-SHA256 Credential=MINIO/"));
    assert!(authorization.contains("/us-east-1/s3/aws4_request"));
}

// ---------------------------------------------------------------------------------------------
// GCS (object_store client against a mock endpoint)
// ---------------------------------------------------------------------------------------------

const TEST_RSA_KEY: &str = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDRoCjhHYgv9Akf\nuWshEOxlAnLLXJqt4bPsgiwDslj9/f9+DwsIRrFV3n4W+o3YFYD7rLb5eDi6lSft\n3C0s8l5xGlawY0oNDV9EixicriN1wUNHIET+iBoGPIv/+EvxcdD74dNkrImGMZ7e\nyEw8kcWC1sovujyzicoUu0G/jmAdkh2cYaWh4lbuC5zgqu85f72En5XOk3sI6AgG\n2oKiSpR+rLv51KxWztujcJWoiR69FieYXBkjYDopp58JQq3+/eosCLLXDc8I459y\nYfuC5dzHraHQWa1sCpNsJmiIFcs7NH+hnAF0VNt7VmaFBqv+BWAkU3vKVfR+Rqbj\ntRBKktm9AgMBAAECggEAS9Iixx3v6uxZOnzN92VQI87pZ44Espz+/64rrmCdWK08\n8sMNKf6r2NPDhps0n/JTN3TGr+AgoLgfe6TWQDogF8e/kEgxehwal8e57L39vHNd\nWsYcvnXK9/OBbeHI0jlpLhoF5JWVnpCnFoybKpNNPeBjvDSgDQ5rJel/RAKC2F6g\nD7gaJ2eY0g+roHBYdyBwD7PCiRCy5+3JLk2EU9dmVp+0OamwHH00EMasbJWQRrIW\n7bo2wqAd+SAo6Pc719w6zRUI1xJBRO6Gy0g5xUElDZK6FeWHQIAhqJFL+ylmxT31\n8MEP7mZNLVx8XCY6ttzjCArMFaT0gh8akr01iacejwKBgQDyYPgXo5q9MY1IpWKv\nEniFXv7AEHIfBR/+qJFyoP/vVlz/zBgumVPIvPNvcmjUn9ocBXV4arP5mH95G6DF\n8nM2uVgIvRrmMossLsfe8zgINPop9W5DSCT3MtsHMzpk6uI3kxGFyUeAE9/IqaAC\nyind5yjDB5mth7oJLteiJ2coKwKBgQDdZ/sMeoK3HtMDKbTEMcvmeSTPMG/BGngn\n6KHL3GGhVuwYBo5frs+7Sdvw3+hIuqKj8qjkTqd2JZSIbi3RW6HVASfAvd1fEdfJ\nTSuWZyjiLaEuxGw3Ak+xgJl7jxAdCWMLwpZKXOMlVYHXKJA/FZcjK6V1TolNH5pX\nHGipW9LptwKBgQDewlBBKZPlnc0Dnzx7OraZnRz02CiKaeNl4PcMKvwNs4n1blYr\nPa/LJh11p+jAwclrR3kXGroeAxHk9IdmZdWNzfoizeoS9xEBolz/gvlUUZw5Q9/6\n5itTJeI3U9WvOlB+UyQfmUWlaJ6bhYoSBktELldAJ5QN8FgCaJK17RDZ0QKBgG1s\npJDoQ45Jd7SKekK08bc4jE6x+6mOcXAX808T3lSk5w6AvwDfHt/Lgx4rK1w2kYdB\nuOMNVIp5zE0ZVx+vj+38Ii+KJsyDvwhIUZCF75jJQG4iufD9/XEWw8RjUm1nZEI9\nq5WZDtI2znMOIyxqeUXynlW5uPYa9mazLa72KOlFAoGABIRms7Qs9/XMET5qLPjK\nyC28jcIDNej7hJB62I0BlALFclAghRhdsL6VDtu5Kx73eQFFvNq2YFtpzg0JfH5F\nzxxFDnlvn9voXF1qv5bpRxHfodBsM4f4zdpvjAIRcszA68p2mOD+HDqaGt7by56L\n1NfeTfPam3FZWBnJrXhlFWk=\n-----END PRIVATE KEY-----";

fn decoded(path: &str) -> String {
    percent_encoding::percent_decode_str(path)
        .decode_utf8_lossy()
        .into_owned()
}

fn gcs_options(mock: &Mock) -> GcsOptions {
    GcsOptions {
        endpoint: mock.base(),
        default_service_account_json: None,
        read_retry: FAST_RETRY,
    }
}

fn gcs_vault(path: &str, secret: Option<&str>, options: &GcsOptions) -> GoogleCloudDataVault {
    GoogleCloudDataVault::new(upath(path).to_remote_uri().unwrap(), secret, options)
}

fn service_account_json() -> String {
    json!({
        "type": "service_account",
        "project_id": "p",
        "private_key_id": "kid1",
        "private_key": TEST_RSA_KEY,
        "client_email": "sa@p.iam.gserviceaccount.com",
        "client_id": "1",
    })
    .to_string()
}

#[tokio::test]
async fn gcs_anonymous_reads_with_ranges_and_stored_encoding() {
    let stored = gzip(b"hello gcs");
    // object_store percent-encodes the whole object name (`/` as `%2F`), which GCS accepts.
    let mock = Mock::start(move |req| match decoded(&req.path).as_str() {
        "/bucket/dir/obj a.bin" => ranged(req, b"0123456789"),
        "/bucket/gz" => object(200, stored.clone()).with("content-encoding", "gzip"),
        _ => Resp::new(404, "<Error><Code>NoSuchKey</Code></Error>"),
    })
    .await;
    let options = gcs_options(&mock);
    let vault: Arc<dyn DataVault> = Arc::new(gcs_vault("gs://bucket/", None, &options));
    let path = upath("gs://bucket/dir/obj%20a.bin");
    let ranged = vault
        .read_bytes_encoding_and_range_header(&path, ByteRange::start_end_exclusive(2, 6), None)
        .await
        .unwrap();
    assert_eq!(&ranged.bytes[..], b"2345");
    assert_eq!(ranged.content_range.as_deref(), Some("bytes 2-5/10"));
    let suffix = vault
        .read_bytes_encoding_and_range_header(&path, ByteRange::suffix(2), None)
        .await
        .unwrap();
    assert_eq!(&suffix.bytes[..], b"89");

    let gz = vault
        .read_bytes_encoding_and_range_header(&upath("gs://bucket/gz"), ByteRange::Complete, None)
        .await
        .unwrap();
    assert_eq!(gz.encoding, Encoding::Gzip);
    let decoded = VaultPath::new(upath("gs://bucket/gz"), Arc::clone(&vault))
        .read_bytes(ByteRange::Complete, None)
        .await
        .unwrap();
    assert_eq!(&decoded[..], b"hello gcs");
    let missing = vault
        .read_bytes_encoding_and_range_header(
            &upath("gs://bucket/missing"),
            ByteRange::Complete,
            None,
        )
        .await
        .unwrap_err();
    assert_eq!(missing, VaultError::NotFound);

    for req in mock.requests() {
        assert_eq!(req.method, "GET");
        // Stored bytes, never transcoded.
        assert_eq!(req.header("accept-encoding"), Some("gzip"));
        assert_eq!(req.header("authorization"), None);
    }
}

#[tokio::test]
async fn gcs_transient_failures_are_retried() {
    let calls = AtomicUsize::new(0);
    let mock = Mock::start(move |req| match decoded(&req.path).as_str() {
        "/bucket/flaky" if calls.fetch_add(1, Ordering::SeqCst) < 2 => Resp::new(503, ""),
        "/bucket/flaky" => object(200, "ok"),
        "/bucket/denied" => Resp::new(403, "Access denied."),
        _ => Resp::new(500, ""),
    })
    .await;
    let vault = gcs_vault("gs://bucket/", None, &gcs_options(&mock));
    let read = vault
        .read_bytes_encoding_and_range_header(
            &upath("gs://bucket/flaky"),
            ByteRange::Complete,
            None,
        )
        .await
        .unwrap();
    assert_eq!(&read.bytes[..], b"ok");
    let denied = vault
        .read_bytes_encoding_and_range_header(
            &upath("gs://bucket/denied"),
            ByteRange::Complete,
            None,
        )
        .await
        .unwrap_err();
    assert!(failure(denied).message.contains("403"));
    let attempts = |path: &str| mock.requests().iter().filter(|r| r.path == path).count();
    assert_eq!(attempts("/bucket/flaky"), 3);
    assert_eq!(attempts("/bucket/denied"), 1);
}

#[tokio::test]
async fn gcs_listing_and_used_storage() {
    let mock = Mock::start(|req| {
        if req.query_value("delimiter").is_some() {
            return Resp::new(
                200,
                r#"<?xml version="1.0" encoding="UTF-8"?><ListBucketResult>
<CommonPrefixes><Prefix>data/a/</Prefix></CommonPrefixes>
<CommonPrefixes><Prefix>data/b/</Prefix></CommonPrefixes>
<CommonPrefixes><Prefix>data/c/</Prefix></CommonPrefixes></ListBucketResult>"#,
            );
        }
        let entry = |key: &str, size: u64| {
            format!(
                "<Contents><Key>{key}</Key><Size>{size}</Size><LastModified>2026-10-21T07:28:00.000Z</LastModified></Contents>"
            )
        };
        match req.query_value("continuation-token") {
            None => Resp::new(
                200,
                format!(
                    "<ListBucketResult><NextContinuationToken>p2</NextContinuationToken>{}</ListBucketResult>",
                    entry("data/x", 7)
                ),
            ),
            Some(_) => Resp::new(
                200,
                format!(
                    "<ListBucketResult>{}</ListBucketResult>",
                    entry("data/y", 5)
                ),
            ),
        }
    })
    .await;
    let vault = gcs_vault("gs://bucket/", None, &gcs_options(&mock));
    let listed = vault
        .list_directory(&upath("gs://bucket/data/"), 2, None)
        .await
        .unwrap();
    let listed: Vec<String> = listed.iter().map(UPath::to_string).collect();
    assert_eq!(listed, vec!["gs://bucket/data/a/", "gs://bucket/data/b/"]);
    let size = vault
        .used_storage_bytes(&upath("gs://bucket/data/"), None)
        .await
        .unwrap();
    assert_eq!(size, 12);
    let requests = mock.requests();
    assert_eq!(requests.len(), 3);
    assert!(requests.iter().all(|r| r.path == "/bucket"));
    assert_eq!(requests[0].query_value("prefix"), Some("data/"));
    assert_eq!(requests[2].query_value("continuation-token"), Some("p2"));
}

#[tokio::test]
async fn gcs_service_account_requests_carry_a_self_signed_token() {
    let mock = Mock::start(|_| object(200, "secret data")).await;
    let options = gcs_options(&mock);
    let secret = service_account_json();
    let vault = gcs_vault("gs://bucket/", Some(&secret), &options);
    for _ in 0..2 {
        vault
            .read_bytes_encoding_and_range_header(
                &upath("gs://bucket/o"),
                ByteRange::Complete,
                None,
            )
            .await
            .unwrap();
    }
    // Application default credentials apply when the vault has none.
    let defaulted = GcsOptions {
        default_service_account_json: Some(secret.clone()),
        ..gcs_options(&mock)
    };
    gcs_vault("gs://bucket/", None, &defaulted)
        .read_bytes_encoding_and_range_header(&upath("gs://bucket/o"), ByteRange::Complete, None)
        .await
        .unwrap();
    let requests = mock.requests();
    assert_eq!(requests.len(), 3);
    for req in &requests {
        let token = req
            .header("authorization")
            .and_then(|a| a.strip_prefix("Bearer "))
            .expect("bearer token");
        let mut parts = token.split('.');
        let header: Value =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(parts.next().unwrap()).unwrap())
                .unwrap();
        let claims: Value =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(parts.next().unwrap()).unwrap())
                .unwrap();
        assert_eq!(header["alg"], "RS256");
        assert_eq!(header["kid"], "kid1");
        assert_eq!(claims["iss"], "sa@p.iam.gserviceaccount.com");
        assert!(!parts.next().unwrap().is_empty(), "signed");
    }
}

#[tokio::test]
async fn gcs_invalid_service_account_fails_on_use_without_leaking() {
    let mock = Mock::start(|_| object(200, "x")).await;
    let options = gcs_options(&mock);
    let broken = json!({
        "type": "service_account",
        "private_key_id": "kid1",
        "private_key": "-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----",
        "client_email": "sa@p.iam.gserviceaccount.com",
    })
    .to_string();
    let vault = gcs_vault("gs://bucket/", Some(&broken), &options);
    let error = vault
        .read_bytes_encoding_and_range_header(&upath("gs://bucket/o"), ByteRange::Complete, None)
        .await
        .unwrap_err();
    let error = failure(error);
    assert!(!error.message.contains("not-a-key"), "{}", error.message);
    assert!(!format!("{vault:?}").contains("PRIVATE"));
    assert!(mock.requests().is_empty());
}

// ---------------------------------------------------------------------------------------------
// DataVaultService
// ---------------------------------------------------------------------------------------------

#[derive(Default)]
struct MapLookup {
    credentials: HashMap<String, DataVaultCredential>,
    calls: Mutex<Vec<String>>,
}

impl CredentialLookup for MapLookup {
    fn find_credential<'a>(
        &'a self,
        credential_id: &'a str,
    ) -> webknossos_datastore::datavault::BoxFuture<'a, DsResult<DataVaultCredential>> {
        self.calls.lock().unwrap().push(credential_id.to_owned());
        let result = self
            .credentials
            .get(credential_id)
            .cloned()
            .ok_or_else(|| DsError::failure("Could not find credential"));
        Box::pin(async move { result })
    }
}

fn s3_credential(name: &str, key: &str) -> DataVaultCredential {
    DataVaultCredential::S3AccessKey {
        name: name.into(),
        access_key_id: key.into(),
        secret_access_key: "secret".into(),
        user: None,
        organization: None,
    }
}

fn basic_credential() -> DataVaultCredential {
    DataVaultCredential::HttpBasicAuth {
        name: "http".into(),
        username: "alice".into(),
        password: "pw".into(),
        user: None,
        organization: None,
    }
}

fn service_with(lookup: Arc<MapLookup>, whitelist: &[&str]) -> DataVaultService {
    DataVaultService::new(
        DataVaultServiceOptions {
            datastore_uri: "http://localhost:9090".into(),
            local_directory_whitelist: whitelist.iter().map(|s| (*s).to_owned()).collect(),
            global_credentials: vec![s3_credential("s3://managed-bucket/", "GLOBALKEY")],
            working_dir: PathBuf::from("/data/wk"),
            s3: S3Options::default(),
            gcs: GcsOptions::default(),
        },
        lookup,
    )
}

#[tokio::test]
async fn service_dispatches_by_scheme_and_caches_vaults() {
    let service = service_with(Arc::default(), &[]);
    for (path, kind) in [
        ("gs://bucket/x", "GoogleCloudDataVault"),
        ("s3://bucket/x", "S3DataVault"),
        ("https://example.com/x", "HttpsDataVault"),
        ("http://example.com/x", "HttpsDataVault"),
        ("/data/wk/binaryData/x", "FileSystemDataVault"),
    ] {
        let vault_path = service.vault_path_for(&upath(path)).await.unwrap();
        assert_eq!(vault_path.vault().kind(), kind, "{path}");
        assert_eq!(vault_path.upath(), &upath(path));
    }
    assert_eq!(service.cached_vault_count(), 5);

    let first = service
        .vault_path_for(&upath("s3://bucket/x"))
        .await
        .unwrap();
    let second = service
        .vault_path_for(&upath("s3://bucket/x"))
        .await
        .unwrap();
    assert!(
        Arc::ptr_eq(first.vault(), second.vault()),
        "cached per CredentializedUPath"
    );
    assert_eq!(service.cached_vault_count(), 5);
    let with_credential = service
        .vault_path_for_credentialized(CredentializedUPath::new(
            upath("s3://bucket/x"),
            Some(s3_credential("other", "OTHERKEY")),
        ))
        .await
        .unwrap();
    assert!(!Arc::ptr_eq(first.vault(), with_credential.vault()));
    assert!(format!("{:?}", with_credential.vault()).contains("OTHERKEY"));
    assert_eq!(service.cached_vault_count(), 6);

    let unknown = service
        .vault_path_for(&upath("ftp://host/x"))
        .await
        .unwrap_err();
    assert_eq!(unknown.message, MSG_SETUP_FAILED);
    assert_eq!(
        unknown.chain,
        vec!["Unknown file system scheme Some(ftp)".to_owned()]
    );
    assert_eq!(service.cached_vault_count(), 6, "failures are not cached");

    let wrong_credential = service
        .vault_path_for_credentialized(CredentializedUPath::new(
            upath("gs://bucket/y"),
            Some(basic_credential()),
        ))
        .await
        .unwrap_err();
    assert_eq!(wrong_credential.message, MSG_SETUP_FAILED);
    assert!(
        wrong_credential.chain[0].contains("java.lang.ClassCastException: class com.scalableminds.webknossos.datastore.storage.HttpBasicAuthCredential cannot be cast to class com.scalableminds.webknossos.datastore.storage.GoogleServiceAccountCredential"),
        "{:?}",
        wrong_credential.chain
    );
}

#[tokio::test]
async fn service_applies_global_managed_s3_credentials() {
    let service = service_with(Arc::default(), &[]);
    let managed = upath("s3://managed-bucket/org/dataset");
    assert!(service.find_global_credential_for(&managed).is_some());
    assert!(service.path_is_in_managed_s3(&managed));
    assert!(
        service
            .find_global_credential_for(&upath("s3://other-bucket/x"))
            .is_none()
    );
    let vault_path = service.vault_path_for(&managed).await.unwrap();
    assert!(format!("{:?}", vault_path.vault()).contains("GLOBALKEY"));
}

#[test]
fn service_local_whitelist_and_managed_s3_guard() {
    let service = service_with(Arc::default(), &["/mnt/allowed", "relative/inbox"]);
    let allowed = |p: &str| service.path_is_allowed_to_add_directly(&upath(p));
    assert!(
        allowed("binaryData/org/ds"),
        "relative inside the working dir"
    );
    assert!(!allowed("../escape"), "relative escaping the working dir");
    assert!(!allowed("binaryData/../../escape"));
    assert!(allowed("/mnt/allowed/ds"), "absolute whitelisted");
    assert!(allowed("/mnt/allowed"));
    assert!(!allowed("/mnt/allowedother/ds"), "segment-wise prefix");
    assert!(!allowed("/mnt/allowed/../secret"));
    assert!(!allowed("/data/wk/ds"), "absolute paths need the whitelist");
    assert!(
        allowed("/data/wk/relative/inbox/ds"),
        "relative whitelist entries resolve in the working dir"
    );
    assert!(allowed("s3://bucket/ds"));
    assert!(allowed("https://example.com/ds"));
    assert!(
        !allowed("s3://managed-bucket/org/ds"),
        "managed S3 is not addable directly"
    );
}

#[tokio::test]
async fn service_mag_credentials_lookup_legacy_and_errors() {
    let mock = Mock::start(|_| Resp::new(200, "mag data")).await;
    let lookup = Arc::new(MapLookup {
        credentials: HashMap::from([("cred1".to_owned(), basic_credential())]),
        calls: Mutex::default(),
    });
    let service = service_with(Arc::clone(&lookup), &[]);

    let mut mag = MagLocator::new(Vec3Int::new(1, 1, 1));
    mag.path = Some(upath(&format!("{}/data/1", mock.base())));
    mag.credential_id = Some("cred1".into());
    let vault_path = service.vault_path_for_mag(&mag).await.unwrap();
    vault_path
        .join("chunk")
        .read_bytes(ByteRange::Complete, None)
        .await
        .unwrap();

    // A failed lookup continues without a credential (Scala `shiftBox ... toOption`).
    let mut unknown = mag.clone();
    unknown.credential_id = Some("missing".into());
    unknown.path = Some(upath(&format!("{}/data/2", mock.base())));
    service
        .vault_path_for_mag(&unknown)
        .await
        .unwrap()
        .join("chunk")
        .read_bytes(ByteRange::Complete, None)
        .await
        .unwrap();
    assert_eq!(*lookup.calls.lock().unwrap(), vec!["cred1", "missing"]);

    let requests = mock.requests();
    assert_eq!(requests[0].path, "/data/1/chunk");
    assert_eq!(
        requests[0].header("authorization"),
        Some(format!("Basic {}", STANDARD.encode("alice:pw")).as_str())
    );
    assert_eq!(requests[1].path, "/data/2/chunk");
    assert_eq!(requests[1].header("authorization"), None);

    // Legacy inline credentials become the S3 access key.
    let mut legacy: MagLocator = serde_json::from_value(json!({
        "mag": [2, 2, 1],
        "path": "s3://legacy-bucket/ds/2-2-1",
        "credentials": {"user": "LEGACYKEY", "password": "pw"}
    }))
    .unwrap();
    let vault_path = service.vault_path_for_mag(&legacy).await.unwrap();
    assert!(format!("{:?}", vault_path.vault()).contains("LEGACYKEY"));

    legacy.path = Some(upath("relative/mag"));
    let error = service.vault_path_for_mag(&legacy).await.unwrap_err();
    assert_eq!(error.message, MSG_MAG_PATH_NOT_ABSOLUTE);
    legacy.path = None;
    let error = service.vault_path_for_mag(&legacy).await.unwrap_err();
    assert_eq!(error, DsError::empty());

    // Cache removal drops exactly that vault.
    let before = service.cached_vault_count();
    service.remove_vault_from_cache_for_mag(&mag).await.unwrap();
    assert_eq!(service.cached_vault_count(), before - 1);
}

#[tokio::test]
async fn service_zip_paths_bind_lazy_outer_vaults_and_share_the_archive_root_scope() {
    let service = service_with(Arc::default(), &[]);
    let first = service
        .vault_path_for(&upath("s3://bucket/archive.zip|zip:inner/file"))
        .await
        .unwrap();
    let second = service
        .vault_path_for(&upath("s3://bucket/archive.zip|zip:other/file"))
        .await
        .unwrap();
    assert_eq!(first.vault().kind(), "ZipDataVault");
    assert!(Arc::ptr_eq(first.vault(), second.vault()));
    assert_eq!(service.cached_vault_count(), 1);
}

#[tokio::test]
async fn wk_client_implements_credential_lookup() {
    let wk = MockWk::start(|call| {
        if call.query_value("credentialId").as_deref() == Some("cred1") {
            Reply::json(
                StatusCode::OK,
                json!({
                    "_type": "com.scalableminds.webknossos.datastore.storage.S3AccessKeyCredential",
                    "name": "s3://bucket", "accessKeyId": "AK", "secretAccessKey": "SK",
                    "user": "u", "organization": "o"
                }),
            )
        } else if call.query_value("credentialId").as_deref() == Some("broken") {
            Reply::json(
                StatusCode::OK,
                json!({"_type": "Nope", "secret": "SHOULD-NOT-LEAK"}),
            )
        } else {
            Reply::text(StatusCode::NOT_FOUND, "not found")
        }
    })
    .await;
    let client = WkClient::new(&wk.config()).unwrap();
    let credential = client.find_credential("cred1").await.unwrap();
    assert_eq!(credential.s3_access_key(), Some(("AK", "SK")));
    assert!(client.find_credential("unknown").await.is_err());
    let broken = client.find_credential("broken").await.unwrap_err();
    assert_eq!(
        broken.message,
        "Could not parse credential broken: unknown credential type Nope"
    );
    assert!(!broken.message.contains("SHOULD-NOT-LEAK"));
}
