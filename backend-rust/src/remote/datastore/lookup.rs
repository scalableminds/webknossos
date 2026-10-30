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
    AppState,
    error::{ApiError, ApiResult},
    extract::{Json, Query},
    remote::datastore::{ValidatedDataStore, remote_datastore_dao},
    util::id::ObjectId,
};

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
    crate::dataset::lifecycle::delete_from_db(&state.pool, &id).await?;
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
) -> ApiResult<ResponseJson<ObjectId>> {
    let organization_exists =
        crate::organization::organization_dao::exists(&state.pool, &query.organization_id).await?;
    if !organization_exists {
        return Err(ApiError::not_found(crate::msg::organization::not_found(
            &query.organization_id,
        )));
    }
    let id = remote_datastore_dao::find_oldest_dataset_id(
        &state.pool,
        &query.dataset_directory_name,
        &query.organization_id,
    )
    .await?;
    Ok(ResponseJson(id.ok_or_else(|| {
        ApiError::bad_request(crate::msg::dataset::not_found_by_name(
            &query.dataset_directory_name,
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
    let record = crate::dataset::lifecycle::load_record(&state.pool, &query.dataset_id)
        .await?
        .ok_or_else(|| ApiError::bad_request(crate::msg::dataset::not_found(&query.dataset_id)))?;
    if record.store_name.as_deref() != Some(store.name.as_str()) {
        return Err(crate::dataset::lifecycle::not_allowed());
    }
    let root = record
        .root_path
        .filter(|root| {
            webknossos_common::upath::UPath::parse(root).is_ok_and(|parsed| parsed.is_local())
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
    let job = remote_datastore_dao::find_job(&state.pool, &query.job_id)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    if !job.is_valid() {
        return Err(ApiError::bad_request(format!(
            "Parsing failed for row in webknossos.jobs queried by {}",
            query.job_id
        )));
    }
    let organization = remote_datastore_dao::find_organization_id_for_user(&state.pool, &job.owner)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    let run_id = job
        .latest_run_id
        .ok_or_else(|| ApiError::bad_request(crate::msg::job::NOT_RUN))?;
    let file = job
        .args
        .get("export_file_name")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::bad_request(crate::msg::job::NO_EXPORT_FILE_NAME))?;
    Ok(ResponseJson(
        json!({"jobId": job.id, "runId": run_id, "organizationId": organization, "exportFileName": file}),
    ))
}
