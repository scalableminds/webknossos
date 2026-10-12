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
use webknossos_backend::{
    AppState,
    auth::authenticate,
    credentials::{CredentialInput, store_credential},
    data_stores,
};

fn app(database: &TestDb, jobs_enabled: bool) -> Router {
    Router::new()
        .nest("/api", data_stores::router(jobs_enabled))
        .with_state(AppState {
            pool: database.pool.clone(),
        })
}

async fn request(
    app: &Router,
    method: &str,
    path: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json");
    if let Some(token) = token {
        request = request.header("x-auth-token", token);
    }
    let response = app
        .clone()
        .oneshot(
            request
                .body(Body::from(
                    body.map(|value| value.to_string()).unwrap_or_default(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
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

async fn seed_store(database: &TestDb, name: &str, only_organization: Option<&str>) {
    sqlx::query("INSERT INTO webknossos.dataStores (name, url, publicUrl, key, onlyAllowedOrganization, isScratch, allowsUploadToPaths, reportUsedStorageEnabled) VALUES ($1, $2, $3, 'private-datastore-key', $4, TRUE, FALSE, TRUE)")
        .bind(name).bind(format!("http://{name}.internal.test")).bind(format!("https://{name}.example.test"))
        .bind(only_organization).execute(&database.pool).await.unwrap();
}

async fn make_superuser(database: &TestDb, multi_user: &str) {
    sqlx::query("UPDATE webknossos.multiUsers SET isSuperUser = TRUE WHERE _id = $1")
        .bind(multi_user)
        .execute(&database.pool)
        .await
        .unwrap();
}

fn public_store(name: &str) -> Value {
    json!({"name":name,"url":format!("https://{name}.example.test"),"allowsUpload":true,"jobsSupportedByAvailableWorkers":[],"jobsEnabled":false})
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn registry_visibility_matches_anonymous_and_organization_scoped_dao_reads() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    let member = database
        .seed_user(&object_id(), &fixture.organization_id, false)
        .await;
    let foreign = database
        .seed_user(&object_id(), "other-registry-organization", false)
        .await;
    seed_store(&database, "common-store", None).await;
    seed_store(&database, "own-store", Some(&fixture.organization_id)).await;
    seed_store(&database, "foreign-store", Some(&foreign.organization_id)).await;
    seed_store(&database, "deleted-store", None).await;
    sqlx::query("UPDATE webknossos.dataStores SET isDeleted = TRUE WHERE name = 'deleted-store'")
        .execute(&database.pool)
        .await
        .unwrap();
    let app = app(&database, true);
    assert_eq!(
        request(&app, "GET", "/api/datastores", None, None).await,
        (StatusCode::OK, json!([]))
    );
    let own = json!([public_store("common-store"), public_store("own-store")]);
    for token in [&fixture.token, &member.token] {
        assert_eq!(
            request(&app, "GET", "/api/datastores", Some(token), None).await,
            (StatusCode::OK, own.clone())
        );
    }
    assert_eq!(
        request(&app, "GET", "/api/datastores", Some(&foreign.token), None).await,
        (
            StatusCode::OK,
            json!([public_store("common-store"), public_store("foreign-store")])
        )
    );
    make_superuser(&database, &fixture.multi_user_id).await;
    assert_eq!(
        request(&app, "GET", "/api/datastores", Some(&fixture.token), None).await,
        (StatusCode::OK, own)
    );
    assert_eq!(
        request(
            &app,
            "GET",
            "/api/datastores",
            Some("invalid-user-token"),
            None
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn public_registry_reuses_worker_job_semantics_and_never_returns_keys_or_internal_configuration()
 {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    seed_store(&database, "job-store", None).await;
    for (commands, deleted) in [
        (vec!["convert_to_wkw", "compute_mesh_file"], false),
        (vec!["convert_to_wkw"], false),
        (vec!["infer_nuclei"], true),
    ] {
        sqlx::query("INSERT INTO webknossos.workers (_id, _dataStore, key, supportedJobCommands, isDeleted) VALUES ($1, 'job-store', $2, $3, $4)")
            .bind(object_id()).bind(object_id()).bind(commands).bind(deleted).execute(&database.pool).await.unwrap();
    }
    let enabled = app(&database, true);
    let (status, body) = request(
        &enabled,
        "GET",
        "/api/datastores",
        Some(&fixture.token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!([{"name":"job-store","url":"https://job-store.example.test","allowsUpload":true,"jobsSupportedByAvailableWorkers":["compute_mesh_file","convert_to_wkw"],"jobsEnabled":true}])
    );
    for private in [
        "private-datastore-key",
        "internal.test",
        "isScratch",
        "onlyAllowedOrganization",
        "allowsUploadToPaths",
        "reportUsedStorageEnabled",
    ] {
        assert!(!body.to_string().contains(private));
    }
    let disabled = app(&database, false);
    assert_eq!(
        request(
            &disabled,
            "GET",
            "/api/datastores",
            Some(&fixture.token),
            None
        )
        .await,
        (StatusCode::OK, json!([public_store("job-store")]))
    );
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn datastore_creation_requires_superuser_and_preserves_dto_defaults_and_public_response() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    let app = app(&database, true);
    let defaults = json!({"name":"new-store","url":"http://new-store.internal.test","publicUrl":"https://new-store.example.test","key":"creation-secret","onlyAllowedOrganization":"must-be-ignored","reportUsedStorageEnabled":true});
    assert_eq!(
        request(
            &app,
            "POST",
            "/api/datastores",
            None,
            Some(defaults.clone())
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        request(
            &app,
            "POST",
            "/api/datastores",
            Some(&fixture.token),
            Some(defaults.clone())
        )
        .await,
        (
            StatusCode::FORBIDDEN,
            json!({"messages":[{"error":"This feature is currently only available for superusers."}]})
        )
    );
    make_superuser(&database, &fixture.multi_user_id).await;
    let (status, body) = request(
        &app,
        "POST",
        "/api/datastores",
        Some(&fixture.token),
        Some(defaults.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, public_store("new-store"));
    assert!(!body.to_string().contains("creation-secret"));
    assert!(!body.to_string().contains("internal.test"));
    let flags: (bool, bool, bool, bool, Option<String>) = sqlx::query_as("SELECT isScratch, allowsUpload, allowsUploadToPaths, reportUsedStorageEnabled, onlyAllowedOrganization FROM webknossos.dataStores WHERE name = 'new-store'")
        .fetch_one(&database.pool).await.unwrap();
    assert_eq!(flags, (false, true, true, false, None));
    assert_eq!(
        request(
            &app,
            "POST",
            "/api/datastores",
            Some(&fixture.token),
            Some(defaults)
        )
        .await,
        (
            StatusCode::BAD_REQUEST,
            json!({"messages":[{"error":"A data store named “new-store” already exists. Please choose a different name."}]})
        )
    );

    let explicit = json!({"name":"explicit-store","url":"http://explicit-store.internal.test","publicUrl":"https://explicit-store.example.test","key":"explicit-secret","isScratch":true,"allowsUpload":false,"allowsUploadToPaths":false});
    let (status, body) = request(
        &app,
        "POST",
        "/api/datastores",
        Some(&fixture.token),
        Some(explicit),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["allowsUpload"], false);
    let flags: (bool, bool, bool) = sqlx::query_as("SELECT isScratch, allowsUpload, allowsUploadToPaths FROM webknossos.dataStores WHERE name = 'explicit-store'")
        .fetch_one(&database.pool).await.unwrap();
    assert_eq!(flags, (true, false, false));
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn invalid_datastore_inputs_roll_back_without_disclosing_private_key() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    make_superuser(&database, &fixture.multi_user_id).await;
    let app = app(&database, true);
    for body in [
        json!({"name":"valid-store","url":"http://valid-store.internal.test","publicUrl":"https://valid-store.example.test"}),
        json!({"name":"invalid store","url":"http://valid-store.internal.test","publicUrl":"https://valid-store.example.test","key":"private-input-secret"}),
        json!({"name":"valid-store","url":"file:///data","publicUrl":"https://valid-store.example.test","key":"private-input-secret"}),
        json!({"name":"valid-store","url":"http://valid-store.internal.test","publicUrl":"ftp://store.example.test","key":"private-input-secret"}),
        json!({"name":"valid-store","url":"http://valid-store.internal.test","publicUrl":"https://valid-store.example.test","key":"private-input-secret","allowsUpload":"false"}),
    ] {
        let (status, response) = request(
            &app,
            "POST",
            "/api/datastores",
            Some(&fixture.token),
            Some(body),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(!response.to_string().contains("private-input-secret"));
    }
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM webknossos.dataStores")
        .fetch_one(&database.pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn datastore_deletion_is_superuser_only_idempotent_soft_and_preserves_dependent_records() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    seed_store(&database, "referenced-store", None).await;
    let dataset_id = object_id();
    sqlx::query("INSERT INTO webknossos.datasets (_id, _dataStore, _organization, _folder, name, directoryName, sortingKey) SELECT $1, 'referenced-store', $2, _rootFolder, 'Dataset', 'Dataset', NOW() FROM webknossos.organizations WHERE _id = $2")
        .bind(&dataset_id).bind(&fixture.organization_id).execute(&database.pool).await.unwrap();
    let worker_id = object_id();
    sqlx::query("INSERT INTO webknossos.workers (_id, _dataStore, key) VALUES ($1, 'referenced-store', 'dependent-worker-key')")
        .bind(&worker_id).execute(&database.pool).await.unwrap();
    let user = authenticate(&database.pool, &fixture.token).await.unwrap();
    let credential = store_credential(
        &database.pool,
        &user,
        &CredentialInput::HttpToken {
            name: "https://source.test".into(),
            token_value: "credential-secret".into(),
        },
    )
    .await
    .unwrap();
    let app = app(&database, true);
    assert_eq!(
        request(
            &app,
            "DELETE",
            "/api/datastores/referenced-store",
            None,
            None
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        request(
            &app,
            "DELETE",
            "/api/datastores/referenced-store",
            Some(&fixture.token),
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    make_superuser(&database, &fixture.multi_user_id).await;
    for path in [
        "/api/datastores/referenced-store",
        "/api/datastores/referenced-store",
        "/api/datastores/missing-store",
    ] {
        assert_eq!(
            request(&app, "DELETE", path, Some(&fixture.token), None).await,
            (StatusCode::OK, Value::Null)
        );
    }
    let deleted: bool = sqlx::query_scalar(
        "SELECT isDeleted FROM webknossos.dataStores WHERE name = 'referenced-store'",
    )
    .fetch_one(&database.pool)
    .await
    .unwrap();
    assert!(deleted);
    assert_eq!(
        request(&app, "GET", "/api/datastores", Some(&fixture.token), None).await,
        (StatusCode::OK, json!([]))
    );
    let retained: (bool, bool, bool) = sqlx::query_as("SELECT EXISTS(SELECT 1 FROM webknossos.datasets WHERE _id = $1 AND NOT isDeleted), EXISTS(SELECT 1 FROM webknossos.workers WHERE _id = $2 AND NOT isDeleted), EXISTS(SELECT 1 FROM webknossos.credentials WHERE _id = $3 AND NOT isDeleted)")
        .bind(&dataset_id).bind(&worker_id).bind(credential.as_str()).fetch_one(&database.pool).await.unwrap();
    assert_eq!(retained, (true, true, true));
    let recreate = json!({"name":"referenced-store","url":"http://recreate.internal.test","publicUrl":"https://recreate.example.test","key":"recreate-key"});
    assert_eq!(
        request(
            &app,
            "POST",
            "/api/datastores",
            Some(&fixture.token),
            Some(recreate)
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    database.cleanup().await;
}
