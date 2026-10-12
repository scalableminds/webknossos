//! Browser sessions: Silhouette cookie interoperability, BCrypt hashes from
//! the real Java hasher, password login and cookie/bearer priority.
mod browser_auth_support;
mod common;

use axum::{
    body::Body,
    http::{HeaderMap, Method, Request, StatusCode, header},
};
use browser_auth_support::{SECRET, USER_AGENT, app, config, error, send, set_password};
use chrono::{Duration as ChronoDuration, TimeZone, Utc};
use common::TestDb;
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{
    browser_auth::{self, BrowserAuthConfig, CookieAuthenticator},
    mail::RecordingMailer,
};

const GOLDEN_SECRET: &str = "webknossos-golden-vector-secret";

fn golden() -> Vec<String> {
    include_str!("fixtures/silhouette_cookie_golden.txt")
        .lines()
        .map(str::to_owned)
        .collect()
}

#[test]
fn decodes_and_reproduces_the_scala_generated_cookie() {
    let lines = golden();
    let cookie = CookieAuthenticator::unserialize(&lines[0], GOLDEN_SECRET).expect("valid golden");
    assert_eq!(cookie.id, "AAAAAAAAAAAAAAAAAAAAAA");
    assert_eq!(cookie.provider_id, "credentials");
    assert_eq!(cookie.user_id, "000000000000000000000001");
    assert_eq!(
        cookie.last_used,
        Utc.with_ymd_and_hms(2026, 10, 9, 0, 0, 0).unwrap() + ChronoDuration::milliseconds(123)
    );
    assert_eq!(
        cookie.expiration,
        Utc.with_ymd_and_hms(2026, 11, 8, 0, 0, 0).unwrap() + ChronoDuration::milliseconds(123)
    );
    assert_eq!(cookie.idle_timeout, None);
    assert_eq!(cookie.cookie_max_age, Some(365 * 86_400));
    assert_eq!(cookie.fingerprint.as_deref(), Some(lines[2].as_str()));
    // Byte-identical re-encoding: JSON field order, date format and signature.
    assert_eq!(cookie.to_json(), lines[1]);
    assert_eq!(cookie.serialize(GOLDEN_SECRET), lines[0]);

    let mut headers = HeaderMap::new();
    headers.insert(header::USER_AGENT, "Golden Browser/1.0".parse().unwrap());
    headers.insert(header::ACCEPT_LANGUAGE, "en-US,en;q=0.9".parse().unwrap());
    headers.insert(header::ACCEPT_CHARSET, "utf-8".parse().unwrap());
    assert_eq!(browser_auth::fingerprint(&headers), lines[2]);
    assert_eq!(browser_auth::fingerprint(&HeaderMap::new()), lines[3]);

    // Wrong secret, modified payload or signature are rejected.
    assert!(CookieAuthenticator::unserialize(&lines[0], "another-secret").is_none());
    let mut tampered = lines[0].clone();
    tampered.pop();
    tampered.push('A');
    assert!(CookieAuthenticator::unserialize(&tampered, GOLDEN_SECRET).is_none());
    let forged = browser_auth::sign("attacker", lines[0].splitn(3, '-').nth(2).unwrap());
    assert!(CookieAuthenticator::unserialize(&forged, GOLDEN_SECRET).is_none());
}

#[tokio::test]
async fn verifies_and_produces_java_compatible_bcrypt_hashes() {
    for line in include_str!("fixtures/bcrypt_golden.tsv").lines() {
        let fields: Vec<&str> = line.split('\t').collect();
        let (password, hash) = (fields[0], fields[1]);
        assert!(browser_auth::verify_password(password.into(), "SCrypt", hash.into()).await);
        assert!(
            !browser_auth::verify_password(format!("{password}x"), "SCrypt", hash.into()).await
        );
        assert!(!browser_auth::verify_password(password.into(), "Empty", hash.into()).await);
    }
    let hash = browser_auth::hash_password("Pässwörd".into())
        .await
        .unwrap();
    assert!(hash.starts_with("$2a$10$"));
    assert!(browser_auth::verify_password("Pässwörd".into(), "SCrypt", hash).await);
    assert!(browser_auth::hash_password("x".repeat(72)).await.is_ok());
    assert!(browser_auth::hash_password("x".repeat(73)).await.is_err());
}

