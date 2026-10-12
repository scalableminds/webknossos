//! OIDC (/auth/oidc/login, /auth/oidc/callback) and Discourse SSO (/auth/sso)
//! against a mock OpenID provider signing with a test-only RSA key.
mod common;

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    Json, Router,
    body::{Body, Bytes},
    extract::State,
    http::{HeaderMap, Request, StatusCode, header},
    routing::{get, post},
};
use base64::{
    Engine,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};
use common::TestDb;
use http_body_util::BodyExt;
use ring::{
    hmac, rand,
    signature::{self, RsaKeyPair, RsaPublicKeyComponents},
};
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{
    AppState,
    auth_oidc::OidcConfig,
    browser_auth::BrowserAuthConfig,
    config::{Config, DatabaseConfig},
    router_with_config,
};

/// Test-only 2048-bit RSA key (PKCS#8 DER, base64). Never used outside tests.
const TEST_KEY_PKCS8: &str = "
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC4g0COxmQ4OgqM/lJur4VrujzJ3lpJd6aJyAXz9yGokHpqHtW9
lTIraDTDA2Cfz+/3g8WvTTuUTiFA92pAxlgvGT9pQFkVov43zZ500LoivvlrfnsY3wMVlbenrniWX45yPpQdKRce15kVKzol2HVr
Vk9KrmlmkRDLOLyN8wUB3CO9aM8qnO5e7cB30L6+Ok4ZxJ80/J0tosfk/FPFezYOiFfOnZkUaWzYW3/XmS0qFiTvrDoW5ukroFzt
a2e3X9glbhktviLZKfQPq/DeJl+DgSyUsNWeqDmRzPBJt+mAhtKIEm96upcvD+BsmycosCdlr+D9wAIlvIeyE09ykDshAgMBAAEC
ggEAHBz3famRxJVnXSM06SN6NzdJotJrvEzsRYsCCTGK4dWdqUSoeXndioqWm24Mz1zN6c8clEC2xrp+y5jHCjaOYiK9LCq/SBIt
HNCKB69z5O5nL282j0wPer70nCpzuim2GQca5zSHDs53xydudSy9e0zLyQu5CIUq42PyKsiv5x/i4Q7LSZ013Y6lgJ0zt1q6bKXK
MuSr/ZxjkGj7Sy6PPFBRNXQuEERsn3cUAxxbWXP3oZytzOTbtdw0G6+RZPUB1KradMbmn8J6ThtUu8NqYh9wUHn8I5xRZ8uySbXt
2MpPgtZn5uNu4LvAbFBMjQrQLbMbGpAbCkQvpddsuwyb5wKBgQDapz/dCw4dOhE4tcZjwZ8uiDvVVtvTzemEQeJW9Q1ddoAP5h/y
U/UXvENK9ljUU8HRmalfzzwtM72XjUaEnIffwSrZDZtNw1xpWSRmQrCaZmiVuGFpImqDFDf2MV0suO9IfNturChBKB1I7GuL9lqS
s7fuFlmTGnmWktpjMhTT7wKBgQDYBy7y6FXgmKoMlx5bVNZ0EmGbJu2a36gBgtyRh/65TpSa+n2we4DpCgCbrhvKGCUMZVjXjDd3
gu5l9PNXWyGhnj/P22TGEgtghl3VdyQjMDNHei0hjufxepEkXEMCPOqb2FPDDV/F0FMFoufjxEcDZWvl44K/VIBH8Qj+CCyR7wKB
gQDGLaDssABy7RZ+2AKgl/W3LzNMAhXsu01T2oNTXXhnpegcgO+jrAURJkm3v+BzUhbx6txhQmvAbI0Ct8GaoGVmoKY9ZN/Gc7Nm
qK0dIoT+7KMOULe5mr//Xmv6cHOK/XOjt8cLYG573+frGJ3BleAx50JmQUue0PgzSZc3IUVPcQKBgD36AZwqz8h5w/+Ms2bcdhIi
2+HZTz2pgNe+JW2TKJ8dTkEQMFMbe6Zf+kCvuMVIHAjsYoqkbZ1Z8O9LUSz0tjdZ4VDOzqCMuLrekbkWT0XRJEUTZjNEfoKm+VEH
LypLM7u2WoGRKrLjy43IaOLNgtoUlNoFZZNiuNLq8ft/eNn9AoGBANTlUTUDXEYsyENjmzQ7QRLn6YuUDuxzR5ZxBWQ/KhUTpiFx
eHaVZ3tIr+5zhoFdHhRwHRybHuDV1sV8UOxmKa+1VRLY7v/W9eqJ9RRQWPWzQDqoIFqvP5JcrdXVj1OeAaoYgRJUXZJfex1ks2gU
yc3CO8G1P8JR7TOks5Q8jMQR";

