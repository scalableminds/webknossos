mod common;

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use common::{TestDb, object_id};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{AppState, router};

async fn request(
    app: &Router,
    method: &str,
    path: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json");
    if let Some(token) = token {
        builder = builder.header("x-auth-token", token);
    }
    let response = app
        .clone()
        .oneshot(
            builder
                .body(
                    body.map(|v| Body::from(v.to_string()))
                        .unwrap_or_else(Body::empty),
                )
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap())
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn tracing_store_registry_exposes_only_public_fields_and_requires_admin_updates() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let member = db.seed_user(&object_id(), &f.organization_id, false).await;
    sqlx::query("INSERT INTO webknossos.tracingStores(name,url,publicUrl,key) VALUES('tracing','http://private:9001','https://public.example','private-key')").execute(&db.pool).await.unwrap();
    let app = router(AppState {
        pool: db.pool.clone(),
    });
    assert_eq!(
        request(&app, "GET", "/api/tracingstore", None, None).await,
        (
            StatusCode::OK,
            json!({"name":"tracing","url":"https://public.example"})
        )
    );
    let body =
        json!({"name":"tracing","url":"http://private:9002","publicUrl":"https://updated.example"});
    for (token, status) in [
        (None, StatusCode::UNAUTHORIZED),
        (Some(member.token.as_str()), StatusCode::FORBIDDEN),
    ] {
        assert_eq!(
            request(
                &app,
                "PUT",
                "/api/tracingstores/tracing",
                token,
                Some(body.clone())
            )
            .await
            .0,
            status
        );
    }
    assert_eq!(
        request(
            &app,
            "PUT",
            "/api/v16/tracingstores/tracing",
            Some(&f.token),
            Some(body.clone())
        )
        .await,
        (
            StatusCode::OK,
            json!({"name":"tracing","url":"https://updated.example"})
        )
    );
    let stored: (String, String) =
        sqlx::query_as("SELECT url,key FROM webknossos.tracingStores WHERE name='tracing'")
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(stored, ("http://private:9002".into(), "private-key".into()));
    let mut invalid = body.clone();
    invalid["name"] = json!("renamed");
    assert_eq!(
        request(
            &app,
            "PUT",
            "/api/tracingstores/tracing",
            Some(&f.token),
            Some(invalid)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let mut invalid = body.clone();
    invalid["url"] = json!("file:///private");
    assert_eq!(
        request(
            &app,
            "PUT",
            "/api/tracingstores/tracing",
            Some(&f.token),
            Some(invalid)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    sqlx::query("UPDATE webknossos.tracingStores SET isDeleted=true")
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        request(&app, "GET", "/api/tracingstore", None, None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(
            &app,
            "PUT",
            "/api/tracingstores/tracing",
            Some(&f.token),
            Some(body)
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    db.cleanup().await;
}
