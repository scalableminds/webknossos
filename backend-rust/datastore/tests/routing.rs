mod common;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use common::*;
use webknossos_datastore::router;

#[tokio::test]
async fn cors_preflight_matches_scala_for_any_path() {
    let port = closed_port().await;
    for path in [
        "/data/datasets/abc/layers/color/data",
        "/does/not/exist",
        "/data/v99/x",
    ] {
        let request = Request::options(path)
            .header(
                "access-control-request-headers",
                "x-auth-token, content-type",
            )
            .header("origin", "https://example.org")
            .body(Body::empty())
            .unwrap();
        let (status, headers, body) = send(router(state_with_redis_port(port)), request).await;
        assert_eq!(status, StatusCode::OK, "{path}");
        assert_eq!(body, b":D");
        assert_eq!(header(&headers, "access-control-allow-origin"), Some("*"));
        assert_eq!(header(&headers, "access-control-max-age"), Some("600"));
        assert_eq!(
            header(&headers, "access-control-allow-methods"),
            Some("POST, GET, DELETE, PUT, HEAD, PATCH, OPTIONS")
        );
        assert_eq!(
            header(&headers, "access-control-allow-headers"),
            Some("x-auth-token, content-type")
        );
        assert_eq!(
            header(&headers, "access-control-expose-headers"),
            Some("failure-bucket-indices, empty-bucket-indices, MISSING-BUCKETS")
        );
        assert_eq!(header(&headers, "x-frame-options"), Some("DENY"));
    }
    let request = Request::options("/data/health")
        .body(Body::empty())
        .unwrap();
    let (_, headers, _) = send(router(state_with_redis_port(port)), request).await;
    assert_eq!(header(&headers, "access-control-allow-headers"), Some(""));
}

#[tokio::test]
async fn unknown_routes_answer_json_404() {
    let port = closed_port().await;
    let (status, headers, body) = get(router(state_with_redis_port(port)), "/data/nope").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(header(&headers, "content-type"), Some("application/json"));
    assert_eq!(header(&headers, "access-control-allow-origin"), None);
    assert_eq!(
        json(&body),
        serde_json::json!({"messages": [{"error": "Route not implemented by the Rust datastore."}]})
    );
}

#[tokio::test]
async fn unsupported_api_versions_answer_scala_404() {
    let port = closed_port().await;
    for (path, requested) in [
        ("/data/v9/health", 9),
        ("/data/v17/health", 17),
        ("/api/v42/buildinfo", 42),
    ] {
        let (status, _, body) = get(router(state_with_redis_port(port)), path).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(
            json(&body),
            serde_json::json!({"messages": [{"error": format!(
                "This WEBKNOSSOS instance does not support the requested HTTP API version. Client requested {requested} but must be at least 10 and at most 16."
            )}]})
        );
    }
}

#[tokio::test]
async fn legacy_override_paths_are_not_served_by_latest_handlers() {
    let port = closed_port().await;
    let (status, _, body) = get(
        router(state_with_redis_port(port)),
        "/data/v14/zarr/abc/datasource-properties.json",
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        json(&body)["messages"][0]["error"],
        "Route not implemented by the Rust datastore."
    );
}

#[tokio::test]
async fn wrong_method_answers_json_405() {
    let port = closed_port().await;
    let request = Request::post("/data/health").body(Body::empty()).unwrap();
    let (status, _, body) = send(router(state_with_redis_port(port)), request).await;
    assert_eq!(status, StatusCode::METHOD_NOT_ALLOWED);
    assert_eq!(json(&body)["messages"][0]["error"], "Method not allowed.");
}

#[tokio::test]
async fn frontpage_links_to_webknossos_and_health() {
    let port = closed_port().await;
    for path in ["/", "/index.html"] {
        let (status, headers, body) = get(router(state_with_redis_port(port)), path).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            header(&headers, "content-type"),
            Some("text/html; charset=utf-8")
        );
        let body = String::from_utf8(body).unwrap();
        assert!(body.contains("This is the WEBKNOSSOS Datastore “test-ds”."));
        assert!(body.contains(r#"<a href="http://localhost:9000" id="wkLink">"#));
        assert!(body.contains(r#"fetch("/data/health")"#));
    }
}