const CLIENT_ID: &str = "wk-client";
const CLIENT_SECRET: &str = "wk-secret";
const SSO_KEY: &str = "discourse-test-key";
const SIGNER_SECRET: &str = "rust-oidc-test-cookie-secret";
const AUTH_FAILED: &str = "Could not register or log in via single sign-on (SSO/OIDC).";
const CALLBACK: &str = "http://localhost:9000/api/auth/oidc/callback";

fn key_pair() -> RsaKeyPair {
    let der = STANDARD
        .decode(TEST_KEY_PKCS8.split_whitespace().collect::<String>())
        .unwrap();
    RsaKeyPair::from_pkcs8(&der).unwrap()
}

fn jwk() -> Value {
    let components: RsaPublicKeyComponents<Vec<u8>> = key_pair().public().into();
    json!({
        "kty": "RSA", "alg": "RS256", "use": "sig", "kid": "test",
        "n": URL_SAFE_NO_PAD.encode(&components.n),
        "e": URL_SAFE_NO_PAD.encode(&components.e),
    })
}

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

fn sign_jwt(header: Value, claims: Value) -> String {
    let message = format!(
        "{}.{}",
        URL_SAFE_NO_PAD.encode(header.to_string()),
        URL_SAFE_NO_PAD.encode(claims.to_string())
    );
    let key = key_pair();
    let mut sig = vec![0; key.public().modulus_len()];
    let encoding = match header["alg"].as_str() {
        Some("RS512") => &signature::RSA_PKCS1_SHA512,
        _ => &signature::RSA_PKCS1_SHA256,
    };
    key.sign(
        encoding,
        &rand::SystemRandom::new(),
        message.as_bytes(),
        &mut sig,
    )
    .unwrap();
    format!("{message}.{}", URL_SAFE_NO_PAD.encode(sig))
}

fn jwt(claims: Value) -> String {
    sign_jwt(json!({"alg": "RS256", "typ": "JWT", "kid": "test"}), claims)
}

fn access_claims() -> Value {
    json!({"sub": "abc", "aud": "account", "exp": now() + 300, "iat": now()})
}

fn id_claims(email: &str) -> Value {
    json!({
        "sub": "abc", "aud": CLIENT_ID, "iss": "http://provider", "exp": now() + 300, "iat": now(),
        "given_name": "Ada", "family_name": "Lovelace Byron", "email": email,
    })
}

#[derive(Default)]
struct ProviderState {
    base: String,
    token_response: Value,
    jwks: Value,
    token_requests: Vec<(HashMap<String, String>, Option<String>)>,
}

type Provider = Arc<Mutex<ProviderState>>;

async fn discovery(State(p): State<Provider>) -> Json<Value> {
    let base = p.lock().unwrap().base.clone();
    Json(json!({
        "issuer": base,
        "authorization_endpoint": format!("{base}protocol/openid-connect/auth"),
        "token_endpoint": format!("{base}protocol/openid-connect/token"),
        "userinfo_endpoint": format!("{base}protocol/openid-connect/userinfo"),
        "jwks_uri": format!("{base}protocol/openid-connect/certs"),
    }))
}

async fn certs(State(p): State<Provider>) -> Json<Value> {
    Json(p.lock().unwrap().jwks.clone())
}

async fn token(State(p): State<Provider>, headers: HeaderMap, body: Bytes) -> Json<Value> {
    let form = url::form_urlencoded::parse(&body).into_owned().collect();
    let auth = headers
        .get(header::AUTHORIZATION)
        .map(|v| v.to_str().unwrap().to_owned());
    let mut state = p.lock().unwrap();
    state.token_requests.push((form, auth));
    Json(state.token_response.clone())
}

