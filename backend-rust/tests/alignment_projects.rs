use crate::common;

use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    Json, Router,
    body::{Body, to_bytes},
    extract::{Request, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use common::{TestDb, object_id};
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{
    AppState, router,
    stores::client::{ServiceClientConfig, ServiceClients},
    system::application_info::MiscConfig,
};

const NOT_ENABLED: &str = "Long-running jobs are not enabled for this WEBKNOSSOS instance.";
const NO_ACCESS: &str =
    "Alignment projects are only available to administrators and dataset managers.";
const NOT_FOUND: &str = "Could not find the requested alignment project.";
const NOT_READY: &str =
    "Alignments can only be started for alignment projects with a valid, fully uploaded CSV.";
const INPUT_DATA_DELETED: &str = "The input data of this alignment project has been deleted.";
const INVALID_SECTION_RANGE: &str =
    "The selected section range is not within the sections of the alignment project.";
const JOB_NOT_FOUND: &str = "Job could not be found or accessed.";
const RETENTION_MILLIS: i64 = 90 * 86_400 * 1000;

/// One recorded datastore call: method and URI (incl. query).
type Call = (String, String);

#[derive(Clone, Default)]
struct Mock {
    calls: Arc<Mutex<Vec<Call>>>,
}

impl Mock {
    fn take(&self) -> Vec<Call> {
        std::mem::take(&mut *self.calls.lock().unwrap())
    }
}

async fn datastore(State(mock): State<Mock>, request: Request) -> Response {
    let method = request.method().to_string();
    let path = request.uri().path().to_owned();
    mock.calls
        .lock()
        .unwrap()
        .push((method.clone(), request.uri().to_string()));
    match (method.as_str(), path.as_str()) {
        ("GET", "/data/datasets/getOneBaseDirForOrgaAbsolute") => {
            Json(json!("/srv/binaryData/orga")).into_response()
        }
        ("DELETE", "/data/datasets/deletePaths") => Json(json!([])).into_response(),
        _ => StatusCode::OK.into_response(),
    }
}

struct Setup {
    db: TestDb,
    app: Router,
    disabled: Router,
    mock: Mock,
    server: tokio::task::JoinHandle<()>,
}

async fn setup() -> Setup {
    let db = TestDb::new().await;
    let mock = Mock::default();
    let upstream = Router::new().fallback(datastore).with_state(mock.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, upstream).await.unwrap() });
    sqlx::query("INSERT INTO webknossos.dataStores (name,url,publicUrl,key) VALUES ('store',$1,'http://public-store.invalid','service-key')")
        .bind(&base)
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO webknossos.workers (_id,_dataStore,key,supportedJobCommands,name) VALUES ($1,'store','worker-key','{align}','Worker')")
        .bind(object_id())
        .execute(&db.pool)
        .await
        .unwrap();
    let clients = || {
        ServiceClients::new(ServiceClientConfig {
            request_timeout: Duration::from_secs(5),
            connect_timeout: Duration::from_secs(1),
            max_response_bytes: 1 << 20,
            rpc_token: "rpc-secret".to_owned(),
        })
        .unwrap()
    };
    let app = router(
        AppState::builder(db.pool.clone())
            .jobs_enabled(true)
            .misc(MiscConfig {
                jobs_enabled: true,
                ..MiscConfig::default()
            })
            .clients(clients())
            .build(),
    );
    let disabled = router(
        AppState::builder(db.pool.clone())
            .clients(clients())
            .build(),
    );
    Setup {
        db,
        app,
        disabled,
        mock,
        server,
    }
}

