//! WKRemoteDataStoreController lookup/deletion callbacks. All authenticate a
//! live datastore service key; the lookups use Scala's global DB access rather
//! than a user token. Only local-root lookup requires the dataset's own store.
use axum::{
    Json as ResponseJson, Router,
    extract::State,
    http::StatusCode,
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{
    AppState, dataset_lifecycle, dataset_source,
    error::{ApiError, ApiResult},
    extract::{Json, Query},
    id::ObjectId,
    jobs::{JOB_COLUMNS, Job},
    remote_datastore::ValidatedDataStore,
};

const NOT_FOUND: &str = "Could not find or access the requested resource.";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/datastores/{name}/deleteDataset", post(delete_dataset))
        .route("/datastores/{name}/findDatasetId", get(find_dataset_id))
        .route(
            "/datastores/{name}/findDatasetLocalRootPath",
            get(find_dataset_local_root_path),
        )
        .route(
            "/datastores/{name}/jobExportProperties",
            get(job_export_properties),
        )
}

async fn delete_dataset(
    State(state): State<AppState>,
    ValidatedDataStore(_store): ValidatedDataStore,
    Json(id): Json<ObjectId>,
) -> ApiResult<StatusCode> {
    dataset_lifecycle::delete_from_db(&state.pool, id.as_str()).await?;
    Ok(StatusCode::OK)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DatasetNameQuery {
    dataset_directory_name: String,
    organization_id: String,
}

async fn find_dataset_id(
    State(state): State<AppState>,
    Query(query): Query<DatasetNameQuery>,
    ValidatedDataStore(_store): ValidatedDataStore,
) -> ApiResult<ResponseJson<String>> {
    let organization_exists: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM webknossos.organizations_ WHERE _id=$1)")
            .bind(&query.organization_id)
            .fetch_one(&state.pool)
            .await?;
    if !organization_exists {
        return Err(ApiError::not_found(format!(
            "Organization “{}” could not be found or accessed.",
            query.organization_id
        )));
    }
    let id: Option<String> = sqlx::query_scalar(
        "SELECT _id FROM webknossos.datasets_ WHERE directoryName=$1 AND _organization=$2 ORDER BY created ASC, _id ASC LIMIT 1",
    ).bind(&query.dataset_directory_name).bind(&query.organization_id).fetch_optional(&state.pool).await?;
    Ok(ResponseJson(id.ok_or_else(|| {
        ApiError::bad_request(format!(
            "Dataset with name “{}” could not be found or accessed.",
            query.dataset_directory_name
        ))
    })?))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DatasetIdQuery {
    dataset_id: ObjectId,
}

async fn find_dataset_local_root_path(
    State(state): State<AppState>,
    Query(query): Query<DatasetIdQuery>,
    ValidatedDataStore(store): ValidatedDataStore,
) -> ApiResult<ResponseJson<String>> {
    let record = dataset_lifecycle::load_record(&state.pool, query.dataset_id.as_str())
        .await?
        .ok_or_else(|| {
            ApiError::bad_request(format!(
                "Dataset “{}” could not be found or accessed.",
                query.dataset_id
            ))
        })?;
    if record.store_name.as_deref() != Some(store.name.as_str()) {
        return Err(dataset_lifecycle::not_allowed());
    }
    let root = record
        .root_path
        .filter(|root| {
            dataset_source::normalize_upath(root)
                .is_ok_and(|parsed| dataset_source::upath_is_local(&parsed))
        })
        .unwrap_or_default();
    Ok(ResponseJson(root))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JobIdQuery {
    job_id: ObjectId,
}

async fn job_export_properties(
    State(state): State<AppState>,
    Query(query): Query<JobIdQuery>,
    ValidatedDataStore(_store): ValidatedDataStore,
) -> ApiResult<ResponseJson<Value>> {
    let statement = format!("SELECT {JOB_COLUMNS} FROM webknossos.jobs_ j WHERE j._id=$1");
    let job: Job = sqlx::query_as(&statement)
        .bind(query.job_id.as_str())
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| ApiError::not_found(NOT_FOUND))?;
    if !job.is_valid() {
        return Err(ApiError::bad_request(format!(
            "Parsing failed for row in webknossos.jobs queried by {}",
            query.job_id
        )));
    }
    let organization: String = sqlx::query_scalar(
        "SELECT o._id FROM webknossos.users_ u JOIN webknossos.organizations_ o ON o._id=u._organization WHERE u._id=$1",
    ).bind(&job.owner).fetch_optional(&state.pool).await?.ok_or_else(|| ApiError::not_found(NOT_FOUND))?;
    let run_id = job
        .latest_run_id
        .ok_or_else(|| ApiError::bad_request("Job has not run yet."))?;
    let file = job
        .args
        .get("export_file_name")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::bad_request("Job does not have an export file name."))?;
    Ok(ResponseJson(
        json!({"jobId": job.id, "runId": run_id, "organizationId": organization, "exportFileName": file}),
    ))
}
