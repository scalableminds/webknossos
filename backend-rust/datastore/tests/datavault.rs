//! Data vaults (DS1b): SigV4 against the AWS published examples, S3 and GCS request construction
//! against local mock servers, GCS service-account tokens, and `DataVaultService` dispatch, cache
//! and whitelist.

mod mock_wk;

use std::{
    collections::HashMap,
    io::Write,
    net::SocketAddr,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use axum::{
    Router,
    body::Bytes,
    http::{HeaderMap, Method, StatusCode, Uri},
    response::{IntoResponse, Response},
};
use base64::{
    Engine,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};
use mock_wk::{MockWk, Reply};
use serde_json::{Value, json};
use webknossos_datastore::{
    datavault::{
        AwsCredentials, ByteRange, CredentialLookup, CredentializedUPath, DataVault,
        DataVaultCredential, DataVaultService, DataVaultServiceOptions, Encoding, GcsOptions,
        GoogleCloudDataVault, MSG_MAG_PATH_NOT_ABSOLUTE, MSG_SETUP_FAILED, S3DataVault, S3Options,
        ServiceAccountTokenSource, UPath, VaultError, VaultPath,
        sigv4::{self, EMPTY_PAYLOAD_SHA256, SigningRequest},
    },
    error::{DsError, DsResult},
    models::{datasource::MagLocator, geometry::Vec3Int},
    wk_client::WkClient,
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
    body: Bytes,
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

    fn form(&self) -> HashMap<String, String> {
        url::form_urlencoded::parse(&self.body)
            .into_owned()
            .collect()
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

    fn json(status: u16, value: Value) -> Self {
        Self::new(status, value.to_string()).with("content-type", "application/json")
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
        let recorded = requests.clone();
        let handler = Arc::new(handler);
        let app = Router::new().fallback(
            move |method: Method, uri: Uri, headers: HeaderMap, body: Bytes| {
                let recorded = recorded.clone();
                let handler = handler.clone();
                async move {
                    let req = Req {
                        method: method.to_string(),
                        path: uri.path().to_owned(),
                        query: url::form_urlencoded::parse(uri.query().unwrap_or("").as_bytes())
                            .into_owned()
                            .collect(),
                        headers,
                        body,
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
            },
        );
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
// SigV4: AWS published examples
// ---------------------------------------------------------------------------------------------

fn pairs(items: &[(&str, &str)]) -> Vec<(String, String)> {
    items
        .iter()
        .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
        .collect()
}

/// aws-sig-v4-test-suite `get-vanilla` and `get-vanilla-query-order-key-case`.
#[test]
fn sigv4_matches_aws_test_suite() {
    let credentials =
        AwsCredentials::new("AKIDEXAMPLE", "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY");
    let headers = pairs(&[
        ("Host", "example.amazonaws.com"),
        ("X-Amz-Date", "20150830T123600Z"),
    ]);
    let sign = |query: &[(String, String)]| {
        sigv4::authorization(
            &credentials,
            &SigningRequest {
                method: "GET",
                canonical_uri: "/",
                query,
                headers: &headers,
                payload_sha256: EMPTY_PAYLOAD_SHA256,
            },
            "us-east-1",
            "service",
            "20150830T123600Z",
        )
    };
    assert_eq!(
        sign(&[]),
        "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31"
    );
    assert_eq!(
        sign(&pairs(&[("Param2", "value2"), ("Param1", "value1")])),
        "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500"
    );
}

/// S3 documentation "Signature Calculations for the Authorization Header" examples
/// (GET Object with range, GET Bucket lifecycle, GET Bucket list objects).
#[test]
fn sigv4_matches_s3_documentation_examples() {
    let credentials = AwsCredentials::new(
        "AKIAIOSFODNN7EXAMPLE",
        "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    );
    let sign = |uri: &str, query: &[(String, String)], headers: &[(String, String)]| {
        sigv4::authorization(
            &credentials,
            &SigningRequest {
                method: "GET",
                canonical_uri: uri,
                query,
                headers,
                payload_sha256: EMPTY_PAYLOAD_SHA256,
            },
            "us-east-1",
            "s3",
            "20130524T000000Z",
        )
    };
    let get_object = sign(
        "/test.txt",
        &[],
        &pairs(&[
            ("Host", "examplebucket.s3.amazonaws.com"),
            ("Range", "bytes=0-9"),
            ("x-amz-content-sha256", EMPTY_PAYLOAD_SHA256),
            ("x-amz-date", "20130524T000000Z"),
        ]),
    );
    assert_eq!(
        get_object,
        "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
    );
    let bucket_headers = pairs(&[
        ("Host", "examplebucket.s3.amazonaws.com"),
        ("x-amz-content-sha256", EMPTY_PAYLOAD_SHA256),
        ("x-amz-date", "20130524T000000Z"),
    ]);
    assert!(
        sign("/", &pairs(&[("lifecycle", "")]), &bucket_headers).ends_with(
            "Signature=fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543"
        )
    );
    assert!(
        sign(
            "/",
            &pairs(&[("max-keys", "2"), ("prefix", "J")]),
            &bucket_headers
        )
        .ends_with("Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7")
    );
}

// ---------------------------------------------------------------------------------------------
// S3
// ---------------------------------------------------------------------------------------------

fn s3_vault(path: &str, credential: Option<AwsCredentials>, options: &S3Options) -> S3DataVault {
    S3DataVault::new(
        upath(path).to_remote_uri().unwrap(),
        credential,
        reqwest::Client::new(),
        options,
    )
}

fn s3_override(mock: &Mock) -> S3Options {
    S3Options {
        env_credentials: None,
        aws_endpoint_override: Some(mock.base()),
    }
}

/// Recompute the signature of a received request from its headers.
fn assert_signature_valid(req: &Req, credentials: &AwsCredentials, region: &str) {
    let authorization = req.header("authorization").expect("signed request");
    let signed: Vec<&str> = authorization
        .split("SignedHeaders=")
        .nth(1)
        .unwrap()
        .split(',')
        .next()
        .unwrap()
        .split(';')
        .collect();
    let headers: Vec<(String, String)> = signed
        .iter()
        .map(|name| ((*name).to_owned(), req.header(name).unwrap().to_owned()))
        .collect();
    let amz_date = req.header("x-amz-date").unwrap();
    let expected = sigv4::authorization(
        credentials,
        &SigningRequest {
            method: &req.method,
            canonical_uri: &req.path,
            query: &req.query,
            headers: &headers,
            payload_sha256: EMPTY_PAYLOAD_SHA256,
        },
        region,
        "s3",
        amz_date,
    );
    assert_eq!(authorization, expected);
}

#[tokio::test]
async fn s3_signed_range_suffix_and_complete_reads() {
    let mock = Mock::start(|req| {
        let body = match req.header("range") {
            Some("bytes=2-5") => "2345",
            Some("bytes=-3") => "789",
            _ => "0123456789",
        };
        Resp::new(
            if req.header("range").is_some() {
                206
            } else {
                200
            },
            body,
        )
        .with("content-range", "bytes 2-5/10")
    })
    .await;
    let credentials = AwsCredentials::new("AKID", "SECRET");
    let vault = s3_vault(
        "s3://my-bucket/data/x%20y.bin",
        Some(credentials.clone()),
        &s3_override(&mock),
    );
    let path = upath("s3://my-bucket/data/x%20y.bin");
    let ranged = vault
        .read_bytes_encoding_and_range_header(&path, ByteRange::start_end_exclusive(2, 6), None)
        .await
        .unwrap();
    assert_eq!(&ranged.bytes[..], b"2345");
    assert_eq!(ranged.encoding, Encoding::Identity);
    assert_eq!(ranged.content_range.as_deref(), Some("bytes 2-5/10"));
    let suffix = vault
        .read_bytes_encoding_and_range_header(&path, ByteRange::suffix(3), None)
        .await
        .unwrap();
    assert_eq!(&suffix.bytes[..], b"789");
    let complete = vault
        .read_bytes_encoding_and_range_header(&path, ByteRange::Complete, None)
        .await
        .unwrap();
    assert_eq!(&complete.bytes[..], b"0123456789");

    let requests = mock.requests();
    assert_eq!(requests.len(), 3);
    for req in &requests {
        assert_eq!(req.method, "GET");
        assert_eq!(req.path, "/my-bucket/data/x%20y.bin");
        assert!(req.query.is_empty());
        assert_eq!(
            req.header("x-amz-content-sha256"),
            Some(EMPTY_PAYLOAD_SHA256)
        );
        assert!(
            req.header("authorization")
                .unwrap()
                .starts_with("AWS4-HMAC-SHA256 Credential=AKID/")
        );
        assert!(
            req.header("authorization")
                .unwrap()
                .contains("/us-east-1/s3/aws4_request")
        );
        assert_signature_valid(req, &credentials, "us-east-1");
    }
    assert_eq!(requests[0].header("range"), Some("bytes=2-5"));
    assert!(
        requests[0]
            .header("authorization")
            .unwrap()
            .contains("SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,")
    );
    assert_eq!(requests[1].header("range"), Some("bytes=-3"));
    assert_eq!(requests[2].header("range"), None);
}

#[tokio::test]
async fn s3_anonymous_and_env_session_credentials() {
    let mock = Mock::start(|_| Resp::new(200, "ok")).await;
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

    let requests = mock.requests();
    assert_eq!(requests.len(), 3);
    assert_eq!(requests[0].header("authorization"), None);
    assert_eq!(requests[0].header("x-amz-date"), None);
    assert_eq!(
        requests[1].header("x-amz-security-token"),
        Some("session-tok")
    );
    assert!(
        requests[1]
            .header("authorization")
            .unwrap()
            .contains("SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token,")
    );
    assert_signature_valid(&requests[1], &env, "us-east-1");
    assert!(
        requests[2]
            .header("authorization")
            .unwrap()
            .starts_with("AWS4-HMAC-SHA256 Credential=OWN/")
    );
}

#[tokio::test]
async fn s3_maps_not_found_to_empty_and_errors_to_sdk_failures() {
    let mock = Mock::start(|req| match req.path.as_str() {
        "/b/missing" => Resp::new(
            404,
            "<Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>",
        ),
        "/b/nobucket" => Resp::new(404, "<Error><Code>NoSuchBucket</Code></Error>"),
        "/b/denied" => Resp::new(
            403,
            "<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>",
        )
        .with("x-amz-request-id", "REQ1")
        .with("x-amz-id-2", "EXT2"),
        "/b/gz" => Resp::new(200, gzip(b"hello")).with("content-encoding", "gzip"),
        "/b/chunked" => Resp::new(200, "raw").with("content-encoding", "aws-chunked"),
        _ => Resp::new(500, ""),
    })
    .await;
    let options = s3_override(&mock);
    let vault: Arc<dyn DataVault> = Arc::new(s3_vault("s3://b/", None, &options));
    let read = |key: &str| {
        let vault = vault.clone();
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
    assert_eq!(
        denied.message,
        "Access Denied (Service: S3, Status Code: 403, Request ID: REQ1, Extended Request ID: EXT2)"
    );
    assert_eq!(
        denied.exception.as_deref(),
        Some(
            "software.amazon.awssdk.services.s3.model.S3Exception: Access Denied (Service: S3, Status Code: 403, Request ID: REQ1, Extended Request ID: EXT2)"
        )
    );
    let gz = read("gz").await.unwrap();
    assert_eq!(gz.encoding, Encoding::Gzip);
    let decoded = VaultPath::new(upath("s3://b/gz"), vault.clone())
        .read_bytes(ByteRange::Complete, None)
        .await
        .unwrap();
    assert_eq!(&decoded[..], b"hello");
    assert_eq!(read("chunked").await.unwrap().encoding, Encoding::Identity);
    // `VaultPath` keeps `Empty` and annotates failures.
    let vault_path = VaultPath::new(upath("s3://b/missing"), vault.clone());
    assert!(
        vault_path
            .read_bytes(ByteRange::Complete, None)
            .await
            .unwrap_err()
            .is_not_found()
    );
}

#[tokio::test]
async fn s3_cross_region_redirect_is_retried_and_remembered() {
    let mock = Mock::start(|req| {
        if req.header("authorization").unwrap().contains("/us-east-1/") {
            Resp::new(
                301,
                "<Error><Code>PermanentRedirect</Code><Message>moved</Message></Error>",
            )
            .with("x-amz-bucket-region", "eu-west-1")
        } else {
            Resp::new(200, "data")
        }
    })
    .await;
    let credentials = AwsCredentials::new("AKID", "SECRET");
    let vault = s3_vault(
        "s3://bucket/k",
        Some(credentials.clone()),
        &s3_override(&mock),
    );
    let path = upath("s3://bucket/k");
    for _ in 0..2 {
        let read = vault
            .read_bytes_encoding_and_range_header(&path, ByteRange::Complete, None)
            .await
            .unwrap();
        assert_eq!(&read.bytes[..], b"data");
    }
    let requests = mock.requests();
    assert_eq!(requests.len(), 3, "one redirect, then the region is cached");
    assert!(
        requests[0]
            .header("authorization")
            .unwrap()
            .contains("/us-east-1/s3/")
    );
    assert!(
        requests[1]
            .header("authorization")
            .unwrap()
            .contains("/eu-west-1/s3/")
    );
    assert!(
        requests[2]
            .header("authorization")
            .unwrap()
            .contains("/eu-west-1/s3/")
    );
    assert_signature_valid(&requests[2], &credentials, "eu-west-1");
}

#[tokio::test]
async fn s3_listing_and_used_storage() {
    let mock = Mock::start(|req| {
        if req.query_value("delimiter").is_some() {
            return Resp::new(
                200,
                r#"<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><EncodingType>url</EncodingType>
<CommonPrefixes><Prefix>data/a/</Prefix></CommonPrefixes>
<CommonPrefixes><Prefix>data/b%20c/</Prefix></CommonPrefixes>
<CommonPrefixes><Prefix>data/d/</Prefix></CommonPrefixes></ListBucketResult>"#,
            );
        }
        match req.query_value("continuation-token") {
            None => Resp::new(
                200,
                "<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>t 1</NextContinuationToken><Contents><Size>10</Size></Contents><Contents><Size>20</Size></Contents></ListBucketResult>",
            ),
            Some(_) => Resp::new(
                200,
                "<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Size>12</Size></Contents></ListBucketResult>",
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

    let requests = mock.requests();
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
            ("encoding-type", "url"),
            ("list-type", "2"),
            ("max-keys", "7"),
            ("prefix", "data/"),
        ])
    );
    assert_eq!(
        query(&requests[1]),
        pairs(&[
            ("encoding-type", "url"),
            ("list-type", "2"),
            ("max-keys", "1000"),
            ("prefix", "data/"),
        ])
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
            .starts_with("The specified bucket does not exist (Service: S3, Status Code: 404")
    );
    assert!(
        error
            .exception
            .unwrap()
            .starts_with("software.amazon.awssdk.services.s3.model.NoSuchBucketException: ")
    );
}

#[tokio::test]
async fn s3_custom_endpoint_uses_path_style_over_http() {
    let mock = Mock::start(|_| Resp::new(200, "minio")).await;
    let path = format!("s3://{}/bucket/dir/key.bin", mock.addr);
    let credentials = AwsCredentials::new("MINIO", "MINIOSECRET");
    // The AWS override must not apply to custom endpoints.
    let options = S3Options {
        env_credentials: None,
        aws_endpoint_override: Some("http://127.0.0.1:1".into()),
    };
    let vault = s3_vault(&path, Some(credentials.clone()), &options);
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
    assert_signature_valid(&requests[0], &credentials, "us-east-1");
}

// ---------------------------------------------------------------------------------------------
// GCS
// ---------------------------------------------------------------------------------------------

const TEST_RSA_KEY: &str = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDRoCjhHYgv9Akf\nuWshEOxlAnLLXJqt4bPsgiwDslj9/f9+DwsIRrFV3n4W+o3YFYD7rLb5eDi6lSft\n3C0s8l5xGlawY0oNDV9EixicriN1wUNHIET+iBoGPIv/+EvxcdD74dNkrImGMZ7e\nyEw8kcWC1sovujyzicoUu0G/jmAdkh2cYaWh4lbuC5zgqu85f72En5XOk3sI6AgG\n2oKiSpR+rLv51KxWztujcJWoiR69FieYXBkjYDopp58JQq3+/eosCLLXDc8I459y\nYfuC5dzHraHQWa1sCpNsJmiIFcs7NH+hnAF0VNt7VmaFBqv+BWAkU3vKVfR+Rqbj\ntRBKktm9AgMBAAECggEAS9Iixx3v6uxZOnzN92VQI87pZ44Espz+/64rrmCdWK08\n8sMNKf6r2NPDhps0n/JTN3TGr+AgoLgfe6TWQDogF8e/kEgxehwal8e57L39vHNd\nWsYcvnXK9/OBbeHI0jlpLhoF5JWVnpCnFoybKpNNPeBjvDSgDQ5rJel/RAKC2F6g\nD7gaJ2eY0g+roHBYdyBwD7PCiRCy5+3JLk2EU9dmVp+0OamwHH00EMasbJWQRrIW\n7bo2wqAd+SAo6Pc719w6zRUI1xJBRO6Gy0g5xUElDZK6FeWHQIAhqJFL+ylmxT31\n8MEP7mZNLVx8XCY6ttzjCArMFaT0gh8akr01iacejwKBgQDyYPgXo5q9MY1IpWKv\nEniFXv7AEHIfBR/+qJFyoP/vVlz/zBgumVPIvPNvcmjUn9ocBXV4arP5mH95G6DF\n8nM2uVgIvRrmMossLsfe8zgINPop9W5DSCT3MtsHMzpk6uI3kxGFyUeAE9/IqaAC\nyind5yjDB5mth7oJLteiJ2coKwKBgQDdZ/sMeoK3HtMDKbTEMcvmeSTPMG/BGngn\n6KHL3GGhVuwYBo5frs+7Sdvw3+hIuqKj8qjkTqd2JZSIbi3RW6HVASfAvd1fEdfJ\nTSuWZyjiLaEuxGw3Ak+xgJl7jxAdCWMLwpZKXOMlVYHXKJA/FZcjK6V1TolNH5pX\nHGipW9LptwKBgQDewlBBKZPlnc0Dnzx7OraZnRz02CiKaeNl4PcMKvwNs4n1blYr\nPa/LJh11p+jAwclrR3kXGroeAxHk9IdmZdWNzfoizeoS9xEBolz/gvlUUZw5Q9/6\n5itTJeI3U9WvOlB+UyQfmUWlaJ6bhYoSBktELldAJ5QN8FgCaJK17RDZ0QKBgG1s\npJDoQ45Jd7SKekK08bc4jE6x+6mOcXAX808T3lSk5w6AvwDfHt/Lgx4rK1w2kYdB\nuOMNVIp5zE0ZVx+vj+38Ii+KJsyDvwhIUZCF75jJQG4iufD9/XEWw8RjUm1nZEI9\nq5WZDtI2znMOIyxqeUXynlW5uPYa9mazLa72KOlFAoGABIRms7Qs9/XMET5qLPjK\nyC28jcIDNej7hJB62I0BlALFclAghRhdsL6VDtu5Kx73eQFFvNq2YFtpzg0JfH5F\nzxxFDnlvn9voXF1qv5bpRxHfodBsM4f4zdpvjAIRcszA68p2mOD+HDqaGt7by56L\n1NfeTfPam3FZWBnJrXhlFWk=\n-----END PRIVATE KEY-----";

fn gcs_options(mock: &Mock) -> GcsOptions {
    GcsOptions {
        endpoint: mock.base(),
        default_service_account_json: None,
    }
}

fn gcs_vault(path: &str, secret: Option<&str>, options: &GcsOptions) -> GoogleCloudDataVault {
    GoogleCloudDataVault::new(
        upath(path).to_remote_uri().unwrap(),
        secret,
        reqwest::Client::new(),
        options,
    )
}

fn service_account_json(token_uri: &str) -> String {
    json!({
        "type": "service_account",
        "project_id": "p",
        "private_key_id": "kid1",
        "private_key": TEST_RSA_KEY,
        "client_email": "sa@p.iam.gserviceaccount.com",
        "client_id": "1",
        "token_uri": token_uri,
    })
    .to_string()
}

#[tokio::test]
async fn gcs_anonymous_reads_with_ranges_and_stored_encoding() {
    let mock = Mock::start(|req| {
        let object = req.path.rsplit('/').next().unwrap().to_owned();
        match (object.as_str(), req.header("range")) {
            ("dir%2Fobj.bin", Some("bytes=2-5")) => Resp::new(206, "2345")
                .with("content-range", "bytes 2-5/10")
                .with("x-goog-stored-content-length", "10"),
            ("dir%2Fobj.bin", Some("bytes=-3")) => {
                Resp::new(206, "789").with("content-range", "bytes 7-9/10")
            }
            // A server that ignores the range header: the vault slices.
            ("ignores-range", Some(_)) => Resp::new(200, "0123456789"),
            ("short", Some(_)) => Resp::new(206, "01"),
            ("gz", None) => Resp::new(200, gzip(b"hello gcs"))
                .with("content-encoding", "gzip")
                .with("x-goog-stored-content-encoding", "gzip"),
            ("missing", _) => Resp::json(404, json!({"error": {"code": 404, "message": "No such object"}})),
            ("denied", _) => Resp::json(
                403,
                json!({"error": {"code": 403, "message": "anonymous caller does not have storage.objects.get access"}}),
            ),
            _ => Resp::new(500, "unexpected"),
        }
    })
    .await;
    let options = gcs_options(&mock);
    let vault: Arc<dyn DataVault> = Arc::new(gcs_vault("gs://my_bucket/", None, &options));
    let read = |name: &str, range: ByteRange| {
        let vault = vault.clone();
        let path = upath(&format!("gs://my_bucket/{name}"));
        async move {
            vault
                .read_bytes_encoding_and_range_header(&path, range, None)
                .await
        }
    };
    let ranged = read("dir/obj.bin", ByteRange::start_end_exclusive(2, 6))
        .await
        .unwrap();
    assert_eq!(&ranged.bytes[..], b"2345");
    assert_eq!(ranged.encoding, Encoding::Identity);
    assert_eq!(ranged.content_range.as_deref(), Some("bytes 2-5/10"));
    let suffix = read("dir/obj.bin", ByteRange::suffix(3)).await.unwrap();
    assert_eq!(&suffix.bytes[..], b"789");
    assert_eq!(suffix.content_range.as_deref(), Some("bytes 7-9/10"));
    let sliced = read("ignores-range", ByteRange::start_end_exclusive(3, 5))
        .await
        .unwrap();
    assert_eq!(&sliced.bytes[..], b"34");
    assert_eq!(sliced.content_range.as_deref(), Some("bytes 3-4/10"));
    let short = failure(
        read("short", ByteRange::start_end_exclusive(0, 4))
            .await
            .unwrap_err(),
    );
    assert_eq!(
        short.message,
        "Unexpected end of stream while reading from GCS: got 2 of 4 requested bytes"
    );
    let gz = read("gz", ByteRange::Complete).await.unwrap();
    assert_eq!(
        gz.encoding,
        Encoding::Gzip,
        "stored encoding is passed through"
    );
    let decoded = VaultPath::new(upath("gs://my_bucket/gz"), vault.clone())
        .read_bytes(ByteRange::Complete, None)
        .await
        .unwrap();
    assert_eq!(&decoded[..], b"hello gcs");
    assert_eq!(
        read("missing", ByteRange::Complete).await.unwrap_err(),
        VaultError::NotFound
    );
    let denied = failure(read("denied", ByteRange::Complete).await.unwrap_err());
    assert_eq!(
        denied.message,
        "anonymous caller does not have storage.objects.get access"
    );
    assert_eq!(
        denied.exception.as_deref(),
        Some(
            "com.google.cloud.storage.StorageException: anonymous caller does not have storage.objects.get access"
        )
    );

    let requests = mock.requests();
    for req in &requests {
        assert_eq!(req.method, "GET");
        assert!(
            req.path.starts_with("/storage/v1/b/my_bucket/o/"),
            "{}",
            req.path
        );
        assert_eq!(req.query_value("alt"), Some("media"));
        assert_eq!(req.header("accept-encoding"), Some("gzip"));
        assert_eq!(req.header("authorization"), None);
    }
    assert_eq!(requests[0].path, "/storage/v1/b/my_bucket/o/dir%2Fobj.bin");
    assert_eq!(requests[0].header("range"), Some("bytes=2-5"));
    assert_eq!(requests[1].header("range"), Some("bytes=-3"));
}

#[tokio::test]
async fn gcs_zero_length_read_uses_object_metadata() {
    let mock =
        Mock::start(|_| Resp::json(200, json!({"size": "100", "contentEncoding": "gzip"}))).await;
    let vault = gcs_vault("gs://bucket/", None, &gcs_options(&mock));
    let read = vault
        .read_bytes_encoding_and_range_header(
            &upath("gs://bucket/obj"),
            ByteRange::start_end_exclusive(5, 5),
            None,
        )
        .await
        .unwrap();
    assert!(read.bytes.is_empty());
    assert_eq!(read.encoding, Encoding::Gzip);
    assert_eq!(read.content_range.as_deref(), Some("bytes 5-4/100"));
    let requests = mock.requests();
    assert_eq!(requests[0].path, "/storage/v1/b/bucket/o/obj");
    assert_eq!(
        requests[0].query_value("fields"),
        Some("size,contentEncoding")
    );
    assert_eq!(requests[0].query_value("alt"), None);
}

#[tokio::test]
async fn gcs_listing_and_used_storage() {
    let mock = Mock::start(|req| {
        if req.query_value("delimiter").is_some() {
            return Resp::json(200, json!({"prefixes": ["dir/a/", "dir/b/"], "items": [{"name": "dir/x", "size": "1"}]}));
        }
        match req.query_value("pageToken") {
            None => Resp::json(
                200,
                json!({"items": [{"size": "10"}, {"size": "20"}], "nextPageToken": "p2"}),
            ),
            Some(_) => Resp::json(200, json!({"items": [{"size": "12"}]})),
        }
    })
    .await;
    let vault = gcs_vault("gs://bucket/", None, &gcs_options(&mock));
    let listed = vault
        .list_directory(&upath("gs://bucket/dir/"), 1, None)
        .await
        .unwrap();
    assert_eq!(
        listed.iter().map(UPath::to_string).collect::<Vec<_>>(),
        vec!["gs://bucket/dir/a/"]
    );
    assert_eq!(
        vault
            .used_storage_bytes(&upath("gs://bucket/dir"), None)
            .await
            .unwrap(),
        42
    );
    let requests = mock.requests();
    assert_eq!(requests.len(), 3);
    assert_eq!(requests[0].path, "/storage/v1/b/bucket/o");
    assert_eq!(requests[0].query_value("prefix"), Some("dir/"));
    assert_eq!(requests[0].query_value("delimiter"), Some("/"));
    assert_eq!(requests[1].query_value("prefix"), Some("dir"));
    assert_eq!(requests[1].query_value("delimiter"), None);
    assert_eq!(requests[2].query_value("pageToken"), Some("p2"));

    let failing =
        Mock::start(|_| Resp::json(404, json!({"error": {"message": "bucket gone"}}))).await;
    let vault = gcs_vault("gs://bucket/", None, &gcs_options(&failing));
    let error = vault
        .list_directory(&upath("gs://bucket/dir/"), 1, None)
        .await
        .unwrap_err();
    assert_eq!(
        failure(error).message,
        "bucket gone",
        "listing 404 is a failure, not Empty"
    );
}

fn token_mock_handler(expires_in: u64) -> impl Fn(&Req) -> Resp + Send + Sync + 'static {
    move |req| {
        if req.path == "/token" {
            Resp::json(
                200,
                json!({"access_token": "ya29.test", "expires_in": expires_in, "token_type": "Bearer"}),
            )
        } else if req.header("authorization") == Some("Bearer ya29.test") {
            Resp::new(200, "secret data")
        } else {
            Resp::json(401, json!({"error": {"message": "Unauthorized"}}))
        }
    }
}

#[tokio::test]
async fn gcs_service_account_token_is_fetched_once_and_cached() {
    let mock = Mock::start(token_mock_handler(3600)).await;
    let secret = service_account_json(&format!("{}/token", mock.base()));
    let vault = gcs_vault("gs://bucket/", Some(&secret), &gcs_options(&mock));
    for _ in 0..2 {
        let read = vault
            .read_bytes_encoding_and_range_header(
                &upath("gs://bucket/obj"),
                ByteRange::Complete,
                None,
            )
            .await
            .unwrap();
        assert_eq!(&read.bytes[..], b"secret data");
    }
    let requests = mock.requests();
    let token_requests: Vec<&Req> = requests.iter().filter(|r| r.path == "/token").collect();
    assert_eq!(token_requests.len(), 1, "token is cached");
    assert_eq!(requests.len(), 3);
    let token_request = token_requests[0];
    assert_eq!(token_request.method, "POST");
    assert_eq!(
        token_request.header("content-type"),
        Some("application/x-www-form-urlencoded")
    );
    let form = token_request.form();
    assert_eq!(
        form["grant_type"],
        "urn:ietf:params:oauth:grant-type:jwt-bearer"
    );

    // The assertion is an RS256 JWT signed with the service account key.
    let assertion = &form["assertion"];
    let parts: Vec<&str> = assertion.split('.').collect();
    assert_eq!(parts.len(), 3);
    let header: Value = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(parts[0]).unwrap()).unwrap();
    assert_eq!(header, json!({"alg": "RS256", "typ": "JWT", "kid": "kid1"}));
    let claims: Value = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(parts[1]).unwrap()).unwrap();
    assert_eq!(claims["iss"], "sa@p.iam.gserviceaccount.com");
    assert_eq!(claims["aud"], format!("{}/token", mock.base()));
    assert_eq!(
        claims["scope"],
        "https://www.googleapis.com/auth/devstorage.full_control"
    );
    assert_eq!(
        claims["exp"].as_u64().unwrap() - claims["iat"].as_u64().unwrap(),
        3600
    );
    let der: String = TEST_RSA_KEY
        .lines()
        .filter(|l| !l.starts_with("-----"))
        .collect();
    let key_pair = ring::signature::RsaKeyPair::from_pkcs8(&STANDARD.decode(der).unwrap()).unwrap();
    use ring::signature::KeyPair;
    ring::signature::UnparsedPublicKey::new(
        &ring::signature::RSA_PKCS1_2048_8192_SHA256,
        key_pair.public_key().as_ref(),
    )
    .verify(
        format!("{}.{}", parts[0], parts[1]).as_bytes(),
        &URL_SAFE_NO_PAD.decode(parts[2]).unwrap(),
    )
    .expect("valid RS256 signature");

    for req in requests.iter().filter(|r| r.path != "/token") {
        assert_eq!(req.header("authorization"), Some("Bearer ya29.test"));
    }
}

#[tokio::test]
async fn gcs_expiring_tokens_are_refreshed_and_token_errors_fail() {
    // Tokens valid for less than the five-minute refresh margin are fetched again.
    let mock = Mock::start(token_mock_handler(60)).await;
    let source = ServiceAccountTokenSource::from_json(
        &service_account_json(&format!("{}/token", mock.base())),
        reqwest::Client::new(),
    )
    .unwrap();
    assert_eq!(source.access_token().await.unwrap(), "ya29.test");
    assert_eq!(source.access_token().await.unwrap(), "ya29.test");
    assert_eq!(mock.requests().len(), 2);

    let rejecting = Mock::start(|_| Resp::json(400, json!({"error": "invalid_grant"}))).await;
    let secret = service_account_json(&format!("{}/token", rejecting.base()));
    let vault = gcs_vault("gs://bucket/", Some(&secret), &gcs_options(&rejecting));
    let error = failure(
        vault
            .read_bytes_encoding_and_range_header(
                &upath("gs://bucket/obj"),
                ByteRange::Complete,
                None,
            )
            .await
            .unwrap_err(),
    );
    assert_eq!(
        error.message,
        "Error getting access token for service account: 400 Bad Request, iss: sa@p.iam.gserviceaccount.com"
    );
    assert_eq!(
        rejecting.requests().len(),
        1,
        "no storage request without a token"
    );

    // An unusable key fails on use and never leaks key material.
    let vault = gcs_vault(
        "gs://bucket/",
        Some(r#"{"client_email":"a@b","private_key":"not a key"}"#),
        &gcs_options(&rejecting),
    );
    let error = failure(
        vault
            .read_bytes_encoding_and_range_header(
                &upath("gs://bucket/obj"),
                ByteRange::Complete,
                None,
            )
            .await
            .unwrap_err(),
    );
    assert_eq!(error.message, "Invalid PKCS#8 data.");
    assert!(!format!("{vault:?}").contains("PRIVATE"));
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
    let service = service_with(lookup.clone(), &[]);

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
async fn service_zip_paths_are_not_supported_yet() {
    let service = service_with(Arc::default(), &[]);
    let error = service
        .vault_path_for(&upath("s3://bucket/archive.zip|zip:inner/file"))
        .await
        .unwrap_err();
    assert_eq!(error.message, MSG_SETUP_FAILED);
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
