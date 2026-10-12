//! User access validation through a controller route against a mock WEBKNOSSOS.

mod mock_wk;

use axum::{
    Router,
    body::Body,
    extract::{Path, State},
    http::{Request, StatusCode, header},
    routing::get,
};
use http_body_util::BodyExt;
use mock_wk::{KEY, MockWk, Reply};
use serde_json::json;
use tower::ServiceExt;
use webknossos_datastore::{
    AppState,
    access::{AccessResult, TokenContext, UserAccessRequest},
    controller,
};

/// A controller route guarded like Scala `validateAccessFromTokenContext(readDataset(id))`.
fn app(wk: &MockWk) -> Router {
    let state = AppState::new(wk.config());
    controller(
        Router::new()
            .route("/data/test/{id}", get(guarded))
            .route("/data/uncached/{id}", get(guarded_uncached)),
        true,
    )
    .with_state(state)
}

async fn guarded(
    State(state): State<AppState>,
    tc: TokenContext,
    Path(id): Path<String>,
) -> AccessResult<&'static str> {
    state
        .access
        .validate_access(UserAccessRequest::read_dataset(&id), &tc)
        .await?;
    Ok("granted")
}

async fn guarded_uncached(
    State(state): State<AppState>,
    tc: TokenContext,
    Path(id): Path<String>,
) -> AccessResult<&'static str> {
    state
        .access
        .validate_access_uncached(UserAccessRequest::read_dataset(&id), &tc)
        .await?;
    Ok("granted")
}

async fn call(
    app: &Router,
    uri: &str,
    header_token: Option<&str>,
) -> (StatusCode, Option<String>, Option<String>, String) {
    let mut request = Request::get(uri);
    if let Some(token) = header_token {
        request = request.header("X-Auth-Token", token);
    }
    let response = app
        .clone()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let header_value = |name| {
        response
            .headers()
            .get(name)
            .map(|v: &axum::http::HeaderValue| v.to_str().unwrap().to_owned())
    };
    let content_type = header_value(header::CONTENT_TYPE);
    let cache_control = header_value(header::CACHE_CONTROL);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        content_type,
        cache_control,
        String::from_utf8(body.to_vec()).unwrap(),
    )
}

/// Grants access only to `good-token`; denies `bad-token` with a message, others without.
async fn token_checking_wk() -> MockWk {
    MockWk::start(|call| match call.query_value("token").as_deref() {
        Some("good-token") => Reply::json(StatusCode::OK, json!({"granted": true})),
        Some("bad-token") => Reply::json(
            StatusCode::OK,
            json!({"granted": false, "msg": "No read access on dataset"}),
        ),
        _ => Reply::json(StatusCode::OK, json!({"granted": false})),
    })
    .await
}

#[tokio::test]
async fn token_from_query_is_forwarded_and_granted() {
    let wk = token_checking_wk().await;
    let app = app(&wk);
    let (status, _, cache_control, body) =
        call(&app, "/data/test/ds1?token=good-token", None).await;
    assert_eq!((status, body.as_str()), (StatusCode::OK, "granted"));
    assert_eq!(cache_control.as_deref(), Some("no-cache"));
    let calls = wk.calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].method, "POST");
    assert_eq!(calls[0].path, "/api/datastores/test-ds/validateUserAccess");
    assert_eq!(
        calls[0].query,
        vec![
            ("key".to_owned(), KEY.to_owned()),
            ("token".to_owned(), "good-token".to_owned())
        ]
    );
    assert_eq!(calls[0].content_type.as_deref(), Some("application/json"));
    assert_eq!(
        calls[0].json(),
        json!({"resourceId": "ds1", "resourceType": "dataset", "mode": "read"})
    );
}

#[tokio::test]
async fn token_from_header_and_query_takes_precedence() {
    let wk = token_checking_wk().await;
    let app = app(&wk);
    let (status, _, _, _) = call(&app, "/data/test/ds1", Some("good-token")).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _, _, _) = call(&app, "/data/test/ds2?token=bad-token", Some("good-token")).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let tokens: Vec<_> = wk.calls().iter().map(|c| c.query_value("token")).collect();
    assert_eq!(
        tokens,
        vec![Some("good-token".to_owned()), Some("bad-token".to_owned())]
    );
}

#[tokio::test]
async fn denied_with_message_is_plain_text_403() {
    let wk = token_checking_wk().await;
    let app = app(&wk);
    let (status, content_type, cache_control, body) =
        call(&app, "/data/test/ds1?token=bad-token", None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(content_type.as_deref(), Some("text/plain; charset=utf-8"));
    assert_eq!(cache_control.as_deref(), Some("no-cache"));
    assert_eq!(
        body,
        "Token may be expired, consider reloading. Access forbidden: No read access on dataset"
    );
}

#[tokio::test]
async fn missing_token_is_forbidden_with_authentication_failed() {
    // Scala never answers 401 itself: an unauthenticated request is denied by WEBKNOSSOS and
    // becomes 403 "Token authentication failed." (no token query parameter is sent).
    let wk = token_checking_wk().await;
    let app = app(&wk);
    let (status, _, _, body) = call(&app, "/data/test/ds1", None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        body,
        "Token may be expired, consider reloading. Token authentication failed."
    );
    assert_eq!(
        wk.calls()[0].query,
        vec![("key".to_owned(), KEY.to_owned())]
    );
}

#[tokio::test]
async fn unauthorized_rpc_answer_keeps_401_and_is_not_cached() {
    let wk = MockWk::start(|_| Reply::text(StatusCode::UNAUTHORIZED, "Invalid token")).await;
    let app = app(&wk);
    for _ in 0..2 {
        let (status, content_type, cache_control, body) =
            call(&app, "/data/test/ds1?token=expired", None).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(content_type.as_deref(), Some("application/json"));
        assert_eq!(cache_control.as_deref(), Some("no-cache"));
        let body: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(
            body["messages"][0]["error"],
            "Failed to check data access, token may be expired, consider reloading."
        );
        let chain = body["messages"][1]["chain"].as_str().unwrap();
        assert!(
            chain.contains("Failed RPC ") && chain.contains("Response: 401 'Invalid token'"),
            "{chain}"
        );
        assert!(!chain.contains(KEY) && !chain.contains("expired"));
    }
    assert_eq!(wk.calls().len(), 2, "failures are not cached");
}

#[tokio::test]
async fn cache_hit_avoids_second_rpc() {
    let wk = token_checking_wk().await;
    let app = app(&wk);
    for _ in 0..3 {
        let (status, _, _, _) = call(&app, "/data/test/ds1?token=good-token", None).await;
        assert_eq!(status, StatusCode::OK);
    }
    assert_eq!(wk.calls().len(), 1);
    // Negative answers are cached too (Scala caches every successful RPC answer).
    for _ in 0..2 {
        let (status, _, _, _) = call(&app, "/data/test/ds1?token=bad-token", None).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }
    assert_eq!(wk.calls().len(), 2);
    // Another resource or token is another cache key.
    call(&app, "/data/test/ds2?token=good-token", None).await;
    assert_eq!(wk.calls().len(), 3);
}

#[tokio::test]
async fn uncached_validation_always_asks() {
    let wk = token_checking_wk().await;
    let app = app(&wk);
    for _ in 0..2 {
        let (status, _, _, _) = call(&app, "/data/uncached/ds1?token=good-token", None).await;
        assert_eq!(status, StatusCode::OK);
    }
    assert_eq!(wk.calls().len(), 2);
}
