//! WK RPC client against a mock WEBKNOSSOS HTTP server.

mod mock_wk;

use std::time::Duration;

use axum::http::StatusCode;
use mock_wk::{MockWk, Reply};
use serde_json::{Value, json};
use webknossos_datastore::{
    access::{TokenContext, UserAccessRequest},
    wk_client::{JobExportProperties, WkClient},
};

use mock_wk::KEY;

#[tokio::test]
async fn status_ping_patches_status_with_scala_payload() {
    let wk = MockWk::start(|_| Reply::json(StatusCode::OK, json!({}))).await;
    let client = WkClient::new(&wk.config()).unwrap();
    let ping = tokio::spawn(
        client
            .clone()
            .status_ping_loop(Duration::ZERO, Duration::from_millis(40)),
    );
    tokio::time::sleep(Duration::from_millis(150)).await;
    ping.abort();
    let calls = wk.calls();
    assert!(
        calls.len() >= 2,
        "expected repeated pings, got {}",
        calls.len()
    );
    for call in &calls {
        assert_eq!(call.method, "PATCH");
        assert_eq!(call.path, "/api/datastores/test-ds/status");
        assert_eq!(call.query, vec![("key".to_owned(), KEY.to_owned())]);
        assert_eq!(call.content_type.as_deref(), Some("application/json"));
        assert_eq!(
            call.json(),
            json!({"ok": true, "url": "http://localhost:9090"})
        );
    }
}

#[tokio::test]
async fn status_ping_rejects_intervals_below_inner_ticker() {
    let wk = MockWk::start(|_| Reply::json(StatusCode::OK, json!({}))).await;
    let mut config = wk.config();
    config.webknossos.ping_interval = Duration::from_millis(50);
    let error = WkClient::new(&config)
        .unwrap()
        .spawn_status_ping()
        .unwrap_err();
    assert!(
        error
            .message
            .starts_with("IntervalScheduler was initialized")
    );
}

#[tokio::test]
async fn failed_rpc_keeps_status_and_hides_query() {
    let wk = MockWk::start(|_| Reply::text(StatusCode::FORBIDDEN, "nope")).await;
    let client = WkClient::new(&wk.config()).unwrap();
    let error = client.report_status().await.unwrap_err();
    assert_eq!(error.status, StatusCode::FORBIDDEN);
    assert!(
        error.message.starts_with("Failed RPC ")
            && error.message.ends_with(&format!(
                ": PATCH {}/api/datastores/test-ds/status. Response: 403 'nope'",
                wk.uri()
            )),
        "{}",
        error.message
    );
    assert!(!error.message.contains(KEY));
}

#[tokio::test]
async fn transport_errors_are_400_failures_without_secrets() {
    let wk = MockWk::start(|_| Reply::json(StatusCode::OK, json!({}))).await;
    let mut config = wk.config();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    config.webknossos.uri = format!("http://127.0.0.1:{port}");
    let client = WkClient::new(&config).unwrap();
    let error = client
        .request_user_access(
            &UserAccessRequest::webknossos(),
            &TokenContext::new(Some("user-token".into())),
        )
        .await
        .unwrap_err();
    assert_eq!(error.status, StatusCode::BAD_REQUEST);
    assert!(
        error.message.starts_with("Error sending RPC "),
        "{}",
        error.message
    );
    assert!(!error.message.contains(KEY) && !error.message.contains("user-token"));
}

#[tokio::test]
async fn invalid_json_answers_fail() {
    let wk = MockWk::start(|_| Reply::text(StatusCode::OK, "not json")).await;
    let client = WkClient::new(&wk.config()).unwrap();
    let error = client.get_job_export_properties("job1").await.unwrap_err();
    assert_eq!(error.status, StatusCode::BAD_REQUEST);
    assert!(
        error.message.contains("returned invalid JSON"),
        "{}",
        error.message
    );
}

