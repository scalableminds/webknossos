mod common;
use axum::{body::Body, http::Request};
use common::TestDb;
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{AppState, router};

async fn request(
    app: &axum::Router,
    method: &str,
    uri: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (u16, Value) {
    let mut request = Request::builder().uri(uri).method(method);
    if let Some(token) = token {
        request = request.header("X-Auth-Token", token);
    }
    let body = match body {
        Some(body) => {
            request = request.header("content-type", "application/json");
            Body::from(body.to_string())
        }
        None => Body::empty(),
    };
    let response = app
        .clone()
        .oneshot(request.body(body).unwrap())
        .await
        .unwrap();
    let status = response.status().as_u16();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).unwrap()
        },
    )
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn maintenance_permissions_lifecycle_and_public_filter() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let app = router(AppState {
        pool: db.pool.clone(),
    });
    let now = chrono::Utc::now().timestamp_millis();
    let body = json!({"startTime":now,"endTime":now+600000,"message":"Test maintenance"});
    assert_eq!(
        request(
            &app,
            "POST",
            "/api/maintenances",
            Some(&f.token),
            Some(body.clone())
        )
        .await
        .0,
        403
    );
    assert_eq!(
        request(&app, "GET", "/api/maintenances/listAll", None, None)
            .await
            .0,
        401
    );
    sqlx::query("UPDATE webknossos.multiUsers SET isSuperUser=TRUE WHERE _id=$1")
        .bind(&f.multi_user_id)
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, created) = request(
        &app,
        "POST",
        "/api/maintenances",
        Some(&f.token),
        Some(body),
    )
    .await;
    assert_eq!(status, 200, "{created}");
    assert_eq!(created["startTime"], now);
    let path = format!("/api/maintenances/{}", created["id"].as_str().unwrap());
    assert_eq!(
        request(&app, "GET", &path, Some(&f.token), None).await.1,
        created
    );
    assert_eq!(
        request(
            &app,
            "GET",
            "/api/maintenances/listCurrentAndUpcoming",
            None,
            None
        )
        .await
        .1
        .as_array()
        .unwrap()
        .len(),
        1
    );
    let old =
        json!({"startTime":"2020-01-01T00:00:00Z","endTime":"1577836801000","message":"Past"});
    assert_eq!(
        request(&app, "PUT", &path, Some(&f.token), Some(old))
            .await
            .0,
        200
    );
    assert_eq!(
        request(
            &app,
            "GET",
            "/api/maintenances/listCurrentAndUpcoming",
            None,
            None
        )
        .await
        .1,
        json!([])
    );
    assert_eq!(
        request(
            &app,
            "POST",
            "/api/maintenances/adHoc",
            Some(&f.token),
            None
        )
        .await
        .0,
        200
    );
    assert_eq!(
        request(&app, "DELETE", &path, Some(&f.token), None).await.0,
        200
    );
    assert_eq!(
        request(&app, "GET", &path, Some(&f.token), None).await.0,
        404
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn short_link_roundtrip_and_origin_validation() {
    let db = TestDb::new().await;
    let app = router(AppState {
        pool: db.pool.clone(),
    });
    let link = "http://localhost:9000/datasets/test#settings";
    let (status, created) = request(&app, "POST", "/api/shortLinks", None, Some(json!(link))).await;
    assert_eq!(status, 200, "{created}");
    assert_eq!(created["longLink"], link);
    assert_eq!(created["_id"].as_str().unwrap().len(), 24);
    let path = format!("/api/shortLinks/byKey/{}", created["key"].as_str().unwrap());
    assert_eq!(request(&app, "GET", &path, None, None).await.1, created);
    assert_eq!(
        request(&app, "GET", "/api/shortLinks/byKey/missing", None, None)
            .await
            .0,
        404
    );
    for invalid in [
        "http://localhost:9000.attacker.example/a",
        "https://localhost:9000/a",
        "http://localhost:9001/a",
        "javascript:alert(1)",
    ] {
        assert_eq!(
            request(&app, "POST", "/api/shortLinks", None, Some(json!(invalid)))
                .await
                .0,
            400
        );
    }
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM webknossos.shortLinks")
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
    db.cleanup().await;
}
