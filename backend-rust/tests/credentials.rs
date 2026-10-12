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
    credentials::{self, CredentialInput, insert_credential, store_credential},
};

fn app(database: &TestDb) -> Router {
    Router::new()
        .nest("/api", credentials::router())
        .with_state(AppState {
            pool: database.pool.clone(),
        })
}

async fn get(app: &Router, path: &str, token: Option<&str>) -> (StatusCode, Value) {
    let mut request = Request::builder().uri(path);
    if let Some(token) = token {
        request = request.header("x-auth-token", token);
    }
    let response = app
        .clone()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&body).unwrap())
}

fn path(store: &str, key: &str, id: &str) -> String {
    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("key", key)
        .append_pair("credentialId", id)
        .finish();
    format!("/api/datastores/{store}/findCredential?{query}")
}

async fn seed_store(database: &TestDb, name: &str, key: &str, only_organization: Option<&str>) {
    sqlx::query("INSERT INTO webknossos.dataStores (name, url, publicUrl, key, onlyAllowedOrganization) VALUES ($1, $2, $3, $4, $5)")
        .bind(name).bind(format!("http://{name}.internal.test")).bind(format!("https://{name}.example.test"))
        .bind(key).bind(only_organization).execute(&database.pool).await.unwrap();
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn every_credential_variant_round_trips_with_exact_datastore_wire_format() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    let user = authenticate(&database.pool, &fixture.token).await.unwrap();
    let key = "datastore-key+/&?";
    seed_store(&database, "credential-store", key, None).await;
    let app = app(&database);
    let cases = [
        (
            CredentialInput::HttpBasicAuth {
                name: "https://data.example.test".into(),
                username: "user'; SQL".into(),
                password: "password-secret\n'".into(),
            },
            "HttpBasicAuth",
            Some("user'; SQL"),
            "password-secret\n'".to_owned(),
            json!({"_type":"com.scalableminds.webknossos.datastore.storage.HttpBasicAuthCredential", "username":"user'; SQL", "password":"password-secret\n'"}),
        ),
        (
            CredentialInput::HttpToken {
                name: "https://data.example.test".into(),
                token_value: "token-secret\n'".into(),
            },
            "HttpToken",
            None,
            "token-secret\n'".to_owned(),
            json!({"_type":"com.scalableminds.webknossos.datastore.storage.XAuthTokenCredential", "tokenValue":"token-secret\n'"}),
        ),
        (
            CredentialInput::S3AccessKey {
                name: "https://data.example.test".into(),
                access_key_id: "access-key-id".into(),
                secret_access_key: "s3-secret".into(),
            },
            "S3AccessKey",
            Some("access-key-id"),
            "s3-secret".to_owned(),
            json!({"_type":"com.scalableminds.webknossos.datastore.storage.S3AccessKeyCredential", "accessKeyId":"access-key-id", "secretAccessKey":"s3-secret"}),
        ),
        (
            CredentialInput::GoogleServiceAccount {
                name: "https://data.example.test".into(),
                secret_json: json!({"private_key":"google-secret\n'", "client_email":"service@example.test"}),
            },
            "GoogleServiceAccount",
            None,
            json!({"private_key":"google-secret\n'", "client_email":"service@example.test"})
                .to_string(),
            json!({"_type":"com.scalableminds.webknossos.datastore.storage.GoogleServiceAccountCredential", "secretJson":{"private_key":"google-secret\n'", "client_email":"service@example.test"}}),
        ),
    ];
    for (input, expected_kind, expected_identifier, expected_secret, mut expected) in cases {
        let id = store_credential(&database.pool, &user, &input)
            .await
            .unwrap();
        let stored: (String, Option<String>, Option<String>, String, String) = sqlx::query_as("SELECT type::text, identifier, secret, _user, _organization FROM webknossos.credentials WHERE _id = $1")
            .bind(id.as_str()).fetch_one(&database.pool).await.unwrap();
        assert_eq!(
            stored,
            (
                expected_kind.into(),
                expected_identifier.map(str::to_owned),
                Some(expected_secret),
                fixture.user_id.clone(),
                fixture.organization_id.clone()
            )
        );
        let expected_object = expected.as_object_mut().unwrap();
        expected_object.insert("name".into(), json!("https://data.example.test"));
        expected_object.insert("user".into(), json!(fixture.user_id));
        expected_object.insert("organization".into(), json!(fixture.organization_id));
        assert_eq!(
            get(&app, &path("credential-store", key, id.as_str()), None).await,
            (StatusCode::OK, expected)
        );
    }
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn datastore_rpc_uses_service_key_not_user_bearer_and_is_global_like_scala() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    let unrelated = database
        .seed_user(&object_id(), "foreign-credential-organization", false)
        .await;
    seed_store(
        &database,
        "restricted-store",
        "correct-key",
        Some(&fixture.organization_id),
    )
    .await;
    let foreign_user = authenticate(&database.pool, &unrelated.token)
        .await
        .unwrap();
    let input = CredentialInput::HttpToken {
        name: "https://foreign.test".into(),
        token_value: "foreign-secret".into(),
    };
    let id = store_credential(&database.pool, &foreign_user, &input)
        .await
        .unwrap();
    let app = app(&database);
    let denied = (
        StatusCode::FORBIDDEN,
        json!({"granted":false,"msg":"Data store could not be found or accessed."}),
    );
    for (name, key) in [
        ("restricted-store", "wrong-key"),
        ("missing-store", "correct-key"),
        ("restricted-store", "' OR TRUE --"),
    ] {
        assert_eq!(
            get(&app, &path(name, key, id.as_str()), Some(&fixture.token)).await,
            denied
        );
    }
    let (status, body) = get(
        &app,
        &path("restricted-store", "correct-key", id.as_str()),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["organization"], unrelated.organization_id);
    assert_eq!(body["tokenValue"], "foreign-secret");
    sqlx::query(
        "UPDATE webknossos.dataStores SET isDeleted = TRUE WHERE name = 'restricted-store'",
    )
    .execute(&database.pool)
    .await
    .unwrap();
    assert_eq!(
        get(
            &app,
            &path("restricted-store", "correct-key", id.as_str()),
            None
        )
        .await,
        denied
    );
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn unavailable_or_corrupt_credentials_never_disclose_stored_secrets_in_errors() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    let user = authenticate(&database.pool, &fixture.token).await.unwrap();
    seed_store(&database, "credential-store", "correct-key", None).await;
    let app = app(&database);
    let id = store_credential(
        &database.pool,
        &user,
        &CredentialInput::GoogleServiceAccount {
            name: "secret-credential-name".into(),
            secret_json: json!({"private_key":"secret-value"}),
        },
    )
    .await
    .unwrap();
    for mutation in [
        "secret = 'secret-invalid-json'",
        "secret = NULL",
        "type = 'HttpBasicAuth', identifier = NULL, secret = 'secret-password'",
    ] {
        sqlx::query(&format!(
            "UPDATE webknossos.credentials SET {mutation} WHERE _id = $1"
        ))
        .bind(id.as_str())
        .execute(&database.pool)
        .await
        .unwrap();
        let (status, body) = get(
            &app,
            &path("credential-store", "correct-key", id.as_str()),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert!(!body.to_string().contains("secret"));
    }
    sqlx::query("UPDATE webknossos.credentials SET isDeleted = TRUE WHERE _id = $1")
        .bind(id.as_str())
        .execute(&database.pool)
        .await
        .unwrap();
    let missing_id = object_id();
    for id in [id.as_str(), missing_id.as_str()] {
        assert_eq!(
            get(&app, &path("credential-store", "correct-key", id), None)
                .await
                .0,
            StatusCode::NOT_FOUND
        );
    }
    for uri in [
        "/api/datastores/credential-store/findCredential",
        "/api/datastores/credential-store/findCredential?key=correct-key&credentialId=invalid",
        "/api/datastores/credential-store/findCredential?key=first&key=second&credentialId=000000000000000000000000",
    ] {
        let (status, body) = get(&app, uri, None).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(!body.to_string().contains("correct-key"));
    }
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn credential_inserts_share_the_callers_transaction_and_require_matching_live_identity_scope()
{
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    let user = authenticate(&database.pool, &fixture.token).await.unwrap();
    let input = CredentialInput::S3AccessKey {
        name: "s3://bucket/path".into(),
        access_key_id: "key-id".into(),
        secret_access_key: "secret".into(),
    };
    let mut tx = database.pool.begin().await.unwrap();
    let id = insert_credential(&mut tx, &user, &input).await.unwrap();
    tx.rollback().await.unwrap();
    let present: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM webknossos.credentials WHERE _id = $1)")
            .bind(id.as_str())
            .fetch_one(&database.pool)
            .await
            .unwrap();
    assert!(!present);
    let mut wrong_scope = user.clone();
    wrong_scope.organization_id = "not-the-users-organization".into();
    assert_eq!(
        store_credential(&database.pool, &wrong_scope, &input)
            .await
            .unwrap_err()
            .status,
        StatusCode::UNAUTHORIZED
    );
    sqlx::query("UPDATE webknossos.users SET isDeactivated = TRUE WHERE _id = $1")
        .bind(&fixture.user_id)
        .execute(&database.pool)
        .await
        .unwrap();
    assert_eq!(
        store_credential(&database.pool, &user, &input)
            .await
            .unwrap_err()
            .status,
        StatusCode::UNAUTHORIZED
    );
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM webknossos.credentials")
        .fetch_one(&database.pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
    database.cleanup().await;
}
