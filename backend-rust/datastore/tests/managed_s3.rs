use crate::mock_s3;
use axum::http::StatusCode;
use mock_s3::{MockS3, Reply};
use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};
use webknossos_datastore::datavault::ToRemoteUri;
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
            ..S3Options::default()
        },
    ))
}
fn target() -> UPath {
    UPath::parse("s3://bucket/prefix/file%20name").unwrap()
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
                ..S3Options::default()
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
async fn signed_puts_send_exact_payloads_in_the_bucket_region_and_retry_server_errors() {
    let attempts = Arc::new(AtomicUsize::new(0));
    let count = Arc::clone(&attempts);
    let mock = MockS3::start(move |call| {
        if call.method == "HEAD" {
            return Reply::xml(StatusCode::FORBIDDEN, "")
                .with("x-amz-bucket-region", "eu-central-1");
        }
        assert!(
            call.headers["authorization"]
                .to_str()
                .unwrap()
                .contains("/eu-central-1/")
        );
        if count.fetch_add(1, Ordering::SeqCst) == 0 {
            Reply::xml(
                StatusCode::SERVICE_UNAVAILABLE,
                "<Error><Code>SlowDown</Code></Error>",
            )
        } else {
            Reply::ok()
        }
    })
    .await;
    let path = temp().join("small");
    std::fs::write(&path, b"exact\0body\xff").unwrap();
    let vault = vault(&mock);
    vault.upload_file(&path, &target()).await.unwrap();
    let puts: Vec<_> = mock
        .calls()
        .into_iter()
        .filter(|c| c.method == "PUT")
        .collect();
    assert_eq!(puts.len(), 2);
    for call in puts {
        assert_eq!(call.path, "/bucket/prefix/file%20name");
        assert_eq!(&call.body[..], b"exact\0body\xff");
        assert_eq!(call.headers["content-type"], "application/octet-stream");
    }
    std::fs::write(&path, b"").unwrap();
    vault.upload_file(&path, &target()).await.unwrap();
    assert_eq!(mock.calls().last().unwrap().body.len(), 0);
}
#[tokio::test]
async fn multipart_sends_ordered_parts_and_escapes_completion_etags_and_upload_id() {
    let failures = Arc::new(AtomicUsize::new(0));
    let count = Arc::clone(&failures);
    let mock = MockS3::start(move |call| {
        if call.query.contains_key("uploads") {
            return Reply::xml(
                StatusCode::OK,
                "<InitiateMultipartUploadResult><UploadId>id+/&amp;=</UploadId>\
                </InitiateMultipartUploadResult>",
            );
        }
        assert_eq!(call.query["uploadId"], "id+/&=");
        if call.method == "PUT" {
            if call.query["partNumber"] == "1" && count.fetch_add(1, Ordering::SeqCst) == 0 {
                return Reply::xml(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "<Error><Code>InternalError</Code></Error>",
                );
            }
            return Reply::part();
        }
        assert_eq!(call.method, "POST");
        let body = std::str::from_utf8(&call.body).unwrap();
        assert!(body.contains("part&amp;etag"), "{body}");
        assert!(body.contains("<PartNumber>1</PartNumber>"));
        assert!(body.contains("<PartNumber>2</PartNumber>"));
        Reply::xml(
            StatusCode::OK,
            "<CompleteMultipartUploadResult><ETag>final</ETag>\
                </CompleteMultipartUploadResult>",
        )
    })
    .await;
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
        let expected = if fail_part {
            "Denied"
        } else {
            "invalid multipart response"
        };
        assert!(error.to_string().contains(expected), "{error}");
        let calls = mock.calls();
        assert_eq!(calls.last().unwrap().method, "DELETE");
        assert_eq!(calls.last().unwrap().query["uploadId"], "upload");
        assert_eq!(calls.iter().filter(|c| c.method == "DELETE").count(), 1);
    }
}
#[tokio::test]
async fn missing_upload_id_or_completion_etag_are_not_silent_successes() {
    for missing_id in [true, false] {
        let mock = MockS3::start(move |call| {
            if call.query.contains_key("uploads") {
                return Reply::xml(
                    StatusCode::OK,
                    if missing_id {
                        "<Result></Result>"
                    } else {
                        "<Result><UploadId>id</UploadId></Result>"
                    },
                );
            }
            if call.method == "POST" {
                return Reply::xml(StatusCode::OK, "<CompleteMultipartUploadResult/>");
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
            error.to_string().contains("invalid multipart response"),
            "{error}"
        );
        assert_eq!(
            mock.calls().iter().any(|c| c.method == "DELETE"),
            !missing_id
        );
    }
}

#[tokio::test]
async fn managed_s3_deletion_removes_all_objects_below_the_path_and_refuses_unsafe_paths() {
    use webknossos_datastore::datavault::{
        BoxFuture, CredentialLookup, DataVaultCredential, DataVaultService,
        DataVaultServiceOptions, GcsOptions,
    };
    use webknossos_datastore::error::{DsError, DsResult};
    struct NoLookup;
    impl CredentialLookup for NoLookup {
        fn find_credential<'a>(
            &'a self,
            _: &'a str,
        ) -> BoxFuture<'a, DsResult<DataVaultCredential>> {
            Box::pin(async { Err(DsError::failure("unused")) })
        }
    }
    let mock = MockS3::start(|call| match call.method.as_str() {
        "HEAD" => Reply::xml(StatusCode::FORBIDDEN, "").with("x-amz-bucket-region", "us-east-1"),
        "GET" if call.query.contains_key("list-type") => {
            assert_eq!(call.query["prefix"], "prefix/dataset/");
            if call.query.contains_key("continuation-token") {
                Reply::xml(
                    StatusCode::OK,
                    "<ListBucketResult><IsTruncated>false</IsTruncated>\
                     <Contents><Key>prefix/dataset/layer/1/c</Key><Size>1</Size>\
                     <LastModified>2026-01-01T00:00:00.000Z</LastModified></Contents>\
                     </ListBucketResult>",
                )
            } else {
                Reply::xml(
                    StatusCode::OK,
                    "<ListBucketResult><IsTruncated>true</IsTruncated>\
                     <NextContinuationToken>next</NextContinuationToken>\
                     <Contents><Key>prefix/dataset/a</Key><Size>1</Size>\
                     <LastModified>2026-01-01T00:00:00.000Z</LastModified></Contents>\
                     <Contents><Key>prefix/dataset/b</Key><Size>1</Size>\
                     <LastModified>2026-01-01T00:00:00.000Z</LastModified></Contents>\
                     </ListBucketResult>",
                )
            }
        }
        "POST" if call.query.contains_key("delete") => {
            let body = String::from_utf8_lossy(&call.body);
            let deleted: String = body
                .split("<Key>")
                .skip(1)
                .map(|rest| {
                    let key = rest.split("</Key>").next().unwrap();
                    format!("<Deleted><Key>{key}</Key></Deleted>")
                })
                .collect();
            Reply::xml(
                StatusCode::OK,
                &format!("<DeleteResult>{deleted}</DeleteResult>"),
            )
        }
        "DELETE" => Reply::xml(StatusCode::NO_CONTENT, ""),
        _ => Reply::xml(StatusCode::BAD_REQUEST, ""),
    })
    .await;
    let service = DataVaultService::new(
        DataVaultServiceOptions {
            datastore_uri: "https://datastore.test".into(),
            local_directory_whitelist: vec![],
            working_dir: temp(),
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
                ..S3Options::default()
            },
            gcs: GcsOptions::from_env(),
        },
        Arc::new(NoLookup),
    );
    assert!(service.has_global_s3_credentials());
    for refused in [
        "s3://bucket/prefix",
        "s3://bucket/prefix/",
        "s3://bucket",
        "s3://bucket/other/dataset",
        "s3://bucket/prefix/dataset?x=1",
        "s3://bucket/prefix/dataset#x",
    ] {
        let error = service
            .delete_recursively_in_managed_s3(&UPath::parse(refused).unwrap())
            .await
            .unwrap_err();
        assert!(
            error.message.contains("Refusing to delete")
                || error.message.contains("No global S3 credential"),
            "{refused}: {}",
            error.message
        );
    }
    assert!(mock.calls().is_empty());
    service
        .delete_recursively_in_managed_s3(&UPath::parse("s3://bucket/prefix/dataset/").unwrap())
        .await
        .unwrap();
    let calls = mock.calls();
    let bulk: Vec<String> = calls
        .iter()
        .filter(|c| c.method == "POST")
        .map(|c| String::from_utf8_lossy(&c.body).into_owned())
        .collect();
    // object_store sends single deletes as DeleteObjects requests, too.
    assert_eq!(bulk.len(), 3);
    assert!(
        bulk[0].contains("<Key>prefix/dataset/a</Key>")
            && bulk[0].contains("<Key>prefix/dataset/b</Key>")
    );
    assert!(bulk[1].contains("<Key>prefix/dataset/layer/1/c</Key>"));
    assert!(bulk[2].contains("<Object><Key>prefix/dataset</Key></Object>"));
    assert_eq!(calls.iter().filter(|c| c.method == "GET").count(), 2);
}