async fn call(
    app: &Router,
    method: &str,
    uri: &str,
    token: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut request = axum::http::Request::builder()
        .method(method)
        .uri(uri)
        .header("X-Auth-Token", token);
    if body.is_some() {
        request = request.header("content-type", "application/json");
    }
    let body = body.map_or_else(Body::empty, |body| Body::from(body.to_string()));
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

/// A project of `owner` on datastore `store`, created at second 1000, with a 2 GB tile upload.
async fn seed_project(
    db: &TestDb,
    organization: &str,
    owner: &str,
    name: &str,
    status: &str,
    sections: Option<(i32, i32)>,
) -> String {
    let id = object_id();
    sqlx::query(
        r#"INSERT INTO webknossos.alignmentProjects (_id,_organization,_owner,_dataStore,name,status,
            voxelSizeFactor,voxelSizeUnit,csvPath,fileCount,totalSizeInBytes,firstSection,lastSection,created)
          VALUES ($1,$2,$3,'store',$4,$5::webknossos.ALIGNMENT_PROJECT_STATUS,ROW(1,2,3)::webknossos.VECTOR3,
            'nanometer','tiles/tiles.csv',10,2000000000,$6,$7,to_timestamp(1000))"#,
    )
    .bind(&id)
    .bind(organization)
    .bind(owner)
    .bind(name)
    .bind(status)
    .bind(sections.map(|range| range.0))
    .bind(sections.map(|range| range.1))
    .execute(&db.pool)
    .await
    .unwrap();
    id
}

async fn seed_job(db: &TestDb, owner: &str, project: &str, state: &str) -> String {
    let id = object_id();
    sqlx::query(
        r#"INSERT INTO webknossos.jobs (_id,_owner,_dataStore,command,commandArgs,state,created,_alignmentProject)
          VALUES ($1,$2,'store','align','{"new_dataset_name":"aligned"}',$3::webknossos.JOB_STATE,to_timestamp(2000),$4)"#,
    )
    .bind(&id)
    .bind(owner)
    .bind(state)
    .bind(project)
    .execute(&db.pool)
    .await
    .unwrap();
    id
}

async fn set_dataset_manager(db: &TestDb, user: &str) {
    sqlx::query("UPDATE webknossos.users SET isDatasetManager = TRUE WHERE _id = $1")
        .bind(user)
        .execute(&db.pool)
        .await
        .unwrap();
}