const INVALID_CREDENTIALS: &str = "Incorrect email or password. Please try again.";

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn password_login_issues_a_silhouette_cookie_used_before_bearer_tokens() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    set_password(&database, &fixture.multi_user_id, "login@example.test").await;
    let mailer = RecordingMailer::default();
    let app = app(&database, config(), &mailer);

    for (email, password) in [
        ("login@example.test", "wrong-password"),
        ("missing@example.test", "secret"),
    ] {
        let response = send(
            &app,
            Method::POST,
            "/api/auth/login",
            None,
            None,
            Some(json!({"email": email, "password": password})),
        )
        .await;
        assert_eq!(
            (response.status, &response.body),
            (StatusCode::BAD_REQUEST, &error(INVALID_CREDENTIALS))
        );
        assert!(response.set_cookie().is_none());
    }
    let malformed = send(
        &app,
        Method::POST,
        "/api/auth/login",
        None,
        None,
        Some(json!({"email": "not-an-email", "password": "secret"})),
    )
    .await;
    assert_eq!(malformed.status, StatusCode::BAD_REQUEST);
    assert!(!malformed.body.to_string().contains("secret"));

    // Email is lowercased; the response is an empty 200 with the cookie.
    let login = send(
        &app,
        Method::POST,
        "/api/auth/login",
        None,
        None,
        Some(json!({"email": "LOGIN@Example.test", "password": "secret"})),
    )
    .await;
    assert_eq!(login.status, StatusCode::OK);
    assert_eq!(login.body, Value::Null);
    let header = login.set_cookie().unwrap();
    assert!(header.starts_with("id=1-"));
    assert!(header.contains("; Max-Age=31536000; Expires="));
    assert!(header.ends_with("; Path=/; HTTPOnly; SameSite=Lax"));
    let cookie_value = login.cookie_value();
    let cookie = CookieAuthenticator::unserialize(&cookie_value, SECRET).unwrap();
    assert_eq!(cookie.user_id, fixture.user_id);
    assert_eq!(cookie.provider_id, "credentials");
    assert_eq!(cookie.cookie_max_age, Some(365 * 86_400));
    assert_eq!(
        cookie.expiration - cookie.last_used,
        ChronoDuration::days(30)
    );
    let mut headers = HeaderMap::new();
    headers.insert(header::USER_AGENT, USER_AGENT.parse().unwrap());
    assert_eq!(
        cookie.fingerprint,
        Some(browser_auth::fingerprint(&headers))
    );
    let last_identity: Option<String> = sqlx::query_scalar(
        "SELECT _lastLoggedInIdentity FROM webknossos.multiUsers WHERE _id = $1",
    )
    .bind(&fixture.multi_user_id)
    .fetch_one(&database.pool)
    .await
    .unwrap();
    assert_eq!(last_identity.as_deref(), Some(fixture.user_id.as_str()));

    let current = send(
        &app,
        Method::GET,
        "/api/user",
        Some(&cookie_value),
        None,
        None,
    )
    .await;
    assert_eq!(current.status, StatusCode::OK);
    assert_eq!(current.body["id"], fixture.user_id);
    // A valid cookie has priority over an invalid bearer token.
    let current = send(
        &app,
        Method::GET,
        "/api/user",
        Some(&cookie_value),
        Some("bogus"),
        None,
    )
    .await;
    assert_eq!(current.status, StatusCode::OK);

    // Another browser fingerprint invalidates the cookie (falls back to bearer).
    let foreign = app
        .clone()
        .oneshot(
            Request::get("/api/user")
                .header(header::USER_AGENT, "Other Browser")
                .header(header::COOKIE, format!("id={cookie_value}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(foreign.status(), StatusCode::UNAUTHORIZED);

    // Tampered cookies are ignored in favour of bearer credentials.
    let other = database
        .seed_user(&common::object_id(), &fixture.organization_id, false)
        .await;
    let tampered = format!("{}x", &cookie_value[..cookie_value.len() - 1]);
    let fallback = send(
        &app,
        Method::GET,
        "/api/user",
        Some(&tampered),
        Some(&other.token),
        None,
    )
    .await;
    assert_eq!(fallback.body["id"], other.user_id);

    // Expired but authentic cookies win over bearer credentials, yield no
    // identity, and are discarded.
    let mut expired = cookie.clone();
    expired.expiration = Utc::now() - ChronoDuration::seconds(1);
    let expired = expired.serialize(SECRET);
    let rejected = send(
        &app,
        Method::GET,
        "/api/user",
        Some(&expired),
        Some(&other.token),
        None,
    )
    .await;
    assert_eq!(rejected.status, StatusCode::UNAUTHORIZED);
    assert_eq!(
        rejected.set_cookie().as_deref(),
        Some("id=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/")
    );
    let anonymous = send(
        &app,
        Method::GET,
        "/api/organizations/default",
        Some(&expired),
        None,
        None,
    )
    .await;
    assert_eq!(anonymous.status, StatusCode::OK);
    assert!(anonymous.set_cookie().is_some());

    // Cookie sessions can obtain API and datastore tokens.
    let token = send(
        &app,
        Method::GET,
        "/api/auth/token",
        Some(&cookie_value),
        None,
        None,
    )
    .await;
    assert_eq!(token.body, json!({"token": fixture.token}));
    let datastore = send(
        &app,
        Method::POST,
        "/api/userToken/generate",
        Some(&cookie_value),
        None,
        None,
    )
    .await;
    assert_eq!(datastore.status, StatusCode::OK);
    assert!(
        datastore.body["token"]
            .as_str()
            .is_some_and(|t| !t.is_empty())
    );

    // Browser logout clears the cookie but leaves bearer tokens valid.
    let logout = send(
        &app,
        Method::POST,
        "/api/auth/logout",
        Some(&cookie_value),
        None,
        None,
    )
    .await;
    assert_eq!(logout.status, StatusCode::OK);
    assert_eq!(logout.body, json!("/"));
    assert_eq!(
        logout.set_cookie().as_deref(),
        Some("id=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/")
    );
    let still = send(
        &app,
        Method::GET,
        "/api/user",
        None,
        Some(&fixture.token),
        None,
    )
    .await;
    assert_eq!(still.status, StatusCode::OK);

    // Logging out everywhere invalidates cookies issued before the cutoff.
    let everywhere = send(
        &app,
        Method::POST,
        "/api/auth/logoutEverywhere",
        Some(&cookie_value),
        None,
        None,
    )
    .await;
    assert_eq!(everywhere.status, StatusCode::OK);
    let revoked = send(
        &app,
        Method::GET,
        "/api/user",
        Some(&cookie_value),
        None,
        None,
    )
    .await;
    assert_eq!(revoked.status, StatusCode::UNAUTHORIZED);
    tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    let relogin = send(
        &app,
        Method::POST,
        "/api/auth/login",
        None,
        None,
        Some(json!({"email": "login@example.test", "password": "secret"})),
    )
    .await;
    let fresh = relogin.cookie_value();
    assert_eq!(
        send(&app, Method::GET, "/api/user", Some(&fresh), None, None)
            .await
            .status,
        StatusCode::OK
    );

    // Deactivated identities cannot log in or keep using cookies.
    sqlx::query("UPDATE webknossos.users SET isDeactivated = TRUE WHERE _id = $1")
        .bind(&fixture.user_id)
        .execute(&database.pool)
        .await
        .unwrap();
    assert_eq!(
        send(&app, Method::GET, "/api/user", Some(&fresh), None, None)
            .await
            .status,
        StatusCode::UNAUTHORIZED
    );
    let deactivated = send(
        &app,
        Method::POST,
        "/api/auth/login",
        None,
        None,
        Some(json!({"email": "login@example.test", "password": "secret"})),
    )
    .await;
    assert_eq!(deactivated.body, error(INVALID_CREDENTIALS));
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn login_requires_configuration_and_enforces_required_email_verification() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    set_password(&database, &fixture.multi_user_id, "verify@example.test").await;
    let mailer = RecordingMailer::default();
    let body = json!({"email": "verify@example.test", "password": "secret"});

    let disabled = app(&database, BrowserAuthConfig::default(), &mailer);
    let response = send(
        &disabled,
        Method::POST,
        "/api/auth/login",
        None,
        None,
        Some(body.clone()),
    )
    .await;
    assert_eq!(response.status, StatusCode::SERVICE_UNAVAILABLE);
    // Without a signer secret cookies are ignored entirely.
    let cookie = CookieAuthenticator {
        id: "x".into(),
        provider_id: "credentials".into(),
        user_id: fixture.user_id.clone(),
        last_used: Utc::now(),
        expiration: Utc::now() + ChronoDuration::days(1),
        idle_timeout: None,
        cookie_max_age: None,
        fingerprint: None,
    };
    let unsigned_config = send(
        &disabled,
        Method::GET,
        "/api/user",
        Some(&cookie.serialize(SECRET)),
        None,
        None,
    )
    .await;
    assert_eq!(unsigned_config.status, StatusCode::UNAUTHORIZED);

    let required = BrowserAuthConfig {
        email_verification_activated: true,
        email_verification_required: true,
        ..config()
    };
    let app = app(&database, required, &mailer);
    // Within the grace period login succeeds without verification.
    let response = send(
        &app,
        Method::POST,
        "/api/auth/login",
        None,
        None,
        Some(body.clone()),
    )
    .await;
    assert_eq!(response.status, StatusCode::OK);
    assert!(mailer.take().is_empty());

    sqlx::query("UPDATE webknossos.multiUsers SET emailChangeDate = NOW() - INTERVAL '8 days' WHERE _id = $1")
        .bind(&fixture.multi_user_id).execute(&database.pool).await.unwrap();
    let response = send(
        &app,
        Method::POST,
        "/api/auth/login",
        None,
        None,
        Some(body.clone()),
    )
    .await;
    assert_eq!(
        (response.status, &response.body),
        (
            StatusCode::BAD_REQUEST,
            &error(
                "Your email address is not verified yet. A new verification email has been sent."
            )
        )
    );
    assert!(response.set_cookie().is_none());
    let mails = mailer.take();
    assert_eq!(mails.len(), 1);
    assert_eq!(mails[0].subject, "Verify Your Email at WEBKNOSSOS");
    assert_eq!(mails[0].recipients, vec!["verify@example.test".to_owned()]);
    let key: String = sqlx::query_scalar(
        "SELECT key FROM webknossos.emailVerificationKeys WHERE _multiUser = $1",
    )
    .bind(&fixture.multi_user_id)
    .fetch_one(&database.pool)
    .await
    .unwrap();
    assert!(
        mails[0]
            .body_html
            .contains(&format!("http://localhost:9000/verifyEmail/{key}"))
    );
    assert!(
        mails[0]
            .body_html
            .contains("This link will expire in 30 days.")
    );

    sqlx::query("UPDATE webknossos.multiUsers SET isEmailVerified = TRUE WHERE _id = $1")
        .bind(&fixture.multi_user_id)
        .execute(&database.pool)
        .await
        .unwrap();
    let response = send(
        &app,
        Method::POST,
        "/api/auth/login",
        None,
        None,
        Some(body),
    )
    .await;
    assert_eq!(response.status, StatusCode::OK);

    // SSO-only accounts (hasher Empty) never authenticate with a password.
    sqlx::query("UPDATE webknossos.multiUsers SET passwordInfo_hasher = 'Empty', passwordInfo_password = '' WHERE _id = $1")
        .bind(&fixture.multi_user_id).execute(&database.pool).await.unwrap();
    let response = send(
        &app,
        Method::POST,
        "/api/auth/login",
        None,
        None,
        Some(json!({"email": "verify@example.test", "password": "secret"})),
    )
    .await;
    assert_eq!(response.body, error(INVALID_CREDENTIALS));
    database.cleanup().await;
}