async fn provider() -> Provider {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}/realms/test/", listener.local_addr().unwrap());
    let state = Arc::new(Mutex::new(ProviderState {
        base,
        jwks: json!({"keys": [
            {"kty": "RSA", "alg": "RSA-OAEP", "use": "enc", "n": "AQAB", "e": "AQAB"},
            jwk(),
        ]}),
        ..Default::default()
    }));
    let app = Router::new()
        .route(
            "/realms/test/.well-known/openid-configuration",
            get(discovery),
        )
        .route("/realms/test/protocol/openid-connect/certs", get(certs))
        .route("/realms/test/protocol/openid-connect/token", post(token))
        .with_state(state.clone());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    state
}

fn oidc_config(provider_url: &str) -> OidcConfig {
    OidcConfig {
        enabled: true,
        provider_url: provider_url.to_owned(),
        client_id: CLIENT_ID.into(),
        client_secret: Some(CLIENT_SECRET.into()),
        sso_key: SSO_KEY.into(),
        ..OidcConfig::default()
    }
}

fn app(db: &TestDb, oidc: OidcConfig) -> Router {
    let config = Config {
        bind: "127.0.0.1:0".parse().unwrap(),
        database: DatabaseConfig {
            url: db.connection_url(),
            min_connections: 0,
            max_connections: 5,
            acquire_timeout: Duration::from_secs(5),
        },
        public_url: "http://localhost:9000".parse().unwrap(),
        email_verification_enabled: true,
        jobs_enabled: false,
        jobs: Default::default(),
        annotation_mutex_expiry: Duration::from_secs(120),
        time_tracking: Default::default(),
        auth_routes: Default::default(),
        browser_auth: BrowserAuthConfig {
            signer_secret: Some(SIGNER_SECRET.into()),
            ..BrowserAuthConfig::default()
        },
        service_client: Default::default(),
        allow_delete_datasets: true,
        datasets: Default::default(),
        request_timeout: Duration::from_secs(30),
        shutdown_timeout: Duration::from_secs(1),
        body_limit: 2 * 1024 * 1024,
        misc: Default::default(),
        voxelytics: Default::default(),
        oidc,
        mail: Default::default(),
        housekeeping: Default::default(),
        slack: Default::default(),
        credit_ticker: Default::default(),
        used_storage: Default::default(),
        worker_liveness: Default::default(),
    };
    router_with_config(
        AppState {
            pool: db.pool.clone(),
        },
        &config,
    )
}

struct Reply {
    status: StatusCode,
    headers: HeaderMap,
    text: String,
}

impl Reply {
    fn json(&self) -> Value {
        serde_json::from_str(&self.text).unwrap()
    }
    fn location(&self) -> &str {
        self.headers[header::LOCATION].to_str().unwrap()
    }
    fn cookie(&self) -> String {
        let set = self.headers[header::SET_COOKIE].to_str().unwrap();
        set.split(';')
            .next()
            .unwrap()
            .split_once('=')
            .unwrap()
            .1
            .to_owned()
    }
}

async fn send(app: &Router, path: &str, cookie: Option<&str>, token: Option<&str>) -> Reply {
    let mut request = Request::get(path).header(header::USER_AGENT, "oidc-test");
    if let Some(cookie) = cookie {
        request = request.header(header::COOKIE, format!("id={cookie}"));
    }
    if let Some(token) = token {
        request = request.header("x-auth-token", token);
    }
    let response = app
        .clone()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    Reply {
        status,
        headers,
        text: String::from_utf8_lossy(&bytes).into_owned(),
    }
}

fn error(message: &str) -> Value {
    json!({"messages": [{"error": message}]})
}

async fn seed_organization_team(db: &TestDb, organization_id: &str) -> String {
    let team = common::object_id();
    sqlx::query("INSERT INTO webknossos.teams (_id, _organization, name, isOrganizationTeam) VALUES ($1, $2, 'Default', TRUE)")
        .bind(&team)
        .bind(organization_id)
        .execute(&db.pool)
        .await
        .unwrap();
    team
}

