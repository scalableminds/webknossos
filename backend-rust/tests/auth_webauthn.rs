mod browser_auth_support;
mod common;

use axum::{
    Extension, Router,
    body::Body,
    http::{Method, Request, StatusCode, header},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use common::{TestDb, object_id};
use http_body_util::BodyExt;
use ring::{
    digest::{SHA256, digest},
    rand::SystemRandom,
    signature::{ECDSA_P256_SHA256_ASN1_SIGNING, EcdsaKeyPair, KeyPair},
};
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{
    AppState,
    application_info::{MiscConfig, MiscState},
    auth_webauthn,
    mail::{MailSender, RecordingMailer},
};

/// _id, credentialId, name, UV, BE, BS, statement, attested, extensions, count, deleted.
type CredentialRow = (
    String,
    Vec<u8>,
    String,
    bool,
    bool,
    bool,
    Value,
    Vec<u8>,
    Value,
    i32,
    bool,
);

const PUBLIC_URI: &str = "https://wk.example.org";
const RP_ID: &str = "wk.example.org";

fn app(database: &TestDb, public_uri: &str, enabled: bool) -> Router {
    let mut misc = MiscConfig {
        public_uri: public_uri.into(),
        ..MiscConfig::default()
    };
    misc.features
        .insert("passkeysEnabled".into(), Value::Bool(enabled));
    Router::new()
        .nest("/api", auth_webauthn::router())
        .layer(Extension(MiscState::new(misc)))
        .with_state(AppState {
            pool: database.pool.clone(),
        })
}

struct Reply {
    status: StatusCode,
    body: Value,
    set_cookie: Option<String>,
}

async fn post(
    app: &Router,
    path: &str,
    token: Option<&str>,
    cookie: Option<&str>,
    body: Value,
) -> Reply {
    let mut request = Request::builder()
        .method("POST")
        .uri(path)
        .header(header::CONTENT_TYPE, "application/json");
    if let Some(token) = token {
        request = request.header("x-auth-token", token);
    }
    if let Some(cookie) = cookie {
        request = request.header(header::COOKIE, format!("webauthn-registration={cookie}"));
    }
    let response = app
        .clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let set_cookie = response
        .headers()
        .get(header::SET_COOKIE)
        .map(|v| v.to_str().unwrap().to_owned());
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap()
    };
    Reply {
        status,
        body,
        set_cookie,
    }
}

fn error(message: &str) -> Value {
    json!({"messages": [{"error": message}]})
}

// Tiny CBOR encoder for building authenticator responses.
fn head(major: u8, len: usize) -> Vec<u8> {
    match len {
        0..=23 => vec![(major << 5) | len as u8],
        24..=255 => vec![(major << 5) | 24, len as u8],
        _ => vec![(major << 5) | 25, (len >> 8) as u8, len as u8],
    }
}
fn int(v: i64) -> Vec<u8> {
    if v >= 0 {
        head(0, v as usize)
    } else {
        head(1, (-1 - v) as usize)
    }
}
fn bstr(b: &[u8]) -> Vec<u8> {
    [head(2, b.len()), b.to_vec()].concat()
}
fn tstr(s: &str) -> Vec<u8> {
    [head(3, s.len()), s.as_bytes().to_vec()].concat()
}

struct Authenticator {
    credential_id: Vec<u8>,
    x: Vec<u8>,
    y: Vec<u8>,
    pair: EcdsaKeyPair,
}

