//! Independently captured actual Scala3/Play3.0.11 HTTP responses, through the Rust router.
use crate::common;
use axum::{body::Body, http::Request};
use common::{header, send};
use serde_json::Value;
use std::path::Path;
use webknossos_datastore::{
    AppState,
    binding_errors::{BypassControllerHeaders, ClientError, render_client_error},
    config::DatastoreConfig,
    error::DsError,
    router,
};

fn app() -> axum::Router {
    let mut config = DatastoreConfig::defaults(Path::new("/tmp/wk-binding-tests"));
    // Binder/schema failures must precede any authorization or datasource RPC.
    config.webknossos.uri = "http://127.0.0.1:1".to_owned();
    router(AppState::new(config))
}
fn fixtures() -> &'static str {
    include_str!("fixtures/binding_errors/scala_http.json")
}

#[tokio::test]
async fn actual_scala_binder_http_goldens_for_all_accepts_and_escaping() {
    let app = app();
    let records: Vec<Value> = serde_json::from_str(fixtures()).unwrap();
    for record in records.iter().filter(|r| {
        matches!(
            r["name"].as_str(),
            Some("objectid" | "int" | "missing" | "bool" | "escaping")
        )
    }) {
        let req = Request::builder()
            .uri(record["path"].as_str().unwrap())
            .header("Accept", record["accept"].as_str().unwrap())
            .body(Body::empty())
            .unwrap();
        let (status, headers, body) = send(app.clone(), req).await;
        assert_eq!(
            status.as_u16(),
            record["status"].as_u64().unwrap() as u16,
            "{record}"
        );
        assert_eq!(
            header(&headers, "content-type"),
            record["headers"]["Content-Type"].as_str(),
            "{record}"
        );
        assert!(header(&headers, "cache-control").is_none(), "{record}");
        assert!(
            header(&headers, "access-control-allow-origin").is_none(),
            "{record}"
        );
        let expected = std::fs::read(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("tests/fixtures/binding_errors")
                .join(record["file"].as_str().unwrap()),
        )
        .unwrap();
        assert_eq!(body, expected, "{record}");
    }
}

#[tokio::test]
async fn schema_rejection_bypasses_fox_headers_and_domain_failures_keep_them() {
    let app = app();
    let req = Request::builder()
        .method("POST")
        .uri("/data/datasets/000000000000000000000004/layers/color/readData")
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .body(Body::from("{}"))
        .unwrap();
    let (status, headers, body) = send(app.clone(), req).await;
    assert_eq!(status.as_u16(), 400);
    assert_eq!(header(&headers, "content-type"), Some("application/json"));
    assert!(header(&headers, "cache-control").is_none());
    assert!(header(&headers, "access-control-allow-origin").is_none());
    let actual: Value = serde_json::from_slice(&body).unwrap();
    let expected: Value =
        serde_json::from_str(include_str!("fixtures/binding_errors/schema.body")).unwrap();
    assert_eq!(actual, expected);
    // Domain errors still return their ordinary messages JSON and Action.fox headers.
    let app = webknossos_datastore::controller(
        axum::Router::new().route(
            "/domain",
            axum::routing::get(|| async { DsError::failure("domain") }),
        ),
        true,
    );
    let (status, headers, body) = send(
        app.clone(),
        Request::builder()
            .uri("/domain")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status.as_u16(), 400);
    assert_eq!(header(&headers, "cache-control"), Some("no-cache"));
    assert_eq!(header(&headers, "access-control-allow-origin"), Some("*"));
    assert_eq!(
        serde_json::from_slice::<Value>(&body).unwrap(),
        serde_json::json!({"messages":[{"error":"domain"}]})
    );
}

#[tokio::test]
async fn content_type_parser_error_matches_actual_scala_html() {
    let app = app();
    let req = Request::builder()
        .method("POST")
        .uri("/data/datasets/000000000000000000000004/layers/color/readData")
        .header("Content-Type", "text/plain")
        .header("Accept", "application/json")
        .body(Body::from("{}"))
        .unwrap();
    let (status, headers, body) = send(app.clone(), req).await;
    assert_eq!(status.as_u16(), 415);
    assert_eq!(
        header(&headers, "content-type"),
        Some("text/html; charset=UTF-8")
    );
    assert!(header(&headers, "cache-control").is_none());
    assert!(header(&headers, "access-control-allow-origin").is_none());
    assert_eq!(
        body,
        include_bytes!("fixtures/binding_errors/content_type.body")
    );
}

#[tokio::test]
async fn malformed_json_uses_html_but_preserves_real_untranslated_diagnostic() {
    let req = Request::builder()
        .method("POST")
        .uri("/data/datasets/000000000000000000000004/layers/color/readData")
        .header("Content-Type", "application/json")
        .body(Body::from("{"))
        .unwrap();
    let (status, headers, body) = send(app(), req).await;
    assert_eq!(status.as_u16(), 400);
    assert_eq!(
        header(&headers, "content-type"),
        Some("text/html; charset=UTF-8")
    );
    assert!(header(&headers, "cache-control").is_none());
    assert!(
        String::from_utf8(body)
            .unwrap()
            .contains("EOF while parsing an object at line 1 column 1")
    );
}

#[tokio::test]
async fn explicit_marker_survives_wrapping_and_status_and_renderer_escapes() {
    use axum::response::IntoResponse;
    let error = DsError::binding("inner")
        .wrap("outer")
        .with_status(axum::http::StatusCode::BAD_REQUEST);
    let response = error.into_response();
    assert!(response.extensions().get::<ClientError>().is_some());
    assert!(
        response
            .extensions()
            .get::<BypassControllerHeaders>()
            .is_some()
    );
    let response = render_client_error(
        ClientError {
            status: axum::http::StatusCode::BAD_REQUEST,
            message: "<&\"'>".into(),
        },
        "GET",
        "/x?q=<&\"'>",
    );
    assert!(
        response
            .extensions()
            .get::<BypassControllerHeaders>()
            .is_some()
    );
    let bytes = axum::body::to_bytes(response.into_body(), 4096)
        .await
        .unwrap();
    let html = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(
        html.contains(
            "For request 'GET /x?q=&lt;&amp;&quot;&#x27;&gt;' [&lt;&amp;&quot;&#x27;&gt;]"
        )
    );
    assert!(!html.contains("/x?q=<&"));
}

#[tokio::test]
async fn accepted_text_json_and_datatype_errors_match_actual_scala_schema_goldens() {
    let app = app();
    let records: Vec<Value> = serde_json::from_str(fixtures()).unwrap();
    for record in records.iter().filter(|r| {
        matches!(
            r["name"].as_str(),
            Some("text_json" | "text_json_charset" | "datatype")
        )
    }) {
        let req = Request::builder()
            .method("POST")
            .uri(record["path"].as_str().unwrap())
            .header("Content-Type", record["content_type"].as_str().unwrap())
            .header("Accept", "application/json")
            .body(Body::from(
                record["request_body"].as_str().unwrap().to_owned(),
            ))
            .unwrap();
        let (status, headers, body) = send(app.clone(), req).await;
        assert_eq!(
            status.as_u16(),
            record["status"].as_u64().unwrap() as u16,
            "{record}"
        );
        assert_eq!(header(&headers, "content-type"), Some("application/json"));
        assert!(header(&headers, "cache-control").is_none());
        assert!(header(&headers, "access-control-allow-origin").is_none());
        let expected = std::fs::read(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("tests/fixtures/binding_errors")
                .join(record["file"].as_str().unwrap()),
        )
        .unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&body).unwrap(),
            serde_json::from_slice::<Value>(&expected).unwrap()
        );
    }
}
