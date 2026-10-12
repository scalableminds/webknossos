use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;
use webknossos_backend::{AppState, router};

fn app() -> axum::Router {
    // No database connection is established: public probes and unauthenticated
    // rejections must work even while the database is unavailable.
    router(AppState {
        pool: PgPoolOptions::new()
            .connect_lazy("postgres://unused@127.0.0.1:1/unused")
            .unwrap(),
    })
}

#[tokio::test]
async fn health_and_version_aliases_are_stable() {
    let app = app();
    for uri in [
        "/health/live",
        "/api/health",
        "/api/v10/health",
        "/api/v16/health",
    ] {
        let response = app
            .clone()
            .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["cache-control"], "no-store");
        assert_eq!(response.headers()["x-content-type-options"], "nosniff");
        assert!(!response.headers()["x-request-id"].is_empty());
        assert_eq!(
            response.into_body().collect().await.unwrap().to_bytes(),
            "Ok"
        );
    }
}

#[tokio::test]
async fn errors_use_json_envelope_and_preserve_request_id() {
    for (uri, method, status) in [
        ("/api/teams", "GET", StatusCode::UNAUTHORIZED),
        ("/api/v16/projects", "GET", StatusCode::UNAUTHORIZED),
        ("/api/teams", "PATCH", StatusCode::METHOD_NOT_ALLOWED),
        (
            "/api/not-a-route?token=never-echo-this",
            "GET",
            StatusCode::NOT_FOUND,
        ),
    ] {
        let response = app()
            .oneshot(
                Request::builder()
                    .uri(uri)
                    .method(method)
                    .header("x-request-id", "test-request")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), status, "{uri}");
        assert_eq!(response.headers()["x-request-id"], "test-request");
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let json: Value = serde_json::from_slice(&body).unwrap();
        assert!(json["messages"][0]["error"].is_string());
        assert!(!String::from_utf8_lossy(&body).contains("never-echo-this"));
    }
}

#[tokio::test]
async fn json_errors_and_body_limit_have_consistent_statuses() {
    for (content_type, body, expected) in [
        (
            "application/json",
            "not json".to_owned(),
            StatusCode::BAD_REQUEST,
        ),
        (
            "application/json",
            json!({"unexpected":true}).to_string(),
            StatusCode::BAD_REQUEST,
        ),
        (
            "text/plain",
            "\"http://localhost:9000/a\"".to_owned(),
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
        ),
        (
            "application/json",
            format!("\"{}\"", "x".repeat(2 * 1024 * 1024)),
            StatusCode::PAYLOAD_TOO_LARGE,
        ),
    ] {
        let response = app()
            .oneshot(
                Request::builder()
                    .uri("/api/shortLinks")
                    .method("POST")
                    .header("content-type", content_type)
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), expected);
        let json: Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert!(json["messages"][0]["error"].is_string());
    }
}