impl Authenticator {
    fn new(credential_id: &[u8]) -> Self {
        let rng = SystemRandom::new();
        let pkcs8 = EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_ASN1_SIGNING, &rng).unwrap();
        let pair = EcdsaKeyPair::from_pkcs8(&ECDSA_P256_SHA256_ASN1_SIGNING, pkcs8.as_ref(), &rng)
            .unwrap();
        let point = pair.public_key().as_ref();
        Self {
            credential_id: credential_id.to_vec(),
            x: point[1..33].to_vec(),
            y: point[33..65].to_vec(),
            pair,
        }
    }

    /// COSE key as an authenticator sends it (canonical CTAP2 order).
    fn cose_key(&self) -> Vec<u8> {
        [
            head(5, 5),
            int(1),
            int(2),
            int(3),
            int(-7),
            int(-1),
            int(1),
            int(-2),
            bstr(&self.x),
            int(-3),
            bstr(&self.y),
        ]
        .concat()
    }

    /// What webauthn4j stores as serializedAttestedCredential.
    fn stored_attested_credential(&self) -> Vec<u8> {
        let mut out = vec![0u8; 16];
        out.extend((self.credential_id.len() as u16).to_be_bytes());
        out.extend(&self.credential_id);
        out.extend(self.cose_key());
        out
    }

    fn registration(&self, options: &Value, tweak: Tweak) -> Value {
        let rp_id = tweak.rp_id.unwrap_or(RP_ID);
        let mut auth_data = digest(&SHA256, rp_id.as_bytes()).as_ref().to_vec();
        auth_data.push(tweak.flags.unwrap_or(0x45));
        auth_data.extend(3u32.to_be_bytes());
        auth_data.extend(self.stored_attested_credential());
        let fmt = tweak.fmt.unwrap_or("none");
        let attestation = [
            head(5, 3),
            tstr("fmt"),
            tstr(fmt),
            tstr("attStmt"),
            head(5, 0),
            tstr("authData"),
            bstr(&auth_data),
        ]
        .concat();
        let challenge = tweak
            .challenge
            .unwrap_or_else(|| options["challenge"].as_str().unwrap().to_owned());
        let client_data = json!({
            "type": "webauthn.create",
            "challenge": challenge,
            "origin": tweak.origin.unwrap_or(PUBLIC_URI),
            "crossOrigin": false,
        });
        let id = URL_SAFE_NO_PAD.encode(&self.credential_id);
        json!({
            "name": "My laptop",
            "key": {
                "id": id,
                "rawId": id,
                "type": "public-key",
                "response": {
                    "clientDataJSON": URL_SAFE_NO_PAD.encode(client_data.to_string()),
                    "attestationObject": URL_SAFE_NO_PAD.encode(attestation),
                    "transports": ["internal"],
                },
                "clientExtensionResults": {},
                "authenticatorAttachment": "platform",
            },
        })
    }
}

#[derive(Default)]
struct Tweak {
    rp_id: Option<&'static str>,
    origin: Option<&'static str>,
    challenge: Option<String>,
    flags: Option<u8>,
    fmt: Option<&'static str>,
}

fn session_of(reply: &Reply) -> String {
    let cookie = reply.set_cookie.as_deref().expect("Set-Cookie");
    cookie
        .strip_prefix("webauthn-registration=")
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned()
}

async fn start(app: &Router, token: &str) -> (Value, String) {
    let reply = post(
        app,
        "/api/auth/webauthn/register/start",
        Some(token),
        None,
        Value::Null,
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.body);
    let session = session_of(&reply);
    (reply.body, session)
}

