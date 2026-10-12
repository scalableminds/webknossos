mod mock_s3;
use axum::http::StatusCode;
use mock_s3::{MockS3, Reply};
use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};
use webknossos_datastore::datavault::{AwsCredentials, S3DataVault, S3Options, UPath};

fn temp() -> PathBuf {
    static COUNT: AtomicUsize = AtomicUsize::new(0);
    let path = std::env::temp_dir().join(format!(
        "wk-s3-upload-{}-{}",
        std::process::id(),
        COUNT.fetch_add(1, Ordering::SeqCst)
    ));
    std::fs::create_dir_all(&path).unwrap();
    path
}
fn vault(mock: &MockS3) -> Arc<S3DataVault> {
    Arc::new(S3DataVault::new(
        UPath::parse("s3://bucket/prefix")
            .unwrap()
            .to_remote_uri()
            .unwrap(),
        Some(AwsCredentials::new("example-key", "example-secret")),
        webknossos_datastore::datavault::s3::build_s3_http_client(),
        &S3Options {
            env_credentials: None,
            aws_endpoint_override: Some(mock.base()),
        },
    ))
}
fn target() -> UPath {
    UPath::parse("s3://bucket/prefix/file%20name").unwrap()
}

#[test]
fn upload_signatures_match_the_repository_aws_sdk_with_payloads_xml_queries_and_session_tokens() {
    use webknossos_datastore::datavault::sigv4::{SigningRequest, authorization};
    let cases: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/managed_s3/aws_sdk_signing.json")).unwrap();
    let credentials = AwsCredentials {
        access_key_id: "example-key".into(),
        secret_access_key: "example-secret".into(),
        session_token: Some("example-session".into()),
    };
    for case in cases.as_array().unwrap() {
        let auth = case["headers"]["authorization"].as_str().unwrap();
        let names = auth
            .split("SignedHeaders=")
            .nth(1)
            .unwrap()
            .split(',')
            .next()
            .unwrap();
        let headers: Vec<(String, String)> = names
            .split(';')
            .map(|name| {
                (
                    name.to_owned(),
                    case["headers"][name].as_str().unwrap().to_owned(),
                )
            })
            .collect();
        let query: Vec<(String, String)> = serde_json::from_value(case["query"].clone()).unwrap();
        let sha = case["headers"]["x-amz-content-sha256"].as_str().unwrap();
        let payload = case["payload"].as_str().unwrap();
        let digest: String = ring::digest::digest(&ring::digest::SHA256, payload.as_bytes())
            .as_ref()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        assert_eq!(sha, digest);
        assert_eq!(
            authorization(
                &credentials,
                &SigningRequest {
                    method: case["method"].as_str().unwrap(),
                    canonical_uri: case["path"].as_str().unwrap(),
                    query: &query,
                    headers: &headers,
                    payload_sha256: sha,
                },
                "eu-central-1",
                "s3",
                case["headers"]["x-amz-date"].as_str().unwrap()
            ),
            auth
        );
    }
}