#[tokio::test]
async fn job_export_properties_query_order_and_model() {
    let wk = MockWk::start(|_| {
        Reply::json(
            StatusCode::OK,
            json!({"jobId": "j", "runId": "r", "organizationId": "o", "exportFileName": "f.zip"}),
        )
    })
    .await;
    let client = WkClient::new(&wk.config()).unwrap();
    let props = client.get_job_export_properties("j").await.unwrap();
    assert_eq!(
        props,
        JobExportProperties {
            job_id: "j".into(),
            run_id: "r".into(),
            organization_id: "o".into(),
            export_file_name: "f.zip".into()
        }
    );
    let call = &wk.calls()[0];
    assert_eq!(call.method, "GET");
    assert_eq!(call.path, "/api/datastores/test-ds/jobExportProperties");
    assert_eq!(
        call.query,
        vec![
            ("jobId".to_owned(), "j".to_owned()),
            ("key".to_owned(), KEY.to_owned())
        ]
    );
}

#[tokio::test]
async fn dataset_id_lookup_is_cached_and_failures_are_not() {
    let wk = MockWk::start(|call| {
        if call.query_value("datasetDirectoryName").as_deref() == Some("missing") {
            Reply::text(StatusCode::NOT_FOUND, "unknown")
        } else {
            Reply::json(StatusCode::OK, json!("5f0c4e8a2b00002b00b4a1c3"))
        }
    })
    .await;
    let client = WkClient::new(&wk.config()).unwrap();
    for _ in 0..2 {
        assert_eq!(
            client.get_dataset_id("org", "ds dir").await.unwrap(),
            "5f0c4e8a2b00002b00b4a1c3"
        );
    }
    assert_eq!(wk.calls().len(), 1);
    let call = &wk.calls()[0];
    assert_eq!(call.path, "/api/datastores/test-ds/findDatasetId");
    assert_eq!(
        call.query,
        vec![
            ("key".to_owned(), KEY.to_owned()),
            ("organizationId".to_owned(), "org".to_owned()),
            ("datasetDirectoryName".to_owned(), "ds dir".to_owned())
        ]
    );
    for _ in 0..2 {
        let error = client.get_dataset_id("org", "missing").await.unwrap_err();
        assert_eq!(error.status, StatusCode::NOT_FOUND);
        assert_eq!(
            error.message,
            "Failed to get dataset id from remote webknossos"
        );
    }
    assert_eq!(wk.calls().len(), 3);
}

#[tokio::test]
async fn local_root_path_empty_answer_is_none() {
    let wk = MockWk::start(|call| {
        if call.query_value("datasetId").as_deref() == Some("a") {
            Reply::json(StatusCode::OK, json!(""))
        } else {
            Reply::json(StatusCode::OK, json!("/srv/data/org/ds"))
        }
    })
    .await;
    let client = WkClient::new(&wk.config()).unwrap();
    assert_eq!(
        client.get_local_root_path_or_empty("a").await.unwrap(),
        None
    );
    assert_eq!(
        client.get_local_root_path_or_empty("b").await.unwrap(),
        Some("/srv/data/org/ds".into())
    );
    assert_eq!(
        wk.calls()[0].path,
        "/api/datastores/test-ds/findDatasetLocalRootPath"
    );
}

#[tokio::test]
async fn tracingstore_uri_is_cached() {
    let wk = MockWk::start(|_| {
        Reply::json(
            StatusCode::OK,
            json!({"name": "ts", "url": "http://ts:9050"}),
        )
    })
    .await;
    let client = WkClient::new(&wk.config()).unwrap();
    assert_eq!(
        client.get_tracingstore_uri().await.unwrap(),
        "http://ts:9050"
    );
    assert_eq!(
        client.get_tracingstore_uri().await.unwrap(),
        "http://ts:9050"
    );
    let calls = wk.calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].path, "/api/tracingstore");
    assert_eq!(calls[0].query, vec![("key".to_owned(), KEY.to_owned())]);
}