async fn finalize(app: &Router, token: &str, session: &str, body: Value) -> Reply {
    post(
        app,
        "/api/auth/webauthn/register/finalize",
        Some(token),
        Some(session),
        body,
    )
    .await
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn start_returns_scala_creation_options_and_feature_gates() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    let token = fixture.token.as_str();

    for (app, message) in [
        (
            app(&database, PUBLIC_URI, false),
            "Passkeys are not enabled for this WEBKNOSSOS instance.",
        ),
        (
            app(&database, "http://wk.example.org", true),
            "Passkeys are only supported with HTTPS.",
        ),
    ] {
        for path in [
            "/api/auth/webauthn/register/start",
            "/api/auth/webauthn/register/finalize",
        ] {
            let body = json!({"name": "x", "key": {}});
            let reply = post(&app, path, Some(token), Some("s"), body).await;
            assert_eq!(
                (reply.status, reply.body),
                (StatusCode::BAD_REQUEST, error(message))
            );
        }
    }

    let app = app(&database, PUBLIC_URI, true);
    let anonymous = post(
        &app,
        "/api/auth/webauthn/register/start",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(anonymous.status, StatusCode::UNAUTHORIZED);

    // A credential row as Scala/webauthn4j wrote it (oracle bytes) is listed.
    let scala_credential = "0000000000000000000000000000000000100102030405060708090a0b0c0d0e0f10a50102032620012158206b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2962258204fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5";
    let scala_bytes: Vec<u8> = (0..scala_credential.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&scala_credential[i..i + 2], 16).unwrap())
        .collect();
    sqlx::query("INSERT INTO webknossos.webauthnCredentials (_id, _multiUser, credentialId, name, userVerified, backupEligible, backupState, serializedAttestationStatement, serializedAttestedCredential, serializedExtensions) VALUES ($1, $2, $3, 'Scala key', TRUE, FALSE, FALSE, '{\"fmt\": \"none\", \"format\": \"none\", \"attestationStatement\": {}}'::jsonb, $4, '{}'::jsonb)")
        .bind(object_id()).bind(&fixture.multi_user_id).bind((1u8..=16).collect::<Vec<u8>>()).bind(&scala_bytes)
        .execute(&database.pool).await.unwrap();
    // Soft-deleted credentials are not excluded (existingCollectionName view).
    sqlx::query("INSERT INTO webknossos.webauthnCredentials (_id, _multiUser, credentialId, name, userVerified, backupEligible, backupState, serializedAttestationStatement, serializedAttestedCredential, serializedExtensions, isDeleted) VALUES ($1, $2, 'garbage', 'Deleted', TRUE, FALSE, FALSE, '{}'::jsonb, 'garbage', '{}'::jsonb, TRUE)")
        .bind(object_id()).bind(&fixture.multi_user_id)
        .execute(&database.pool).await.unwrap();

    let reply = post(
        &app,
        "/api/auth/webauthn/register/start",
        Some(token),
        None,
        Value::Null,
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK);
    let cookie = reply.set_cookie.clone().unwrap();
    assert!(cookie.starts_with("webauthn-registration="), "{cookie}");
    assert!(
        cookie.contains("; Max-Age=120; Expires=")
            && cookie.ends_with("; Path=/; Secure; HTTPOnly; SameSite=Strict"),
        "{cookie}"
    );
    assert_eq!(session_of(&reply).len(), 36);
    let mut options = reply.body;
    let challenge = options["challenge"].as_str().unwrap().to_owned();
    assert_eq!(URL_SAFE_NO_PAD.decode(&challenge).unwrap().len(), 32);
    options["challenge"] = json!("<challenge>");
    let (email, multi_user) = (
        format!("{}@example.test", fixture.multi_user_id),
        fixture.multi_user_id.clone(),
    );
    assert_eq!(
        options,
        json!({
            "authenticatorSelection": {"requireResidentKey": true, "residentKey": "required", "userVerification": "preferred"},
            "attestation": "none",
            "challenge": "<challenge>",
            "excludeCredentials": [{"id": URL_SAFE_NO_PAD.encode((1u8..=16).collect::<Vec<u8>>()), "type": "public-key"}],
            "pubKeyCredParams": [
                {"alg": -8, "type": "public-key"},
                {"alg": -7, "type": "public-key"},
                {"alg": -257, "type": "public-key"},
            ],
            "timeout": 120000,
            "rp": {"id": RP_ID, "name": RP_ID},
            "user": {"displayName": "Rust Test", "id": URL_SAFE_NO_PAD.encode(multi_user.as_bytes()), "name": email},
        })
    );
    // Each start issues a fresh challenge.
    let (again, _) = start(&app, token).await;
    assert_ne!(again["challenge"], json!(challenge));

    // A malformed live row fails the lookup like the Scala DAO parse.
    sqlx::query("INSERT INTO webknossos.webauthnCredentials (_id, _multiUser, credentialId, name, userVerified, backupEligible, backupState, serializedAttestationStatement, serializedAttestedCredential, serializedExtensions) VALUES ($1, $2, 'bad', 'Broken', TRUE, FALSE, FALSE, '{}'::jsonb, 'bad', '{}'::jsonb)")
        .bind(object_id()).bind(&fixture.multi_user_id)
        .execute(&database.pool).await.unwrap();
    let reply = post(
        &app,
        "/api/auth/webauthn/register/start",
        Some(token),
        None,
        Value::Null,
    )
    .await;
    assert_eq!(
        (reply.status, reply.body),
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            error("Failed to fetch Passkeys")
        )
    );
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn finalize_stores_scala_compatible_credential_and_rejects_bad_ceremonies() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    let token = fixture.token.as_str();
    let app = app(&database, PUBLIC_URI, true);
    let authenticator = Authenticator::new(&[0xab; 20]);
    let invalid = error("Passkey registration could not be verified.");

    // Bad ceremonies: each consumes its challenge (popped before verify).
    let bad: Vec<Tweak> = vec![
        Tweak {
            challenge: Some(URL_SAFE_NO_PAD.encode([0u8; 32])),
            ..Tweak::default()
        },
        Tweak {
            origin: Some("https://evil.example.org"),
            ..Tweak::default()
        },
        Tweak {
            origin: Some("http://wk.example.org"),
            ..Tweak::default()
        },
        Tweak {
            rp_id: Some("evil.example.org"),
            ..Tweak::default()
        },
        Tweak {
            flags: Some(0x44), // AT + UV without UP
            ..Tweak::default()
        },
        Tweak {
            flags: Some(0x55), // BS without BE
            ..Tweak::default()
        },
        Tweak {
            fmt: Some("packed"),
            ..Tweak::default()
        },
    ];
    for tweak in bad {
        let (options, session) = start(&app, token).await;
        let body = authenticator.registration(&options, tweak);
        let reply = finalize(&app, token, &session, body.clone()).await;
        assert_eq!(
            (reply.status, reply.body),
            (StatusCode::BAD_REQUEST, invalid.clone())
        );
        let retry = finalize(&app, token, &session, body).await;
        assert_eq!(
            (retry.status, retry.body),
            (
                StatusCode::UNAUTHORIZED,
                error("Timeout during registration. Please try again.")
            )
        );
    }

    let (options, session) = start(&app, token).await;
    let body = authenticator.registration(&options, Tweak::default());
    // Missing cookie: Fox Empty -> 404; malformed key: 400 before the pop.
    let reply = post(
        &app,
        "/api/auth/webauthn/register/finalize",
        Some(token),
        None,
        body.clone(),
    )
    .await;
    assert_eq!(
        (reply.status, reply.body),
        (
            StatusCode::NOT_FOUND,
            error("Could not find or access the requested resource.")
        )
    );
    let reply = finalize(
        &app,
        token,
        &session,
        json!({"name": "x", "key": {"response": {}}}),
    )
    .await;
    assert_eq!(
        (reply.status, reply.body),
        (StatusCode::BAD_REQUEST, invalid.clone())
    );
    let reply = finalize(&app, token, "unknown-session", body.clone()).await;
    assert_eq!(reply.status, StatusCode::UNAUTHORIZED);

    let reply = finalize(&app, token, &session, body).await;
    assert_eq!(
        (reply.status, reply.body),
        (
            StatusCode::OK,
            json!({"message": "Key registered successfully"})
        )
    );
    let row: CredentialRow = sqlx::query_as(
        "SELECT _id, credentialId, name, userVerified, backupEligible, backupState, serializedAttestationStatement, serializedAttestedCredential, serializedExtensions, signatureCount, isDeleted FROM webknossos.webauthnCredentials WHERE _multiUser = $1",
    )
    .bind(&fixture.multi_user_id)
    .fetch_one(&database.pool)
    .await
    .unwrap();
    assert_eq!(row.0.len(), 24);
    assert_eq!(row.1, authenticator.credential_id);
    assert_eq!(row.2, "My laptop");
    assert_eq!((row.3, row.4, row.5), (true, false, false));
    assert_eq!(
        row.6,
        json!({"attestationStatement": {}, "fmt": "none", "format": "none"})
    );
    assert_eq!(row.7, authenticator.stored_attested_credential());
    assert_eq!(row.8, json!({}));
    assert_eq!((row.9, row.10), (3, false));

    // The stored credential is excluded on the next start.
    let (options, session) = start(&app, token).await;
    assert_eq!(
        options["excludeCredentials"],
        json!([{"id": URL_SAFE_NO_PAD.encode(&authenticator.credential_id), "type": "public-key"}])
    );
    // Duplicate (multiUser, credentialId): unique violation -> 500 like Scala.
    let body = authenticator.registration(&options, Tweak::default());
    let reply = finalize(&app, token, &session, body).await;
    assert_eq!(
        (reply.status, reply.body),
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            error("Failed to add Passkey")
        )
    );
    // Uniqueness is per account: another account may register the same id,
    // and the stored flags follow the authenticator (BE+BS, no UV).
    let other = database
        .seed_user(&object_id(), &fixture.organization_id, false)
        .await;
    let (options, session) = start(&app, &other.token).await;
    let body = authenticator.registration(
        &options,
        Tweak {
            flags: Some(0x59),
            ..Tweak::default()
        },
    );
    let reply = finalize(&app, &other.token, &session, body).await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.body);
    let flags: (bool, bool, bool) = sqlx::query_as(
        "SELECT userVerified, backupEligible, backupState FROM webknossos.webauthnCredentials WHERE _multiUser = $1",
    )
    .bind(&other.multi_user_id)
    .fetch_one(&database.pool)
    .await
    .unwrap();
    assert_eq!(flags, (false, true, true));
    database.cleanup().await;
}

