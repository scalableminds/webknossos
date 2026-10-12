mod common;

use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    Extension, Router,
    body::{Body, to_bytes},
    extract::{Request, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use common::{TestDb, object_id};
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{
    AppState, remote_datastore,
    service_clients::{ServiceClientConfig, ServiceClients},
};

const UNREPORTED: &str = "No longer available on datastore.";

#[derive(Clone, Default)]
struct Calls(Arc<Mutex<Vec<String>>>);

impl Calls {
    fn take(&self) -> Vec<String> {
        let mut calls = std::mem::take(&mut *self.0.lock().unwrap());
        calls.sort();
        calls
    }
}

async fn datastore(State(calls): State<Calls>, request: Request) -> Response {
    calls
        .0
        .lock()
        .unwrap()
        .push(format!("{} {}", request.method(), request.uri().path()));
    StatusCode::OK.into_response()
}

struct Setup {
    db: TestDb,
    app: Router,
    calls: Calls,
    server: tokio::task::JoinHandle<()>,
}

async fn setup() -> Setup {
    let db = TestDb::new().await;
    let calls = Calls::default();
    let mock = Router::new().fallback(datastore).with_state(calls.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, mock).await.unwrap() });
    for (name, url, key, scratch) in [
        ("store", base.as_str(), "k", false),
        ("scratch", "http://scratch.invalid", "s", true),
        ("other", "http://other.invalid", "o", false),
    ] {
        sqlx::query("INSERT INTO webknossos.dataStores (name,url,publicUrl,key,isScratch) VALUES ($1,$2,$3,$4,$5)")
            .bind(name).bind(url).bind(format!("http://public-{name}.invalid")).bind(key).bind(scratch)
            .execute(&db.pool).await.unwrap();
    }
    let clients = ServiceClients::new(ServiceClientConfig {
        request_timeout: Duration::from_secs(5),
        connect_timeout: Duration::from_secs(1),
        max_response_bytes: 1 << 20,
        rpc_token: "rpc-secret".to_owned(),
    })
    .unwrap();
    let app = remote_datastore::router()
        .layer(Extension(clients))
        .with_state(AppState {
            pool: db.pool.clone(),
        });
    Setup {
        db,
        app,
        calls,
        server,
    }
}