async fn multi_user_count(db: &TestDb) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM webknossos.multiUsers")
        .fetch_one(&db.pool)
        .await
        .unwrap()
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn disabled_and_invalid_configuration_fail_like_play() {
    let db = TestDb::new().await;
    let p = provider().await;
    let base = p.lock().unwrap().base.clone();
    let disabled = app(
        &db,
        OidcConfig {
            enabled: false,
            ..oidc_config(&base)
        },
    );
    let login = send(&disabled, "/api/auth/oidc/login", None, None).await;
    assert_eq!(login.status, StatusCode::BAD_REQUEST);
    assert_eq!(login.text, "SSO is not enabled");
    let callback = send(&disabled, "/api/auth/oidc/callback?code=x", None, None).await;
    assert_eq!(callback.status, StatusCode::BAD_REQUEST);
    assert_eq!(callback.json(), error("SSO is not enabled"));
    assert!(p.lock().unwrap().token_requests.is_empty());

    let invalid = app(&db, oidc_config(""));
    let login = send(&invalid, "/api/auth/oidc/login", None, None).await;
    assert_eq!(login.status, StatusCode::BAD_REQUEST);
    assert_eq!(login.json(), error("SSO/OIDC configuration is invalid."));
    let callback = send(&invalid, "/api/auth/oidc/callback?code=x", None, None).await;
    assert_eq!(callback.json(), error(AUTH_FAILED));

    let unreachable = app(&db, oidc_config("http://127.0.0.1:9/realms/none/"));
    let login = send(&unreachable, "/api/auth/oidc/login", None, None).await;
    assert_eq!(login.status, StatusCode::BAD_REQUEST);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn login_returns_authorization_url_without_state_like_play() {
    let db = TestDb::new().await;
    let p = provider().await;
    let base = p.lock().unwrap().base.clone();
    let app = app(&db, oidc_config(&base));
    let login = send(&app, "/api/auth/oidc/login", None, None).await;
    assert_eq!(login.status, StatusCode::OK);
    let expected = format!(
        "{base}protocol/openid-connect/auth?client_id=wk-client&redirect_uri=http%3A%2F%2Flocalhost%3A9000%2Fapi%2Fauth%2Foidc%2Fcallback&scope=openid+profile+email&response_type=code"
    );
    assert_eq!(login.json(), json!({ "redirect_url": expected }));
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn callback_creates_new_user_and_logs_in_existing_users() {
    let db = TestDb::new().await;
    let fixture = db.fixture().await;
    let org_team = seed_organization_team(&db, &fixture.organization_id).await;
    let p = provider().await;
    let base = p.lock().unwrap().base.clone();
    let app = app(&db, oidc_config(&base));

    // New user from id token claims; `state` is ignored as in Play.
    p.lock().unwrap().token_response = json!({
        "access_token": jwt(access_claims()),
        "id_token": jwt(id_claims("ada@example.test")),
        "token_type": "Bearer",
        "scope": "openid profile email",
    });
    let reply = send(
        &app,
        "/api/auth/oidc/callback?state=whatever&code=auth%2Bcode",
        None,
        None,
    )
    .await;
    assert_eq!(reply.status, StatusCode::SEE_OTHER, "{}", reply.text);
    assert_eq!(reply.location(), "/dashboard");
    let cookie = reply.cookie();
    {
        let state = p.lock().unwrap();
        let (form, auth) = &state.token_requests[0];
        assert_eq!(form["grant_type"], "authorization_code");
        assert_eq!(form["client_id"], CLIENT_ID);
        assert_eq!(form["redirect_uri"], CALLBACK);
        assert_eq!(form["code"], "auth+code");
        assert_eq!(form["scope"], "openid profile email");
        let expected = format!("Basic {}", STANDARD.encode("wk-client:wk-secret"));
        assert_eq!(auth.as_deref(), Some(expected.as_str()));
    }
    let (user_id, hasher, verified, deactivated, admin, owner, org, first, last): (
        String,
        String,
        bool,
        bool,
        bool,
        bool,
        String,
        String,
        String,
    ) = sqlx::query_as(
        "SELECT u._id, m.passwordInfo_hasher::text, m.isEmailVerified, u.isDeactivated, u.isAdmin, u.isOrganizationOwner, u._organization, m.firstName, m.lastName FROM webknossos.users u JOIN webknossos.multiUsers m ON m._id = u._multiUser WHERE m.email = 'ada@example.test'",
    )
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(hasher, "Empty");
    assert!(verified && !deactivated && !admin && !owner);
    assert_eq!(org, fixture.organization_id);
    assert_eq!((first.as_str(), last.as_str()), ("Ada", "Lovelace Byron"));
    let teams: Vec<String> =
        sqlx::query_scalar("SELECT _team FROM webknossos.user_team_roles WHERE _user = $1")
            .bind(&user_id)
            .fetch_all(&db.pool)
            .await
            .unwrap();
    assert_eq!(teams, vec![org_team]);
    let me = send(&app, "/api/user", Some(&cookie), None).await;
    assert_eq!(me.status, StatusCode::OK, "{}", me.text);
    assert_eq!(me.json()["id"], user_id);

    // Second login of the same account: no new user, missing code forwarded literally.
    let users = multi_user_count(&db).await;
    let reply = send(&app, "/api/auth/oidc/callback", None, None).await;
    assert_eq!(reply.status, StatusCode::SEE_OTHER);
    assert_eq!(multi_user_count(&db).await, users);
    assert_eq!(
        p.lock().unwrap().token_requests[1].0["code"],
        "missing code"
    );

    // Existing (password) user; user info from the access token when no id token is returned.
    let email: String =
        sqlx::query_scalar("SELECT email FROM webknossos.multiUsers WHERE _id = $1")
            .bind(&fixture.multi_user_id)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    let mut claims = id_claims(&email);
    claims["aud"] = json!("account");
    p.lock().unwrap().token_response = json!({"access_token": jwt(claims), "token_type": "Bearer"});
    let reply = send(&app, "/api/auth/oidc/callback?code=c", None, None).await;
    assert_eq!(reply.status, StatusCode::SEE_OTHER, "{}", reply.text);
    let me = send(&app, "/api/user", Some(&reply.cookie()), None).await;
    assert_eq!(me.json()["id"], fixture.user_id);
    assert_eq!(multi_user_count(&db).await, users);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn callback_rejects_invalid_tokens() {
    let db = TestDb::new().await;
    let fixture = db.fixture().await;
    seed_organization_team(&db, &fixture.organization_id).await;
    let p = provider().await;
    let base = p.lock().unwrap().base.clone();
    let app = app(&db, oidc_config(&base));
    let users = multi_user_count(&db).await;

    let good_id = jwt(id_claims("eve@example.test"));
    let mut tampered = good_id.clone();
    tampered.pop();
    tampered.push(if good_id.ends_with('A') { 'B' } else { 'A' });
    let (head, rest) = good_id.split_once('.').unwrap();
    let forged_claims = {
        let mut claims = id_claims("eve@example.test");
        claims["email"] = json!("admin@example.test");
        URL_SAFE_NO_PAD.encode(claims.to_string())
    };
    let swapped = format!("{head}.{forged_claims}.{}", rest.split_once('.').unwrap().1);
    let with = |field: &str, value: Value| {
        let mut claims = id_claims("eve@example.test");
        claims[field] = value;
        jwt(claims)
    };
    let hs256 = {
        let message = format!(
            "{}.{}",
            URL_SAFE_NO_PAD.encode(json!({"alg": "HS256"}).to_string()),
            URL_SAFE_NO_PAD.encode(id_claims("eve@example.test").to_string())
        );
        let key = hmac::Key::new(hmac::HMAC_SHA256, b"public-key-confusion");
        format!(
            "{message}.{}",
            URL_SAFE_NO_PAD.encode(hmac::sign(&key, message.as_bytes()))
        )
    };
    let unsigned = format!(
        "{}.{}.",
        URL_SAFE_NO_PAD.encode(json!({"alg": "none"}).to_string()),
        URL_SAFE_NO_PAD.encode(id_claims("eve@example.test").to_string())
    );
    let expired_access = jwt(json!({"exp": now() - 1}));
    let cases: Vec<(&str, String, Option<String>)> = vec![
        ("tampered signature", jwt(access_claims()), Some(tampered)),
        ("swapped claims", jwt(access_claims()), Some(swapped)),
        (
            "wrong audience",
            jwt(access_claims()),
            Some(with("aud", json!("other-client"))),
        ),
        (
            "missing audience",
            jwt(access_claims()),
            Some(with("aud", Value::Null)),
        ),
        (
            "expired id token",
            jwt(access_claims()),
            Some(with("exp", json!(now() - 1))),
        ),
        (
            "not yet valid",
            jwt(access_claims()),
            Some(with("nbf", json!(now() + 600))),
        ),
        (
            "non-numeric exp",
            jwt(access_claims()),
            Some(with("exp", json!("tomorrow"))),
        ),
        ("hs256", jwt(access_claims()), Some(hs256)),
        ("alg none", jwt(access_claims()), Some(unsigned)),
        (
            "expired access token",
            expired_access,
            Some(good_id.clone()),
        ),
        (
            "opaque access token",
            "opaque".into(),
            Some(good_id.clone()),
        ),
    ];
    for (name, access, id) in cases {
        p.lock().unwrap().token_response =
            json!({"access_token": access, "id_token": id, "token_type": "Bearer"});
        let reply = send(&app, "/api/auth/oidc/callback?code=c", None, None).await;
        assert_eq!(reply.status, StatusCode::BAD_REQUEST, "{name}");
        assert_eq!(reply.json(), error(AUTH_FAILED), "{name}");
        assert!(!reply.headers.contains_key(header::SET_COOKIE), "{name}");
    }

    // No signing key in the JWKS (Play: first kty=RSA, use=sig key only).
    p.lock().unwrap().token_response =
        json!({"access_token": jwt(access_claims()), "id_token": good_id, "token_type": "Bearer"});
    p.lock().unwrap().jwks = json!({"keys": [{"kty": "RSA", "alg": "RS256", "use": "enc", "n": jwk()["n"], "e": "AQAB"}]});
    let reply = send(&app, "/api/auth/oidc/callback?code=c", None, None).await;
    assert_eq!(reply.json(), error(AUTH_FAILED));
    // Play's JsonWebKey format requires `alg` on every key.
    let mut no_alg = jwk();
    no_alg.as_object_mut().unwrap().remove("alg");
    p.lock().unwrap().jwks = json!({ "keys": [no_alg] });
    let reply = send(&app, "/api/auth/oidc/callback?code=c", None, None).await;
    assert_eq!(reply.json(), error(AUTH_FAILED));

    // Valid tokens without the required user info claims.
    p.lock().unwrap().jwks = json!({ "keys": [jwk()] });
    let mut claims = id_claims("eve@example.test");
    claims.as_object_mut().unwrap().remove("family_name");
    p.lock().unwrap().token_response = json!({"access_token": jwt(access_claims()), "id_token": jwt(claims), "token_type": "Bearer"});
    let reply = send(&app, "/api/auth/oidc/callback?code=c", None, None).await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        reply.json(),
        error("Failed to extract user info from id token or access token")
    );
    assert_eq!(multi_user_count(&db).await, users);

    // Sanity: the same provider state with a valid RS512 id token succeeds.
    p.lock().unwrap().token_response = json!({
        "access_token": jwt(access_claims()),
        "id_token": sign_jwt(json!({"alg": "RS512"}), id_claims("eve@example.test")),
        "token_type": "Bearer",
    });
    let reply = send(&app, "/api/auth/oidc/callback?code=c", None, None).await;
    assert_eq!(reply.status, StatusCode::SEE_OTHER, "{}", reply.text);
    assert_eq!(multi_user_count(&db).await, users + 1);
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn callback_requires_a_single_default_organization() {
    let db = TestDb::new().await;
    let fixture = db.fixture().await;
    seed_organization_team(&db, &fixture.organization_id).await;
    db.seed_user(&common::object_id(), "second-orga", false)
        .await;
    let p = provider().await;
    let base = p.lock().unwrap().base.clone();
    let app = app(&db, oidc_config(&base));
    p.lock().unwrap().token_response = json!({
        "access_token": jwt(access_claims()),
        "id_token": jwt(id_claims("new@example.test")),
        "token_type": "Bearer",
    });
    let users = multi_user_count(&db).await;
    let reply = send(&app, "/api/auth/oidc/callback?code=c", None, None).await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);
    assert!(!reply.headers.contains_key(header::SET_COOKIE));
    assert_eq!(multi_user_count(&db).await, users);
    db.cleanup().await;
}

fn discourse_sign(value: &str) -> String {
    let key = hmac::Key::new(hmac::HMAC_SHA256, SSO_KEY.as_bytes());
    hmac::sign(&key, value.as_bytes())
        .as_ref()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn sso_path(payload: &str, sig: Option<&str>) -> String {
    let sso = STANDARD.encode(payload);
    let sig = sig.map_or_else(|| discourse_sign(&sso), str::to_owned);
    format!(
        "/api/auth/sso?sso={}&sig={sig}",
        url::form_urlencoded::byte_serialize(sso.as_bytes()).collect::<String>()
    )
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn discourse_single_sign_on() {
    let db = TestDb::new().await;
    let fixture = db.fixture().await;
    sqlx::query("UPDATE webknossos.multiUsers SET email = 'grace@example.test', firstName = 'Grace Brewster', lastName = 'Mc Hopper' WHERE _id = $1")
        .bind(&fixture.multi_user_id)
        .execute(&db.pool)
        .await
        .unwrap();
    // The SSO endpoint does not depend on the OIDC feature flag.
    let app = app(
        &db,
        OidcConfig {
            sso_key: SSO_KEY.into(),
            ..OidcConfig::default()
        },
    );
    let payload = "nonce=n%2B1&return_sso_url=https%3A%2F%2Fdiscuss.example%2Fsession%2Fsso_login";

    let anonymous = send(&app, &sso_path(payload, None), None, None).await;
    assert_eq!(anonymous.status, StatusCode::SEE_OTHER);
    assert_eq!(
        anonymous.location(),
        "/auth/login?redirectPage=http://discuss.webknossos.org"
    );

    let bad = send(
        &app,
        &sso_path(payload, Some("00")),
        None,
        Some(&fixture.token),
    )
    .await;
    assert_eq!(bad.status, StatusCode::BAD_REQUEST);
    assert_eq!(bad.text, "Invalid signature");

    let missing = send(
        &app,
        &sso_path("return_sso_url=x", None),
        None,
        Some(&fixture.token),
    )
    .await;
    assert_eq!(missing.json(), error("Nonce is missing"));
    let missing = send(&app, &sso_path("nonce=1", None), None, Some(&fixture.token)).await;
    assert_eq!(missing.json(), error("Return url is missing"));

    let ok = send(&app, &sso_path(payload, None), None, Some(&fixture.token)).await;
    assert_eq!(ok.status, StatusCode::SEE_OTHER, "{}", ok.text);
    let location = url::Url::parse(ok.location()).unwrap();
    assert_eq!(
        &location.as_str()[..location.as_str().find('?').unwrap()],
        "https://discuss.example/session/sso_login"
    );
    let query: HashMap<String, String> = location.query_pairs().into_owned().collect();
    assert_eq!(query["sig"], discourse_sign(&query["sso"]));
    let returned = String::from_utf8(STANDARD.decode(&query["sso"]).unwrap()).unwrap();
    assert_eq!(
        returned,
        format!(
            "nonce=n+1&email=grace%40example.test&external_id={}&username=gmc_hopper&name=Grace+Brewster+Mc+Hopper",
            fixture.user_id
        )
    );

    let missing_param = send(&app, "/api/auth/sso?sso=abc", None, None).await;
    assert_eq!(missing_param.status, StatusCode::BAD_REQUEST);

    let unconfigured = app_without_sso_key(&db);
    let reply = send(
        &unconfigured,
        &sso_path(payload, None),
        None,
        Some(&fixture.token),
    )
    .await;
    assert_eq!(reply.status, StatusCode::INTERNAL_SERVER_ERROR);
    db.cleanup().await;
}

fn app_without_sso_key(db: &TestDb) -> Router {
    app(db, OidcConfig::default())
}
