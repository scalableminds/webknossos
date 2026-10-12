use std::time::Duration;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::Value;
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;
use webknossos_backend::{
    AppState,
    config::{Config, DatabaseConfig},
    router, router_with_config,
};

#[tokio::test]
async fn closed_database_readiness_is_unavailable_but_liveness_remains_healthy() {
    let pool = PgPoolOptions::new()
        .connect_lazy("postgres://unused@127.0.0.1:1/unavailable")
        .unwrap();
    pool.close().await;
    let app = router(AppState { pool });
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/health/ready")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(response.headers()["cache-control"], "no-store");
    let body: Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(body["messages"][0]["error"], "Database unavailable.");
    let response = app
        .oneshot(
            Request::builder()
                .uri("/health/live")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn request_timeout_bounds_database_waits_and_preserves_error_headers() {
    let pool = PgPoolOptions::new()
        .acquire_timeout(Duration::from_secs(5))
        .connect_lazy("postgres://database_secret@127.0.0.1:1/unavailable")
        .unwrap();
    let config = Config {
        bind: "127.0.0.1:0".parse().unwrap(),
        database: DatabaseConfig {
            url: "postgres://database_secret@127.0.0.1:1/unavailable".into(),
            min_connections: 0,
            max_connections: 1,
            acquire_timeout: Duration::from_secs(5),
        },
        public_url: "http://localhost:9000".parse().unwrap(),
        email_verification_enabled: true,
        jobs_enabled: false,
        jobs: Default::default(),
        annotation_mutex_expiry: Duration::from_secs(120),
        time_tracking: Default::default(),
        auth_routes: Default::default(),
        browser_auth: Default::default(),
        service_client: Default::default(),
        allow_delete_datasets: true,
        datasets: Default::default(),
        request_timeout: Duration::from_millis(10),
        shutdown_timeout: Duration::from_secs(1),
        body_limit: 1024,
        misc: Default::default(),
        voxelytics: Default::default(),
        oidc: Default::default(),
        mail: Default::default(),
        housekeeping: Default::default(),
        slack: Default::default(),
        credit_ticker: Default::default(),
        used_storage: Default::default(),
        worker_liveness: Default::default(),
    };
    let app = router_with_config(AppState { pool: pool.clone() }, &config);
    let response = tokio::time::timeout(
        Duration::from_secs(1),
        app.oneshot(
            Request::builder()
                .uri("/api/teams?token=query_secret")
                .header("x-request-id", "timeout-request")
                .body(Body::empty())
                .unwrap(),
        ),
    )
    .await
    .expect("server timeout must bound database acquisition")
    .unwrap();
    assert_eq!(response.status(), StatusCode::GATEWAY_TIMEOUT);
    assert_eq!(response.headers()["cache-control"], "no-store");
    assert_eq!(response.headers()["x-content-type-options"], "nosniff");
    assert_eq!(response.headers()["x-request-id"], "timeout-request");
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["messages"][0]["error"], "Request timed out.");
    assert!(!String::from_utf8_lossy(&bytes).contains("query_secret"));
    assert!(!String::from_utf8_lossy(&bytes).contains("database_secret"));
    pool.close().await;
}
