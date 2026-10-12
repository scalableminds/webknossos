//! Periodic organization used-storage scan (Scala `UsedStorageService.tick`) against a fresh
//! database and a mock datastore (`POST /data/datasets/measureUsedStorage/{organization}`).
mod common;

use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use axum::{
    Json, Router,
    body::to_bytes,
    extract::{Request, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use chrono::{DateTime, Utc};
use common::{TestDb, object_id};
use serde_json::{Value, json};
use webknossos_backend::{
    dataset_storage::{self, JOB_NAME, UsedStorageConfig},
    scheduler::{JobOutcome, JobSchedule, advisory_lock_key, try_advisory_xact_lock},
    service_clients::{ServiceClientConfig, ServiceClients},
};

/// One recorded datastore call: URI path and requested paths.
type Call = (String, Vec<String>);

#[derive(Clone, Default)]
struct Mock {
    calls: Arc<Mutex<Vec<Call>>>,
    /// URI path prefixes answered with HTTP 500.
    failing: Arc<Mutex<HashSet<String>>>,
    /// Reported sizes per measured path (default: 1000 * path length).
    sizes: Arc<Mutex<HashMap<String, i64>>>,
}

impl Mock {
    fn take(&self) -> Vec<Call> {
        std::mem::take(&mut *self.calls.lock().unwrap())
    }

    fn fail(&self, prefix: &str) {
        self.failing.lock().unwrap().insert(prefix.to_owned());
    }
}

fn default_size(path: &str) -> i64 {
    1000 * path.len() as i64
}

async fn datastore(State(mock): State<Mock>, request: Request) -> Response {
    let path = request.uri().path().to_owned();
    let bytes = to_bytes(request.into_body(), 1 << 20).await.unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    let requested: Vec<String> = body["paths"]
        .as_array()
        .map(|paths| {
            paths
                .iter()
                .map(|p| p.as_str().unwrap().to_owned())
                .collect()
        })
        .unwrap_or_default();
    mock.calls
        .lock()
        .unwrap()
        .push((path.clone(), requested.clone()));
    if mock
        .failing
        .lock()
        .unwrap()
        .iter()
        .any(|prefix| path.starts_with(prefix))
    {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    if !path.contains("/data/datasets/measureUsedStorage/") {
        return StatusCode::NOT_FOUND.into_response();
    }
    let sizes = mock.sizes.lock().unwrap().clone();
    let mut reports: Vec<Value> = requested
        .iter()
        .map(|p| json!({"path": p, "usedStorageBytes": sizes.get(p).copied().unwrap_or_else(|| default_size(p))}))
        .collect();
    // Scala logs and drops reports for paths it did not ask about.
    reports.push(json!({"path": "not/requested", "usedStorageBytes": 7}));
    Json(json!({ "reports": reports })).into_response()
}

struct Setup {
    db: TestDb,
    mock: Mock,
    clients: ServiceClients,
    base: String,
    server: tokio::task::JoinHandle<()>,
}

impl Setup {
    async fn new() -> Self {
        let db = TestDb::new().await;
        let mock = Mock::default();
        let upstream = Router::new().fallback(datastore).with_state(mock.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, upstream).await.unwrap() });
        let clients = ServiceClients::new(ServiceClientConfig {
            request_timeout: Duration::from_secs(5),
            connect_timeout: Duration::from_secs(1),
            max_response_bytes: 1 << 20,
            rpc_token: "rpc-secret".to_owned(),
        })
        .unwrap();
        Self {
            db,
            mock,
            clients,
            base,
            server,
        }
    }

    /// Datastore `name` served by the mock under the URL prefix `/{name}`.
    async fn store(&self, name: &str, reporting: bool, deleted: bool) {
        sqlx::query(
            "INSERT INTO webknossos.dataStores (name,url,publicUrl,key,reportUsedStorageEnabled,isDeleted) \
             VALUES ($1,$2,$3,'service-key',$4,$5)",
        )
        .bind(name)
        .bind(format!("{}/{name}", self.base))
        .bind(format!("http://public-{name}.invalid"))
        .bind(reporting)
        .bind(deleted)
        .execute(&self.db.pool)
        .await
        .unwrap();
    }

    /// Organization whose last scan was `scanned_hours_ago` hours ago.
    async fn organization(&self, id: &str, scanned_hours_ago: i32, deleted: bool) {
        let folder = object_id();
        sqlx::query("INSERT INTO webknossos.folders (_id, name) VALUES ($1, 'root')")
            .bind(&folder)
            .execute(&self.db.pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO webknossos.organizations (_id,_rootFolder,name,lastStorageScanTime,isDeleted) \
             VALUES ($1,$2,'Org',NOW() - make_interval(hours => $3),$4)",
        )
        .bind(id)
        .bind(&folder)
        .bind(scanned_hours_ago)
        .bind(deleted)
        .execute(&self.db.pool)
        .await
        .unwrap();
    }

    async fn dataset(&self, organization: &str, store: &str, directory: &str) -> String {
        let id = object_id();
        sqlx::query(
            "INSERT INTO webknossos.datasets (_id,_organization,_dataStore,_folder,name,directoryName,isUsable,sortingKey) \
             SELECT $1,_id,$3,_rootFolder,$4,$4,TRUE,NOW() FROM webknossos.organizations WHERE _id=$2",
        )
        .bind(&id)
        .bind(organization)
        .bind(store)
        .bind(directory)
        .execute(&self.db.pool)
        .await
        .unwrap();
        id
    }

    async fn mag(
        &self,
        dataset: &str,
        layer: &str,
        mag: i32,
        path: Option<&str>,
        real_path: Option<&str>,
    ) {
        sqlx::query(
            "INSERT INTO webknossos.dataset_mags (_dataset,dataLayerName,mag,path,realPath) \
             VALUES ($1,$2,ROW($3,$3,$3)::webknossos.VECTOR3,$4,$5)",
        )
        .bind(dataset)
        .bind(layer)
        .bind(f64::from(mag))
        .bind(path)
        .bind(real_path)
        .execute(&self.db.pool)
        .await
        .unwrap();
    }

    /// Attachments reference their layer.
    async fn layer(&self, dataset: &str, layer: &str) {
        sqlx::query(
            "INSERT INTO webknossos.dataset_layers (_dataset,name,category,elementClass,boundingBox) \
             VALUES ($1,$2,'segmentation','uint32',ROW(0,0,0,10,10,10)::webknossos.BOUNDING_BOX) \
             ON CONFLICT DO NOTHING",
        )
        .bind(dataset)
        .bind(layer)
        .execute(&self.db.pool)
        .await
        .unwrap();
    }

    async fn attachment(&self, dataset: &str, layer: &str, name: &str, path: &str) {
        self.layer(dataset, layer).await;
        sqlx::query(
            "INSERT INTO webknossos.dataset_layer_attachments (_dataset,layerName,name,path,type,dataFormat) \
             VALUES ($1,$2,$3,$4,'agglomerate','hdf5')",
        )
        .bind(dataset)
        .bind(layer)
        .bind(name)
        .bind(path)
        .execute(&self.db.pool)
        .await
        .unwrap();
    }

    /// Pre-existing (stale) usedStorage rows of an organization. They reference a dataset on the
    /// non-reporting store "off" (the rows have foreign keys), so no scan measures them again.
    async fn stale_rows(&self, organization: &str) {
        let dataset = self.dataset(organization, "off", "stale-dir").await;
        self.mag(&dataset, "stale", 8, Some("stale/path"), None)
            .await;
        self.layer(&dataset, "stale").await;
        sqlx::query(
            "INSERT INTO webknossos.dataset_layer_attachments (_dataset,layerName,name,path,type,dataFormat) \
             VALUES ($1,'stale','old','stale/att','mesh','hdf5')",
        )
        .bind(&dataset)
        .execute(&self.db.pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO webknossos.organization_usedStorage_mags (_dataset,layerName,mag,path,_organization,usedStorageBytes) \
             VALUES ($1,'stale',ROW(8,8,8)::webknossos.VECTOR3,'stale/path',$2,42)",
        )
        .bind(&dataset)
        .bind(organization)
        .execute(&self.db.pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO webknossos.organization_usedStorage_attachments (_dataset,layerName,name,path,type,_organization,usedStorageBytes) \
             VALUES ($1,'stale','old','stale/att','mesh',$2,43)",
        )
        .bind(&dataset)
        .bind(organization)
        .execute(&self.db.pool)
        .await
        .unwrap();
    }

    /// (dataset, layer, mag x, path, bytes) of an organization's mag rows.
    async fn mag_rows(&self, organization: &str) -> Vec<(String, String, f64, String, i64)> {
        sqlx::query_as(
            "SELECT _dataset, layerName, (mag).x, path, usedStorageBytes \
             FROM webknossos.organization_usedStorage_mags WHERE _organization=$1 ORDER BY path COLLATE \"C\"",
        )
        .bind(organization)
        .fetch_all(&self.db.pool)
        .await
        .unwrap()
    }

    /// (dataset, layer, name, path, type, bytes) of an organization's attachment rows.
    async fn attachment_rows(
        &self,
        organization: &str,
    ) -> Vec<(String, String, String, String, String, i64)> {
        sqlx::query_as(
            "SELECT _dataset, layerName, name, path, type::text, usedStorageBytes \
             FROM webknossos.organization_usedStorage_attachments WHERE _organization=$1 ORDER BY path COLLATE \"C\"",
        )
        .bind(organization)
        .fetch_all(&self.db.pool)
        .await
        .unwrap()
    }

    async fn scan_time(&self, organization: &str) -> DateTime<Utc> {
        sqlx::query_scalar("SELECT lastStorageScanTime FROM webknossos.organizations WHERE _id=$1")
            .bind(organization)
            .fetch_one(&self.db.pool)
            .await
            .unwrap()
    }

    async fn cleanup(self) {
        self.server.abort();
        self.db.cleanup().await;
    }
}

fn config(scans_per_tick: u32) -> UsedStorageConfig {
    UsedStorageConfig {
        scans_per_tick,
        pause_after_each_organization: Duration::ZERO,
        ..UsedStorageConfig::default()
    }
}

fn organizations_of(calls: &[Call]) -> Vec<String> {
    calls
        .iter()
        .map(|(path, _)| path.rsplit('/').next().unwrap().to_owned())
        .collect()
}

fn recent(time: DateTime<Utc>) -> bool {
    (Utc::now() - time).num_seconds().abs() < 60
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL"]
async fn scans_due_organizations_oldest_first_and_replaces_rows() {
    let setup = Setup::new().await;
    setup.store("s1", true, false).await;
    setup.store("s2", true, false).await;
    setup.store("off", false, false).await;
    setup.store("gone", true, true).await;
    // Due: orgB (10 d), orgA (3 d), orgC (2 d). Not due: orgD (1 h). Deleted: orgE.
    for (org, hours, deleted) in [
        ("orgA", 72, false),
        ("orgB", 240, false),
        ("orgC", 48, false),
        ("orgD", 1, false),
        ("orgE", 720, true),
    ] {
        setup.organization(org, hours, deleted).await;
    }
    let a1 = setup.dataset("orgA", "s1", "dsA").await;
    setup
        .mag(&a1, "color", 1, Some("s3://bucket/a/color/1"), None)
        .await;
    setup
        .mag(
            &a1,
            "color",
            2,
            Some("dsA/color/2"),
            Some("/real/a/color/2"),
        )
        .await;
    setup
        .attachment(&a1, "segmentation", "agglo", "./segmentation/../agglo.hdf5")
        .await;
    setup
        .attachment(&a1, "segmentation", "remote", "s3://bucket/a/agglo.hdf5")
        .await;
    // Mags without any path are never storage relevant.
    setup.mag(&a1, "color", 4, None, None).await;
    let a2 = setup.dataset("orgA", "s2", "dsA2").await;
    setup.mag(&a2, "color", 1, Some("dsA2/color/1"), None).await;
    let a_off = setup.dataset("orgA", "off", "dsOff").await;
    setup
        .mag(&a_off, "color", 1, Some("dsOff/color/1"), None)
        .await;
    // Same physical path as orgA's first mag, but created later: counted for orgA only.
    let b1 = setup.dataset("orgB", "s1", "dsB").await;
    setup
        .mag(&b1, "color", 1, Some("s3://bucket/a/color/1"), None)
        .await;
    setup.mag(&b1, "color", 2, Some("dsB/color/2"), None).await;
    setup.stale_rows("orgA").await;
    setup.stale_rows("orgC").await;
    setup.stale_rows("orgD").await;
    let scan_c = setup.scan_time("orgC").await;
    let scan_d = setup.scan_time("orgD").await;
    setup
        .mock
        .sizes
        .lock()
        .unwrap()
        .insert("/real/a/color/2".into(), 0);

    let outcome = dataset_storage::run_scan(&setup.db.pool, &setup.clients, &config(2))
        .await
        .unwrap();
    assert_eq!(
        outcome,
        JobOutcome::Completed(
            "Scanned used storage for 2 organizations (0 failed) in 2 datastores.".into()
        )
    );
    let calls = setup.mock.take();
    // orgB (oldest) first, then orgA; per organization store s1 then s2; never "off"/"gone".
    // A store without relevant paths gets no request (Scala: empty `grouped(200)`).
    assert_eq!(
        calls.iter().map(|(p, _)| p.as_str()).collect::<Vec<_>>(),
        [
            "/s1/data/datasets/measureUsedStorage/orgB",
            "/s1/data/datasets/measureUsedStorage/orgA",
            "/s2/data/datasets/measureUsedStorage/orgA",
        ]
    );
    assert_eq!(calls[0].1, ["dsB/color/2"]);
    let mut a_s1 = calls[1].1.clone();
    a_s1.sort();
    assert_eq!(
        a_s1,
        [
            "/real/a/color/2",
            "dsA/agglo.hdf5",
            "s3://bucket/a/agglo.hdf5",
            "s3://bucket/a/color/1"
        ]
    );
    assert_eq!(calls[2].1, ["dsA2/color/1"]);

    let len = |p: &str| default_size(p);
    assert_eq!(
        setup.mag_rows("orgA").await,
        [
            (a1.clone(), "color".into(), 2.0, "/real/a/color/2".into(), 0),
            (
                a2.clone(),
                "color".into(),
                1.0,
                "dsA2/color/1".into(),
                len("dsA2/color/1")
            ),
            (
                a1.clone(),
                "color".into(),
                1.0,
                "s3://bucket/a/color/1".into(),
                len("s3://bucket/a/color/1")
            ),
        ]
    );
    assert_eq!(
        setup.attachment_rows("orgA").await,
        [
            (
                a1.clone(),
                "segmentation".into(),
                "agglo".into(),
                "dsA/agglo.hdf5".into(),
                "agglomerate".into(),
                len("dsA/agglo.hdf5")
            ),
            (
                a1.clone(),
                "segmentation".into(),
                "remote".into(),
                "s3://bucket/a/agglo.hdf5".into(),
                "agglomerate".into(),
                len("s3://bucket/a/agglo.hdf5")
            ),
        ]
    );
    assert_eq!(
        setup.mag_rows("orgB").await,
        [(
            b1.clone(),
            "color".into(),
            2.0,
            "dsB/color/2".into(),
            len("dsB/color/2")
        )]
    );
    assert!(setup.attachment_rows("orgB").await.is_empty());
    assert!(recent(setup.scan_time("orgA").await));
    assert!(recent(setup.scan_time("orgB").await));
    // Not selected this tick (limit) / not due / deleted: untouched.
    assert_eq!(setup.scan_time("orgC").await, scan_c);
    assert_eq!(setup.scan_time("orgD").await, scan_d);
    assert_eq!(setup.mag_rows("orgC").await.len(), 1);
    assert_eq!(setup.mag_rows("orgD").await.len(), 1);
    assert!(!recent(setup.scan_time("orgE").await));

    // Next tick: only orgC is still due; its datasets are gone, so its stale rows are cleared.
    let outcome = dataset_storage::run_scan(&setup.db.pool, &setup.clients, &config(2))
        .await
        .unwrap();
    assert_eq!(
        outcome,
        JobOutcome::Completed(
            "Scanned used storage for 1 organizations (0 failed) in 2 datastores.".into()
        )
    );
    assert!(setup.mock.take().is_empty());
    assert!(setup.mag_rows("orgC").await.is_empty());
    assert!(setup.attachment_rows("orgC").await.is_empty());
    assert!(recent(setup.scan_time("orgC").await));
    assert_eq!(setup.mag_rows("orgA").await.len(), 3);

    // Nothing due anymore.
    let outcome = dataset_storage::run_scan(&setup.db.pool, &setup.clients, &config(2))
        .await
        .unwrap();
    assert_eq!(
        outcome,
        JobOutcome::Completed(
            "Scanned used storage for 0 organizations (0 failed) in 2 datastores.".into()
        )
    );
    assert!(setup.mock.take().is_empty());
    setup.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL"]
async fn datastore_failure_keeps_organization_untouched_and_continues() {
    let setup = Setup::new().await;
    setup.store("s1", true, false).await;
    setup.store("s2", true, false).await;
    setup.store("off", false, false).await;
    setup.organization("orgF", 100, false).await;
    setup.organization("orgN", 90, false).await;
    setup.organization("orgG", 80, false).await;
    for org in ["orgF", "orgN", "orgG"] {
        let dataset = setup.dataset(org, "s1", &format!("ds{org}")).await;
        setup
            .mag(&dataset, "color", 1, Some(&format!("{org}/color/1")), None)
            .await;
        let dataset2 = setup.dataset(org, "s2", &format!("ds2{org}")).await;
        setup
            .mag(
                &dataset2,
                "color",
                1,
                Some(&format!("{org}/s2/color/1")),
                None,
            )
            .await;
        setup.stale_rows(org).await;
    }
    let scan_f = setup.scan_time("orgF").await;
    let scan_n = setup.scan_time("orgN").await;
    // orgF: the second store fails after the first one answered. orgN: negative size.
    setup.mock.fail("/s2/data/datasets/measureUsedStorage/orgF");
    setup
        .mock
        .sizes
        .lock()
        .unwrap()
        .insert("orgN/s2/color/1".into(), -1);

    let outcome = dataset_storage::run_scan(&setup.db.pool, &setup.clients, &config(10))
        .await
        .unwrap();
    assert_eq!(
        outcome,
        JobOutcome::Completed(
            "Scanned used storage for 3 organizations (2 failed) in 2 datastores.".into()
        )
    );
    assert_eq!(
        organizations_of(&setup.mock.take()),
        ["orgF", "orgF", "orgN", "orgN", "orgG", "orgG"]
    );
    for (org, scan) in [("orgF", scan_f), ("orgN", scan_n)] {
        let mags = setup.mag_rows(org).await;
        assert_eq!(mags.len(), 1);
        assert_eq!(mags[0].1, "stale");
        assert_eq!(setup.attachment_rows(org).await.len(), 1);
        assert_eq!(setup.scan_time(org).await, scan);
    }
    let paths: Vec<String> = setup
        .mag_rows("orgG")
        .await
        .into_iter()
        .map(|row| row.3)
        .collect();
    assert_eq!(paths, ["orgG/color/1", "orgG/s2/color/1"]);
    assert!(setup.attachment_rows("orgG").await.is_empty());
    assert!(recent(setup.scan_time("orgG").await));
    setup.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL"]
async fn paths_are_measured_in_batches_of_200() {
    let setup = Setup::new().await;
    setup.store("s1", true, false).await;
    setup.organization("orgP", 30, false).await;
    let dataset = setup.dataset("orgP", "s1", "dsP").await;
    for mag in 1..=201 {
        setup
            .mag(
                &dataset,
                "color",
                mag,
                Some(&format!("dsP/color/{mag}")),
                None,
            )
            .await;
    }
    dataset_storage::run_scan(&setup.db.pool, &setup.clients, &config(10))
        .await
        .unwrap();
    let calls = setup.mock.take();
    assert_eq!(
        calls
            .iter()
            .map(|(_, paths)| paths.len())
            .collect::<Vec<_>>(),
        [200, 1]
    );
    assert_eq!(setup.mag_rows("orgP").await.len(), 201);
    setup.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL"]
async fn without_reporting_datastores_rows_are_cleared_like_scala() {
    let setup = Setup::new().await;
    setup.store("off", false, false).await;
    setup.organization("orgQ", 30, false).await;
    let dataset = setup.dataset("orgQ", "off", "dsQ").await;
    setup
        .mag(&dataset, "color", 1, Some("dsQ/color/1"), None)
        .await;
    setup.stale_rows("orgQ").await;
    let outcome = dataset_storage::run_scan(&setup.db.pool, &setup.clients, &config(10))
        .await
        .unwrap();
    assert_eq!(
        outcome,
        JobOutcome::Completed(
            "Scanned used storage for 1 organizations (0 failed) in 0 datastores.".into()
        )
    );
    assert!(setup.mock.take().is_empty());
    assert!(setup.mag_rows("orgQ").await.is_empty());
    assert!(setup.attachment_rows("orgQ").await.is_empty());
    assert!(recent(setup.scan_time("orgQ").await));
    setup.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL"]
async fn lock_contention_skips_the_run() {
    let setup = Setup::new().await;
    setup.store("s1", true, false).await;
    setup.organization("orgL", 30, false).await;
    let dataset = setup.dataset("orgL", "s1", "dsL").await;
    setup
        .mag(&dataset, "color", 1, Some("dsL/color/1"), None)
        .await;
    let scan = setup.scan_time("orgL").await;

    let mut holder = setup.db.pool.begin().await.unwrap();
    assert!(
        try_advisory_xact_lock(&mut holder, advisory_lock_key(JOB_NAME))
            .await
            .unwrap()
    );
    let contenders = (0..3).map(|_| {
        let pool = setup.db.pool.clone();
        let clients = setup.clients.clone();
        async move {
            dataset_storage::run_scan(&pool, &clients, &config(10))
                .await
                .unwrap()
        }
    });
    for outcome in futures_util::future::join_all(contenders).await {
        assert_eq!(outcome, JobOutcome::SkippedLocked);
    }
    assert!(setup.mock.take().is_empty());
    assert_eq!(setup.scan_time("orgL").await, scan);
    holder.rollback().await.unwrap();

    // Parallel runs after release: exactly one scans, the others skip or find nothing due.
    let runs = (0..3).map(|_| {
        let pool = setup.db.pool.clone();
        let clients = setup.clients.clone();
        async move {
            dataset_storage::run_scan(&pool, &clients, &config(10))
                .await
                .unwrap()
        }
    });
    futures_util::future::join_all(runs).await;
    assert_eq!(organizations_of(&setup.mock.take()), ["orgL"]);
    assert_eq!(setup.mag_rows("orgL").await.len(), 1);
    assert!(recent(setup.scan_time("orgL").await));
    setup.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL"]
async fn spawned_scheduler_scans_and_shuts_down() {
    let setup = Setup::new().await;
    setup.store("s1", true, false).await;
    setup.organization("orgS", 30, false).await;
    let dataset = setup.dataset("orgS", "s1", "dsS").await;
    setup
        .mag(&dataset, "color", 1, Some("dsS/color/1"), None)
        .await;
    let config = UsedStorageConfig {
        schedule: JobSchedule {
            enabled: true,
            interval: Duration::from_secs(3600),
            initial_delay: Duration::ZERO,
        },
        ..config(10)
    };
    let handle = dataset_storage::spawn(setup.db.pool.clone(), setup.clients.clone(), &config);
    assert_eq!(handle.job_names(), [JOB_NAME]);
    let deadline = Instant::now() + Duration::from_secs(10);
    while setup.mag_rows("orgS").await.is_empty() {
        assert!(Instant::now() < deadline, "scan did not run");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    tokio::time::timeout(Duration::from_secs(5), handle.shutdown())
        .await
        .unwrap();
    assert_eq!(organizations_of(&setup.mock.take()), ["orgS"]);
    setup.cleanup().await;
}
