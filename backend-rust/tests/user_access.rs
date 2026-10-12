mod common;

use axum::{
    Extension, Router,
    body::Body,
    http::{Request, StatusCode},
};
use common::{Fixture, TestDb, object_id};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{
    AppState,
    service_clients::{ServiceClientConfig, ServiceClients},
    user_access,
};

fn app(db: &TestDb, allow_delete: bool) -> Router {
    user_access::router(allow_delete)
        .layer(Extension(
            ServiceClients::new(ServiceClientConfig {
                rpc_token: "process-secret".into(),
                ..Default::default()
            })
            .unwrap(),
        ))
        .with_state(AppState {
            pool: db.pool.clone(),
        })
}
async fn request(
    app: &Router,
    store: &str,
    key: &str,
    token: Option<&str>,
    resource: &str,
    id: Option<&str>,
    mode: &str,
) -> (StatusCode, Value) {
    let mut pairs = vec![("key", key)];
    if let Some(token) = token {
        pairs.push(("token", token));
    }
    let uri = format!(
        "/{store}/validateUserAccess?{}",
        serde_urlencoded::to_string(pairs).unwrap()
    );
    let body = json!({"resourceType":resource,"resourceId":id,"mode":mode});
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(uri)
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).into_owned())),
    )
}
async fn seed(db: &TestDb, f: &Fixture) -> String {
    sqlx::query("INSERT INTO webknossos.dataStores(name,url,publicUrl,key) VALUES('rpc','http://data.example','http://public.example','store-secret')").execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.tracingStores(name,url,publicUrl,key) VALUES('tracing','http://tracing.example','http://public-tracing.example','tracing-secret')").execute(&db.pool).await.unwrap();
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.datasets(_id,_dataStore,_organization,_folder,name,directoryName,sortingKey,sharingToken) SELECT $1,'rpc',_id,_rootFolder,'Dataset','dataset',now(),'share-token' FROM webknossos.organizations WHERE _id=$2")
        .bind(&id).bind(&f.organization_id).execute(&db.pool).await.unwrap();
    id
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn callbacks_validate_service_keys_before_rpc_bypass_and_dataset_permissions() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let id = seed(&db, &f).await;
    let member = db.seed_user(&object_id(), &f.organization_id, false).await;
    let app = app(&db, true);
    assert_eq!(
        request(
            &app,
            "datastores/rpc",
            "wrong",
            Some("process-secret"),
            "webknossos",
            None,
            "read"
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        request(
            &app,
            "datastores/missing",
            "store-secret",
            Some("process-secret"),
            "webknossos",
            None,
            "read"
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    for (store, key) in [
        ("datastores/rpc", "store-secret"),
        ("tracingstores/name-is-informational", "tracing-secret"),
    ] {
        assert_eq!(
            request(
                &app,
                store,
                key,
                Some("process-secret"),
                "webknossos",
                None,
                "write"
            )
            .await,
            (StatusCode::OK, json!({"granted":true}))
        );
        assert_eq!(
            request(
                &app,
                store,
                "wrong",
                Some("process-secret"),
                "webknossos",
                None,
                "read"
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
    }
    for (token, mode, granted) in [
        (None, "read", false),
        (Some("share-token"), "read", true),
        (Some("share-token"), "write", false),
        (Some(f.token.as_str()), "read", true),
        (Some(f.token.as_str()), "write", true),
        (Some(f.token.as_str()), "delete", true),
        (Some(member.token.as_str()), "write", false),
        (Some(member.token.as_str()), "delete", false),
    ] {
        let (status, result) = request(
            &app,
            "datastores/rpc",
            "store-secret",
            token,
            "dataset",
            Some(&id.to_uppercase()),
            mode,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{result}");
        assert_eq!(result["granted"], granted);
    }
    assert_eq!(
        request(
            &app,
            "datastores/rpc",
            "store-secret",
            Some(&f.token),
            "dataset",
            Some(&f.organization_id),
            "administrate"
        )
        .await
        .1,
        json!({"granted":true})
    );
    assert_eq!(
        request(
            &app,
            "datastores/rpc",
            "store-secret",
            Some(&member.token),
            "dataset",
            None,
            "administrate"
        )
        .await
        .1,
        json!({"granted":false})
    );
    let disabled = user_access::router(false)
        .layer(Extension(
            ServiceClients::new(ServiceClientConfig {
                rpc_token: "process-secret".into(),
                ..Default::default()
            })
            .unwrap(),
        ))
        .with_state(AppState {
            pool: db.pool.clone(),
        });
    assert_eq!(
        request(
            &disabled,
            "datastores/rpc",
            "store-secret",
            Some(&f.token),
            "dataset",
            Some(&id),
            "delete"
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        request(
            &app,
            "datastores/rpc",
            "store-secret",
            None,
            "dataset",
            Some("invalid"),
            "read"
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        request(
            &app,
            "datastores/rpc",
            "store-secret",
            None,
            "dataset",
            Some(&id),
            "unknown-mode"
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    sqlx::query("UPDATE webknossos.dataStores SET isDeleted=true WHERE name='rpc'")
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        request(
            &app,
            "datastores/rpc",
            "store-secret",
            Some("process-secret"),
            "dataset",
            Some(&id),
            "read"
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn callbacks_preserve_annotation_mutex_private_link_and_job_export_contracts() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let dataset = seed(&db, &f).await;
    let member = db.seed_user(&object_id(), &f.organization_id, false).await;
    let annotation = object_id();
    sqlx::query("INSERT INTO webknossos.annotations(_id,_dataset,_user,typ,state,visibility,collaborationMode) VALUES($1,$2,$3,'Explorational','Active','Internal','Concurrent')")
        .bind(&annotation).bind(&dataset).bind(&f.user_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.annotation_layers(_annotation,tracingId,typ,name,statistics) VALUES($1,'tracing-id','Skeleton','skeleton','{}')")
        .bind(&annotation).execute(&db.pool).await.unwrap();
    let application = app(&db, true);
    for (mode, granted) in [("read", true), ("write", false), ("delete", false)] {
        assert_eq!(
            request(
                &application,
                "tracingstores/tracing",
                "tracing-secret",
                Some(&member.token),
                "annotation",
                Some(&annotation),
                mode
            )
            .await
            .1["granted"],
            granted
        );
    }
    sqlx::query("INSERT INTO webknossos.annotation_mutexes(_annotation,_user,sessionId,expiry) VALUES($1,$2,'session',now()+INTERVAL '1 hour')")
        .bind(&annotation).bind(&member.user_id).execute(&db.pool).await.unwrap();
    assert_eq!(
        request(
            &application,
            "tracingstores/tracing",
            "tracing-secret",
            Some(&member.token),
            "tracing",
            Some("tracing-id"),
            "write"
        )
        .await
        .1,
        json!({"granted":true})
    );
    sqlx::query("UPDATE webknossos.annotations SET isLockedByOwner=true WHERE _id=$1")
        .bind(&annotation)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        request(
            &application,
            "tracingstores/tracing",
            "tracing-secret",
            Some(&member.token),
            "annotation",
            Some(&annotation),
            "write"
        )
        .await
        .1["granted"],
        false
    );
    sqlx::query("INSERT INTO webknossos.annotation_privateLinks(_id,_annotation,accessToken,expirationDateTime) VALUES($1,$2,'private-link',now()-INTERVAL '1 day')")
        .bind(object_id()).bind(&annotation).execute(&db.pool).await.unwrap();
    // The trusted callback preserves Scala's grant, including expiration/mode
    // behavior. The dedicated source endpoint has a stricter expiration check.
    assert_eq!(
        request(
            &application,
            "tracingstores/tracing",
            "tracing-secret",
            Some("private-link"),
            "annotation",
            Some(&annotation),
            "write"
        )
        .await
        .1,
        json!({"granted":true})
    );
    for (resource, id) in [
        ("annotation", "000000000000000000000000"),
        ("tracing", "dummyTracingId"),
    ] {
        assert_eq!(
            request(
                &application,
                "tracingstores/tracing",
                "tracing-secret",
                None,
                resource,
                Some(id),
                "write"
            )
            .await
            .1,
            json!({"granted":true})
        );
    }
    let job = object_id();
    sqlx::query("INSERT INTO webknossos.jobs(_id,_owner,_dataStore,command,commandArgs) VALUES($1,$2,'rpc','export_tiff','{}')")
        .bind(&job).bind(&member.user_id).execute(&db.pool).await.unwrap();
    for token in [&member.token, &f.token] {
        assert_eq!(
            request(
                &application,
                "datastores/rpc",
                "store-secret",
                Some(token),
                "jobExport",
                Some(&job),
                "read"
            )
            .await
            .1,
            json!({"granted":true})
        );
    }
    assert_eq!(
        request(
            &application,
            "datastores/rpc",
            "store-secret",
            None,
            "jobExport",
            Some(&job),
            "read"
        )
        .await
        .1["granted"],
        false
    );
    assert_eq!(
        request(
            &application,
            "datastores/rpc",
            "store-secret",
            Some(&member.token),
            "jobExport",
            Some(&job),
            "write"
        )
        .await
        .1["granted"],
        false
    );
    let timestamp: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("SELECT lastUsedDateTime FROM webknossos.tokens WHERE value=$1")
            .bind(&member.token)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert!(
        timestamp < chrono::Utc::now() - chrono::Duration::seconds(30),
        "service token checks must not touch usage"
    );
    db.cleanup().await;
}
