//! Hourly virtual-dataset realpath scan against a real database and mock datastores.
use crate::common;

use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    Router,
    body::to_bytes,
    extract::{Request, State},
    http::StatusCode,
    routing::post,
};
use common::{Fixture, TestDb, object_id};
use serde_json::{Value, json};
use webknossos_backend::{
    background::scheduler::{JobOutcome, advisory_lock_key, try_advisory_xact_lock},
    background::virtual_datasets_real_path_scan::{JOB_NAME, run_scan},
    stores::client::{ServiceClientConfig, ServiceClients},
};

#[derive(Clone)]
struct MockStore {
    requests: Arc<Mutex<Vec<(String, Value)>>>,
    status: StatusCode,
}

impl MockStore {
    fn take(&self) -> Vec<(String, Value)> {
        std::mem::take(&mut *self.requests.lock().unwrap())
    }
}

async fn record(State(store): State<MockStore>, request: Request) -> StatusCode {
    let uri = request.uri().to_string();
    let body = to_bytes(request.into_body(), 1 << 20).await.unwrap();
    let body = serde_json::from_slice(&body).unwrap_or(Value::Null);
    store.requests.lock().unwrap().push((uri, body));
    store.status
}

/// Starts a mock datastore answering `status` and registers it as datastore `name`.
async fn mock_store(db: &TestDb, name: &str, status: StatusCode, is_deleted: bool) -> MockStore {
    let store = MockStore {
        requests: Arc::default(),
        status,
    };
    let app = Router::new()
        .route("/data/triggers/scanRealPathsForVirtual", post(record))
        .with_state(store.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    sqlx::query(
        "INSERT INTO webknossos.dataStores (name,url,publicUrl,key,isDeleted) \
         VALUES ($1,$2,$2 || '/public','store-key',$3)",
    )
    .bind(name)
    .bind(url)
    .bind(is_deleted)
    .execute(&db.pool)
    .await
    .unwrap();
    store
}

struct Spec<'a> {
    store: &'a str,
    is_virtual: bool,
    is_usable: bool,
    is_deleted: bool,
    root_path: Option<&'a str>,
    mag_path: &'a str,
}

const VIRTUAL: Spec<'static> = Spec {
    store: "",
    is_virtual: true,
    is_usable: true,
    is_deleted: false,
    root_path: None,
    mag_path: "",
};

async fn seed_dataset(db: &TestDb, fixture: &Fixture, spec: Spec<'_>) -> String {
    let id = object_id();
    sqlx::query(
        "INSERT INTO webknossos.datasets (_id,_dataStore,_organization,_folder,name,directoryName,\
         isUsable,isVirtual,isDeleted,status,rootPath,voxelSizeFactor,sortingKey) SELECT $1,$3,_id,\
         _rootFolder,$1,$1,$4,$5,$6,'',$7,ROW(1,1,1)::webknossos.VECTOR3,NOW() \
         FROM webknossos.organizations WHERE _id=$2",
    )
    .bind(&id)
    .bind(&fixture.organization_id)
    .bind(spec.store)
    .bind(spec.is_usable)
    .bind(spec.is_virtual)
    .bind(spec.is_deleted)
    .bind(spec.root_path)
    .execute(&db.pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO webknossos.dataset_layers (_dataset,name,category,elementClass,boundingBox,\
         dataFormat) VALUES ($1,'color','color','uint8',ROW(0,0,0,10,10,10)::webknossos.BOUNDING_BOX,\
         'zarr3')",
    )
    .bind(&id)
    .execute(&db.pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO webknossos.dataset_mags (_dataset,dataLayerName,mag,path,realPath) \
         VALUES ($1,'color',ROW(1,1,1)::webknossos.VECTOR3,$2,'/resolved/elsewhere')",
    )
    .bind(&id)
    .bind(spec.mag_path)
    .execute(&db.pool)
    .await
    .unwrap();
    id
}

fn clients() -> ServiceClients {
    ServiceClients::new(ServiceClientConfig {
        request_timeout: Duration::from_secs(5),
        connect_timeout: Duration::from_secs(1),
        max_response_bytes: 1 << 20,
        rpc_token: "rpc-secret".into(),
    })
    .unwrap()
}

const SCAN_URI: &str = "/data/triggers/scanRealPathsForVirtual?token=rpc-secret";