#[tokio::test]
async fn annotation_source_and_credential_lookups() {
    let wk = MockWk::start(|_| Reply::json(StatusCode::OK, json!({"name": "c"}))).await;
    let client = WkClient::new(&wk.config()).unwrap();
    let tc = TokenContext::new(Some("u".into()));
    client.get_annotation_source("priv", &tc).await.unwrap();
    client.get_annotation_source("priv", &tc).await.unwrap();
    client.get_credential("cred1").await.unwrap();
    let calls = wk.calls();
    assert_eq!(calls.len(), 2, "annotation source is cached for 5 s");
    assert_eq!(calls[0].path, "/api/annotations/source/priv");
    assert_eq!(
        calls[0].query,
        vec![
            ("key".to_owned(), KEY.to_owned()),
            ("userToken".to_owned(), "u".to_owned())
        ]
    );
    assert_eq!(calls[1].path, "/api/datastores/test-ds/findCredential");
    assert_eq!(
        calls[1].query,
        vec![
            ("credentialId".to_owned(), "cred1".to_owned()),
            ("key".to_owned(), KEY.to_owned())
        ]
    );
}

/// (method, path, query)
type CallSummary = (String, String, Vec<(String, String)>);

#[tokio::test]
async fn report_calls_use_scala_methods_paths_and_bodies() {
    let wk = MockWk::start(|_| Reply::json(StatusCode::OK, json!({"id": "x"}))).await;
    let client = WkClient::new(&wk.config()).unwrap();
    let tc = TokenContext::new(Some("tok".into()));
    client
        .delete_dataset("5f0c4e8a2b00002b00b4a1c3")
        .await
        .unwrap();
    client
        .report_data_sources(&json!([]), Some("org"))
        .await
        .unwrap();
    client.report_data_sources(&json!([]), None).await.unwrap();
    client.report_real_paths(&json!([])).await.unwrap();
    client
        .update_data_source(&json!({"a": 1}), "dsid", &tc)
        .await
        .unwrap();
    client
        .report_dataset_upload("dsid", &json!({"p": 1}), &tc)
        .await
        .unwrap();
    let reserved: Value = client
        .reserve_dataset_upload(&json!({}), &tc)
        .await
        .unwrap();
    assert_eq!(reserved, json!({"id": "x"}));
    let _: Value = client.get_data_source("dsid").await.unwrap();
    let _: Value = client
        .get_unfinished_uploads_for_user("orgName", &tc)
        .await
        .unwrap();

    let calls = wk.calls();
    let summary: Vec<CallSummary> = calls
        .iter()
        .map(|c| (c.method.clone(), c.path.clone(), c.query.clone()))
        .collect();
    let key = ("key".to_owned(), KEY.to_owned());
    let token = ("token".to_owned(), "tok".to_owned());
    let p = |s: &str| format!("/api/datastores/test-ds/{s}");
    assert_eq!(
        summary,
        vec![
            ("POST".into(), p("deleteDataset"), vec![key.clone()]),
            (
                "PUT".into(),
                p("datasources"),
                vec![key.clone(), ("organizationId".into(), "org".into())]
            ),
            ("PUT".into(), p("datasources"), vec![key.clone()]),
            ("PUT".into(), p("datasources/realpaths"), vec![key.clone()]),
            (
                "PUT".into(),
                p("datasources/dsid"),
                vec![key.clone(), token.clone()]
            ),
            (
                "POST".into(),
                p("reportDatasetUpload"),
                vec![
                    key.clone(),
                    ("datasetId".into(), "dsid".into()),
                    token.clone()
                ]
            ),
            (
                "POST".into(),
                p("reserveDatasetUpload"),
                vec![key.clone(), token.clone()]
            ),
            ("GET".into(), p("datasources/dsid"), vec![key.clone()]),
            (
                "GET".into(),
                p("getUnfinishedDatasetUploadsForUser"),
                vec![
                    key.clone(),
                    ("organizationName".into(), "orgName".into()),
                    token
                ]
            ),
        ]
    );
    assert_eq!(calls[0].json(), json!("5f0c4e8a2b00002b00b4a1c3"));
    assert_eq!(calls[4].json(), json!({"a": 1}));
}

#[tokio::test]
async fn webknossos_uri_path_prefix_is_kept() {
    let wk = MockWk::start(|_| Reply::json(StatusCode::OK, json!({}))).await;
    let mut config = wk.config();
    config.webknossos.uri = format!("{}/prefix", wk.uri());
    WkClient::new(&config)
        .unwrap()
        .report_status()
        .await
        .unwrap();
    assert_eq!(wk.calls()[0].path, "/prefix/api/datastores/test-ds/status");
}
