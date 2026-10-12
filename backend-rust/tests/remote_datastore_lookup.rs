mod common;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::StatusCode,
};
use common::{TestDb, object_id};
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{AppState, remote_datastore_lookup};

async fn setup() -> (TestDb, Router) {
    let db = TestDb::new().await;
    for (store, key) in [("store", "service-key"), ("other", "other-key")] {
        sqlx::query(
            "INSERT INTO webknossos.dataStores (name,url,publicUrl,key) VALUES ($1,$3,$4,$2)",
        )
        .bind(store)
        .bind(key)
        .bind(format!("http://{store}.invalid"))
        .bind(format!("http://public-{store}.invalid"))
        .execute(&db.pool)
        .await
        .unwrap();
    }
    let app = remote_datastore_lookup::router().with_state(AppState {
        pool: db.pool.clone(),
    });
    (db, app)
}

async fn call(app: &Router, method: &str, uri: &str, body: Option<Value>) -> (StatusCode, Value) {
    let mut request = axum::http::Request::builder().method(method).uri(uri);
    let body = if let Some(body) = body {
        request = request.header("content-type", "application/json");
        Body::from(body.to_string())
    } else {
        Body::empty()
    };
    let response = app
        .clone()
        .oneshot(request.body(body).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1 << 20).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

fn error(message: &str) -> Value {
    json!({"messages": [{"error": message}]})
}
fn forbidden() -> Value {
    json!({"granted": false, "msg": "Data store could not be found or accessed."})
}
fn id_lookup(directory: &str, organization: &str) -> String {
    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("key", "service-key")
        .append_pair("datasetDirectoryName", directory)
        .append_pair("organizationId", organization)
        .finish();
    format!("/datastores/store/findDatasetId?{query}")
}

async fn seed_dataset(db: &TestDb, organization: &str, directory: &str) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.datasets (_id,_organization,_dataStore,_folder,name,directoryName,isUsable,voxelSizeFactor,sortingKey) SELECT $1,_id,'other',_rootFolder,'Display name',$2,TRUE,ROW(1,1,1)::webknossos.VECTOR3,NOW() FROM webknossos.organizations WHERE _id=$3")
        .bind(&id).bind(directory).bind(organization).execute(&db.pool).await.unwrap();
    id
}

async fn seed_layers(db: &TestDb, dataset: &str, organization: &str) {
    sqlx::query("INSERT INTO webknossos.dataset_layers (_dataset,name,category,elementClass,boundingBox,dataFormat) VALUES ($1,'seg','segmentation','uint32',ROW(0,0,0,10,10,10)::webknossos.BOUNDING_BOX,'zarr3')")
        .bind(dataset).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_mags (_dataset,dataLayerName,mag,path) VALUES ($1,'seg',ROW(1,1,1)::webknossos.VECTOR3,'/data/seg/1')")
        .bind(dataset).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_layer_attachments (_dataset,layerName,name,path,type,dataFormat) VALUES ($1,'seg','mesh','/data/seg/meshes','mesh','hdf5')")
        .bind(dataset).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.organization_usedStorage_mags (_dataset,layerName,mag,path,_organization,usedStorageBytes) VALUES ($1,'seg',ROW(1,1,1)::webknossos.VECTOR3,'/data/seg/1',$2,100)")
        .bind(dataset).bind(organization).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.organization_usedStorage_attachments (_dataset,layerName,name,path,type,_organization,usedStorageBytes) VALUES ($1,'seg','mesh','/data/seg/meshes','mesh',$2,200)")
        .bind(dataset).bind(organization).execute(&db.pool).await.unwrap();
}

