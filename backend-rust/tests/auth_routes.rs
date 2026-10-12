mod common;

use std::time::Duration;

use axum::{
    Router,
    body::Body,
    http::{Method, Request, StatusCode},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use common::{TestDb, object_id};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{
    AppState,
    auth::authenticate,
    auth_routes::{self, AuthRouteConfig},
};

fn configured_router(database: &TestDb, config: AuthRouteConfig) -> Router {
    Router::new()
        .nest("/api", auth_routes::router(config))
        .with_state(AppState {
            pool: database.pool.clone(),
        })
}

fn app(database: &TestDb) -> Router {
    configured_router(database, AuthRouteConfig::default())
}

async fn request(
    app: &Router,
    method: Method,
    path: &str,
    token: Option<&str>,
) -> (StatusCode, Value) {
    let mut request = Request::builder().method(method).uri(path);
    if let Some(token) = token {
        request = request.header("x-auth-token", token);
    }
    let response = app
        .clone()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap()
    };
    (status, body)
}

async fn token_type(database: &TestDb, token: &str) -> String {
    sqlx::query_scalar("SELECT tokenType::text FROM webknossos.tokens WHERE value = $1")
        .bind(token)
        .fetch_one(&database.pool)
        .await
        .unwrap()
}

async fn is_deleted(database: &TestDb, token: &str) -> bool {
    sqlx::query_scalar("SELECT isDeleted FROM webknossos.tokens WHERE value = $1")
        .bind(token)
        .fetch_one(&database.pool)
        .await
        .unwrap()
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn token_reuse_creation_and_deletion_preserve_wire_contracts() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    let app = app(&database);
    assert_eq!(
        request(&app, Method::GET, "/api/auth/token", Some(&fixture.token)).await,
        (StatusCode::OK, json!({"token":fixture.token}))
    );
    let datastore = database.seed_token(&fixture.user_id, "DataStore").await;
    assert_eq!(
        request(&app, Method::DELETE, "/api/auth/token", Some(&datastore)).await,
        (StatusCode::OK, json!({"messages":"Token was deleted."}))
    );
    assert!(is_deleted(&database, &fixture.token).await);
    assert!(authenticate(&database.pool, &fixture.token).await.is_err());
    assert_eq!(
        request(&app, Method::DELETE, "/api/auth/token", Some(&datastore)).await,
        (StatusCode::OK, Value::Null)
    );

    // Account locking guarantees concurrent find-or-create calls issue one token.
    let (first, second) = tokio::join!(
        request(&app, Method::GET, "/api/auth/token", Some(&datastore)),
        request(&app, Method::GET, "/api/auth/token", Some(&datastore)),
    );
    assert_eq!(first.0, StatusCode::OK);
    assert_eq!(first, second);
    let token = first.1["token"].as_str().unwrap();
    assert_eq!(URL_SAFE_NO_PAD.decode(token).unwrap().len(), 16);
    assert_eq!(token_type(&database, token).await, "Authentication");
    assert!(authenticate(&database.pool, token).await.is_ok());
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM webknossos.tokens WHERE _user = $1 AND tokenType = 'Authentication' AND NOT isDeleted")
        .bind(&fixture.user_id).fetch_one(&database.pool).await.unwrap();
    assert_eq!(count, 1);
    let (expiry_ms, idle_ms): (i64, Option<i64>) = sqlx::query_as("SELECT ROUND(EXTRACT(EPOCH FROM (expirationDateTime - created)) * 1000)::bigint, idleTimeout FROM webknossos.tokens WHERE value = $1")
        .bind(token).fetch_one(&database.pool).await.unwrap();
    assert_eq!(expiry_ms, 23_000 * 86_400_000);
    assert_eq!(idle_ms, Some(expiry_ms));
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn unusable_authentication_tokens_are_replaced_without_renewing_usable_tokens() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    let datastore = database.seed_token(&fixture.user_id, "DataStore").await;
    let app = app(&database);
    for invalidation in [
        "expirationDateTime = NOW() - INTERVAL '1 second'",
        "idleTimeout = 1000, lastUsedDateTime = NOW() - INTERVAL '1 minute'",
        "idleTimeout = 0",
    ] {
        let existing: String = sqlx::query_scalar("SELECT value FROM webknossos.tokens WHERE _user = $1 AND tokenType = 'Authentication' AND NOT isDeleted")
            .bind(&fixture.user_id).fetch_one(&database.pool).await.unwrap();
        sqlx::query(&format!(
            "UPDATE webknossos.tokens SET {invalidation} WHERE value = $1"
        ))
        .bind(&existing)
        .execute(&database.pool)
        .await
        .unwrap();
        let (status, response) =
            request(&app, Method::GET, "/api/auth/token", Some(&datastore)).await;
        assert_eq!(status, StatusCode::OK);
        let replacement = response["token"].as_str().unwrap();
        assert_ne!(replacement, existing);
        assert!(is_deleted(&database, &existing).await);
        assert!(authenticate(&database.pool, replacement).await.is_ok());
        let expiry_before: chrono::DateTime<chrono::Utc> =
            sqlx::query_scalar("SELECT expirationDateTime FROM webknossos.tokens WHERE value = $1")
                .bind(replacement)
                .fetch_one(&database.pool)
                .await
                .unwrap();
        assert_eq!(
            request(&app, Method::GET, "/api/auth/token", Some(&datastore))
                .await
                .1,
            response
        );
        let expiry_after: chrono::DateTime<chrono::Utc> =
            sqlx::query_scalar("SELECT expirationDateTime FROM webknossos.tokens WHERE value = $1")
                .bind(replacement)
                .fetch_one(&database.pool)
                .await
                .unwrap();
        assert_eq!(expiry_before, expiry_after);
    }
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn datastore_generation_handles_anonymous_and_authenticated_users_with_configured_expiry() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    let app = configured_router(
        &database,
        AuthRouteConfig {
            datastore_expiry: Duration::from_secs(120),
            auth_idle_timeout: Duration::from_secs(90),
            ..AuthRouteConfig::default()
        },
    );
    assert_eq!(
        request(&app, Method::POST, "/api/userToken/generate", None).await,
        (StatusCode::OK, json!({"token":""}))
    );
    let (status, first) = request(
        &app,
        Method::POST,
        "/api/userToken/generate",
        Some(&fixture.token),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let first = first["token"].as_str().unwrap();
    let (status, second) = request(
        &app,
        Method::POST,
        "/api/userToken/generate",
        Some(&fixture.token),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let second = second["token"].as_str().unwrap();
    assert_ne!(first, second);
    assert_eq!(URL_SAFE_NO_PAD.decode(first).unwrap().len(), 16);
    assert_eq!(token_type(&database, first).await, "DataStore");
    assert_eq!(
        authenticate(&database.pool, first).await.unwrap().id,
        fixture.user_id
    );
    assert!(!is_deleted(&database, first).await);
    let (expiry_ms, idle_ms): (i64, Option<i64>) = sqlx::query_as("SELECT ROUND(EXTRACT(EPOCH FROM (expirationDateTime - created)) * 1000)::bigint, idleTimeout FROM webknossos.tokens WHERE value = $1")
        .bind(first).fetch_one(&database.pool).await.unwrap();
    assert_eq!(expiry_ms, 120_000);
    assert_eq!(idle_ms, Some(90_000));
    for path in [
        "/api/auth/token",
        "/api/auth/logoutEverywhere",
        "/api/auth/webauthn/keys",
    ] {
        let method = if path.ends_with("logoutEverywhere") {
            Method::POST
        } else {
            Method::GET
        };
        assert_eq!(
            request(&app, method, path, None).await.0,
            StatusCode::UNAUTHORIZED
        );
    }
    for (method, path) in [
        (Method::GET, "/api/auth/token"),
        (Method::DELETE, "/api/auth/token"),
        (Method::POST, "/api/auth/logout"),
        (Method::POST, "/api/auth/logoutEverywhere"),
        (Method::POST, "/api/userToken/generate"),
    ] {
        assert_eq!(
            request(&app, method, path, Some("unknown")).await.0,
            StatusCode::UNAUTHORIZED
        );
    }
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn logout_discards_only_the_presented_credential_and_returns_the_redirect() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    let datastore = database.seed_token(&fixture.user_id, "DataStore").await;
    let other = database
        .seed_user(&object_id(), &fixture.organization_id, false)
        .await;
    let app = configured_router(
        &database,
        AuthRouteConfig {
            logout_redirect_url: "https://identity.example.test/logout".into(),
            ..AuthRouteConfig::default()
        },
    );
    for token in [None, Some(datastore.as_str()), Some(fixture.token.as_str())] {
        assert_eq!(
            request(&app, Method::POST, "/api/auth/logout", token).await,
            (
                StatusCode::OK,
                json!("https://identity.example.test/logout")
            )
        );
        assert!(authenticate(&database.pool, &other.token).await.is_ok());
    }
    assert!(is_deleted(&database, &fixture.token).await);
    assert!(is_deleted(&database, &datastore).await);
    assert!(authenticate(&database.pool, &fixture.token).await.is_err());
    assert!(authenticate(&database.pool, &datastore).await.is_err());
    assert!(!is_deleted(&database, &other.token).await);
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn logout_everywhere_revokes_every_identity_and_datastore_token_of_only_one_account() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    let other_identity = database
        .seed_user(&object_id(), "second-organization", false)
        .await;
    sqlx::query("UPDATE webknossos.users SET _multiUser = $1 WHERE _id = $2")
        .bind(&fixture.multi_user_id)
        .bind(&other_identity.user_id)
        .execute(&database.pool)
        .await
        .unwrap();
    let unrelated = database
        .seed_user(&object_id(), &fixture.organization_id, false)
        .await;
    let first_datastore = database.seed_token(&fixture.user_id, "DataStore").await;
    let second_datastore = database
        .seed_token(&other_identity.user_id, "DataStore")
        .await;
    let reset = database.seed_token(&fixture.user_id, "ResetPassword").await;
    let job = database.seed_token(&fixture.user_id, "Job").await;
    let app = app(&database);
    assert_eq!(
        request(
            &app,
            Method::POST,
            "/api/auth/logoutEverywhere",
            Some(&fixture.token)
        )
        .await,
        (StatusCode::OK, Value::Null)
    );
    for token in [
        &fixture.token,
        &other_identity.token,
        &first_datastore,
        &second_datastore,
    ] {
        assert!(authenticate(&database.pool, token).await.is_err());
    }
    assert!(is_deleted(&database, &first_datastore).await);
    assert!(is_deleted(&database, &second_datastore).await);
    for token in [&fixture.token, &other_identity.token, &reset, &job] {
        assert!(!is_deleted(&database, token).await);
    }
    assert!(authenticate(&database.pool, &unrelated.token).await.is_ok());
    let cutoff_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM webknossos.users WHERE _multiUser = $1 AND loggedOutEverywhereTime IS NOT NULL")
        .bind(&fixture.multi_user_id).fetch_one(&database.pool).await.unwrap();
    assert_eq!(cutoff_count, 2);

    // A newly authenticated session must never receive the old revoked API token.
    let fresh = database.seed_token(&fixture.user_id, "DataStore").await;
    sqlx::query("UPDATE webknossos.tokens SET created = clock_timestamp() WHERE value = $1")
        .bind(&fresh)
        .execute(&database.pool)
        .await
        .unwrap();
    let (status, response) = request(&app, Method::GET, "/api/auth/token", Some(&fresh)).await;
    assert_eq!(status, StatusCode::OK);
    let renewed = response["token"].as_str().unwrap();
    assert_ne!(renewed, fixture.token);
    assert!(authenticate(&database.pool, renewed).await.is_ok());
    assert!(is_deleted(&database, &fixture.token).await);
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn concurrent_issuance_cannot_leave_a_live_datastore_token_after_account_logout() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    let app = app(&database);
    let (generated, logged_out) = tokio::join!(
        request(
            &app,
            Method::POST,
            "/api/userToken/generate",
            Some(&fixture.token)
        ),
        request(
            &app,
            Method::POST,
            "/api/auth/logoutEverywhere",
            Some(&fixture.token)
        ),
    );
    assert_eq!(logged_out.0, StatusCode::OK);
    match generated.0 {
        StatusCode::OK => {
            let token = generated.1["token"].as_str().unwrap();
            assert!(is_deleted(&database, token).await);
            assert!(authenticate(&database.pool, token).await.is_err());
        }
        StatusCode::UNAUTHORIZED => (),
        status => panic!("unexpected token issuance status: {status}"),
    }
    database.cleanup().await;
}

async fn seed_key(database: &TestDb, multi_user: &str, name: &str) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.webauthnCredentials (_id, _multiUser, credentialId, name, userVerified, backupEligible, backupState, serializedAttestationStatement, serializedAttestedCredential, serializedExtensions) VALUES ($1, $2, $3, $4, TRUE, FALSE, FALSE, '{}'::jsonb, $3, '{}'::jsonb)")
        .bind(&id).bind(multi_user).bind(id.as_bytes()).bind(name).execute(&database.pool).await.unwrap();
    id
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn passkey_descriptors_and_soft_deletion_are_multiuser_scoped_and_feature_gated() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    let other = database
        .seed_user(&object_id(), &fixture.organization_id, false)
        .await;
    let id = seed_key(&database, &fixture.multi_user_id, "Laptop passkey").await;
    let foreign_id = seed_key(&database, &other.multi_user_id, "Foreign key").await;
    let same_account = database
        .seed_user(&object_id(), "passkey-second-org", false)
        .await;
    sqlx::query("UPDATE webknossos.users SET _multiUser = $1 WHERE _id = $2")
        .bind(&fixture.multi_user_id)
        .bind(&same_account.user_id)
        .execute(&database.pool)
        .await
        .unwrap();
    let disabled = app(&database);
    assert_eq!(
        request(
            &disabled,
            Method::GET,
            "/api/auth/webauthn/keys",
            Some(&fixture.token)
        )
        .await,
        (
            StatusCode::BAD_REQUEST,
            json!({"messages":[{"error":"Passkeys are not enabled for this WEBKNOSSOS instance."}]})
        )
    );
    let http = configured_router(
        &database,
        AuthRouteConfig {
            passkeys_enabled: true,
            ..AuthRouteConfig::default()
        },
    );
    assert_eq!(
        request(
            &http,
            Method::GET,
            "/api/auth/webauthn/keys",
            Some(&fixture.token)
        )
        .await,
        (
            StatusCode::BAD_REQUEST,
            json!({"messages":[{"error":"Passkeys are only supported with HTTPS."}]})
        )
    );
    let app = configured_router(
        &database,
        AuthRouteConfig {
            passkeys_enabled: true,
            uses_https: true,
            ..AuthRouteConfig::default()
        },
    );
    assert_eq!(
        request(
            &app,
            Method::GET,
            "/api/auth/webauthn/keys",
            Some(&fixture.token)
        )
        .await,
        (StatusCode::OK, json!([{"id":id,"name":"Laptop passkey"}]))
    );
    assert_eq!(
        request(
            &app,
            Method::GET,
            "/api/auth/webauthn/keys",
            Some(&same_account.token)
        )
        .await,
        (StatusCode::OK, json!([{"id":id,"name":"Laptop passkey"}]))
    );
    assert_eq!(
        request(
            &app,
            Method::DELETE,
            &format!("/api/auth/webauthn/keys/{foreign_id}"),
            Some(&fixture.token)
        )
        .await,
        (StatusCode::OK, json!({}))
    );
    assert_eq!(
        request(
            &app,
            Method::DELETE,
            &format!("/api/auth/webauthn/keys/{id}"),
            Some(&fixture.token)
        )
        .await,
        (StatusCode::OK, json!({}))
    );
    assert_eq!(
        request(
            &app,
            Method::DELETE,
            &format!("/api/auth/webauthn/keys/{id}"),
            Some(&fixture.token)
        )
        .await,
        (StatusCode::OK, json!({}))
    );
    assert_eq!(
        request(
            &app,
            Method::GET,
            "/api/auth/webauthn/keys",
            Some(&fixture.token)
        )
        .await,
        (StatusCode::OK, json!([]))
    );
    let deleted: bool =
        sqlx::query_scalar("SELECT isDeleted FROM webknossos.webauthnCredentials WHERE _id = $1")
            .bind(&id)
            .fetch_one(&database.pool)
            .await
            .unwrap();
    assert!(deleted);
    assert_eq!(
        request(
            &app,
            Method::GET,
            "/api/auth/webauthn/keys",
            Some(&other.token)
        )
        .await,
        (
            StatusCode::OK,
            json!([{"id":foreign_id,"name":"Foreign key"}])
        )
    );
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn account_logout_never_moves_an_existing_revocation_cutoff_backwards() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    let previously_revoked = database
        .seed_token(&fixture.user_id, "Authentication")
        .await;
    sqlx::query("UPDATE webknossos.users SET loggedOutEverywhereTime = NOW() + INTERVAL '1 day' WHERE _id = $1")
        .bind(&fixture.user_id).execute(&database.pool).await.unwrap();
    sqlx::query(
        "UPDATE webknossos.tokens SET created = NOW() + INTERVAL '2 days' WHERE value = $1",
    )
    .bind(&fixture.token)
    .execute(&database.pool)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE webknossos.tokens SET created = NOW() + INTERVAL '12 hours' WHERE value = $1",
    )
    .bind(&previously_revoked)
    .execute(&database.pool)
    .await
    .unwrap();
    assert!(
        authenticate(&database.pool, &previously_revoked)
            .await
            .is_err()
    );
    let before: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("SELECT loggedOutEverywhereTime FROM webknossos.users WHERE _id = $1")
            .bind(&fixture.user_id)
            .fetch_one(&database.pool)
            .await
            .unwrap();
    let app = app(&database);
    assert_eq!(
        request(
            &app,
            Method::POST,
            "/api/auth/logoutEverywhere",
            Some(&fixture.token)
        )
        .await,
        (StatusCode::OK, Value::Null)
    );
    let after: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("SELECT loggedOutEverywhereTime FROM webknossos.users WHERE _id = $1")
            .bind(&fixture.user_id)
            .fetch_one(&database.pool)
            .await
            .unwrap();
    assert_eq!(before, after);
    assert!(
        authenticate(&database.pool, &previously_revoked)
            .await
            .is_err()
    );
    database.cleanup().await;
}
