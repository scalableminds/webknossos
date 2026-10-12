#![allow(clippy::type_complexity, clippy::field_reassign_with_default)]
mod common;
use axum::{body::Body, http::Request};
use common::TestDb;
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{
    AppState,
    application_info::{LocalStoreConfig, MiscConfig},
    mail::MailSender,
    router_with_misc,
};

async fn send(app: &axum::Router, method: &str, uri: &str, token: Option<&str>) -> (u16, Value) {
    let mut request = Request::builder().uri(uri).method(method);
    if let Some(token) = token {
        request = request.header("X-Auth-Token", token);
    }
    let response = app
        .clone()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status().as_u16();
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

async fn trigger(db: &TestDb, misc: MiscConfig) -> (u16, Value) {
    let app = router_with_misc(
        AppState {
            pool: db.pool.clone(),
        },
        misc,
        MailSender::default(),
    );
    send(
        &app,
        "POST",
        "/api/triggers/initialData",
        Some("ignored-token"),
    )
    .await
}

fn error(message: &str) -> Value {
    json!({"messages": [{"error": message}]})
}

const NOT_ENABLED: &str =
    "Initial data (sample organization) is not enabled for this WEBKNOSSOS instance.";

/// Local stores at an address nothing listens on, so the organization
/// directory RPC fails fast instead of reaching a developer's server.
fn local_config(public_store_uri: &str) -> MiscConfig {
    let mut misc = MiscConfig::default();
    misc.analytics.uri = String::new();
    misc.public_uri = "http://127.0.0.1:9".into();
    let store = |name: &str| LocalStoreConfig {
        name: name.into(),
        key: "store-key".into(),
        public_uri: public_store_uri.into(),
    };
    misc.local_datastore = Some(store("localhost"));
    misc.local_tracingstore = Some(store("localhost"));
    misc
}

async fn count(db: &TestDb, sql: &str) -> i64 {
    sqlx::query_scalar(sql).fetch_one(&db.pool).await.unwrap()
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn disabled_sample_organization_only_syncs_stores_and_pretrained_models() {
    let db = TestDb::new().await;
    // Defaults: no local stores, no sample organization.
    assert_eq!(
        trigger(&db, MiscConfig::default()).await,
        (400, error(NOT_ENABLED))
    );
    assert_eq!(
        count(&db, "SELECT COUNT(*) FROM webknossos.dataStores").await,
        0
    );
    assert_eq!(
        count(&db, "SELECT COUNT(*) FROM webknossos.aiModels").await,
        0
    );

    for _ in 0..2 {
        assert_eq!(
            trigger(&db, local_config("http://public.example")).await,
            (400, error(NOT_ENABLED))
        );
    }
    let stores: Vec<(String, String, String, String, bool, bool)> = sqlx::query_as(
        "SELECT name, url, publicUrl, key, allowsUpload, isScratch FROM webknossos.dataStores",
    )
    .fetch_all(&db.pool)
    .await
    .unwrap();
    assert_eq!(
        stores,
        vec![(
            "localhost".into(),
            "http://127.0.0.1:9".into(),
            "http://public.example".into(),
            "store-key".into(),
            true,
            false
        )]
    );
    assert_eq!(
        count(&db, "SELECT COUNT(*) FROM webknossos.tracingStores WHERE publicUrl = 'http://public.example'").await,
        1
    );
    let models: Vec<(String, Option<String>, String, String, bool, bool)> = sqlx::query_as(
        "SELECT _id, _organization, name, category::TEXT, isSuperUserOnly, isPretrained FROM webknossos.aiModels ORDER BY _id",
    )
    .fetch_all(&db.pool)
    .await
    .unwrap();
    assert_eq!(models.len(), 4);
    assert_eq!(models[0].0, "576500000000000000000001");
    assert_eq!(models[0].2, "Neuron Segmentation");
    assert_eq!(models[3].3, "em_somata");
    assert!(models.iter().all(|m| m.1.is_none() && m.5));
    assert!(models[2].4 && !models[1].4);

    // A changed public URI is written back to the existing rows.
    trigger(&db, local_config("http://moved.example")).await;
    assert_eq!(
        count(
            &db,
            "SELECT COUNT(*) FROM webknossos.dataStores WHERE publicUrl = 'http://moved.example'"
        )
        .await,
        1
    );
    assert_eq!(
        count(
            &db,
            "SELECT COUNT(*) FROM webknossos.tracingStores WHERE publicUrl = 'http://moved.example'"
        )
        .await,
        1
    );
    assert_eq!(
        count(&db, "SELECT COUNT(*) FROM webknossos.organizations").await,
        0
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn sample_organization_is_inserted_once() {
    let db = TestDb::new().await;
    let mut misc = local_config("http://public.example");
    misc.sample_organization.enabled = true;
    assert_eq!(trigger(&db, misc.clone()).await, (200, Value::Null));

    let organization: (String, String, String, String, Option<String>) = sqlx::query_as(
        "SELECT _id, name, logoUrl, pricingPlan::TEXT, aiPlan::TEXT FROM webknossos.organizations",
    )
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(
        organization,
        (
            "sample_organization".into(),
            "Sample Organization".into(),
            "/images/logo.svg".into(),
            "Custom".into(),
            Some("Power_AI".into())
        )
    );
    let users: Vec<(String, String, bool, bool, bool, bool, bool, String, bool)> = sqlx::query_as(
        r#"SELECT m.email, m.firstName, m.isSuperUser, m.isEmailVerified, u.isAdmin,
             u.isOrganizationOwner, u.isDatasetManager, m.passwordInfo_password, r.isTeamManager
           FROM webknossos.users u JOIN webknossos.multiUsers m ON m._id = u._multiUser
           JOIN webknossos.user_team_roles r ON r._user = u._id ORDER BY m.email"#,
    )
    .fetch_all(&db.pool)
    .await
    .unwrap();
    assert_eq!(users.len(), 2);
    assert_eq!(users[0].0, "sample2@scm.io");
    assert_eq!(users[0].1, "Non-Admin");
    assert!(!users[0].2 && users[0].3 && !users[0].4 && !users[0].8);
    assert_eq!(users[1].0, "sample@scm.io");
    assert!(users[1].2 && users[1].3 && users[1].4 && users[1].5 && users[1].6 && users[1].8);
    assert!(users[1].7.starts_with("$2a$10$"));
    assert!(bcrypt::verify("secret", &users[1].7).unwrap());
    assert_ne!(users[0].7, users[1].7);
    assert_eq!(
        count(&db, "SELECT COUNT(*) FROM webknossos.user_experiences WHERE domain = 'sampleExp' AND value = 10").await,
        2
    );
    assert_eq!(
        count(&db, "SELECT COUNT(*) FROM webknossos.experienceDomains WHERE _organization = 'sample_organization'").await,
        1
    );
    assert_eq!(
        count(
            &db,
            "SELECT COUNT(*) FROM webknossos.teams WHERE isOrganizationTeam AND name = 'Default'"
        )
        .await,
        1
    );
    assert_eq!(
        count(&db, "SELECT COUNT(*) FROM webknossos.folders f JOIN webknossos.organizations o ON o._rootFolder = f._id WHERE f.name = 'Datasets'").await,
        1
    );
    assert_eq!(
        count(&db, "SELECT COUNT(*) FROM webknossos.taskTypes WHERE _id = '63721e2cef0100470266c485' AND settings_allowedModes = '{orthogonal,flight}'").await,
        1
    );
    assert_eq!(
        count(&db, "SELECT COUNT(*) FROM webknossos.projects WHERE name = 'sampleProject' AND expectedTime = 5400000").await,
        1
    );
    assert_eq!(
        count(&db, "SELECT COUNT(*) FROM webknossos.publications").await,
        2
    );
    let description: String = sqlx::query_scalar(
        "SELECT description FROM webknossos.publications WHERE _id = '5c766bec6c01006c018c7459'",
    )
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert!(description.contains("M Helmstaedter\\\nScience."));
    let datasets: Vec<(String, String, bool, Option<String>, Value)> = sqlx::query_as(
        "SELECT _id, name, isPublic, _publication, metadata FROM webknossos.datasets ORDER BY _id",
    )
    .fetch_all(&db.pool)
    .await
    .unwrap();
    assert_eq!(datasets.len(), 6);
    assert_eq!(datasets[0].1, "tubhiswt-4D OME-Zarr");
    assert!(datasets[0].2 && datasets[0].3.is_none());
    assert_eq!(datasets[1].0, "68b80290d4000090f8f4aa62");
    assert_eq!(datasets[1].4.as_array().unwrap().len(), 2);
    assert_eq!(datasets[2].4[2]["value"], "Cortex L4");
    assert_eq!(datasets[5].3.as_deref(), Some("6ac000000000000000000001"));
    assert_eq!(
        count(&db, "SELECT COUNT(*) FROM webknossos.dataset_layers").await,
        12
    );
    assert_eq!(
        count(&db, "SELECT COUNT(*) FROM webknossos.dataset_mags").await,
        52
    );
    assert_eq!(
        count(
            &db,
            "SELECT COUNT(*) FROM webknossos.dataset_layer_additionalAxes"
        )
        .await,
        2
    );
    assert_eq!(
        count(&db, "SELECT COUNT(*) FROM webknossos.aiModels WHERE _organization = 'sample_organization' AND NOT isPretrained").await,
        1
    );

    // The configured sample token authenticates the default user.
    let app = router_with_misc(
        AppState {
            pool: db.pool.clone(),
        },
        misc.clone(),
        MailSender::default(),
    );
    let (status, datasets) =
        send(&app, "GET", "/api/datasets", Some("secretSampleUserToken")).await;
    assert_eq!(status, 200);
    assert_eq!(datasets.as_array().unwrap().len(), 6);

    assert_eq!(
        trigger(&db, misc).await,
        (
            400,
            error(
                "There are already organizations present in the database. To reset initial data, please refresh the database schema and try again."
            )
        )
    );
    assert_eq!(
        count(&db, "SELECT COUNT(*) FROM webknossos.multiUsers").await,
        2
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn sample_organization_without_local_datastore_skips_datasets() {
    let db = TestDb::new().await;
    let mut misc = MiscConfig::default();
    misc.analytics.uri = String::new();
    misc.sample_organization.enabled = true;
    assert_eq!(trigger(&db, misc).await, (200, Value::Null));
    assert_eq!(
        count(&db, "SELECT COUNT(*) FROM webknossos.organizations").await,
        1
    );
    assert_eq!(
        count(&db, "SELECT COUNT(*) FROM webknossos.datasets").await,
        0
    );
    assert_eq!(
        count(&db, "SELECT COUNT(*) FROM webknossos.aiModels").await,
        0
    );
    assert_eq!(
        count(&db, "SELECT COUNT(*) FROM webknossos.tokens").await,
        1
    );
    db.cleanup().await;
}