async fn rows_for(db: &TestDb, dataset: &str) -> (i64, i64, i64, i64, i64) {
    sqlx::query_as("SELECT (SELECT COUNT(*) FROM webknossos.dataset_layers WHERE _dataset=$1), (SELECT COUNT(*) FROM webknossos.dataset_mags WHERE _dataset=$1), (SELECT COUNT(*) FROM webknossos.dataset_layer_attachments WHERE _dataset=$1), (SELECT COUNT(*) FROM webknossos.organization_usedStorage_mags WHERE _dataset=$1), (SELECT COUNT(*) FROM webknossos.organization_usedStorage_attachments WHERE _dataset=$1)")
        .bind(dataset).fetch_one(&db.pool).await.unwrap()
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn datastore_keys_directory_lookup_and_local_root_contracts() {
    let (db, app) = setup().await;
    let owner = db.fixture().await;
    let different_org = db.fixture().await;
    let dataset = seed_dataset(&db, &owner.organization_id, "directory with spaces").await;
    let same_directory =
        seed_dataset(&db, &different_org.organization_id, "directory with spaces").await;
    let uri = id_lookup("directory with spaces", &owner.organization_id);
    assert_eq!(
        call(&app, "GET", &uri, None).await,
        (StatusCode::OK, json!(dataset))
    );
    assert_eq!(
        call(
            &app,
            "GET",
            &id_lookup("directory with spaces", &different_org.organization_id),
            None
        )
        .await,
        (StatusCode::OK, json!(same_directory))
    );
    // A service key grants global lookup; it need not be the dataset's own store
    // and onlyAllowedOrganization does not constrain this callback in Scala.
    sqlx::query("UPDATE webknossos.dataStores SET onlyAllowedOrganization=$1 WHERE name='store'")
        .bind(&different_org.organization_id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(call(&app, "GET", &uri, None).await.0, StatusCode::OK);
    assert_eq!(
        call(&app, "GET", &uri.replace("service-key", "wrong"), None).await,
        (StatusCode::FORBIDDEN, forbidden())
    );
    assert_eq!(
        call(&app, "GET", &uri.replace("/store/", "/missing/"), None).await,
        (StatusCode::FORBIDDEN, forbidden())
    );
    assert_eq!(
        call(
            &app,
            "GET",
            "/datastores/store/findDatasetId?key=service-key",
            None
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        call(&app, "GET", &uri.replace("key=service-key&", ""), None)
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    for directory in ["Display name", "x' OR TRUE --"] {
        assert_eq!(
            call(
                &app,
                "GET",
                &id_lookup(directory, &owner.organization_id),
                None
            )
            .await,
            (
                StatusCode::BAD_REQUEST,
                error(&format!(
                    "Dataset with name “{directory}” could not be found or accessed."
                ))
            )
        );
    }
    assert_eq!(
        call(
            &app,
            "GET",
            &id_lookup("directory with spaces", "missing-org"),
            None
        )
        .await,
        (
            StatusCode::NOT_FOUND,
            error("Organization “missing-org” could not be found or accessed.")
        )
    );
    let local = format!(
        "/datastores/other/findDatasetLocalRootPath?key=other-key&datasetId={}",
        dataset.to_uppercase()
    );
    for (root, expected) in [
        (Some("/data/../original/root"), "/data/../original/root"),
        (Some("relative/path"), "relative/path"),
        (Some("file:///data/root"), "file:///data/root"),
        (Some("s3://bucket/root"), ""),
        (Some("a|zip|zip"), ""),
        (None, ""),
    ] {
        sqlx::query("UPDATE webknossos.datasets SET rootPath=$2, rootRealPath='/must/not/fallback' WHERE _id=$1")
            .bind(&dataset).bind(root).execute(&db.pool).await.unwrap();
        assert_eq!(
            call(&app, "GET", &local, None).await,
            (StatusCode::OK, json!(expected))
        );
    }
    assert_eq!(
        call(
            &app,
            "GET",
            &local
                .replace("/other/", "/store/")
                .replace("other-key", "service-key"),
            None
        )
        .await,
        (
            StatusCode::FORBIDDEN,
            error("You are not authorized to view or edit this resource.")
        )
    );
    assert_eq!(call(&app, "GET", "/datastores/other/findDatasetLocalRootPath?key=other-key&datasetId=prefix-0123456789abcdef01234567", None).await.0, StatusCode::BAD_REQUEST);
    let missing = object_id();
    assert_eq!(
        call(
            &app,
            "GET",
            &format!(
                "/datastores/other/findDatasetLocalRootPath?key=other-key&datasetId={missing}"
            ),
            None
        )
        .await,
        (
            StatusCode::BAD_REQUEST,
            error(&format!(
                "Dataset “{missing}” could not be found or accessed."
            ))
        )
    );
    sqlx::query("UPDATE webknossos.datasets SET isDeleted=TRUE WHERE _id=$1")
        .bind(&dataset)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        call(&app, "GET", &uri, None).await.0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        call(&app, "GET", &local, None).await.0,
        StatusCode::BAD_REQUEST
    );
    sqlx::query("UPDATE webknossos.organizations SET isDeleted=TRUE WHERE _id=$1")
        .bind(&different_org.organization_id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        call(
            &app,
            "GET",
            &id_lookup("directory with spaces", &different_org.organization_id),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    sqlx::query("UPDATE webknossos.dataStores SET isDeleted=TRUE WHERE name='store'")
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        call(&app, "GET", &uri, None).await,
        (StatusCode::FORBIDDEN, forbidden())
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn deletion_is_idempotent_transactional_and_retains_annotated_datasets() {
    let (db, app) = setup().await;
    let owner = db.fixture().await;
    let hard = seed_dataset(&db, &owner.organization_id, "hard").await;
    seed_layers(&db, &hard, &owner.organization_id).await;
    let endpoint = "/datastores/store/deleteDataset?key=service-key";
    assert_eq!(
        call(
            &app,
            "POST",
            "/datastores/store/deleteDataset?key=wrong",
            Some(json!(hard))
        )
        .await,
        (StatusCode::FORBIDDEN, forbidden())
    );
    assert_eq!(
        call(&app, "POST", endpoint, Some(json!({"id": hard})))
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        call(
            &app,
            "POST",
            endpoint,
            Some(json!(format!("prefix-{hard}")))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(rows_for(&db, &hard).await, (1, 1, 1, 1, 1));
    // No user token or dataset-own-store match is required by the Scala callback.
    // Pending conversion jobs are not cancelled by this database-only callback.
    let conversion = object_id();
    sqlx::query("INSERT INTO webknossos.jobs (_id,_owner,_dataStore,command,commandArgs,state) VALUES ($1,$2,'other','convert_to_wkw',$3,'PENDING')")
        .bind(&conversion).bind(&owner.user_id).bind(json!({"dataset_id": hard})).execute(&db.pool).await.unwrap();
    let (a, b) = tokio::join!(
        call(&app, "POST", endpoint, Some(json!(hard.to_uppercase()))),
        call(&app, "POST", endpoint, Some(json!(hard)))
    );
    assert_eq!(a, (StatusCode::OK, Value::Null));
    assert_eq!(b, (StatusCode::OK, Value::Null));
    assert_eq!(rows_for(&db, &hard).await, (0, 0, 0, 0, 0));
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM webknossos.datasets WHERE _id=$1)")
            .bind(&hard)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert!(!exists);
    let manual: Option<String> =
        sqlx::query_scalar("SELECT manualState::text FROM webknossos.jobs WHERE _id=$1")
            .bind(&conversion)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert!(manual.is_none());
    assert_eq!(
        call(&app, "POST", endpoint, Some(json!(object_id()))).await,
        (StatusCode::OK, Value::Null)
    );
    let soft = seed_dataset(&db, &owner.organization_id, "soft").await;
    seed_layers(&db, &soft, &owner.organization_id).await;
    let annotation = object_id();
    sqlx::query("INSERT INTO webknossos.annotations (_id,_dataset,_user,typ,isDeleted) VALUES ($1,$2,$3,'Explorational',TRUE)")
        .bind(&annotation).bind(&soft).bind(&owner.user_id).execute(&db.pool).await.unwrap();
    assert_eq!(
        call(&app, "POST", endpoint, Some(json!(soft))).await,
        (StatusCode::OK, Value::Null)
    );
    let kept: (bool, bool, String) =
        sqlx::query_as("SELECT isDeleted,isUsable,status FROM webknossos.datasets WHERE _id=$1")
            .bind(&soft)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(kept, (false, false, "Deleted by user.".into()));
    assert_eq!(rows_for(&db, &soft).await, (0, 0, 0, 0, 0));
    let still_referenced: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM webknossos.annotations WHERE _id=$1 AND _dataset=$2)",
    )
    .bind(&annotation)
    .bind(&soft)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert!(still_referenced);
    // Force the final row DELETE to fail after child cleanup: everything rolls back.
    let rollback = seed_dataset(&db, &owner.organization_id, "rollback").await;
    seed_layers(&db, &rollback, &owner.organization_id).await;
    sqlx::raw_sql("CREATE FUNCTION webknossos.reject_dataset_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.directoryName='rollback' THEN RAISE EXCEPTION 'private trigger detail'; END IF; RETURN OLD; END $$; CREATE TRIGGER reject_dataset_delete BEFORE DELETE ON webknossos.datasets FOR EACH ROW EXECUTE FUNCTION webknossos.reject_dataset_delete();")
        .execute(&db.pool).await.unwrap();
    assert_eq!(
        call(&app, "POST", endpoint, Some(json!(rollback))).await,
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            error("Internal server error.")
        )
    );
    assert_eq!(rows_for(&db, &rollback).await, (1, 1, 1, 1, 1));
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn job_export_properties_require_live_job_owner_org_run_and_string_filename() {
    let (db, app) = setup().await;
    let owner = db.fixture().await;
    let job = object_id();
    sqlx::query("INSERT INTO webknossos.jobs (_id,_owner,_dataStore,command,commandArgs,state) VALUES ($1,$2,'other','export_tiff',$3,'SUCCESS')")
        .bind(&job).bind(&owner.user_id).bind(json!({"export_file_name": "out.zip", "webknossos_token": "private-job-token"})).execute(&db.pool).await.unwrap();
    let uri = format!(
        "/datastores/store/jobExportProperties?key=service-key&jobId={}",
        job.to_uppercase()
    );
    assert_eq!(
        call(&app, "GET", &uri, None).await,
        (StatusCode::BAD_REQUEST, error("Job has not run yet."))
    );
    sqlx::query("UPDATE webknossos.jobs SET latestRunId='run-123' WHERE _id=$1")
        .bind(&job)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        call(&app, "GET", &uri, None).await,
        (
            StatusCode::OK,
            json!({"jobId": job, "runId": "run-123", "organizationId": owner.organization_id, "exportFileName": "out.zip"})
        )
    );
    assert_eq!(
        call(&app, "GET", &uri.replace("service-key", "wrong"), None).await,
        (StatusCode::FORBIDDEN, forbidden())
    );
    assert_eq!(call(&app, "GET", "/datastores/store/jobExportProperties?key=service-key&jobId=prefix-0123456789abcdef01234567", None).await.0, StatusCode::BAD_REQUEST);
    for args in [json!({}), json!({"export_file_name": 42})] {
        sqlx::query("UPDATE webknossos.jobs SET commandArgs=$2 WHERE _id=$1")
            .bind(&job)
            .bind(args)
            .execute(&db.pool)
            .await
            .unwrap();
        assert_eq!(
            call(&app, "GET", &uri, None).await,
            (
                StatusCode::BAD_REQUEST,
                error("Job does not have an export file name.")
            )
        );
    }
    sqlx::query("UPDATE webknossos.jobs SET commandArgs=$2,command='unknown_command' WHERE _id=$1")
        .bind(&job)
        .bind(json!({"export_file_name": "out.zip"}))
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        call(&app, "GET", &uri, None).await,
        (
            StatusCode::BAD_REQUEST,
            error(&format!(
                "Parsing failed for row in webknossos.jobs queried by {job}"
            ))
        )
    );
    sqlx::query("UPDATE webknossos.jobs SET command='export_tiff',isDeleted=TRUE WHERE _id=$1")
        .bind(&job)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        call(&app, "GET", &uri, None).await,
        (
            StatusCode::NOT_FOUND,
            error("Could not find or access the requested resource.")
        )
    );
    sqlx::query("UPDATE webknossos.jobs SET isDeleted=FALSE WHERE _id=$1")
        .bind(&job)
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE webknossos.users SET isDeleted=TRUE WHERE _id=$1")
        .bind(&owner.user_id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(call(&app, "GET", &uri, None).await.0, StatusCode::NOT_FOUND);
    sqlx::query("UPDATE webknossos.users SET isDeleted=FALSE WHERE _id=$1")
        .bind(&owner.user_id)
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE webknossos.organizations SET isDeleted=TRUE WHERE _id=$1")
        .bind(&owner.organization_id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(call(&app, "GET", &uri, None).await.0, StatusCode::NOT_FOUND);
    db.cleanup().await;
}
