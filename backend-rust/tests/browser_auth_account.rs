//! Password reset/change, identity switching and email verification.
mod browser_auth_support;
mod common;

use axum::http::{Method, StatusCode, header};
use browser_auth_support::{
    SECRET, app, config, error, make_superuser, seed_organization_team, send, set_password,
};
use common::{TestDb, object_id};
use serde_json::{Value, json};
use webknossos_backend::{browser_auth::CookieAuthenticator, mail::RecordingMailer};

const TOKEN_INVALID: &str = "The supplied token is invalid or expired.";
const INVALID_CREDENTIALS: &str = "Incorrect email or password. Please try again.";

async fn login(app: &axum::Router, email: &str, password: &str) -> Option<String> {
    let response = send(
        app,
        Method::POST,
        "/api/auth/login",
        None,
        None,
        Some(json!({"email": email, "password": password})),
    )
    .await;
    (response.status == StatusCode::OK).then(|| response.cookie_value())
}

async fn change(
    app: &axum::Router,
    cookie: Option<&str>,
    token: Option<&str>,
    old: &str,
    new: &str,
) -> browser_auth_support::Response {
    send(
        app,
        Method::POST,
        "/api/auth/changePassword",
        cookie,
        token,
        Some(json!({"oldPassword": old, "password": {"password1": new, "password2": new}})),
    )
    .await
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
async fn password_reset_and_change_follow_play_semantics() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    set_password(&database, &fixture.multi_user_id, "reset@example.test").await;
    let mailer = RecordingMailer::default();
    let app = app(&database, config(), &mailer);

    // Unknown accounts get the same 200 without a mail.
    let start = |email: &str| {
        send(
            &app,
            Method::POST,
            "/api/auth/startResetPassword",
            None,
            None,
            Some(json!({"email": email})),
        )
    };
    assert_eq!(start("nobody@example.test").await.status, StatusCode::OK);
    assert!(mailer.take().is_empty());
    assert_eq!(start("invalid").await.status, StatusCode::BAD_REQUEST);
    assert_eq!(start("RESET@example.test").await.status, StatusCode::OK);
    let first: String = sqlx::query_scalar(
        "SELECT value FROM webknossos.tokens WHERE _user = $1 AND tokenType = 'ResetPassword'",
    )
    .bind(&fixture.user_id)
    .fetch_one(&database.pool)
    .await
    .unwrap();
    assert_eq!(start("reset@example.test").await.status, StatusCode::OK);
    assert!(is_deleted(&database, &first).await);
    let (token, expiry_seconds): (String, i64) = sqlx::query_as(
        "SELECT value, ROUND(EXTRACT(EPOCH FROM (expirationDateTime - created)))::bigint FROM webknossos.tokens WHERE _user = $1 AND tokenType = 'ResetPassword' AND NOT isDeleted")
        .bind(&fixture.user_id).fetch_one(&database.pool).await.unwrap();
    assert_eq!(expiry_seconds, 86_400);
    let mails = mailer.take();
    assert_eq!(mails.len(), 2);
    assert_eq!(mails[1].subject, "WEBKNOSSOS | Password Reset");
    assert_eq!(mails[1].recipients, vec!["reset@example.test".to_owned()]);
    assert!(mails[1].body_html.contains(&format!(
        "http://localhost:9000/auth/finishResetPassword?token={token}"
    )));

    let reset = |token: &str, one: &str, two: &str| {
        send(
            &app,
            Method::POST,
            "/api/auth/resetPassword",
            None,
            None,
            Some(json!({"token": token, "password": {"password1": one, "password2": two}})),
        )
    };
    assert_eq!(
        reset("unknown", "new-password", "new-password").await.body,
        error(TOKEN_INVALID)
    );
    // Only reset-password tokens may reset passwords (stricter than Play).
    assert_eq!(
        reset(&fixture.token, "new-password", "new-password")
            .await
            .body,
        error(TOKEN_INVALID)
    );
    assert_eq!(
        reset(&token, "new-password", "other-password").await.status,
        StatusCode::BAD_REQUEST
    );
    let response = reset(&format!(" {token} "), "new-password", "new-password").await;
    assert_eq!(
        (response.status, &response.body),
        (StatusCode::OK, &Value::Null)
    );
    assert!(is_deleted(&database, &token).await);
    assert_eq!(
        reset(&token, "new-password", "new-password").await.body,
        error(TOKEN_INVALID)
    );
    assert!(login(&app, "reset@example.test", "secret").await.is_none());
    let cookie = login(&app, "reset@example.test", "new-password")
        .await
        .unwrap();

    // changePassword re-checks the old password; a bearer credential is
    // discarded, a cookie session keeps working.
    assert_eq!(
        change(&app, None, None, "new-password", "third-password")
            .await
            .status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        change(&app, None, Some(&fixture.token), "wrong", "third-password")
            .await
            .body,
        error(INVALID_CREDENTIALS)
    );
    let response = change(
        &app,
        None,
        Some(&fixture.token),
        "new-password",
        "third-password",
    )
    .await;
    assert_eq!(response.status, StatusCode::OK);
    assert!(is_deleted(&database, &fixture.token).await);
    let mails = mailer.take();
    assert_eq!(mails.len(), 1);
    assert_eq!(mails[0].subject, "WEBKNOSSOS | Password changed");
    let response = change(
        &app,
        Some(&cookie),
        None,
        "third-password",
        "fourth-password",
    )
    .await;
    assert_eq!(response.status, StatusCode::OK);
    assert_eq!(
        send(&app, Method::GET, "/api/user", Some(&cookie), None, None)
            .await
            .status,
        StatusCode::OK
    );
    assert!(
        login(&app, "reset@example.test", "fourth-password")
            .await
            .is_some()
    );
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn switching_identities_and_organizations_issues_cookies() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    set_password(&database, &fixture.multi_user_id, "multi@example.test").await;
    // A second identity of the same account in another organization.
    database.seed_user(&object_id(), "org-b", false).await;
    let second_user = object_id();
    sqlx::query("INSERT INTO webknossos.users (_id, _multiUser, _organization, userConfiguration) VALUES ($1, $2, 'org-b', '{}'::jsonb)")
        .bind(&second_user).bind(&fixture.multi_user_id).execute(&database.pool).await.unwrap();
    let mailer = RecordingMailer::default();
    let app = app(&database, config(), &mailer);
    let cookie = login(&app, "multi@example.test", "secret").await.unwrap();

    let response = send(
        &app,
        Method::POST,
        "/api/auth/switchOrganization/org-b",
        Some(&cookie),
        None,
        None,
    )
    .await;
    assert_eq!(response.status, StatusCode::SEE_OTHER);
    assert_eq!(response.headers[header::LOCATION], "/dashboard");
    let switched = response.cookie_value();
    assert_eq!(
        CookieAuthenticator::unserialize(&switched, SECRET)
            .unwrap()
            .user_id,
        second_user
    );
    let current = send(&app, Method::GET, "/api/user", Some(&switched), None, None).await;
    assert_eq!(current.body["id"], second_user);
    let last: String = sqlx::query_scalar(
        "SELECT _lastLoggedInIdentity FROM webknossos.multiUsers WHERE _id = $1",
    )
    .bind(&fixture.multi_user_id)
    .fetch_one(&database.pool)
    .await
    .unwrap();
    assert_eq!(last, second_user);
    // Login now resumes the last identity.
    let resumed = login(&app, "multi@example.test", "secret").await.unwrap();
    assert_eq!(
        CookieAuthenticator::unserialize(&resumed, SECRET)
            .unwrap()
            .user_id,
        second_user
    );

    let response = send(
        &app,
        Method::POST,
        "/api/auth/switchOrganization/unrelated",
        Some(&switched),
        None,
        None,
    )
    .await;
    assert_eq!(
        (response.status, &response.body),
        (
            StatusCode::NOT_FOUND,
            &error("Organization “unrelated” could not be found or accessed.")
        )
    );
    sqlx::query("UPDATE webknossos.users SET isDeactivated = TRUE WHERE _id = $1")
        .bind(&fixture.user_id)
        .execute(&database.pool)
        .await
        .unwrap();
    let response = send(
        &app,
        Method::POST,
        &format!("/api/auth/switchOrganization/{}", fixture.organization_id),
        Some(&switched),
        None,
        None,
    )
    .await;
    assert_eq!(response.status, StatusCode::BAD_REQUEST);
    sqlx::query("UPDATE webknossos.users SET isDeactivated = FALSE WHERE _id = $1")
        .bind(&fixture.user_id)
        .execute(&database.pool)
        .await
        .unwrap();

    // Superusers: GET /auth/switch?to=<email>, and switching into foreign
    // organizations creates an unlisted admin identity.
    let admin = database.seed_user(&object_id(), "org-super", true).await;
    let org_c = database.seed_user(&object_id(), "org-c", true).await;
    let org_c_team = seed_organization_team(&database, "org-c").await;
    let _ = org_c;
    let denied = send(
        &app,
        Method::GET,
        "/api/auth/switch?to=multi@example.test",
        Some(&switched),
        None,
        None,
    )
    .await;
    assert_eq!(
        (denied.status, &denied.body),
        (
            StatusCode::FORBIDDEN,
            &error("You are not authorized to view this resource. Please log in.")
        )
    );
    make_superuser(&database, &admin.multi_user_id).await;
    let missing = send(
        &app,
        Method::GET,
        "/api/auth/switch?to=nobody@example.test",
        None,
        Some(&admin.token),
        None,
    )
    .await;
    assert_eq!(missing.status, StatusCode::NOT_FOUND);
    let response = send(
        &app,
        Method::GET,
        "/api/auth/switch?to=multi@example.test",
        None,
        Some(&admin.token),
        None,
    )
    .await;
    assert_eq!(response.status, StatusCode::SEE_OTHER);
    assert_eq!(
        CookieAuthenticator::unserialize(&response.cookie_value(), SECRET)
            .unwrap()
            .user_id,
        second_user
    );
    // Play discards the superuser's bearer authenticator when switching.
    assert!(is_deleted(&database, &admin.token).await);

    let fresh_token = database.seed_token(&admin.user_id, "Authentication").await;
    let response = send(
        &app,
        Method::POST,
        "/api/auth/switchOrganization/org-c",
        None,
        Some(&fresh_token),
        None,
    )
    .await;
    assert_eq!(response.status, StatusCode::SEE_OTHER);
    let (identity, is_admin, unlisted): (String, bool, bool) = sqlx::query_as(
        "SELECT _id, isAdmin, isUnlisted FROM webknossos.users WHERE _multiUser = $1 AND _organization = 'org-c'")
        .bind(&admin.multi_user_id).fetch_one(&database.pool).await.unwrap();
    assert!(is_admin && unlisted);
    assert_eq!(
        CookieAuthenticator::unserialize(&response.cookie_value(), SECRET)
            .unwrap()
            .user_id,
        identity
    );
    let teams: Vec<String> =
        sqlx::query_scalar("SELECT _team FROM webknossos.user_team_roles WHERE _user = $1")
            .bind(&identity)
            .fetch_all(&database.pool)
            .await
            .unwrap();
    assert_eq!(teams, vec![org_c_team]);
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn accessible_by_switching_finds_the_identity_with_access() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    database.seed_user(&object_id(), "org-b", false).await;
    sqlx::query("INSERT INTO webknossos.users (_id, _multiUser, _organization, userConfiguration) VALUES ($1, $2, 'org-b', '{}'::jsonb)")
        .bind(object_id()).bind(&fixture.multi_user_id).execute(&database.pool).await.unwrap();
    database.seed_user(&object_id(), "org-c", false).await;
    for (organization, hash) in [
        ("org-b", "workflow-b"),
        ("org-c", "workflow-c"),
        (fixture.organization_id.as_str(), "workflow-a"),
    ] {
        sqlx::query("INSERT INTO webknossos.voxelytics_workflows (_organization, hash, name) VALUES ($1, $2, 'w')")
            .bind(organization).bind(hash).execute(&database.pool).await.unwrap();
    }
    let mailer = RecordingMailer::default();
    let app = app(&database, config(), &mailer);
    let get = |query: &str, token: &str| {
        let path = format!("/api/auth/accessibleBySwitching?{query}");
        let token = token.to_owned();
        let app = app.clone();
        async move { send(&app, Method::GET, &path, None, Some(&token), None).await }
    };

    let response = get("workflowHash=workflow-b", &fixture.token).await;
    assert_eq!(response.status, StatusCode::OK);
    assert_eq!(response.body["id"], "org-b");
    assert!(
        response
            .body
            .get("milliCreditBalance")
            .is_some_and(Value::is_null)
    );
    // Accessible in the current organization (or nowhere): 400.
    assert_eq!(
        get("workflowHash=workflow-a", &fixture.token).await.status,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        get("workflowHash=workflow-c", &fixture.token).await.status,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        get(&format!("datasetId={}", object_id()), &fixture.token)
            .await
            .status,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        get(&format!("annotationId={}", object_id()), &fixture.token)
            .await
            .status,
        StatusCode::BAD_REQUEST
    );
    let combined = get(
        &format!("datasetId={}&workflowHash=x", object_id()),
        &fixture.token,
    )
    .await;
    assert_eq!(
        combined.body,
        error("Can either test access for dataset or annotation or workflow, not a combination")
    );
    assert_eq!(
        get("datasetId=invalid", &fixture.token).await.status,
        StatusCode::BAD_REQUEST
    );

    make_superuser(&database, &fixture.multi_user_id).await;
    let response = get("workflowHash=workflow-c", &fixture.token).await;
    assert_eq!(response.body["id"], "org-c");
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn email_verification_keys_are_checked_and_used_once() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    set_password(&database, &fixture.multi_user_id, "verify@example.test").await;
    let mailer = RecordingMailer::default();
    let app = app(&database, config(), &mailer);

    assert_eq!(
        send(&app, Method::POST, "/api/verifyEmail", None, None, None)
            .await
            .status,
        StatusCode::UNAUTHORIZED
    );
    let response = send(
        &app,
        Method::POST,
        "/api/verifyEmail",
        None,
        Some(&fixture.token),
        None,
    )
    .await;
    assert_eq!(
        (response.status, &response.body),
        (StatusCode::OK, &Value::Null)
    );
    let key: String = sqlx::query_scalar(
        "SELECT key FROM webknossos.emailVerificationKeys WHERE _multiUser = $1",
    )
    .bind(&fixture.multi_user_id)
    .fetch_one(&database.pool)
    .await
    .unwrap();
    assert_eq!(key.len(), 43);
    let mails = mailer.take();
    assert!(
        mails[0]
            .body_html
            .contains(&format!("http://localhost:9000/verifyEmail/{key}"))
    );

    let verify = |key: String| {
        let app = app.clone();
        async move {
            send(
                &app,
                Method::POST,
                &format!("/api/verifyEmail/{key}"),
                None,
                None,
                None,
            )
            .await
        }
    };
    assert_eq!(
        verify("unknown".into()).await.body,
        error("Verification key is invalid.")
    );
    // Changed email address: the key no longer matches.
    sqlx::query("UPDATE webknossos.multiUsers SET email = 'changed@example.test' WHERE _id = $1")
        .bind(&fixture.multi_user_id)
        .execute(&database.pool)
        .await
        .unwrap();
    assert_eq!(
        verify(key.clone()).await.body,
        error("This verification key is associated with a different email address.")
    );
    sqlx::query("UPDATE webknossos.multiUsers SET email = 'verify@example.test' WHERE _id = $1")
        .bind(&fixture.multi_user_id)
        .execute(&database.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE webknossos.emailVerificationKeys SET validUntil = NOW() - INTERVAL '1 second' WHERE key = $1")
        .bind(&key).execute(&database.pool).await.unwrap();
    assert_eq!(
        verify(key.clone()).await.body,
        error("The email verification link is expired.")
    );
    sqlx::query("UPDATE webknossos.emailVerificationKeys SET validUntil = NULL WHERE key = $1")
        .bind(&key)
        .execute(&database.pool)
        .await
        .unwrap();
    let response = verify(key.clone()).await;
    assert_eq!(
        (response.status, &response.body),
        (StatusCode::OK, &Value::Null)
    );
    let (verified, used): (bool, bool) = sqlx::query_as(
        "SELECT m.isEmailVerified, k.isUsed FROM webknossos.multiUsers m JOIN webknossos.emailVerificationKeys k ON k._multiUser = m._id WHERE k.key = $1")
        .bind(&key).fetch_one(&database.pool).await.unwrap();
    assert!(verified && used);
    // Already verified accounts succeed even with a used key.
    assert_eq!(verify(key.clone()).await.status, StatusCode::OK);
    sqlx::query("UPDATE webknossos.multiUsers SET isEmailVerified = FALSE WHERE _id = $1")
        .bind(&fixture.multi_user_id)
        .execute(&database.pool)
        .await
        .unwrap();
    assert_eq!(
        verify(key).await.body,
        error("Verification key has already been used.")
    );
    database.cleanup().await;
}
