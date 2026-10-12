#![allow(clippy::type_complexity, clippy::field_reassign_with_default)]
mod common;
use axum::{body::Body, http::Request};
use base64::Engine;
use common::TestDb;
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{
    AppState,
    application_info::MiscConfig,
    mail::{MailSender, RecordingMailer},
    router_with_misc,
};

struct Reply {
    status: u16,
    headers: axum::http::HeaderMap,
    body: Value,
}

async fn send(
    app: &axum::Router,
    method: &str,
    uri: &str,
    token: Option<&str>,
    body: Option<&str>,
) -> Reply {
    let mut request = Request::builder().uri(uri).method(method);
    if let Some(token) = token {
        request = request.header("X-Auth-Token", token);
    }
    let body = match body {
        Some(body) => {
            request = request.header("content-type", "application/json");
            Body::from(body.to_owned())
        }
        None => Body::empty(),
    };
    let response = app
        .clone()
        .oneshot(request.body(body).unwrap())
        .await
        .unwrap();
    let status = response.status().as_u16();
    let headers = response.headers().clone();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    Reply {
        status,
        headers,
        body: if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).unwrap()
        },
    }
}

fn app(db: &TestDb, misc: MiscConfig, mailer: MailSender) -> axum::Router {
    router_with_misc(
        AppState {
            pool: db.pool.clone(),
        },
        misc,
        mailer,
    )
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn buildinfo_and_features_are_public_and_shaped_like_play() {
    let db = TestDb::new().await;
    let mut misc = MiscConfig::default();
    misc.build_info.commit_hash = "abc123".into();
    misc.build_info.ci_build = "77".into();
    misc.features
        .insert("voxelyticsEnabled".into(), json!(true));
    let app = app(&db, misc, MailSender::default());
    let schema_version: i64 =
        sqlx::query_scalar("SELECT schemaVersion FROM webknossos.releaseInformation")
            .fetch_one(&db.pool)
            .await
            .unwrap();

    for token in [None, Some("not-a-valid-token")] {
        let reply = send(&app, "GET", "/api/buildinfo", token, None).await;
        assert_eq!(reply.status, 200);
        assert_eq!(reply.headers["access-control-allow-origin"], "*");
        assert_eq!(reply.headers["access-control-max-age"], "600");
        assert_eq!(
            reply.body,
            json!({
                "webknossos": {
                    "name": "webknossos",
                    "scalaVersion": "3.8.4",
                    "sbtVersion": "1.12.9",
                    "commitHash": "abc123",
                    "commitDate": "<getting git date failed>",
                    "ciBuild": "77",
                    "ciTag": "",
                    "version": "77",
                },
                "schemaVersion": schema_version,
                "httpApiVersioning": {"currentApiVersion": 16, "oldestSupportedApiVersion": 10},
                "localDataStoreEnabled": false,
                "localTracingStoreEnabled": false,
            })
        );

        let reply = send(&app, "GET", "/api/v10/features", token, None).await;
        assert_eq!(reply.status, 200);
        assert_eq!(reply.headers["cache-control"], "no-cache");
        assert_eq!(reply.body["voxelyticsEnabled"], true);
        assert_eq!(reply.body["taskReopenAllowedInSeconds"], 30);
        assert_eq!(reply.body["optInTabs"], json!(["ConnectomeView"]));
        assert_eq!(
            reply.body["supportAiAgentUrl"],
            "https://docs.webknossos.org/webhooks/webknossos/ask"
        );
        assert_eq!(reply.body.as_object().unwrap().len(), 26);
    }
    // A missing schema version renders as null, as Play's Option does.
    sqlx::query("DELETE FROM webknossos.releaseInformation")
        .execute(&db.pool)
        .await
        .unwrap();
    let reply = send(&app, "GET", "/api/buildinfo", None, None).await;
    assert_eq!(reply.body["schemaVersion"], Value::Null);
    db.cleanup().await;
}

fn signed_certificate(claims: Value) -> (String, String) {
    use ring::signature::{ECDSA_P256_SHA256_FIXED_SIGNING, EcdsaKeyPair, KeyPair};
    let rng = ring::rand::SystemRandom::new();
    let pkcs8 = EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, &rng).unwrap();
    let pair =
        EcdsaKeyPair::from_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, pkcs8.as_ref(), &rng).unwrap();
    let mut spki = vec![
        0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08,
        0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
    ];
    spki.extend_from_slice(pair.public_key().as_ref());
    let engine = base64::engine::general_purpose::URL_SAFE_NO_PAD;
    let signed = format!(
        "{}.{}",
        engine.encode(br#"{"alg":"ES256","typ":"JWT"}"#),
        engine.encode(claims.to_string())
    );
    let signature = pair.sign(&rng, signed.as_bytes()).unwrap();
    (
        base64::engine::general_purpose::STANDARD.encode(&spki),
        format!("{signed}.{}", engine.encode(signature.as_ref())),
    )
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn check_certificate_reports_validity_and_expiry() {
    let db = TestDb::new().await;
    let check = |misc: MiscConfig| {
        let app = app(&db, misc, MailSender::default());
        async move {
            let reply = send(&app, "GET", "/api/checkCertificate", None, None).await;
            (reply.status, reply.body)
        }
    };
    // No public key: always valid.
    assert_eq!(
        check(MiscConfig::default()).await,
        (200, json!({"isValid": true, "expiresAt": 0}))
    );
    // Undecodable public key: always invalid.
    let mut misc = MiscConfig::default();
    misc.certificate_public_key = Some("not a key".into());
    misc.certificate = Some("a.b.c".into());
    assert_eq!(
        check(misc).await,
        (400, json!({"isValid": false, "expiresAt": 0}))
    );
    let future = chrono::Utc::now().timestamp() + 3600;
    let (key, certificate) = signed_certificate(json!({"exp": future}));
    let mut misc = MiscConfig::default();
    misc.certificate_public_key = Some(key.clone());
    misc.certificate = Some(certificate);
    assert_eq!(
        check(misc).await,
        (200, json!({"isValid": true, "expiresAt": future}))
    );
    let (key, certificate) = signed_certificate(json!({"exp": 1000}));
    let mut misc = MiscConfig::default();
    misc.certificate_public_key = Some(key.clone());
    misc.certificate = Some(certificate);
    assert_eq!(
        check(misc).await,
        (400, json!({"isValid": false, "expiresAt": 1000}))
    );
    // Missing certificate with a valid key.
    let mut misc = MiscConfig::default();
    misc.certificate_public_key = Some(key);
    assert_eq!(
        check(misc).await,
        (400, json!({"isValid": false, "expiresAt": 0}))
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn help_email_requires_login_and_mails_support_and_user() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let recorder = RecordingMailer::default();
    let mut misc = MiscConfig::default();
    misc.support_email = "Support <support@example.test>".into();
    let app = app(&db, misc, MailSender::new(recorder.clone()));
    let body = r#"{"message":"Help me\nplease","currentUrl":"http://localhost:9000/dashboard"}"#;

    let reply = send(&app, "POST", "/api/helpEmail", None, Some(body)).await;
    assert_eq!(reply.status, 401);
    let reply = send(&app, "POST", "/api/helpEmail", Some(&f.token), Some("{}")).await;
    assert_eq!(reply.status, 400);
    assert!(recorder.messages().is_empty());

    let reply = send(&app, "POST", "/api/helpEmail", Some(&f.token), Some(body)).await;
    assert_eq!((reply.status, reply.body), (200, Value::Null));
    let mails = recorder.take();
    assert_eq!(mails.len(), 1);
    assert_eq!(mails[0].subject, "Help requested // Feedback provided");
    assert_eq!(
        mails[0].recipients,
        vec![
            "Support <support@example.test>".to_owned(),
            format!("{}@example.test", f.multi_user_id)
        ]
    );
    assert!(mails[0].body_html.contains("Help me\nplease"));
    assert!(
        mails[0]
            .body_html
            .contains(r#"Current URL: <a href="http://localhost:9000/dashboard">"#)
    );
    assert!(
        mails[0]
            .body_html
            .contains("Rust Test from Test organization")
    );
    db.cleanup().await;
}