fn project_json(id: &str, name: &str) -> Value {
    json!({
        "id": id,
        "name": name,
        "description": "",
        "status": "READY",
        "invalidReason": null,
        "created": 1_000_000,
        "ownerFirstName": "Rust",
        "ownerLastName": "Test",
        "dataStoreName": "store",
        "dataStoreUrl": "http://public-store.invalid",
        "voxelSize": {"factor": [1, 2, 3], "unit": "nanometer"},
        "csvPath": "tiles/tiles.csv",
        "fileCount": 10,
        "totalSizeInBytes": 2_000_000_000_i64,
        "sectionRange": {"first": 0, "last": 9},
        "isInputDataDeleted": false,
        "csvReplaced": null,
        "inputDataDeletionDate": 1_000_000 + RETENTION_MILLIS,
        "jobCount": 0
    })
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn list_read_and_update_alignment_projects() {
    let Setup {
        db,
        app,
        disabled,
        server,
        ..
    } = setup().await;
    let admin = db.fixture().await;
    let org = &admin.organization_id;
    let manager = db.seed_user(&object_id(), org, false).await;
    set_dataset_manager(&db, &manager.user_id).await;
    let member = db.seed_user(&object_id(), org, false).await;
    let stranger = db.fixture().await;

    assert_eq!(
        call(&app, "GET", "/api/alignmentProjects", &admin.token, None).await,
        (StatusCode::OK, json!([]))
    );
    assert_eq!(
        call(
            &disabled,
            "GET",
            "/api/alignmentProjects",
            &admin.token,
            None
        )
        .await,
        (StatusCode::BAD_REQUEST, error(NOT_ENABLED))
    );
    assert_eq!(
        call(&app, "GET", "/api/alignmentProjects", &member.token, None).await,
        (StatusCode::FORBIDDEN, error(NO_ACCESS))
    );

    let first = seed_project(&db, org, &admin.user_id, "first", "READY", Some((0, 9))).await;
    sqlx::query(
        "UPDATE webknossos.alignmentProjects SET created = to_timestamp(500) WHERE _id = $1",
    )
    .bind(&first)
    .execute(&db.pool)
    .await
    .unwrap();
    let second = seed_project(&db, org, &admin.user_id, "second", "READY", Some((0, 9))).await;
    seed_job(&db, &admin.user_id, &second, "SUCCESS").await;
    let foreign = seed_project(
        &db,
        &stranger.organization_id,
        &stranger.user_id,
        "foreign",
        "READY",
        Some((0, 9)),
    )
    .await;

    // Newest first; only the own organization's projects.
    let mut expected_second = project_json(&second, "second");
    expected_second["jobCount"] = json!(1);
    let mut expected_first = project_json(&first, "first");
    expected_first["created"] = json!(500_000);
    expected_first["inputDataDeletionDate"] = json!(500_000 + RETENTION_MILLIS);
    assert_eq!(
        call(&app, "GET", "/api/alignmentProjects", &manager.token, None).await,
        (
            StatusCode::OK,
            json!([expected_second.clone(), expected_first])
        )
    );
    assert_eq!(
        call(
            &app,
            "GET",
            &format!("/api/alignmentProjects/{second}"),
            &admin.token,
            None
        )
        .await,
        (StatusCode::OK, expected_second)
    );
    for id in [foreign.clone(), object_id()] {
        assert_eq!(
            call(
                &app,
                "GET",
                &format!("/api/alignmentProjects/{id}"),
                &admin.token,
                None
            )
            .await,
            (StatusCode::NOT_FOUND, error(NOT_FOUND))
        );
    }

    // Update: the name is trimmed and must be unique, the voxel size valid.
    let uri = format!("/api/alignmentProjects/{second}");
    assert_eq!(
        call(
            &app,
            "PATCH",
            &uri,
            &admin.token,
            Some(json!({"name": " first "}))
        )
        .await,
        (
            StatusCode::BAD_REQUEST,
            error(
                "An alignment project with the name “first” already exists. Please choose a different name."
            )
        )
    );
    assert_eq!(
        call(
            &app,
            "PATCH",
            &uri,
            &admin.token,
            Some(json!({"name": "  "}))
        )
        .await,
        (
            StatusCode::BAD_REQUEST,
            error("The name of an alignment project must not be empty.")
        )
    );
    assert_eq!(
        call(
            &app,
            "PATCH",
            &uri,
            &admin.token,
            Some(json!({"voxelSize": {"factor": [1, 0, 1], "unit": "nanometer"}}))
        )
        .await,
        (
            StatusCode::BAD_REQUEST,
            error("Each component of the voxel size must be larger than 0.")
        )
    );
    assert_eq!(
        call(&app, "PATCH", &uri, &member.token, Some(json!({}))).await,
        (StatusCode::FORBIDDEN, error(NO_ACCESS))
    );
    let (status, body) = call(
        &app,
        "PATCH",
        &uri,
        &manager.token,
        Some(json!({"name": " renamed ", "description": "Notes", "voxelSize": [4, 4, 40]})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["name"], "renamed");
    assert_eq!(body["description"], "Notes");
    assert_eq!(
        body["voxelSize"],
        json!({"factor": [4, 4, 40], "unit": "nanometer"})
    );
    // Absent fields keep their value; an unchanged name is not re-validated.
    let (status, body) = call(
        &app,
        "PATCH",
        &uri,
        &admin.token,
        Some(json!({"voxelSize": {"factor": [1.5, 1.5, 2], "unit": "micrometer"}})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        (&body["name"], &body["description"], &body["voxelSize"]),
        (
            &json!("renamed"),
            &json!("Notes"),
            &json!({"factor": [1.5, 1.5, 2], "unit": "micrometer"})
        )
    );

    server.abort();
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn credit_cost_and_align_job() {
    let Setup {
        db,
        app,
        mock,
        server,
        ..
    } = setup().await;
    let admin = db.fixture().await;
    let org = &admin.organization_id;
    let ready = seed_project(&db, org, &admin.user_id, "ready", "READY", Some((0, 9))).await;
    let uploading = seed_project(&db, org, &admin.user_id, "uploading", "UPLOADING", None).await;
    let cost_uri =
        |id: &str, query: &str| format!("/api/alignmentProjects/{id}/jobCreditCost?{query}");

    assert_eq!(
        call(
            &app,
            "GET",
            &cost_uri(&ready, "renderUnaligned=false"),
            &admin.token,
            None
        )
        .await,
        (
            StatusCode::OK,
            json!({"costInMilliCredits": 0, "hasEnoughCredits": true, "organizationMilliCredits": 0})
        )
    );
    assert_eq!(
        call(
            &app,
            "GET",
            &cost_uri(&uploading, "renderUnaligned=false"),
            &admin.token,
            None
        )
        .await,
        (StatusCode::BAD_REQUEST, error(NOT_READY))
    );
    for query in [
        "renderUnaligned=true&firstSection=2",
        "renderUnaligned=true&firstSection=5&lastSection=4",
        "renderUnaligned=true&firstSection=5&lastSection=10",
    ] {
        assert_eq!(
            call(&app, "GET", &cost_uri(&ready, query), &admin.token, None).await,
            (StatusCode::BAD_REQUEST, error(INVALID_SECTION_RANGE)),
            "{query}"
        );
    }

    // Start an alignment of sections 2..=4 in the root folder.
    let run_uri = |id: &str| format!("/api/jobs/run/alignAlignmentProject/{id}");
    let run_body = json!({
        "newDatasetName": "aligned",
        "renderUnaligned": false,
        "sectionRange": {"first": 2, "last": 4},
    });
    assert_eq!(
        call(
            &app,
            "POST",
            &run_uri(&uploading),
            &admin.token,
            Some(run_body.clone())
        )
        .await,
        (StatusCode::BAD_REQUEST, error(NOT_READY))
    );
    let mut invalid_name = run_body.clone();
    invalid_name["newDatasetName"] = json!("a b");
    assert_eq!(
        call(
            &app,
            "POST",
            &run_uri(&ready),
            &admin.token,
            Some(invalid_name)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let (status, job) = call(
        &app,
        "POST",
        &run_uri(&ready),
        &admin.token,
        Some(run_body.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{job}");
    assert_eq!(job["command"], "align");
    assert_eq!(job["state"], "PENDING");
    assert_eq!(job["alignmentProjectId"], json!(ready));
    assert_eq!(job["costInMilliCredits"], 0);
    let root_folder: String =
        sqlx::query_scalar("SELECT _rootFolder FROM webknossos.organizations WHERE _id = $1")
            .bind(org)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(
        job["args"],
        json!({
            "alignment_project_id": ready,
            "tiles_csv_path": format!("/srv/binaryData/orga/.alignmentProjects/{ready}/tiles/tiles.csv"),
            "voxel_size": [1, 2, 3],
            "voxel_size_unit": "nanometer",
            "organization_id": org,
            "new_dataset_name": "aligned",
            "webknossos_folder_id": root_folder,
            "section_range": [2, 5],
            "render_unaligned": false,
        })
    );
    assert_eq!(
        mock.take(),
        vec![(
            "GET".to_owned(),
            format!(
                "/data/datasets/getOneBaseDirForOrgaAbsolute?token=rpc-secret&organizationId={org}&requireAllowsUpload=true"
            )
        )]
    );
    let stored: Option<String> =
        sqlx::query_scalar("SELECT _alignmentProject FROM webknossos.jobs WHERE _id = $1")
            .bind(job["id"].as_str().unwrap())
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(stored.as_deref(), Some(ready.as_str()));
    let (_, project) = call(
        &app,
        "GET",
        &format!("/api/alignmentProjects/{ready}"),
        &admin.token,
        None,
    )
    .await;
    assert_eq!(project["jobCount"], 1);

    // Jobs list filtered by project; a dataset manager sees and cancels jobs of other owners.
    let manager = db.seed_user(&object_id(), org, false).await;
    set_dataset_manager(&db, &manager.user_id).await;
    let (status, jobs) = call(
        &app,
        "GET",
        &format!("/api/jobs?alignmentProjectId={ready}"),
        &manager.token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{jobs}");
    assert_eq!(jobs.as_array().unwrap().len(), 1);
    assert_eq!(jobs[0]["alignmentProjectId"], json!(ready));
    let (_, own_jobs) = call(&app, "GET", "/api/jobs", &manager.token, None).await;
    assert_eq!(own_jobs, json!([]));
    let member = db.seed_user(&object_id(), org, false).await;
    assert_eq!(
        call(
            &app,
            "GET",
            &format!("/api/jobs?alignmentProjectId={ready}"),
            &member.token,
            None
        )
        .await,
        (StatusCode::FORBIDDEN, error(NO_ACCESS))
    );
    assert_eq!(
        call(
            &app,
            "GET",
            &format!("/api/jobs?alignmentProjectId={}", object_id()),
            &manager.token,
            None
        )
        .await,
        (StatusCode::NOT_FOUND, error(NOT_FOUND))
    );
    let job_id = job["id"].as_str().unwrap();
    let (status, body) = call(
        &app,
        "PATCH",
        &format!("/api/jobs/{job_id}/cancel"),
        &member.token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(body["messages"][0]["error"], JOB_NOT_FOUND);
    let (status, body) = call(
        &app,
        "PATCH",
        &format!("/api/jobs/{job_id}/cancel"),
        &manager.token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["ownerFirstName"], "Rust");
    let manual: Option<String> =
        sqlx::query_scalar("SELECT manualState::text FROM webknossos.jobs WHERE _id = $1")
            .bind(job_id)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(manual.as_deref(), Some("CANCELLED"));

    // Retrying is refused once the input data is gone.
    sqlx::query("UPDATE webknossos.alignmentProjects SET isInputDataDeleted = TRUE WHERE _id = $1")
        .bind(&ready)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        call(
            &app,
            "PATCH",
            &format!("/api/jobs/{job_id}/retry"),
            &admin.token,
            None
        )
        .await,
        (StatusCode::BAD_REQUEST, error(INPUT_DATA_DELETED))
    );
    assert_eq!(
        call(&app, "POST", &run_uri(&ready), &admin.token, Some(run_body)).await,
        (StatusCode::BAD_REQUEST, error(INPUT_DATA_DELETED))
    );

    server.abort();
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn delete_cancels_jobs_and_removes_input_data() {
    let Setup {
        db,
        app,
        mock,
        server,
        ..
    } = setup().await;
    let admin = db.fixture().await;
    let org = &admin.organization_id;
    let uploading = seed_project(&db, org, &admin.user_id, "uploading", "UPLOADING", None).await;
    let ready = seed_project(&db, org, &admin.user_id, "ready", "READY", Some((0, 9))).await;
    let running = seed_job(&db, &admin.user_id, &ready, "STARTED").await;
    let finished = seed_job(&db, &admin.user_id, &ready, "SUCCESS").await;

    let member = db.seed_user(&object_id(), org, false).await;
    assert_eq!(
        call(
            &app,
            "DELETE",
            &format!("/api/alignmentProjects/{ready}"),
            &member.token,
            None
        )
        .await,
        (StatusCode::FORBIDDEN, error(NO_ACCESS))
    );

    // An unfinished upload is cancelled on the datastore before the directory is deleted.
    assert_eq!(
        call(
            &app,
            "DELETE",
            &format!("/api/alignmentProjects/{uploading}"),
            &admin.token,
            None
        )
        .await,
        (StatusCode::OK, Value::Null)
    );
    let calls: Vec<String> = mock
        .take()
        .into_iter()
        .map(|(method, uri)| format!("{method} {uri}"))
        .collect();
    assert_eq!(
        calls,
        vec![
            format!(
                "DELETE /data/datasets/upload/alignmentProject/cancelUploadForProject?token=rpc-secret&alignmentProjectId={uploading}"
            ),
            format!(
                "GET /data/datasets/getOneBaseDirForOrgaAbsolute?token=rpc-secret&organizationId={org}&requireAllowsUpload=true"
            ),
            "DELETE /data/datasets/deletePaths?token=rpc-secret".to_owned(),
        ]
    );

    // Unfinished jobs are cancelled, all jobs are kept without the reference.
    let (status, body) = call(
        &app,
        "DELETE",
        &format!("/api/alignmentProjects/{ready}"),
        &admin.token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(mock.take().len(), 2);
    let jobs: Vec<(String, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT _id, manualState::text, _alignmentProject FROM webknossos.jobs WHERE _id IN ($1, $2) ORDER BY _id = $1 DESC",
    )
    .bind(&running)
    .bind(&finished)
    .fetch_all(&db.pool)
    .await
    .unwrap();
    assert_eq!(
        jobs,
        vec![
            (running.clone(), Some("CANCELLED".to_owned()), None),
            (finished.clone(), None, None),
        ]
    );
    let projects: Vec<(String, bool, bool)> = sqlx::query_as(
        "SELECT name, isInputDataDeleted, isDeleted FROM webknossos.alignmentProjects ORDER BY name",
    )
    .fetch_all(&db.pool)
    .await
    .unwrap();
    assert_eq!(
        projects,
        vec![
            ("ready".to_owned(), true, true),
            ("uploading".to_owned(), true, true)
        ]
    );
    assert_eq!(
        call(
            &app,
            "GET",
            &format!("/api/alignmentProjects/{ready}"),
            &admin.token,
            None
        )
        .await,
        (StatusCode::NOT_FOUND, error(NOT_FOUND))
    );
    // The name is free again.
    let again = seed_project(&db, org, &admin.user_id, "ready", "READY", Some((0, 9))).await;
    assert_eq!(
        call(
            &app,
            "GET",
            &format!("/api/alignmentProjects/{again}"),
            &admin.token,
            None
        )
        .await
        .0,
        StatusCode::OK
    );

    server.abort();
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn expired_input_data_is_cleaned_up() {
    let Setup {
        db, mock, server, ..
    } = setup().await;
    let admin = db.fixture().await;
    let org = &admin.organization_id;
    let expired = seed_project(&db, org, &admin.user_id, "expired", "READY", Some((0, 9))).await;
    let busy = seed_project(&db, org, &admin.user_id, "busy", "READY", Some((0, 9))).await;
    seed_job(&db, &admin.user_id, &busy, "PENDING").await;
    let fresh = seed_project(&db, org, &admin.user_id, "fresh", "READY", Some((0, 9))).await;
    sqlx::query("UPDATE webknossos.alignmentProjects SET created = NOW() WHERE _id = $1")
        .bind(&fresh)
        .execute(&db.pool)
        .await
        .unwrap();
    let clients = ServiceClients::new(ServiceClientConfig {
        request_timeout: Duration::from_secs(5),
        connect_timeout: Duration::from_secs(1),
        max_response_bytes: 1 << 20,
        rpc_token: "rpc-secret".to_owned(),
    })
    .unwrap();
    webknossos_backend::background::alignment_project_cleanup::run_cleanup(
        &db.pool,
        &clients,
        Duration::from_secs(90 * 86_400),
    )
    .await
    .unwrap();
    assert_eq!(mock.take().len(), 2);
    let deleted: Vec<(String, bool, bool)> = sqlx::query_as(
        "SELECT _id, isInputDataDeleted, isDeleted FROM webknossos.alignmentProjects ORDER BY name",
    )
    .fetch_all(&db.pool)
    .await
    .unwrap();
    assert_eq!(
        deleted,
        vec![
            (busy, false, false),
            (expired, true, false),
            (fresh, false, false)
        ]
    );

    server.abort();
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn datastore_write_access_to_uploading_projects() {
    let Setup {
        db, app, server, ..
    } = setup().await;
    let admin = db.fixture().await;
    let org = &admin.organization_id;
    let member = db.seed_user(&object_id(), org, false).await;
    let uploading = seed_project(&db, org, &admin.user_id, "uploading", "UPLOADING", None).await;
    let ready = seed_project(&db, org, &admin.user_id, "ready", "READY", Some((0, 9))).await;
    let access = |token: &str, id: &str, mode: &str| {
        let app = app.clone();
        let uri = format!("/api/datastores/store/validateUserAccess?key=service-key&token={token}");
        let body = json!({"resourceType": "alignmentProject", "resourceId": id, "mode": mode});
        async move { call(&app, "POST", &uri, "", Some(body)).await }
    };
    let answer = |granted: bool, msg: Option<&str>, user: &str| {
        let mut answer = json!({"granted": granted, "userId": user});
        if let Some(msg) = msg {
            answer["msg"] = json!(msg);
        }
        (StatusCode::OK, answer)
    };
    assert_eq!(
        access(&admin.token, &uploading, "write").await,
        answer(true, None, &admin.user_id)
    );
    assert_eq!(
        access(&admin.token, &ready, "write").await,
        answer(
            false,
            Some("The upload of this alignment project has already been finished."),
            &admin.user_id
        )
    );
    assert_eq!(
        access(&member.token, &uploading, "write").await,
        answer(
            false,
            Some("No write access to alignment project"),
            &member.user_id
        )
    );
    assert_eq!(
        access(&admin.token, &uploading, "read").await,
        answer(
            false,
            Some("Unsupported access to alignment project: read"),
            &admin.user_id
        )
    );
    sqlx::query("UPDATE webknossos.alignmentProjects SET isInputDataDeleted = TRUE WHERE _id = $1")
        .bind(&uploading)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        access(&admin.token, &uploading, "write").await,
        answer(false, Some(INPUT_DATA_DELETED), &admin.user_id)
    );

    server.abort();
    db.cleanup().await;
}