// ---------------------------------------------------------------------------
// Authentication ceremony (auth/start + auth/finalize).

#[derive(Default)]
struct AssertTweak {
    rp_id: Option<&'static str>,
    origin: Option<&'static str>,
    challenge: Option<String>,
    client_type: Option<&'static str>,
    flags: Option<u8>,
    count: u32,
    credential_id: Option<Vec<u8>>,
    /// `None` = the registering account; `Some(None)` = no userHandle.
    user_handle: Option<Option<String>>,
    corrupt_signature: bool,
}

impl Authenticator {
    fn assertion(&self, options: &Value, multi_user: &str, tweak: AssertTweak) -> Value {
        let rp_id = tweak.rp_id.unwrap_or(RP_ID);
        let mut auth_data = digest(&SHA256, rp_id.as_bytes()).as_ref().to_vec();
        auth_data.push(tweak.flags.unwrap_or(0x05)); // UP + UV
        auth_data.extend(tweak.count.to_be_bytes());
        let challenge = tweak
            .challenge
            .unwrap_or_else(|| options["challenge"].as_str().unwrap().to_owned());
        let client_data = json!({
            "type": tweak.client_type.unwrap_or("webauthn.get"),
            "challenge": challenge,
            "origin": tweak.origin.unwrap_or(PUBLIC_URI),
            "crossOrigin": false,
        })
        .to_string();
        let mut message = auth_data.clone();
        message.extend(digest(&SHA256, client_data.as_bytes()).as_ref());
        let mut signature = self
            .pair
            .sign(&SystemRandom::new(), &message)
            .unwrap()
            .as_ref()
            .to_vec();
        if tweak.corrupt_signature {
            let last = signature.len() - 1;
            signature[last] ^= 1;
        }
        let id = URL_SAFE_NO_PAD.encode(
            tweak
                .credential_id
                .as_deref()
                .unwrap_or(&self.credential_id),
        );
        let user_handle = tweak
            .user_handle
            .unwrap_or_else(|| Some(multi_user.to_owned()))
            .map(|handle| URL_SAFE_NO_PAD.encode(handle));
        json!({
            "key": {
                "id": id,
                "rawId": id,
                "type": "public-key",
                "response": {
                    "clientDataJSON": URL_SAFE_NO_PAD.encode(&client_data),
                    "authenticatorData": URL_SAFE_NO_PAD.encode(&auth_data),
                    "signature": URL_SAFE_NO_PAD.encode(&signature),
                    "userHandle": user_handle,
                },
                "clientExtensionResults": {},
                "authenticatorAttachment": "platform",
            },
        })
    }
}