#[tokio::test]
async fn path_deletion_tick_deletes_only_managed_paths_and_reports_the_deleted_ones() {
    use crate::mock_wk::{self, MockWk};
    use serde_json::json;
    use webknossos_datastore::{
        clients::wk::WkClient,
        datavault::{
            BoxFuture, CredentialLookup, DataVaultCredential, DataVaultService,
            DataVaultServiceOptions, GcsOptions,
        },
        error::{DsError, DsResult},
        services::managed_s3_path_deletion::ManagedS3PathDeletionService,
    };
    struct NoLookup;
    impl CredentialLookup for NoLookup {
        fn find_credential<'a>(
            &'a self,
            _: &'a str,
        ) -> BoxFuture<'a, DsResult<DataVaultCredential>> {
            Box::pin(async { Err(DsError::failure("unused")) })
        }
    }
    let s3 = MockS3::start(|call| match call.method.as_str() {
        "GET" => Reply::xml(
            StatusCode::OK,
            "<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>",
        ),
        "POST" => {
            let body = String::from_utf8_lossy(&call.body);
            let key = body.split("<Key>").nth(1).unwrap().split("</Key>").next().unwrap();
            if key.contains("failing") {
                Reply::xml(
                    StatusCode::OK,
                    &format!("<DeleteResult><Error><Key>{key}</Key><Code>AccessDenied</Code><Message>no</Message></Error></DeleteResult>"),
                )
            } else {
                Reply::xml(
                    StatusCode::OK,
                    &format!("<DeleteResult><Deleted><Key>{key}</Key></Deleted></DeleteResult>"),
                )
            }
        }
        _ => Reply::xml(StatusCode::FORBIDDEN, "").with("x-amz-bucket-region", "us-east-1"),
    })
    .await;
    let wk = MockWk::start(|call| {
        if call.path.ends_with("/pathsToDelete") {
            mock_wk::Reply::json(
                StatusCode::OK,
                json!([
                    "s3://bucket/prefix/dataset",
                    "s3://bucket/prefix/failing",
                    "s3://bucket/prefix/query?x=1",
                    "s3://other-bucket/dataset",
                    "/local/dataset",
                    "not a path \u{0}"
                ]),
            )
        } else {
            mock_wk::Reply::json(StatusCode::OK, json!({}))
        }
    })
    .await;
    let data_vaults = DataVaultService::new(
        DataVaultServiceOptions {
            datastore_uri: "https://datastore.test".into(),
            local_directory_whitelist: vec![],
            working_dir: temp(),
            global_credentials: vec![DataVaultCredential::S3AccessKey {
                name: "s3://bucket/prefix".into(),
                access_key_id: "example-key".into(),
                secret_access_key: "example-secret".into(),
                user: None,
                organization: None,
            }],
            s3: S3Options {
                env_credentials: None,
                aws_endpoint_override: Some(s3.base()),
                ..S3Options::default()
            },
            gcs: GcsOptions::from_env(),
        },
        Arc::new(NoLookup),
    );
    let service =
        ManagedS3PathDeletionService::new(WkClient::new(&wk.config()).unwrap(), data_vaults);
    service.tick().await.unwrap();
    let calls = wk.calls();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].method, "GET");
    assert_eq!(calls[0].path, "/api/datastores/test-ds/pathsToDelete");
    assert_eq!(calls[0].query_value("key").as_deref(), Some(mock_wk::KEY));
    assert_eq!(calls[1].method, "POST");
    assert_eq!(
        calls[1].path,
        "/api/datastores/test-ds/pathsToDelete/markAsDeleted"
    );
    assert_eq!(calls[1].json(), json!(["s3://bucket/prefix/dataset"]));
}