async fn call(app: &Router, method: &str, uri: &str, body: Option<Value>) -> (StatusCode, Value) {
    let mut builder = axum::http::Request::builder().method(method).uri(uri);
    if body.is_some() {
        builder = builder.header("content-type", "application/json");
    }
    let response = app
        .clone()
        .oneshot(
            builder
                .body(body.map_or_else(Body::empty, |b| Body::from(b.to_string())))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1 << 20).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

/// A usable non-virtual dataset with one color layer and one mag.
async fn seed(
    db: &TestDb,
    organization: &str,
    directory: &str,
    store: &str,
    is_virtual: bool,
) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.datasets (_id,_dataStore,_organization,_folder,name,directoryName,isUsable,isVirtual,voxelSizeFactor,voxelSizeUnit,inboxSourceHash,rootPath,sortingKey) SELECT $1,$4,_id,_rootFolder,$3,$3,true,$5,ROW(1,1,1)::webknossos.VECTOR3,'nanometer',123,'/old/root',NOW() FROM webknossos.organizations WHERE _id=$2")
        .bind(&id).bind(organization).bind(directory).bind(store).bind(is_virtual)
        .execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_layers (_dataset,name,category,elementClass,boundingBox,dataFormat) VALUES ($1,'color','color','uint8',ROW(0,0,0,10,10,10)::webknossos.BOUNDING_BOX,'wkw')")
        .bind(&id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_mags (_dataset,dataLayerName,mag,path,realPath,hasLocalData) VALUES ($1,'color',ROW(1,1,1)::webknossos.VECTOR3,'./color/1','/real/color/1',true)")
        .bind(&id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_thumbnails (_dataset,dataLayerName,width,height,mappingName,image,mag,mag1BoundingBox) VALUES ($1,'',1,1,'','\\x00',ROW(1,1,1)::webknossos.VECTOR3,ROW(0,0,0,1,1,1)::webknossos.BOUNDING_BOX)")
        .bind(&id).execute(&db.pool).await.unwrap();
    id
}

fn source(directory: &str, organization: &str, layer: &str, factor: f64) -> Value {
    json!({
        "id": {"name": directory, "team": organization},
        "scale": {"factor": [factor, factor, factor], "unit": "nanometer"},
        "dataLayers": [{
            "name": layer, "category": "segmentation", "dataFormat": "zarr3", "elementClass": "uint32",
            "boundingBox": {"topLeft": [0, 0, 0], "width": 5, "height": 5, "depth": 5},
            "mags": [{"mag": [1, 1, 1], "path": "s3://bucket/x/./y"}],
            "largestSegmentId": 7
        }]
    })
}

#[derive(Debug, PartialEq, sqlx::FromRow)]
struct Row {
    data_store: String,
    is_usable: bool,
    status: String,
    has_hash: bool,
    has_voxel_size: bool,
    root_path: Option<String>,
    layers: Vec<String>,
}

async fn row(db: &TestDb, id: &str) -> Row {
    sqlx::query_as(
        r#"SELECT _dataStore AS data_store, isUsable AS is_usable, status, inboxSourceHash IS NOT NULL AS has_hash,
             voxelSizeFactor IS NOT NULL AS has_voxel_size, rootPath AS root_path,
             ARRAY(SELECT name FROM webknossos.dataset_layers l WHERE l._dataset = d._id ORDER BY name) AS layers
           FROM webknossos.datasets d WHERE _id = $1"#,
    )
    .bind(id)
    .fetch_one(&db.pool)
    .await
    .unwrap()
}

async fn hash(db: &TestDb, id: &str) -> Option<i32> {
    sqlx::query_scalar("SELECT inboxSourceHash FROM webknossos.datasets WHERE _id = $1")
        .bind(id)
        .fetch_one(&db.pool)
        .await
        .unwrap()
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL database with CREATEDB"]
async fn access_status_and_per_dataset_rpcs() {
    let Setup {
        db,
        app,
        calls,
        server,
    } = setup().await;
    let fixture = db.fixture().await;
    let org = fixture.organization_id.as_str();
    let forbidden = json!({"granted": false, "msg": "Data store could not be found or accessed."});
    let status_body = json!({"ok": true, "url": "http://updated.invalid"});

    // Key validation: wrong key, unknown and deleted stores are 403 without touching the body.
    assert_eq!(
        call(
            &app,
            "PATCH",
            "/datastores/other/status?key=wrong",
            Some(status_body.clone())
        )
        .await,
        (StatusCode::FORBIDDEN, forbidden.clone())
    );
    assert_eq!(
        call(
            &app,
            "PATCH",
            "/datastores/missing/status?key=o",
            Some(json!("garbage"))
        )
        .await,
        (StatusCode::FORBIDDEN, forbidden.clone())
    );
    assert_eq!(
        call(
            &app,
            "PATCH",
            "/datastores/other/status",
            Some(status_body.clone())
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        call(
            &app,
            "PATCH",
            "/datastores/other/status?key=o",
            Some(json!({"ok": "yes"}))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        call(
            &app,
            "PATCH",
            "/datastores/other/status?key=o",
            Some(status_body.clone())
        )
        .await,
        (StatusCode::OK, Value::Null)
    );
    let url: String =
        sqlx::query_scalar("SELECT url FROM webknossos.dataStores WHERE name = 'other'")
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(url, "http://updated.invalid");
    sqlx::query("UPDATE webknossos.dataStores SET isDeleted = true WHERE name = 'other'")
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        call(
            &app,
            "PATCH",
            "/datastores/other/status?key=o",
            Some(status_body)
        )
        .await,
        (StatusCode::FORBIDDEN, forbidden.clone())
    );

    // GET data source: not found, usable (real paths, credential ids), unusable.
    let missing = object_id();
    let (status, body) = call(
        &app,
        "GET",
        &format!("/datastores/store/datasources/{missing}?key=k"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        body["messages"][0]["error"],
        format!("Dataset “{missing}” could not be found or accessed.")
    );
    assert_eq!(
        call(
            &app,
            "GET",
            "/datastores/store/datasources/nope?key=k",
            None
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let id = seed(&db, org, "plain", "store", false).await;
    sqlx::query("UPDATE webknossos.dataset_mags SET credentialId = 'cred-1' WHERE _dataset = $1")
        .bind(&id)
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, body) = call(
        &app,
        "GET",
        &format!("/datastores/scratch/datasources/{id}?key=s"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["id"], json!({"name": "plain", "team": org}));
    assert_eq!(
        body["scale"],
        json!({"factor": [1, 1, 1], "unit": "nanometer"})
    );
    let mag = &body["dataLayers"][0]["mags"][0];
    assert_eq!(
        (&mag["mag"], &mag["path"], &mag["credentialId"]),
        (&json!([1, 1, 1]), &json!("/real/color/1"), &json!("cred-1"))
    );
    assert!(body.get("status").is_none());
    let broken = seed(&db, org, "broken", "store", false).await;
    sqlx::query("UPDATE webknossos.datasets SET isUsable = false, status = 'bad', voxelSizeFactor = NULL WHERE _id = $1")
        .bind(&broken).execute(&db.pool).await.unwrap();
    assert_eq!(
        call(
            &app,
            "GET",
            &format!("/datastores/store/datasources/{broken}?key=k"),
            None
        )
        .await,
        (
            StatusCode::OK,
            json!({"id": {"name": "broken", "team": org}, "status": "bad"})
        )
    );
    sqlx::query("UPDATE webknossos.datasets SET isUsable = true WHERE _id = $1")
        .bind(&broken)
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, body) = call(
        &app,
        "GET",
        &format!("/datastores/store/datasources/{broken}?key=k"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body["messages"][0]["error"],
        "Dataset is marked as usable but has no voxel size."
    );

    // PUT data source: replaces layers + voxel size, keeps root path, no RPC.
    let uri = format!("/datastores/scratch/datasources/{id}?key=s");
    assert_eq!(
        call(&app, "PUT", &uri, Some(json!({"id": {"name": "plain"}})))
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        call(&app, "PUT", &uri, Some(source("plain", org, "seg", 2.0))).await,
        (StatusCode::OK, Value::Null)
    );
    let updated = row(&db, &id).await;
    assert_eq!(
        updated,
        Row {
            data_store: "scratch".into(),
            is_usable: true,
            status: String::new(),
            has_hash: true,
            has_voxel_size: true,
            root_path: Some("/old/root".into()),
            layers: vec!["seg".into()],
        }
    );
    let (path, largest): (Option<String>, Option<i64>) = sqlx::query_as(
        "SELECT m.path, l.largestSegmentId FROM webknossos.dataset_mags m JOIN webknossos.dataset_layers l ON l._dataset = m._dataset AND l.name = m.dataLayerName WHERE m._dataset = $1",
    )
    .bind(&id)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(path.as_deref(), Some("s3://bucket/x/y"));
    assert_eq!(largest, Some(7));
    // Unusable report: status set, layers removed, voxel size cleared.
    assert_eq!(
        call(
            &app,
            "PUT",
            &uri,
            Some(json!({"id": {"name": "plain", "team": org}, "status": "Broken."}))
        )
        .await
        .0,
        StatusCode::OK
    );
    let updated = row(&db, &id).await;
    assert!(!updated.is_usable && !updated.has_voxel_size && updated.layers.is_empty());
    assert_eq!(updated.status, "Broken.");
    // Virtual datasets are left untouched; unknown organizations are Fox.Empty.
    let virtual_id = seed(&db, org, "virtual", "store", true).await;
    assert_eq!(
        call(
            &app,
            "PUT",
            &format!("/datastores/store/datasources/{virtual_id}?key=k"),
            Some(source("virtual", org, "seg", 2.0))
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(row(&db, &virtual_id).await.layers, vec!["color".to_owned()]);
    assert_eq!(
        call(
            &app,
            "PUT",
            &uri,
            Some(source("plain", "no-such-org", "seg", 2.0))
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );

    // Real paths: only matching paths change, unknown data sources are skipped.
    let real = seed(&db, org, "real", "store", false).await;
    sqlx::query("INSERT INTO webknossos.dataset_layers (_dataset,name,category,elementClass,boundingBox,dataFormat) VALUES ($1,'seg','segmentation','uint8',ROW(0,0,0,10,10,10)::webknossos.BOUNDING_BOX,'zarr3')")
        .bind(&real).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_layer_attachments (_dataset,layerName,name,path,type,dataFormat) VALUES ($1,'seg','m','s3://b/meshes/m','mesh','hdf5')")
        .bind(&real).execute(&db.pool).await.unwrap();
    let report = json!([
        {"dataSourceId": {"name": "real", "team": org},
         "magPathInfos": [
            {"path": "color/1", "realPath": "/mnt/x/../color/1", "hasLocalData": false},
            {"path": "./unknown", "realPath": "/u", "hasLocalData": true}],
         "attachmentPathInfos": [{"path": "s3://b/meshes/./m", "realPath": "s3://real/m", "hasLocalData": false}]},
        {"dataSourceId": {"name": "absent", "team": org}, "magPathInfos": [], "attachmentPathInfos": []}
    ]);
    assert_eq!(
        call(
            &app,
            "PUT",
            "/datastores/store/datasources/realpaths?key=k",
            Some(json!([{"dataSourceId": {"name": "real", "team": org}, "magPathInfos": []}]))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        call(
            &app,
            "PUT",
            "/datastores/store/datasources/realpaths?key=k",
            Some(report)
        )
        .await,
        (StatusCode::OK, Value::Null)
    );
    let mag: (Option<String>, bool) = sqlx::query_as(
        "SELECT realPath, hasLocalData FROM webknossos.dataset_mags WHERE _dataset = $1",
    )
    .bind(&real)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(mag, (Some("/mnt/color/1".to_owned()), false));
    let attachment: (Option<String>, bool) = sqlx::query_as(
        "SELECT realPath, hasLocalData FROM webknossos.dataset_layer_attachments WHERE _dataset = $1",
    )
    .bind(&real)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(attachment, (Some("s3://real/m".to_owned()), false));

    assert_eq!(calls.take(), Vec::<String>::new());
    server.abort();
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL database with CREATEDB"]
async fn inbox_reports_update_create_skip_and_deactivate() {
    let Setup {
        db,
        app,
        calls,
        server,
    } = setup().await;
    let a = db.fixture().await.organization_id;
    let b = db.fixture().await.organization_id;
    let known = seed(&db, &a, "known", "store", false).await;
    let virtual_id = seed(&db, &a, "virt", "store", true).await;
    let from_scratch = seed(&db, &a, "fromScratch", "scratch", false).await;
    let from_other = seed(&db, &a, "otherStore", "other", false).await;
    let gone = seed(&db, &a, "gone", "store", false).await;
    let gone_b = seed(&db, &b, "bgone", "store", false).await;
    let report = json!([
        {"dataSource": source("known", &a, "seg", 1.0), "rootPath": "/new/root", "rootRealPath": null},
        {"dataSource": source("virt", &a, "seg", 1.0)},
        {"dataSource": source("fromScratch", &a, "seg", 1.0), "rootPath": "/old/root"},
        {"dataSource": source("otherStore", &a, "seg", 1.0)},
        {"dataSource": source("fresh", &a, "seg", 3.0), "rootPath": "/fresh"},
        {"dataSource": {"id": {"name": "freshBroken", "team": &a}, "status": "No datasource-properties.json"}},
        {"dataSource": source("ghost", "no-such-org", "seg", 1.0)}
    ]);
    let uri = format!("/datastores/store/datasources?key=k&organizationId={a}");
    assert_eq!(
        call(
            &app,
            "PUT",
            "/datastores/store/datasources?key=k",
            Some(json!({}))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        call(&app, "PUT", &uri, Some(report.clone())).await,
        (StatusCode::OK, Value::Null)
    );
    let updated = row(&db, &known).await;
    assert_eq!(updated.layers, vec!["seg".to_owned()]);
    assert_eq!(updated.root_path.as_deref(), Some("/new/root"));
    assert!(updated.has_hash);
    let thumbnails: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM webknossos.dataset_thumbnails WHERE _dataset = ANY($1)",
    )
    .bind(vec![known.clone(), from_scratch.clone()])
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(thumbnails, 0);
    assert_eq!(row(&db, &virtual_id).await.layers, vec!["color".to_owned()]);
    let replaced = row(&db, &from_scratch).await;
    assert_eq!(
        (replaced.data_store.as_str(), replaced.layers),
        ("store", vec!["seg".to_owned()])
    );
    let kept = row(&db, &from_other).await;
    assert_eq!(
        (kept.data_store.as_str(), kept.status.as_str(), kept.layers),
        ("other", "", vec!["color".to_owned()])
    );
    let deactivated = row(&db, &gone).await;
    assert_eq!(
        deactivated,
        Row {
            data_store: "store".into(),
            is_usable: false,
            status: UNREPORTED.into(),
            has_hash: false,
            has_voxel_size: false,
            root_path: Some("/old/root".into()),
            layers: vec![],
        }
    );
    assert!(row(&db, &gone_b).await.is_usable);
    type Created = (String, bool, String, bool, Option<String>, String, bool);
    let created: Vec<Created> = sqlx::query_as(
        r#"SELECT directoryName, isUsable, status, inboxSourceHash IS NOT NULL, rootPath, creationType::text,
             d._folder = o._rootFolder AND d.name = d.directoryName AND NOT d.isVirtual AND NOT d.isPublic AND d._uploader IS NULL
           FROM webknossos.datasets d JOIN webknossos.organizations o ON o._id = d._organization
           WHERE directoryName IN ('fresh', 'freshBroken', 'ghost') ORDER BY directoryName"#,
    )
    .fetch_all(&db.pool)
    .await
    .unwrap();
    assert_eq!(
        created,
        vec![
            (
                "fresh".into(),
                true,
                String::new(),
                true,
                Some("/fresh".into()),
                "DiskScan".into(),
                true
            ),
            (
                "freshBroken".into(),
                false,
                "No datasource-properties.json".into(),
                false,
                None,
                "DiskScan".into(),
                true
            ),
        ]
    );
    assert_eq!(calls.take(), {
        let mut expected = vec![
            format!("DELETE /data/datasets/{from_scratch}"),
            format!("DELETE /data/datasets/{known}"),
        ];
        expected.sort();
        expected
    });

    // An identical report is skipped by hash: no rewrite, no invalidation
    // (a stored root path differing from the reported one would force one).
    let before = hash(&db, &known).await;
    sqlx::query("UPDATE webknossos.dataset_layers SET elementClass = 'uint8' WHERE _dataset = $1")
        .bind(&known)
        .execute(&db.pool)
        .await
        .unwrap();
    // Unusable sources are created without hash (as in Scala), so the second
    // report rewrites them once; the third report skips everything.
    let fresh_broken: String = sqlx::query_scalar(
        "SELECT _id FROM webknossos.datasets WHERE directoryName = 'freshBroken'",
    )
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(
        call(&app, "PUT", &uri, Some(report.clone())).await.0,
        StatusCode::OK
    );
    assert_eq!(
        calls.take(),
        vec![format!("DELETE /data/datasets/{fresh_broken}")]
    );
    assert!(hash(&db, &fresh_broken).await.is_some());
    assert_eq!(
        call(&app, "PUT", &uri, Some(report.clone())).await.0,
        StatusCode::OK
    );
    assert_eq!(calls.take(), Vec::<String>::new());
    assert_eq!(hash(&db, &known).await, before);
    let element_class: String = sqlx::query_scalar(
        "SELECT elementClass::text FROM webknossos.dataset_layers WHERE _dataset = $1",
    )
    .bind(&known)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(element_class, "uint8");

    // Single data source report: rewrites (root path None differs), keeps root path.
    assert_eq!(
        call(
            &app,
            "PUT",
            "/datastores/store/datasource?key=k",
            Some(source("known", &a, "other", 1.0))
        )
        .await,
        (StatusCode::OK, Value::Null)
    );
    let single = row(&db, &known).await;
    assert_eq!(single.layers, vec!["other".to_owned()]);
    assert_eq!(single.root_path.as_deref(), Some("/new/root"));
    assert_eq!(calls.take(), vec![format!("DELETE /data/datasets/{known}")]);

    // Atomic: a failing creation (directory name held by a deleted row) rolls back everything.
    sqlx::query("UPDATE webknossos.datasets SET isDeleted = true WHERE _id = $1")
        .bind(&from_other)
        .execute(&db.pool)
        .await
        .unwrap();
    let failing = json!([
        {"dataSource": source("known", &a, "changed", 1.0)},
        {"dataSource": source("otherStore", &a, "seg", 1.0)}
    ]);
    assert_eq!(
        call(
            &app,
            "PUT",
            "/datastores/store/datasources?key=k",
            Some(failing)
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(row(&db, &known).await.layers, vec!["other".to_owned()]);
    assert!(row(&db, &gone_b).await.is_usable);
    assert_eq!(calls.take(), Vec::<String>::new());

    // Organization-restricted datastores ignore other organizations; without an
    // organization filter, every unreported non-virtual dataset is deactivated.
    sqlx::query(
        "UPDATE webknossos.dataStores SET onlyAllowedOrganization = $1 WHERE name = 'store'",
    )
    .bind(&a)
    .execute(&db.pool)
    .await
    .unwrap();
    assert_eq!(
        call(
            &app,
            "PUT",
            "/datastores/store/datasources?key=k",
            Some(json!([{"dataSource": source("bgone", &b, "seg", 1.0)}]))
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(row(&db, &gone_b).await.status, UNREPORTED);
    assert_eq!(row(&db, &known).await.status, UNREPORTED);
    assert!(row(&db, &virtual_id).await.is_usable);
    assert_eq!(calls.take(), Vec::<String>::new());

    server.abort();
    db.cleanup().await;
}