/// W2 handlers additionally need the router-wide browser-auth config and
/// mailer (login_user).
fn auth_app(database: &TestDb, public_uri: &str, enabled: bool) -> Router {
    app(database, public_uri, enabled)
        .layer(Extension(browser_auth_support::config()))
        .layer(Extension(MailSender::new(RecordingMailer::default())))
}

async fn post_assertion(app: &Router, path: &str, session: Option<&str>, body: Value) -> Reply {
    let mut request = Request::builder()
        .method("POST")
        .uri(path)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::USER_AGENT, browser_auth_support::USER_AGENT);
    if let Some(session) = session {
        request = request.header(header::COOKIE, format!("x=1; webauthn-session={session}"));
    }
    let response = app
        .clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let set_cookie = response
        .headers()
        .get(header::SET_COOKIE)
        .map(|v| v.to_str().unwrap().to_owned());
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap()
    };
    Reply {
        status,
        body,
        set_cookie,
    }
}

async fn auth_start(app: &Router) -> (Value, String) {
    let reply = post_assertion(app, "/api/auth/webauthn/auth/start", None, Value::Null).await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.body);
    let cookie = reply.set_cookie.expect("Set-Cookie");
    let session = cookie
        .strip_prefix("webauthn-session=")
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    (reply.body, session)
}