#[tokio::test]
async fn directory_upload_uses_global_credentials_and_keeps_nested_hidden_empty_files_without_following_links()
 {
    use webknossos_datastore::{
        datavault::{
            BoxFuture, CredentialLookup, DataVaultCredential, DataVaultService,
            DataVaultServiceOptions, GcsOptions,
        },
        error::{DsError, DsResult},
    };
    struct NoLookup;
    impl CredentialLookup for NoLookup {
        fn find_credential<'a>(
            &'a self,
            _: &'a str,
        ) -> BoxFuture<'a, DsResult<DataVaultCredential>> {
            Box::pin(async {
                Err(DsError::failure(
                    "managed writes must use global credentials",
                ))
            })
        }
    }
    let mock = MockS3::start(|_| Reply::ok()).await;
    let root = temp();
    std::fs::create_dir_all(root.join("nested")).unwrap();
    std::fs::write(root.join("nested/.zarray"), b"metadata").unwrap();
    std::fs::write(root.join("empty"), b"").unwrap();
    std::fs::write(root.join("nested/file name%é.bin"), b"special name").unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(root.join("nested"), root.join("link")).unwrap();
    let service = DataVaultService::new(
        DataVaultServiceOptions {
            datastore_uri: "https://datastore.test".into(),
            local_directory_whitelist: vec![],
            working_dir: root.clone(),
            global_credentials: vec![DataVaultCredential::S3AccessKey {
                name: "s3://bucket/prefix".into(),
                access_key_id: "example-key".into(),
                secret_access_key: "example-secret".into(),
                user: None,
                organization: None,
            }],
            s3: S3Options {
                env_credentials: None,
                aws_endpoint_override: Some(mock.base()),
            },
            gcs: GcsOptions::from_env(),
        },
        Arc::new(NoLookup),
    );
    service
        .upload_directory_to_s3(&root, &UPath::parse("s3://bucket/prefix/dataset").unwrap())
        .await
        .unwrap();
    let calls = mock.calls();
    assert_eq!(calls.len(), 3);
    assert!(
        calls.iter().any(
            |c| c.path == "/bucket/prefix/dataset/nested/.zarray" && &c.body[..] == b"metadata"
        )
    );
    assert!(
        calls
            .iter()
            .any(|c| c.path == "/bucket/prefix/dataset/empty" && c.body.is_empty())
    );
    assert!(calls.iter().any(|c| c.path
        == "/bucket/prefix/dataset/nested/file%20name%25%C3%A9.bin"
        && &c.body[..] == b"special name"));
    let error = service
        .upload_directory_to_s3(&root, &UPath::parse("s3://bucket/other").unwrap())
        .await
        .unwrap_err();
    assert!(
        error
            .message
            .contains("S3 upload is not properly configured")
    );
    assert_eq!(mock.calls().len(), 3);
}

