//! Shared helpers for browser authentication integration tests.
#![allow(dead_code)]

use axum::{
    Router,
    body::Body,
    http::{HeaderMap, Method, Request, StatusCode, header},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{
    AppState,
    browser_auth::BrowserAuthConfig,
    mail::{MailSender, RecordingMailer},
    router_with_browser_auth,
};

use crate::common::TestDb;

pub const SECRET: &str = "rust-browser-auth-test-secret";
pub const USER_AGENT: &str = "Rust Test Browser/1.0";
/// at.favre BCrypt 2a/10 of "secret" (tests/fixtures/bcrypt_golden.tsv).
pub const SECRET_HASH: &str = "$2a$10$.umPE/6kJRO5OijOTz3jZ.QoDdRM.sUpE67egjpu7S/8C8/kEdsOy";

pub fn config() -> BrowserAuthConfig {
    BrowserAuthConfig {
        signer_secret: Some(SECRET.into()),
        ..BrowserAuthConfig::default()
    }
}

pub struct Response {
    pub status: StatusCode,
    pub headers: HeaderMap,
    pub body: Value,
}

impl Response {
    pub fn set_cookie(&self) -> Option<String> {
        self.headers
            .get(header::SET_COOKIE)
            .map(|v| v.to_str().unwrap().to_owned())
    }

    pub fn cookie_value(&self) -> String {
        let header = self.set_cookie().expect("Set-Cookie");
        header
            .split(';')
            .next()
            .unwrap()
            .split_once('=')
            .unwrap()
            .1
            .to_owned()
    }
}

pub async fn send(
    app: &Router,
    method: Method,
    path: &str,
    cookie: Option<&str>,
    token: Option<&str>,
    body: Option<Value>,
) -> Response {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header(header::USER_AGENT, USER_AGENT);
    if let Some(cookie) = cookie {
        request = request.header(header::COOKIE, format!("other=1; id={cookie}"));
    }
    if let Some(token) = token {
        request = request.header("x-auth-token", token);
    }
    let request = match body {
        Some(body) => request
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string())),
        None => request.body(Body::empty()),
    }
    .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).into_owned()))
    };
    Response {
        status,
        headers,
        body,
    }
}

pub fn app(database: &TestDb, config: BrowserAuthConfig, mailer: &RecordingMailer) -> Router {
    router_with_browser_auth(
        AppState {
            pool: database.pool.clone(),
        },
        config,
        MailSender::new(mailer.clone()),
    )
}

pub async fn set_password(database: &TestDb, multi_user_id: &str, email: &str) {
    sqlx::query(
        "UPDATE webknossos.multiUsers SET email = $2, passwordInfo_password = $3 WHERE _id = $1",
    )
    .bind(multi_user_id)
    .bind(email)
    .bind(SECRET_HASH)
    .execute(&database.pool)
    .await
    .unwrap();
}

pub fn error(message: &str) -> Value {
    json!({"messages":[{"error": message}]})
}

/// Organizations created by Play always have an organization team.
pub async fn seed_organization_team(database: &TestDb, organization_id: &str) -> String {
    let team = crate::common::object_id();
    sqlx::query("INSERT INTO webknossos.teams (_id, _organization, name, isOrganizationTeam) VALUES ($1, $2, 'Default', TRUE)")
        .bind(&team)
        .bind(organization_id)
        .execute(&database.pool)
        .await
        .unwrap();
    team
}

pub async fn make_superuser(database: &TestDb, multi_user_id: &str) {
    sqlx::query("UPDATE webknossos.multiUsers SET isSuperUser = TRUE WHERE _id = $1")
        .bind(multi_user_id)
        .execute(&database.pool)
        .await
        .unwrap();
}

pub fn messages(errors: &[&str]) -> Value {
    json!({"messages": errors.iter().map(|e| json!({"error": e})).collect::<Vec<_>>()})
}

pub fn sign_up(email: &str, first: &str, last: &str, extra: Value) -> Value {
    let mut body = json!({
        "organization": "",
        "organizationName": "",
        "email": email,
        "password": {"password1": "secret-password", "password2": "secret-password"},
        "firstName": first,
        "lastName": last,
    });
    if let (Some(body), Some(extra)) = (body.as_object_mut(), extra.as_object()) {
        for (key, value) in extra {
            body.insert(key.clone(), value.clone());
        }
    }
    body
}