async fn auth_finalize(app: &Router, session: &str, body: Value) -> Reply {
    post_assertion(app, "/api/auth/webauthn/auth/finalize", Some(session), body).await
}

async fn stored_sign_count(database: &TestDb, multi_user: &str) -> i32 {
    sqlx::query_scalar(
        "SELECT signatureCount FROM webknossos.webauthnCredentials WHERE _multiUser = $1",
    )
    .bind(multi_user)
    .fetch_one(&database.pool)
    .await
    .unwrap()
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn auth_start_returns_scala_request_options_and_feature_gates() {
    let database = TestDb::new().await;
    for (app, message) in [
        (
            auth_app(&database, PUBLIC_URI, false),
            "Passkeys are not enabled for this WEBKNOSSOS instance.",
        ),
        (
            auth_app(&database, "http://wk.example.org", true),
            "Passkeys are only supported with HTTPS.",
        ),
    ] {
        for path in [
            "/api/auth/webauthn/auth/start",
            "/api/auth/webauthn/auth/finalize",
        ] {
            let reply = post_assertion(&app, path, Some("s"), json!({"key": {}})).await;
            assert_eq!(
                (reply.status, reply.body),
                (StatusCode::BAD_REQUEST, error(message))
            );
        }
    }

    // Anonymous (Action, not SecuredAction).
    let app = auth_app(&database, PUBLIC_URI, true);
    let reply = post_assertion(&app, "/api/auth/webauthn/auth/start", None, Value::Null).await;
    assert_eq!(reply.status, StatusCode::OK);
    let cookie = reply.set_cookie.clone().unwrap();
    assert!(cookie.starts_with("webauthn-session="), "{cookie}");
    assert!(
        cookie.contains("; Max-Age=120; Expires=")
            && cookie.ends_with("; Path=/; Secure; HTTPOnly; SameSite=Strict"),
        "{cookie}"
    );
    let mut options = reply.body;
    let challenge = options["challenge"].as_str().unwrap().to_owned();
    assert_eq!(URL_SAFE_NO_PAD.decode(&challenge).unwrap().len(), 32);
    options["challenge"] = json!("<challenge>");
    assert_eq!(
        options,
        json!({"challenge": "<challenge>", "timeout": 120000, "rpId": RP_ID, "userVerification": "preferred"})
    );
    // Body without `key`: 400 from JSON validation, before any other check.
    let reply = post_assertion(
        &app,
        "/api/auth/webauthn/auth/finalize",
        Some("s"),
        json!({}),
    )
    .await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);
    database.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn auth_finalize_logs_in_and_rejects_bad_assertions() {
    let database = TestDb::new().await;
    let fixture = database.fixture().await;
    let multi_user = fixture.multi_user_id.clone();
    let app = auth_app(&database, PUBLIC_URI, true);
    let authenticator = Authenticator::new(&[0xcd; 24]);
    let unauthorized = error("Passkey authentication failed.");
    let timeout = error("Timeout during authentication. Please try again.");

    // Register via the W1 routes (stored signCount 3, BE false).
    let (options, session) = start(&app, &fixture.token).await;
    let body = authenticator.registration(&options, Tweak::default());
    let reply = finalize(&app, &fixture.token, &session, body).await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.body);
    assert_eq!(stored_sign_count(&database, &multi_user).await, 3);

    let other = database
        .seed_user(&object_id(), &fixture.organization_id, false)
        .await;
    let bad: Vec<AssertTweak> = vec![
        AssertTweak {
            challenge: Some(URL_SAFE_NO_PAD.encode([0u8; 32])),
            count: 10,
            ..Default::default()
        },
        AssertTweak {
            origin: Some("https://evil.example.org"),
            count: 10,
            ..Default::default()
        },
        AssertTweak {
            origin: Some("http://wk.example.org"),
            count: 10,
            ..Default::default()
        },
        AssertTweak {
            rp_id: Some("evil.example.org"),
            count: 10,
            ..Default::default()
        },
        AssertTweak {
            client_type: Some("webauthn.create"),
            count: 10,
            ..Default::default()
        },
        AssertTweak {
            credential_id: Some(vec![1; 16]),
            count: 10,
            ..Default::default()
        },
        AssertTweak {
            corrupt_signature: true,
            count: 10,
            ..Default::default()
        },
        // signCount regression (equal and lower than stored 3).
        AssertTweak {
            count: 3,
            ..Default::default()
        },
        AssertTweak {
            count: 2,
            ..Default::default()
        },
        AssertTweak {
            count: 0,
            ..Default::default()
        },
        // Missing / foreign / malformed userHandle.
        AssertTweak {
            user_handle: Some(None),
            count: 10,
            ..Default::default()
        },
        AssertTweak {
            user_handle: Some(Some(other.multi_user_id.clone())),
            count: 10,
            ..Default::default()
        },
        AssertTweak {
            user_handle: Some(Some("not-an-object-id".into())),
            count: 10,
            ..Default::default()
        },
        // BS without BE; BE although the credential was registered without it.
        AssertTweak {
            flags: Some(0x15),
            count: 10,
            ..Default::default()
        },
        AssertTweak {
            flags: Some(0x0d),
            count: 10,
            ..Default::default()
        },
        // Attested credential data (AT) is not allowed in an assertion.
        AssertTweak {
            flags: Some(0x45),
            count: 10,
            ..Default::default()
        },
    ];
    for (index, tweak) in bad.into_iter().enumerate() {
        let (options, session) = auth_start(&app).await;
        let body = authenticator.assertion(&options, &multi_user, tweak);
        let reply = auth_finalize(&app, &session, body.clone()).await;
        assert_eq!(
            (reply.status, &reply.body, reply.set_cookie.is_some()),
            (StatusCode::UNAUTHORIZED, &unauthorized, false),
            "case {index}"
        );
        // The challenge was consumed.
        let retry = auth_finalize(&app, &session, body).await;
        assert_eq!(
            (retry.status, retry.body),
            (StatusCode::UNAUTHORIZED, timeout.clone())
        );
    }
    // No rejected ceremony touched the counter.
    assert_eq!(stored_sign_count(&database, &multi_user).await, 3);

    // Missing cookie: Fox Empty 404; unknown session: 401 timeout.
    let (options, _) = auth_start(&app).await;
    let body = authenticator.assertion(
        &options,
        &multi_user,
        AssertTweak {
            count: 4,
            ..Default::default()
        },
    );
    let reply = post_assertion(&app, "/api/auth/webauthn/auth/finalize", None, body.clone()).await;
    assert_eq!(
        (reply.status, reply.body),
        (
            StatusCode::NOT_FOUND,
            error("Could not find or access the requested resource.")
        )
    );
    let reply = auth_finalize(&app, "unknown-session", body).await;
    assert_eq!(
        (reply.status, reply.body),
        (StatusCode::UNAUTHORIZED, timeout.clone())
    );

    // A valid assertion (UP only, UV not required) for an account without
    // _lastLoggedInIdentity: counter updated first, then Empty -> 404.
    sqlx::query("UPDATE webknossos.multiUsers SET _lastLoggedInIdentity = NULL WHERE _id = $1")
        .bind(&multi_user)
        .execute(&database.pool)
        .await
        .unwrap();
    let (options, session) = auth_start(&app).await;
    let body = authenticator.assertion(
        &options,
        &multi_user,
        AssertTweak {
            flags: Some(0x01),
            count: 4,
            ..Default::default()
        },
    );
    let reply = auth_finalize(&app, &session, body).await;
    assert_eq!(reply.status, StatusCode::NOT_FOUND, "{}", reply.body);
    assert_eq!(stored_sign_count(&database, &multi_user).await, 4);

    // Successful login: session cookie authenticates GET /api/user.
    sqlx::query("UPDATE webknossos.multiUsers SET _lastLoggedInIdentity = $2 WHERE _id = $1")
        .bind(&multi_user)
        .bind(&fixture.user_id)
        .execute(&database.pool)
        .await
        .unwrap();
    let (options, session) = auth_start(&app).await;
    let body = authenticator.assertion(
        &options,
        &multi_user,
        AssertTweak {
            count: 7,
            ..Default::default()
        },
    );
    let reply = auth_finalize(&app, &session, body).await;
    assert_eq!((reply.status, &reply.body), (StatusCode::OK, &Value::Null));
    let cookie = reply.set_cookie.expect("session cookie");
    assert!(cookie.starts_with("id="), "{cookie}");
    let session_cookie = cookie
        .split(';')
        .next()
        .unwrap()
        .strip_prefix("id=")
        .unwrap()
        .to_owned();
    assert_eq!(stored_sign_count(&database, &multi_user).await, 7);
    let mailer = RecordingMailer::default();
    let full = browser_auth_support::app(&database, browser_auth_support::config(), &mailer);
    let user = browser_auth_support::send(
        &full,
        Method::GET,
        "/api/user",
        Some(&session_cookie),
        None,
        None,
    )
    .await;
    assert_eq!(user.status, StatusCode::OK, "{}", user.body);
    assert_eq!(user.body["id"], json!(fixture.user_id));
    let anonymous =
        browser_auth_support::send(&full, Method::GET, "/api/user", None, None, None).await;
    assert_eq!(anonymous.status, StatusCode::UNAUTHORIZED);

    // Replaying the same assertion fails (challenge consumed / counter).
    let (options, session) = auth_start(&app).await;
    let body = authenticator.assertion(
        &options,
        &multi_user,
        AssertTweak {
            count: 7,
            ..Default::default()
        },
    );
    let reply = auth_finalize(&app, &session, body).await;
    assert_eq!(
        (reply.status, reply.body),
        (StatusCode::UNAUTHORIZED, unauthorized.clone())
    );

    // A soft-deleted credential no longer authenticates.
    sqlx::query("UPDATE webknossos.webauthnCredentials SET isDeleted = TRUE WHERE _multiUser = $1")
        .bind(&multi_user)
        .execute(&database.pool)
        .await
        .unwrap();
    let (options, session) = auth_start(&app).await;
    let body = authenticator.assertion(
        &options,
        &multi_user,
        AssertTweak {
            count: 20,
            ..Default::default()
        },
    );
    let reply = auth_finalize(&app, &session, body).await;
    assert_eq!(
        (reply.status, reply.body),
        (StatusCode::UNAUTHORIZED, unauthorized)
    );
    database.cleanup().await;
}