#[tokio::test]
async fn interrupted_multipart_upload_is_aborted() {
    let mock = MockS3::start(|call| {
        if call.query.contains_key("uploads") {
            return Reply::xml(
                StatusCode::OK,
                "<Result><UploadId>interrupted</UploadId></Result>",
            );
        }
        if call.method == "PUT" {
            let mut reply = Reply::part();
            reply.delay = std::time::Duration::from_secs(30);
            return reply;
        }
        Reply::xml(StatusCode::NO_CONTENT, "")
    })
    .await;
    let (path, _) = large_file();
    let vault = vault(&mock);
    let task = tokio::spawn(async move { vault.upload_file(&path, &target()).await });
    tokio::time::timeout(std::time::Duration::from_secs(2), mock.put_seen.notified())
        .await
        .unwrap();
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            if mock.calls().iter().any(|c| c.method == "DELETE") {
                break;
            }
            mock.changed.notified().await;
        }
    })
    .await
    .unwrap();
    let calls = mock.calls();
    let abort = calls.iter().find(|c| c.method == "DELETE").unwrap();
    assert_eq!(abort.query["uploadId"], "interrupted");
    assert!(
        !calls
            .iter()
            .any(|c| c.method == "POST" && !c.query.contains_key("uploads"))
    );
}
fn large_file() -> (PathBuf, Vec<u8>) {
    let bytes: Vec<u8> = (0..8 * 1024 * 1024 + 731)
        .map(|i| (i % 251) as u8)
        .collect();
    let path = temp().join("large.bin");
    std::fs::write(&path, &bytes).unwrap();
    (path, bytes)
}
#[tokio::test]
async fn signed_puts_stream_exact_payloads_and_replay_after_region_and_server_errors() {
    let attempts = Arc::new(AtomicUsize::new(0));
    let count = Arc::clone(&attempts);
    let mock = MockS3::start(move |call| {
        let attempt = count.fetch_add(1, Ordering::SeqCst);
        if attempt == 0 { return Reply::xml(StatusCode::BAD_REQUEST, "<Error><Code>AuthorizationHeaderMalformed</Code><Region>eu-central-1</Region></Error>"); }
        assert!(call.headers["authorization"].to_str().unwrap().contains("/eu-central-1/"));
        if attempt == 1 { Reply::xml(StatusCode::SERVICE_UNAVAILABLE, "<Error><Code>SlowDown</Code></Error>") }
        else { Reply::ok() }
    }).await;
    let path = temp().join("small");
    std::fs::write(&path, b"exact\0body\xff").unwrap();
    let vault = vault(&mock);
    vault.upload_file(&path, &target()).await.unwrap();
    assert_eq!(mock.calls().len(), 3);
    for call in mock.calls() {
        assert_eq!(call.path, "/bucket/prefix/file%20name");
        assert_eq!(&call.body[..], b"exact\0body\xff");
        assert_eq!(call.headers["content-type"], "application/octet-stream");
    }
    std::fs::write(&path, b"").unwrap();
    vault.upload_file(&path, &target()).await.unwrap();
    assert_eq!(mock.calls().last().unwrap().body.len(), 0);
}
#[tokio::test]
async fn multipart_streams_ordered_parts_and_escapes_completion_etags_and_upload_id() {
    let failures = Arc::new(AtomicUsize::new(0));
    let count = Arc::clone(&failures);
    let mock = MockS3::start(move |call| {
        if call.query.contains_key("uploads") { return Reply::xml(StatusCode::OK, "<InitiateMultipartUploadResult><UploadId>id+/&amp;=</UploadId></InitiateMultipartUploadResult>"); }
        assert_eq!(call.query["uploadId"], "id+/&=");
        if call.method == "PUT" {
            if call.query["partNumber"] == "1" && count.fetch_add(1, Ordering::SeqCst) == 0 { return Reply::xml(StatusCode::INTERNAL_SERVER_ERROR, "<Error><Code>InternalError</Code></Error>"); }
            return Reply::part();
        }
        assert_eq!(call.method, "POST"); assert_eq!(call.headers["content-type"], "application/xml");
        let body = std::str::from_utf8(&call.body).unwrap();
        assert!(body.contains("<PartNumber>1</PartNumber><ETag>&quot;part&amp;etag&quot;</ETag>"));
        assert!(body.contains("<PartNumber>2</PartNumber>"));
        Reply::xml(StatusCode::OK, "<CompleteMultipartUploadResult><ETag>final</ETag></CompleteMultipartUploadResult>")
    }).await;
    let (path, expected) = large_file();
    vault(&mock).upload_file(&path, &target()).await.unwrap();
    let calls = mock.calls();
    assert_eq!(calls.len(), 5);
    let mut reconstructed = Vec::new();
    for call in &calls[2..4] {
        assert_eq!(call.method, "PUT");
        reconstructed.extend_from_slice(&call.body);
    }
    assert_eq!(reconstructed, expected);
    assert_eq!(calls[1].body, calls[2].body);
    assert!(!calls.iter().any(|c| c.method == "DELETE"));
}
#[tokio::test]
async fn multipart_failure_and_http_200_error_abort_without_reporting_success() {
    for fail_part in [true, false] {
        let mock = MockS3::start(move |call| {
            if call.query.contains_key("uploads") {
                return Reply::xml(
                    StatusCode::OK,
                    "<Result><UploadId>upload</UploadId></Result>",
                );
            }
            if call.method == "DELETE" {
                return Reply::xml(StatusCode::NO_CONTENT, "");
            }
            if call.method == "PUT" && !fail_part {
                return Reply::part();
            }
            Reply::xml(
                if fail_part {
                    StatusCode::FORBIDDEN
                } else {
                    StatusCode::OK
                },
                " \n<Error><Code>AccessDenied</Code><Message>Denied</Message></Error>",
            )
        })
        .await;
        let (path, _) = large_file();
        let error = vault(&mock)
            .upload_file(&path, &target())
            .await
            .unwrap_err();
        assert!(error.to_string().contains("Denied"));
        let calls = mock.calls();
        assert_eq!(calls.last().unwrap().method, "DELETE");
        assert_eq!(calls.last().unwrap().query["uploadId"], "upload");
        assert_eq!(calls.iter().filter(|c| c.method == "DELETE").count(), 1);
    }
}
#[tokio::test]
async fn missing_etag_or_upload_id_are_not_silent_successes() {
    for missing_id in [true, false] {
        let mock = MockS3::start(move |call| {
            if call.query.contains_key("uploads") {
                return Reply::xml(
                    StatusCode::OK,
                    if missing_id {
                        "<Result/>"
                    } else {
                        "<Result><UploadId>id</UploadId></Result>"
                    },
                );
            }
            Reply::ok()
        })
        .await;
        let (path, _) = large_file();
        let error = vault(&mock)
            .upload_file(&path, &target())
            .await
            .unwrap_err();
        assert!(
            error
                .to_string()
                .contains(if missing_id { "UploadId" } else { "ETag" })
        );
        assert_eq!(
            mock.calls().iter().any(|c| c.method == "DELETE"),
            !missing_id
        );
    }
}
