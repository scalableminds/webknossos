use crate::common;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::StatusCode,
};
use common::{TestDb, object_id};
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::AppState;

const NOT_FOUND: &str = "Could not find the requested alignment project.";
const NOT_ALLOWED: &str = "You are not authorized to view or edit this resource.";
const INPUT_DATA_DELETED: &str = "The input data of this alignment project has been deleted.";

fn app(db: &TestDb, jobs_enabled: bool) -> Router {
    webknossos_backend::remote::datastore::alignment_project_upload::router().with_state(
        AppState::builder(db.pool.clone())
            .jobs_enabled(jobs_enabled)
            .build(),
    )
}

async fn call(app: &Router, uri: &str, body: Option<Value>) -> (StatusCode, Value) {
    let request = axum::http::Request::builder()
        .method("POST")
        .uri(uri)
        .header("content-type", "application/json")
        .body(body.map_or_else(Body::empty, |body| Body::from(body.to_string())))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
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

async fn seed_data_stores(db: &TestDb, restricted_to: Option<&str>) {
    for (name, key, only) in [
        ("store", "service-key", None),
        ("other", "other-key", restricted_to),
    ] {
        sqlx::query("INSERT INTO webknossos.dataStores (name,url,publicUrl,key,onlyAllowedOrganization) VALUES ($1,'http://'||$1||'.invalid','http://'||$1||'.invalid',$2,$3)")
            .bind(name)
            .bind(key)
            .bind(only)
            .execute(&db.pool)
            .await
            .unwrap();
    }
}

fn reserve_body(organization: &str, name: &str) -> Value {
    json!({
        "resumableUploadInfo": {"uploadId": "upload-1", "totalFileCount": 3},
        "name": name,
        "organizationId": organization,
        "voxelSizeFactor": [4, 4, 40],
        "voxelSizeUnit": "nanometer",
    })
}

/// (status, invalidReason, csvPath, fileCount, totalSizeInBytes, firstSection, lastSection,
/// csvReplaced IS NOT NULL).
type ProjectRow = (
    String,
    Option<String>,
    Option<String>,
    Option<i64>,
    Option<i64>,
    Option<i32>,
    Option<i32>,
    bool,
);

async fn project_row(db: &TestDb, id: &str) -> ProjectRow {
    sqlx::query_as(
        "SELECT status::text, invalidReason, csvPath, fileCount, totalSizeInBytes, firstSection, lastSection, \
         csvReplaced IS NOT NULL FROM webknossos.alignmentProjects WHERE _id = $1",
    )
    .bind(id)
    .fetch_one(&db.pool)
    .await
    .unwrap()
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn reserve_and_report_alignment_project_upload() {
    let db = TestDb::new().await;
    let admin = db.fixture().await;
    let org = &admin.organization_id;
    let stranger = db.fixture().await;
    seed_data_stores(&db, Some(&stranger.organization_id)).await;
    let member = db.seed_user(&object_id(), org, false).await;
    let app = app(&db, true);
    let reserve = |store: &str, key: &str, token: &str| {
        format!("/datastores/{store}/reserveAlignmentProjectUpload?key={key}&token={token}")
    };
    let uri = reserve("store", "service-key", &admin.token);

    assert_eq!(
        call(
            &app,
            &reserve("store", "wrong", &admin.token),
            Some(reserve_body(org, "p"))
        )
        .await,
        (StatusCode::FORBIDDEN, forbidden())
    );
    assert_eq!(
        call(
            &app,
            &reserve("store", "service-key", "bogus"),
            Some(reserve_body(org, "p"))
        )
        .await,
        (
            StatusCode::FORBIDDEN,
            error("The supplied token is invalid or expired.")
        )
    );
    assert_eq!(
        call(&self::app(&db, false), &uri, Some(reserve_body(org, "p"))).await,
        (
            StatusCode::BAD_REQUEST,
            error("Long-running jobs are not enabled for this WEBKNOSSOS instance.")
        )
    );
    assert_eq!(
        call(
            &app,
            &reserve("store", "service-key", &member.token),
            Some(reserve_body(org, "p"))
        )
        .await,
        (
            StatusCode::FORBIDDEN,
            error("Alignment projects are only available to administrators and dataset managers.")
        )
    );
    assert_eq!(
        call(
            &app,
            &uri,
            Some(reserve_body(&stranger.organization_id, "p"))
        )
        .await,
        (StatusCode::FORBIDDEN, error(NOT_ALLOWED))
    );
    assert_eq!(
        call(
            &app,
            &reserve("other", "other-key", &admin.token),
            Some(reserve_body(org, "p"))
        )
        .await,
        (
            StatusCode::BAD_REQUEST,
            error(
                "Your organization does not have permission to upload datasets to this data store. Please choose another data store."
            )
        )
    );
    assert_eq!(
        call(&app, &uri, Some(reserve_body(org, " "))).await,
        (
            StatusCode::BAD_REQUEST,
            error("The name of an alignment project must not be empty.")
        )
    );
    let mut invalid_voxel_size = reserve_body(org, "p");
    invalid_voxel_size["voxelSizeFactor"] = json!([1, 1, -1]);
    assert_eq!(
        call(&app, &uri, Some(invalid_voxel_size)).await,
        (
            StatusCode::BAD_REQUEST,
            error("Each component of the voxel size must be larger than 0.")
        )
    );
    let mut invalid_unit = reserve_body(org, "p");
    invalid_unit["voxelSizeUnit"] = json!("lightyear");
    assert_eq!(
        call(&app, &uri, Some(invalid_unit)).await,
        (StatusCode::BAD_REQUEST, error("Invalid JSON request body."))
    );

    let (status, body) = call(&app, &uri, Some(reserve_body(org, " tiles "))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let id = body["newAlignmentProjectId"].as_str().unwrap().to_owned();
    assert_eq!(body, json!({"newAlignmentProjectId": id}));
    let stored: (String, String, String, String, Vec<f64>, String) = sqlx::query_as(
        "SELECT _organization, _owner, _dataStore, name, \
         ARRAY[(voxelSizeFactor).x, (voxelSizeFactor).y, (voxelSizeFactor).z]::float8[], voxelSizeUnit::text \
         FROM webknossos.alignmentProjects WHERE _id = $1",
    )
    .bind(&id)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(
        stored,
        (
            org.clone(),
            admin.user_id.clone(),
            "store".to_owned(),
            "tiles".to_owned(),
            vec![4.0, 4.0, 40.0],
            "nanometer".to_owned()
        )
    );
    assert_eq!(
        project_row(&db, &id).await,
        (
            "UPLOADING".to_owned(),
            None,
            None,
            None,
            None,
            None,
            None,
            false
        )
    );
    assert_eq!(
        call(&app, &uri, Some(reserve_body(org, "tiles"))).await,
        (
            StatusCode::BAD_REQUEST,
            error(
                "An alignment project with the name “tiles” already exists. Please choose a different name."
            )
        )
    );

    // Report: only by the project's datastore, only while uploading.
    let report = |section_range: Value, invalid_reason: Value| {
        json!({
            "alignmentProjectId": id,
            "csvPath": "tiles.csv",
            "fileCount": 3,
            "totalSizeInBytes": 1234,
            "sectionRange": section_range,
            "invalidReason": invalid_reason,
        })
    };
    let report_uri = "/datastores/store/reportAlignmentProjectUpload?key=service-key";
    let mut unknown = report(json!(null), json!(null));
    unknown["alignmentProjectId"] = json!(object_id());
    assert_eq!(
        call(&app, report_uri, Some(unknown)).await,
        (StatusCode::NOT_FOUND, error(NOT_FOUND))
    );
    assert_eq!(
        call(
            &app,
            "/datastores/other/reportAlignmentProjectUpload?key=other-key",
            Some(report(json!(null), json!(null)))
        )
        .await,
        (StatusCode::FORBIDDEN, error(NOT_ALLOWED))
    );
    // A section range together with an invalid reason is invalid; the range is dropped.
    assert_eq!(
        call(
            &app,
            report_uri,
            Some(report(json!({"first": 1, "last": 5}), json!("Row 3: bad")))
        )
        .await,
        (StatusCode::OK, Value::Null)
    );
    assert_eq!(
        project_row(&db, &id).await,
        (
            "INVALID".to_owned(),
            Some("Row 3: bad".to_owned()),
            Some("tiles.csv".to_owned()),
            Some(3),
            Some(1234),
            None,
            None,
            false
        )
    );
    assert_eq!(
        call(
            &app,
            report_uri,
            Some(report(json!({"first": 1, "last": 5}), json!(null)))
        )
        .await,
        (
            StatusCode::BAD_REQUEST,
            error("The upload of this alignment project has already been finished.")
        )
    );
    sqlx::query("UPDATE webknossos.alignmentProjects SET status = 'UPLOADING' WHERE _id = $1")
        .bind(&id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        call(
            &app,
            report_uri,
            Some(report(json!({"first": 1, "last": 5}), json!(null)))
        )
        .await,
        (StatusCode::OK, Value::Null)
    );
    assert_eq!(
        project_row(&db, &id).await,
        (
            "READY".to_owned(),
            None,
            Some("tiles.csv".to_owned()),
            Some(3),
            Some(1234),
            Some(1),
            Some(5),
            false
        )
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn validate_and_update_alignment_project_csv() {
    let db = TestDb::new().await;
    let admin = db.fixture().await;
    let org = &admin.organization_id;
    let stranger = db.fixture().await;
    seed_data_stores(&db, None).await;
    let app = app(&db, true);
    let (_, body) = call(
        &app,
        &format!(
            "/datastores/store/reserveAlignmentProjectUpload?key=service-key&token={}",
            admin.token
        ),
        Some(reserve_body(org, "tiles")),
    )
    .await;
    let id = body["newAlignmentProjectId"].as_str().unwrap().to_owned();
    let validate = |store: &str, key: &str, token: &str, project: &str| {
        format!(
            "/datastores/{store}/validateAlignmentProjectCsvReplacement?key={key}&token={token}&alignmentProjectId={project}"
        )
    };
    let uri = validate("store", "service-key", &admin.token, &id);

    assert_eq!(
        call(&app, &uri, None).await,
        (
            StatusCode::BAD_REQUEST,
            error("The upload of this alignment project has not finished yet.")
        )
    );
    sqlx::query("UPDATE webknossos.alignmentProjects SET status = 'INVALID' WHERE _id = $1")
        .bind(&id)
        .execute(&db.pool)
        .await
        .unwrap();
    // Without a CSV path, the field is omitted.
    assert_eq!(
        call(&app, &uri, None).await,
        (StatusCode::OK, json!({"organizationId": org}))
    );
    sqlx::query("UPDATE webknossos.alignmentProjects SET csvPath = 'old.csv' WHERE _id = $1")
        .bind(&id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        call(&app, &uri, None).await,
        (
            StatusCode::OK,
            json!({"organizationId": org, "currentCsvPath": "old.csv"})
        )
    );
    assert_eq!(
        call(
            &app,
            &validate("store", "service-key", &stranger.token, &id),
            None
        )
        .await,
        (StatusCode::NOT_FOUND, error(NOT_FOUND))
    );
    assert_eq!(
        call(
            &app,
            &validate("other", "other-key", &admin.token, &id),
            None
        )
        .await,
        (StatusCode::FORBIDDEN, error(NOT_ALLOWED))
    );

    // The validated replacement makes the project READY.
    let update_uri = "/datastores/store/updateAlignmentProjectCsv?key=service-key";
    let update = json!({
        "alignmentProjectId": id,
        "csvPath": "new.csv",
        "sectionRange": {"first": 0, "last": 7},
    });
    assert_eq!(
        call(
            &app,
            "/datastores/other/updateAlignmentProjectCsv?key=other-key",
            Some(update.clone())
        )
        .await,
        (StatusCode::FORBIDDEN, error(NOT_ALLOWED))
    );
    assert_eq!(
        call(&app, update_uri, Some(update.clone())).await,
        (StatusCode::OK, Value::Null)
    );
    let row = project_row(&db, &id).await;
    assert_eq!(
        (&row.0, &row.1, &row.2, row.5, row.6, row.7),
        (
            &"READY".to_owned(),
            &None,
            &Some("new.csv".to_owned()),
            Some(0),
            Some(7),
            true
        )
    );

    // Neither is possible once the input data is deleted.
    sqlx::query("UPDATE webknossos.alignmentProjects SET isInputDataDeleted = TRUE WHERE _id = $1")
        .bind(&id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        call(&app, &uri, None).await,
        (StatusCode::BAD_REQUEST, error(INPUT_DATA_DELETED))
    );
    assert_eq!(
        call(&app, update_uri, Some(update)).await,
        (StatusCode::BAD_REQUEST, error(INPUT_DATA_DELETED))
    );
    db.cleanup().await;
}
