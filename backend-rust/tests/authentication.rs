mod common;

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::routing::get;
use chrono::{DateTime, Utc};
use common::{TestDb, object_id};
use tower::ServiceExt;
use webknossos_backend::auth::{AuthUser, OptionalAuthUser, authenticate};
use webknossos_backend::{AppState, db};

fn auth_router(database: &TestDb) -> Router {
    Router::new()
        .route("/identity", get(|_: AuthUser| async { StatusCode::OK }))
        .route(
            "/optional",
            get(|OptionalAuthUser(user): OptionalAuthUser| async move {
                if user.is_some() {
                    StatusCode::OK
                } else {
                    StatusCode::NO_CONTENT
                }
            }),
        )
        .with_state(AppState {
            pool: database.pool.clone(),
        })
}

async fn last_used(database: &TestDb, token: &str) -> DateTime<Utc> {
    sqlx::query_scalar("SELECT lastUsedDateTime FROM webknossos.tokens WHERE value = $1")
        .bind(token)
        .fetch_one(&database.pool)
        .await
        .unwrap()
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB; run cargo test -- --ignored"]
async fn accepts_existing_credentials_via_all_transports_and_touches_activity() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    let before = last_used(&database, &fixture.token).await;
    let router = auth_router(&database);
    for request in [
        Request::builder()
            .uri("/identity")
            .header("x-auth-token", &fixture.token)
            .body(Body::empty()),
        Request::builder()
            .uri("/identity")
            .header("Authorization", format!("Bearer {}", fixture.token))
            .body(Body::empty()),
        Request::builder()
            .uri(format!("/identity?token={}", fixture.token))
            .body(Body::empty()),
    ] {
        assert_eq!(
            router
                .clone()
                .oneshot(request.unwrap())
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
    }
    assert!(last_used(&database, &fixture.token).await > before);
    let user = authenticate(&database.pool, &fixture.token).await.unwrap();
    assert_eq!(user.id, fixture.user_id);
    assert_eq!(user.organization_id, fixture.organization_id);
    assert!(user.is_admin);
    let datastore_token = database.seed_token(&fixture.user_id, "DataStore").await;
    assert!(authenticate(&database.pool, &datastore_token).await.is_ok());
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB; run cargo test -- --ignored"]
async fn missing_invalid_and_wrong_purpose_tokens_are_unauthorized() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    let router = auth_router(&database);
    for path in [
        "/identity",
        "/identity?token=unknown",
        "/identity?token=",
        "/identity?token=a&token=b",
    ] {
        let response = router
            .clone()
            .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
    for purpose in ["ResetPassword"] {
        let token = database.seed_token(&fixture.user_id, purpose).await;
        let before = last_used(&database, &token).await;
        assert!(authenticate(&database.pool, &token).await.is_err());
        assert_eq!(last_used(&database, &token).await, before);
    }
    let job_token = database.seed_token(&fixture.user_id, "Job").await;
    let before = last_used(&database, &job_token).await;
    assert!(authenticate(&database.pool, &job_token).await.is_ok());
    assert!(last_used(&database, &job_token).await > before);
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB; run cargo test -- --ignored"]
async fn optional_auth_only_allows_absent_credentials() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    let router = auth_router(&database);
    for (path, status) in [
        ("/optional".to_owned(), StatusCode::NO_CONTENT),
        (format!("/optional?token={}", fixture.token), StatusCode::OK),
        (
            "/optional?token=unknown".to_owned(),
            StatusCode::UNAUTHORIZED,
        ),
        ("/optional?token=".to_owned(), StatusCode::UNAUTHORIZED),
    ] {
        let response = router
            .clone()
            .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), status);
    }
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB; run cargo test -- --ignored"]
async fn job_tokens_authenticate_http_requests_and_obey_expiry_and_account_revocation() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    let router = auth_router(&database);
    let valid = database.seed_token(&fixture.user_id, "Job").await;
    assert_eq!(
        router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/identity")
                    .header("x-auth-token", &valid)
                    .body(Body::empty())
                    .unwrap()
            )
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    for invalidation in [
        "expirationDateTime=NOW()-INTERVAL '1 second'",
        "idleTimeout=1000,lastUsedDateTime=NOW()-INTERVAL '1 minute'",
        "isDeleted=true",
    ] {
        let token = database.seed_token(&fixture.user_id, "Job").await;
        sqlx::query(&format!(
            "UPDATE webknossos.tokens SET {invalidation} WHERE value=$1"
        ))
        .bind(&token)
        .execute(&database.pool)
        .await
        .unwrap();
        let before = last_used(&database, &token).await;
        assert_eq!(
            router
                .clone()
                .oneshot(
                    Request::builder()
                        .uri("/identity")
                        .header("Authorization", format!("Bearer {token}"))
                        .body(Body::empty())
                        .unwrap()
                )
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(last_used(&database, &token).await, before);
    }
    let before = last_used(&database, &valid).await;
    sqlx::query("UPDATE webknossos.users SET loggedOutEverywhereTime=NOW() WHERE _id=$1")
        .bind(&fixture.user_id)
        .execute(&database.pool)
        .await
        .unwrap();
    assert_eq!(
        router
            .oneshot(
                Request::builder()
                    .uri(format!("/identity?token={valid}"))
                    .body(Body::empty())
                    .unwrap()
            )
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(last_used(&database, &valid).await, before);
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB; run cargo test -- --ignored"]
async fn expiration_idle_timeout_and_revocation_do_not_refresh_tokens() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    for invalidation in [
        "expirationDateTime = NOW() - INTERVAL '1 second'",
        "idleTimeout = 1000, lastUsedDateTime = NOW() - INTERVAL '1 minute'",
        "idleTimeout = 0",
        "isDeleted = TRUE",
    ] {
        let token = database
            .seed_token(&fixture.user_id, "Authentication")
            .await;
        sqlx::query(&format!(
            "UPDATE webknossos.tokens SET {invalidation} WHERE value = $1"
        ))
        .bind(&token)
        .execute(&database.pool)
        .await
        .unwrap();
        let before = last_used(&database, &token).await;
        assert!(
            authenticate(&database.pool, &token).await.is_err(),
            "accepted {invalidation}"
        );
        assert_eq!(last_used(&database, &token).await, before);
    }
    let valid_idle_token = database
        .seed_token(&fixture.user_id, "Authentication")
        .await;
    sqlx::query("UPDATE webknossos.tokens SET idleTimeout = 3600000 WHERE value = $1")
        .bind(&valid_idle_token)
        .execute(&database.pool)
        .await
        .unwrap();
    assert!(
        authenticate(&database.pool, &valid_idle_token)
            .await
            .is_ok()
    );
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB; run cargo test -- --ignored"]
async fn inactive_deleted_or_logged_out_identity_cannot_authenticate() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    let before = last_used(&database, &fixture.token).await;
    for (invalidate, restore) in [
        (
            "UPDATE webknossos.users SET isDeleted = TRUE",
            "UPDATE webknossos.users SET isDeleted = FALSE",
        ),
        (
            "UPDATE webknossos.users SET isDeactivated = TRUE",
            "UPDATE webknossos.users SET isDeactivated = FALSE",
        ),
        (
            "UPDATE webknossos.multiUsers SET isDeleted = TRUE",
            "UPDATE webknossos.multiUsers SET isDeleted = FALSE",
        ),
        (
            "UPDATE webknossos.organizations SET isDeleted = TRUE",
            "UPDATE webknossos.organizations SET isDeleted = FALSE",
        ),
        (
            "UPDATE webknossos.users SET loggedOutEverywhereTime = NOW()",
            "UPDATE webknossos.users SET loggedOutEverywhereTime = NULL",
        ),
    ] {
        sqlx::query(invalidate)
            .execute(&database.pool)
            .await
            .unwrap();
        assert!(
            authenticate(&database.pool, &fixture.token).await.is_err(),
            "accepted {invalidate}"
        );
        assert_eq!(last_used(&database, &fixture.token).await, before);
        sqlx::query(restore).execute(&database.pool).await.unwrap();
    }
    assert!(authenticate(&database.pool, &fixture.token).await.is_ok());
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB; run cargo test -- --ignored"]
async fn duplicate_live_token_values_are_rejected_without_updates() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    sqlx::query("INSERT INTO webknossos.tokens SELECT $1, value, _user, lastUsedDateTime, expirationDateTime, idleTimeout, tokenType, created, isDeleted FROM webknossos.tokens WHERE value = $2")
        .bind(object_id()).bind(&fixture.token).execute(&database.pool).await.unwrap();
    assert!(authenticate(&database.pool, &fixture.token).await.is_err());
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB; run cargo test -- --ignored"]
async fn overlapping_authentication_never_moves_last_used_backwards() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    // Stored future timestamps are legal in the legacy schema; touching must preserve them.
    sqlx::query("UPDATE webknossos.tokens SET lastUsedDateTime = NOW() + INTERVAL '1 minute' WHERE value = $1")
        .bind(&fixture.token).execute(&database.pool).await.unwrap();
    let before = last_used(&database, &fixture.token).await;
    let (first, second) = tokio::join!(
        authenticate(&database.pool, &fixture.token),
        authenticate(&database.pool, &fixture.token)
    );
    assert!(first.is_ok() && second.is_ok());
    assert_eq!(last_used(&database, &fixture.token).await, before);
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB; run cargo test -- --ignored"]
async fn team_management_requires_same_organization_and_live_team() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    let member_id = object_id();
    let member = database
        .seed_user(&member_id, &fixture.organization_id, false)
        .await;
    let user = authenticate(&database.pool, &member.token).await.unwrap();
    assert!(!user.is_team_manager_or_admin(&database.pool).await.unwrap());
    assert!(
        !user
            .can_manage_team(&database.pool, &fixture.team_id)
            .await
            .unwrap()
    );
    sqlx::query("INSERT INTO webknossos.user_team_roles (_user, _team, isTeamManager) VALUES ($1, $2, TRUE)")
        .bind(&member_id).bind(&fixture.team_id).execute(&database.pool).await.unwrap();
    assert!(user.is_team_manager_or_admin(&database.pool).await.unwrap());
    assert!(
        user.can_manage_team(&database.pool, &fixture.team_id)
            .await
            .unwrap()
    );
    let other = database
        .seed_user(&object_id(), "other-organization", true)
        .await;
    let other_user = authenticate(&database.pool, &other.token).await.unwrap();
    assert!(
        !other_user
            .can_manage_team(&database.pool, &fixture.team_id)
            .await
            .unwrap()
    );
    sqlx::query("UPDATE webknossos.teams SET isDeleted = TRUE WHERE _id = $1")
        .bind(&fixture.team_id)
        .execute(&database.pool)
        .await
        .unwrap();
    assert!(
        !user
            .can_manage_team(&database.pool, &fixture.team_id)
            .await
            .unwrap()
    );
    assert!(!user.is_team_manager_or_admin(&database.pool).await.unwrap());
    let admin = authenticate(&database.pool, &fixture.token).await.unwrap();
    assert!(
        !admin
            .can_manage_team(&database.pool, &fixture.team_id)
            .await
            .unwrap()
    );
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB; run cargo test -- --ignored"]
async fn readiness_requires_exactly_one_supported_schema_version() {
    let database = TestDb::new().await;
    db::check_schema(&database.pool).await.unwrap();
    db::ready(&database.pool).await.unwrap();
    sqlx::query("UPDATE webknossos.releaseInformation SET schemaVersion = 184")
        .execute(&database.pool)
        .await
        .unwrap();
    assert!(db::ready(&database.pool).await.is_err());
    sqlx::query("UPDATE webknossos.releaseInformation SET schemaVersion = 185")
        .execute(&database.pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO webknossos.releaseInformation (schemaVersion) VALUES (185)")
        .execute(&database.pool)
        .await
        .unwrap();
    assert!(db::check_schema(&database.pool).await.is_err());
    sqlx::query("DELETE FROM webknossos.releaseInformation")
        .execute(&database.pool)
        .await
        .unwrap();
    assert!(db::check_schema(&database.pool).await.is_err());
    database.cleanup().await;
}