/// The (dataset id, stored mag path, rootPath) triples of one scan request body.
fn summary(body: &Value) -> Vec<(String, String, Option<String>)> {
    body.as_array()
        .unwrap()
        .iter()
        .map(|info| {
            let source = &info["dataSource"];
            (
                source["id"]["name"].as_str().unwrap().to_owned(),
                source["dataLayers"][0]["mags"][0]["path"]
                    .as_str()
                    .unwrap()
                    .to_owned(),
                info["rootPath"].as_str().map(str::to_owned),
            )
        })
        .collect()
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn scans_virtual_datasets_per_data_store_and_continues_after_failures() {
    let db = TestDb::new().await;
    let fixture = db.fixture().await;
    let alpha = mock_store(&db, "alpha", StatusCode::OK, false).await;
    let beta = mock_store(&db, "beta", StatusCode::INTERNAL_SERVER_ERROR, false).await;
    let deleted = mock_store(&db, "delta", StatusCode::OK, true).await;
    let gamma = mock_store(&db, "gamma", StatusCode::OK, false).await;
    let only_remote = mock_store(&db, "remote-only", StatusCode::OK, false).await;

    let sent_with_root = seed_dataset(
        &db,
        &fixture,
        Spec {
            store: "alpha",
            root_path: Some("/srv/root"),
            mag_path: "/srv/root/color/1",
            ..VIRTUAL
        },
    )
    .await;
    let sent_file_scheme = seed_dataset(
        &db,
        &fixture,
        Spec {
            store: "alpha",
            mag_path: "file:///srv/other/color/1",
            ..VIRTUAL
        },
    )
    .await;
    // Not sent: only remote paths, unusable, deleted, not virtual.
    for spec in [
        Spec {
            store: "alpha",
            mag_path: "s3://bucket/color/1",
            ..VIRTUAL
        },
        Spec {
            store: "alpha",
            is_usable: false,
            mag_path: "/srv/unusable/color/1",
            ..VIRTUAL
        },
        Spec {
            store: "alpha",
            is_deleted: true,
            mag_path: "/srv/deleted/color/1",
            ..VIRTUAL
        },
        Spec {
            store: "alpha",
            is_virtual: false,
            mag_path: "/srv/disk/color/1",
            ..VIRTUAL
        },
        Spec {
            store: "remote-only",
            mag_path: "https://host/color/1",
            ..VIRTUAL
        },
    ] {
        seed_dataset(&db, &fixture, spec).await;
    }
    let failing = seed_dataset(
        &db,
        &fixture,
        Spec {
            store: "beta",
            mag_path: "/srv/beta/color/1",
            ..VIRTUAL
        },
    )
    .await;
    seed_dataset(
        &db,
        &fixture,
        Spec {
            store: "delta",
            mag_path: "/srv/delta/color/1",
            ..VIRTUAL
        },
    )
    .await;
    let after_failures = seed_dataset(
        &db,
        &fixture,
        Spec {
            store: "gamma",
            mag_path: "/srv/gamma/color/1",
            ..VIRTUAL
        },
    )
    .await;

    let outcome = run_scan(&db.pool, &clients()).await.unwrap();
    assert_eq!(
        outcome,
        JobOutcome::Completed(
            "Sent 3 virtual data sources for realpath scanning to 5 datastores (2 failed).".into()
        )
    );

    let alpha_calls = alpha.take();
    assert_eq!(alpha_calls.len(), 1);
    assert_eq!(alpha_calls[0].0, SCAN_URI);
    let mut expected = vec![
        (
            sent_with_root.clone(),
            "/srv/root/color/1".to_owned(),
            Some("/srv/root".to_owned()),
        ),
        (
            sent_file_scheme.clone(),
            "file:///srv/other/color/1".to_owned(),
            None,
        ),
    ];
    expected.sort();
    assert_eq!(summary(&alpha_calls[0].1), expected);
    // DataSourceWithRootPathInfo shape: stored paths, no rootRealPath when unset.
    let info = alpha_calls[0]
        .1
        .as_array()
        .unwrap()
        .iter()
        .find(|info| info["dataSource"]["id"]["name"] == json!(sent_with_root));
    let info = info.unwrap();
    assert!(info.get("rootRealPath").is_none());
    assert_eq!(
        info["dataSource"]["id"]["team"],
        json!(fixture.organization_id)
    );

    // The failing datastore was asked (and answered 500); the deleted one was never contacted.
    let beta_calls = beta.take();
    assert_eq!(beta_calls.len(), 1);
    assert_eq!(beta_calls[0].0, SCAN_URI);
    assert_eq!(
        summary(&beta_calls[0].1),
        vec![(failing, "/srv/beta/color/1".to_owned(), None)]
    );
    assert!(deleted.take().is_empty());
    assert!(only_remote.take().is_empty());

    // A failing datastore does not stop the following ones.
    let gamma_calls = gamma.take();
    assert_eq!(gamma_calls.len(), 1);
    assert_eq!(
        summary(&gamma_calls[0].1),
        vec![(after_failures, "/srv/gamma/color/1".to_owned(), None)]
    );

    // Another instance holding the lock: the tick is skipped and nothing is sent.
    let mut other = db.pool.begin().await.unwrap();
    assert!(
        try_advisory_xact_lock(&mut other, advisory_lock_key(JOB_NAME))
            .await
            .unwrap()
    );
    assert_eq!(
        run_scan(&db.pool, &clients()).await.unwrap(),
        JobOutcome::SkippedLocked
    );
    other.rollback().await.unwrap();
    assert!(alpha.take().is_empty());
    assert!(gamma.take().is_empty());

    db.cleanup().await;
}
