mod common;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use common::{TestDb, object_id};
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::AppState;

async fn request(
    app: &Router,
    method: &str,
    path: &str,
    token: Option<&str>,
    value: Option<Value>,
) -> (StatusCode, Value, String) {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header(header::CONTENT_TYPE, "application/json");
    if let Some(token) = token {
        request = request.header("x-auth-token", token);
    }
    let response = app
        .clone()
        .oneshot(
            request
                .body(Body::from(value.map(|v| v.to_string()).unwrap_or_default()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let cache = response
        .headers()
        .get(header::CACHE_CONTROL)
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap(), cache)
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB; run cargo test -- --ignored"]
async fn anonymous_reads_are_empty_and_private_writes_require_authentication() {
    let database = TestDb::new().await;
    let app = webknossos_backend::router(AppState {
        pool: database.pool.clone(),
    });
    for path in [
        "/api/user/userConfiguration",
        "/api/user/keyboardShortcutsConfig",
    ] {
        let (status, body, cache) = request(&app, "GET", path, None, None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, json!({}));
        assert_eq!(cache, "no-store");
        assert_eq!(
            request(&app, "GET", path, Some("invalid"), None).await.0,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            request(&app, "PUT", path, None, Some(json!({}))).await.0,
            StatusCode::UNAUTHORIZED
        );
    }
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB; run cargo test -- --ignored"]
async fn configuration_and_shortcuts_replace_objects_without_merging() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    let app = webknossos_backend::router(AppState {
        pool: database.pool.clone(),
    });
    for path in [
        "/api/user/userConfiguration",
        "/api/user/keyboardShortcutsConfig",
    ] {
        assert_eq!(
            request(
                &app,
                "PUT",
                path,
                Some(&fixture.token),
                Some(json!({"old": 1, "nested": {"a": true}}))
            )
            .await
            .0,
            StatusCode::OK
        );
        assert_eq!(
            request(
                &app,
                "PUT",
                path,
                Some(&fixture.token),
                Some(json!({"new": 2}))
            )
            .await
            .0,
            StatusCode::OK
        );
        assert_eq!(
            request(&app, "GET", path, Some(&fixture.token), None)
                .await
                .1,
            json!({"new": 2})
        );
        for invalid in [json!([]), json!(null), json!("invalid")] {
            assert_eq!(
                request(&app, "PUT", path, Some(&fixture.token), Some(invalid))
                    .await
                    .0,
                StatusCode::BAD_REQUEST
            );
        }
        assert_eq!(
            request(&app, "GET", path, Some(&fixture.token), None)
                .await
                .1,
            json!({"new": 2})
        );
    }
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB; run cargo test -- --ignored"]
async fn shortcuts_belong_to_account_but_configuration_belongs_to_identity() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    let second = database
        .seed_user(&object_id(), "second-organization", false)
        .await;
    sqlx::query("UPDATE webknossos.users SET _multiUser = $1 WHERE _id = $2")
        .bind(&fixture.multi_user_id)
        .bind(&second.user_id)
        .execute(&database.pool)
        .await
        .unwrap();
    let app = webknossos_backend::router(AppState {
        pool: database.pool.clone(),
    });
    request(
        &app,
        "PUT",
        "/api/user/userConfiguration",
        Some(&fixture.token),
        Some(json!({"identity": "first"})),
    )
    .await;
    request(
        &app,
        "PUT",
        "/api/user/keyboardShortcutsConfig",
        Some(&fixture.token),
        Some(json!({"tool": "x"})),
    )
    .await;
    assert_eq!(
        request(
            &app,
            "GET",
            "/api/user/userConfiguration",
            Some(&second.token),
            None
        )
        .await
        .1,
        json!({})
    );
    assert_eq!(
        request(
            &app,
            "GET",
            "/api/user/keyboardShortcutsConfig",
            Some(&second.token),
            None
        )
        .await
        .1,
        json!({"tool": "x"})
    );
    request(
        &app,
        "PUT",
        "/api/user/keyboardShortcutsConfig",
        Some(&second.token),
        Some(json!({"tool": "y"})),
    )
    .await;
    assert_eq!(
        request(
            &app,
            "GET",
            "/api/user/keyboardShortcutsConfig",
            Some(&fixture.token),
            None
        )
        .await
        .1,
        json!({"tool": "y"})
    );
    database.cleanup().await;
}
