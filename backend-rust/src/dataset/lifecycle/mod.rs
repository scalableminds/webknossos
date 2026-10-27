//! DatasetController delete, mirror and finish-upload routes plus the
//! DatasetService side effects (datastore cache invalidation, mirrors,
//! real-path scans) shared by other dataset mutation modules.
use axum::{
    Extension, Router,
    extract::State,
    routing::{delete, post},
};
use reqwest::Method;
use serde::Deserialize;
use serde_json::{Value, json};
use webknossos_common::enums::{LayerAttachmentDataformat, LayerAttachmentType};

mod dao;

pub(crate) use dao::find_record as load_record;

use crate::{
    AppState,
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::{Json as RequestJson, Path},
    state::JobsEnabled,
    stores::client::{ServiceClients, ServiceError},
    util::id::{ObjectId, PathObjectId},
};

pub(crate) const NOT_YET_UPLOADED: &str = "Not yet fully uploaded.";
pub(crate) const NOT_YET_UPLOADED_TO_PATHS: &str = "Not yet marked as fully uploaded to paths.";
pub(crate) const CONVERSION_FAILED: &str = "Conversion failed.";
const DELETED_BY_USER: &str = "Deleted by user.";

#[derive(Clone, Copy)]
struct LifecycleFeatures {
    allow_delete_datasets: bool,
}

pub fn router(allow_delete_datasets: bool) -> Router<AppState> {
    Router::new()
        .route("/datasets/{datasetId}", delete(delete_dataset))
        .route("/datasets/{datasetId}/writeMirror", post(write_mirror))
        .route("/datasets/writeAllMirrors", post(write_all_mirrors))
        .route(
            "/datasets/{datasetId}/finishUploadToPaths",
            post(finish_upload_to_paths),
        )
        .route(
            "/datasets/{datasetId}/finishMagUploadToPath",
            post(finish_mag_upload_to_path),
        )
        .route(
            "/datasets/{datasetId}/finishAttachmentUploadToPath",
            post(finish_attachment_upload_to_path),
        )
        .layer(Extension(LifecycleFeatures {
            allow_delete_datasets,
        }))
}

#[derive(sqlx::FromRow, Clone, Debug)]
pub(crate) struct DatasetRecord {
    pub id: ObjectId,
    pub organization: String,
    pub store_url: Option<String>,
    pub store_name: Option<String>,
    pub is_virtual: bool,
    pub is_usable: bool,
    pub status: String,
    pub root_path: Option<String>,
    pub root_real_path: Option<String>,
}

impl DatasetRecord {
    pub(crate) fn store_url(&self) -> ApiResult<&str> {
        self.store_url
            .as_deref()
            .ok_or_else(|| ApiError::bad_request(crate::msg::data_store::NOT_FOUND))
    }
}

/// Play passes `datasetId.toString` to `notFoundMessage` in writeMirror and the finish-to-path routes, which picks the
/// "Dataset with name “…”" overload.
async fn require_editable_by_name(
    state: &AppState,
    user: &AuthUser,
    id: &PathObjectId,
) -> ApiResult<DatasetRecord> {
    require_editable(state, user, id).await.map_err(|error| {
        if error.status == axum::http::StatusCode::NOT_FOUND {
            ApiError::not_found(crate::msg::dataset::not_found_by_name(id))
        } else {
            error
        }
    })
}

pub(crate) fn not_found(id: &ObjectId) -> ApiError {
    ApiError::not_found(crate::msg::dataset::not_found(id))
}

pub(crate) fn not_allowed() -> ApiError {
    ApiError::forbidden(crate::msg::NOT_ALLOWED)
}

/// DatasetDAO.findOne (read access) followed by DatasetService.isEditableBy.
pub(crate) async fn require_editable(
    state: &AppState,
    user: &AuthUser,
    id: &ObjectId,
) -> ApiResult<DatasetRecord> {
    let record = require_readable(state, user, id).await?;
    if !crate::dataset::access::can_edit(&state.pool, user, id).await? {
        return Err(not_allowed());
    }
    Ok(record)
}

pub(crate) async fn require_readable(
    state: &AppState,
    user: &AuthUser,
    id: &ObjectId,
) -> ApiResult<DatasetRecord> {
    if !crate::dataset::access::can_read(&state.pool, Some(user), id, None).await? {
        return Err(not_found(id));
    }
    load_record(&state.pool, id)
        .await?
        .ok_or_else(|| not_found(id))
}

fn parse_json<T: serde::de::DeserializeOwned>(bytes: &[u8]) -> ApiResult<T> {
    serde_json::from_slice(bytes).map_err(|_| ServiceError::InvalidJson.into())
}

/// WKRemoteDataStoreClient.invalidateDatasetInDSCache.
pub(crate) async fn invalidate_cache(
    clients: &ServiceClients,
    record: &DatasetRecord,
) -> ApiResult<()> {
    clients
        .request(
            Method::DELETE,
            record.store_url()?,
            &["data", "datasets", record.id.as_str()],
            &[],
            None,
        )
        .await?;
    Ok(())
}

/// WKRemoteDataStoreClient.updateDataSourceOnDisk.
pub(crate) async fn update_data_source_on_disk(
    clients: &ServiceClients,
    record: &DatasetRecord,
    data_source: &Value,
    root_path: &str,
) -> ApiResult<()> {
    clients
        .request(
            Method::PUT,
            record.store_url()?,
            &["data", "datasets", record.id.as_str()],
            &[("rootPath", root_path.to_owned())],
            Some(data_source),
        )
        .await?;
    Ok(())
}

/// DatasetService.writeMirrorForVirtual.
pub(crate) async fn write_mirror_for_virtual(
    pool: &sqlx::PgPool,
    clients: &ServiceClients,
    record: &DatasetRecord,
) -> ApiResult<()> {
    if !(record.is_virtual && record.is_usable) {
        return Ok(());
    }
    let response = clients
        .request(
            Method::POST,
            record.store_url()?,
            &["data", "datasets", "writeMirrors"],
            &[("failOnError", "true".to_owned())],
            Some(&json!([record.id])),
        )
        .await?;
    let written: Vec<(String, String)> = parse_json(&response.bytes)?;
    if let Some((_, path)) = written.first() {
        dao::update_mirror_path(pool, record.id.as_str(), path).await?;
    }
    Ok(())
}

/// All explicit mag/attachment paths of a rendered data source.
pub(crate) fn explicit_paths(data_source: &Value) -> Vec<String> {
    let mut paths = Vec::new();
    for layer in data_source["dataLayers"].as_array().into_iter().flatten() {
        for mag in layer["mags"].as_array().into_iter().flatten() {
            if let Some(path) = mag["path"].as_str() {
                paths.push(path.to_owned());
            }
        }
        if let Some(attachments) = layer["attachments"].as_object() {
            for value in attachments.values() {
                let entries = match value {
                    Value::Array(entries) => entries.iter().collect::<Vec<_>>(),
                    other => vec![other],
                };
                for entry in entries {
                    if let Some(path) = entry["path"].as_str() {
                        paths.push(path.to_owned());
                    }
                }
            }
        }
    }
    paths
}

/// DatasetService.scanRealpathsIfVirtual: only data sources that reference
/// local paths are sent, using stored (not resolved) paths.
pub(crate) async fn scan_realpaths_if_virtual(
    pool: &sqlx::PgPool,
    clients: &ServiceClients,
    record: &DatasetRecord,
) -> ApiResult<()> {
    if !(record.is_virtual && record.is_usable) {
        return Ok(());
    }
    let data_source = crate::dataset::routes::data_source_for_rpc(pool, &record.id, false).await?;
    if !explicit_paths(&data_source)
        .iter()
        .any(|p| crate::organization::storage::is_local_path(p))
    {
        return Ok(());
    }
    let mut info = json!({ "dataSource": data_source });
    if let Some(root) = &record.root_path {
        info["rootPath"] = json!(root);
    }
    if let Some(root) = &record.root_real_path {
        info["rootRealPath"] = json!(root);
    }
    clients
        .request(
            Method::POST,
            record.store_url()?,
            &["data", "triggers", "scanRealPathsForVirtual"],
            &[],
            Some(&json!([info])),
        )
        .await?;
    Ok(())
}

async fn delete_dataset(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
    Extension(features): Extension<LifecycleFeatures>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
    Extension(clients): Extension<ServiceClients>,
) -> ApiResult<()> {
    let record = require_readable(&state, &user, &id).await?;
    if !features.allow_delete_datasets {
        return Err(ApiError::bad_request(
            crate::msg::dataset::delete::NOT_ENABLED,
        ));
    }
    if !crate::dataset::access::can_edit(&state.pool, &user, &id).await? {
        return Err(not_allowed());
    }
    tracing::info!(dataset = %id, user = %user.id, is_virtual = record.is_virtual, "Deleting dataset");
    let store_url = record.store_url()?.to_owned();
    if record.is_virtual {
        let paths = crate::dataset::dao::find_exclusive_paths(&state.pool, &id).await?;
        crate::dataset::paths::delete_paths(&state.pool, &clients, &store_url, &paths).await?;
    } else if let Some(root) = record.root_path.clone().or(record.root_real_path.clone()) {
        if !crate::organization::storage::is_local_path(&root) {
            return Err(ApiError::bad_request(
                crate::msg::dataset::delete::ROOT_NOT_LOCAL,
            ));
        }
        let directory = if root.ends_with('/') {
            root.clone()
        } else {
            format!("{root}/")
        };
        let store_name = record.store_name.clone().unwrap_or_default();
        let users =
            dao::find_ids_referencing_directory(&state.pool, &directory, &id, &store_name).await?;
        if !users.is_empty() {
            return Err(ApiError::bad_request(format!(
                "Cannot delete dataset because {} other datasets reference its data: {}",
                users.len(),
                users.join(",")
            )));
        }
        clients
            .request(
                Method::DELETE,
                &store_url,
                &["data", "datasets", id.as_str(), "deleteOnDisk"],
                &[("rootPath", root.clone())],
                None,
            )
            .await
            .map_err(|_| ApiError::bad_request(crate::msg::dataset::delete::FAILED))?;
    }
    let mut transaction = state.pool.begin().await?;
    let exists = crate::dataset::dao::find_id_for_update(&mut transaction, &id).await?;
    if exists.is_none() {
        return Ok(());
    }
    if jobs_enabled
        && matches!(
            record.status.as_str(),
            NOT_YET_UPLOADED | NOT_YET_UPLOADED_TO_PATHS
        )
    {
        dao::cancel_conversion_jobs(&mut transaction, &id).await?;
    }
    delete_from_db_on_connection(&mut transaction, &id).await?;
    transaction.commit().await?;
    Ok(())
}

/// DatasetService.deleteDatasetFromDB, without disk/RPC deletion or conversion
/// job cancellation. A missing or already deleted dataset is an idempotent no-op.
pub(crate) async fn delete_from_db(pool: &sqlx::PgPool, id: &ObjectId) -> ApiResult<()> {
    let mut transaction = pool.begin().await?;
    delete_from_db_on_connection(&mut transaction, id).await?;
    transaction.commit().await?;
    Ok(())
}

/// Shared database deletion, in the caller's transaction so the public route's
/// conversion job cancellation and deletion remain atomic.
async fn delete_from_db_on_connection(
    connection: &mut sqlx::PgConnection,
    id: &ObjectId,
) -> ApiResult<()> {
    let exists = crate::dataset::dao::find_id_for_update(connection, id).await?;
    if exists.is_none() {
        return Ok(());
    }
    let annotations = dao::count_annotations(connection, id).await?;
    dao::delete_dependent_rows(connection, id).await?;
    if annotations > 0 {
        // Annotations keep referencing the dataset; it stays as an unusable row.
        dao::mark_unusable(connection, id, DELETED_BY_USER).await?;
    } else {
        dao::delete_one(connection, id).await?;
    }
    Ok(())
}

async fn write_mirror(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
    Extension(clients): Extension<ServiceClients>,
) -> ApiResult<()> {
    let record = require_editable_by_name(&state, &user, &id).await?;
    if !record.is_virtual {
        return Err(ApiError::bad_request(
            crate::msg::dataset::mirror::ONLY_FOR_VIRTUAL,
        ));
    }
    if !record.is_usable {
        return Err(ApiError::bad_request(
            crate::msg::dataset::mirror::ONLY_FOR_USABLE,
        ));
    }
    write_mirror_for_virtual(&state.pool, &clients, &record)
        .await
        .map_err(|error| {
            if error.status.is_server_error() {
                error
            } else {
                ApiError::bad_request(crate::msg::dataset::mirror::WRITE_FAILED)
            }
        })
}

async fn write_all_mirrors(
    State(state): State<AppState>,
    user: AuthUser,
    Extension(clients): Extension<ServiceClients>,
) -> ApiResult<()> {
    if !user.is_superuser {
        return Err(ApiError::bad_request(crate::msg::user::SUPER_USER_ONLY));
    }
    tracing::info!(user = %user.id, "Writing mirrors for all datasets");
    let groups = dao::find_virtual_usable_ids_by_store(&state.pool).await?;
    for (store_name, ids) in groups {
        let url = dao::find_store_url(&state.pool, &store_name).await?;
        let url = url.ok_or_else(|| ApiError::bad_request(crate::msg::data_store::NOT_FOUND))?;
        let response = clients
            .request(
                Method::POST,
                &url,
                &["data", "datasets", "writeMirrors"],
                &[("failOnError", "false".to_owned())],
                Some(&json!(ids)),
            )
            .await?;
        let written: Vec<(String, String)> = parse_json(&response.bytes)?;
        for (dataset, path) in written {
            dao::update_mirror_path(&state.pool, &dataset, &path).await?;
        }
    }
    Ok(())
}

async fn finish_upload_to_paths(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
    Extension(clients): Extension<ServiceClients>,
) -> ApiResult<()> {
    require_editable(&state, &user, &id).await?;
    let mut transaction = state.pool.begin().await?;
    let (status, usable) = dao::find_status_for_update(&mut transaction, &id)
        .await?
        .ok_or_else(|| not_found(&id))?;
    if !matches!(
        status.as_str(),
        NOT_YET_UPLOADED | NOT_YET_UPLOADED_TO_PATHS
    ) {
        return Err(ApiError::bad_request(format!(
            "Dataset is not in uploading-to-paths status, got {status}."
        )));
    }
    if usable {
        return Err(ApiError::bad_request(crate::msg::dataset::ALREADY_USABLE));
    }
    dao::mark_usable(&mut transaction, &id).await?;
    transaction.commit().await?;
    let updated = load_record(&state.pool, &id)
        .await?
        .ok_or_else(|| not_found(&id))?;
    scan_realpaths_if_virtual(&state.pool, &clients, &updated).await?;
    write_mirror_for_virtual(&state.pool, &clients, &updated).await?;
    crate::organization::storage::refresh_for_dataset(&state.pool, &clients, &id).await?;
    tracing::info!(dataset = %id, user = %user.id, "Finished uploadToPaths");
    Ok(())
}

/// ReserveMagUploadToPathRequest, also the finish request body.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MagUploadRequest {
    pub layer_name: String,
    pub mag: [i32; 3],
    pub axis_order: Option<Value>,
    pub channel_index: Option<i32>,
    pub path_prefix: Option<String>,
    pub overwrite_pending: bool,
}

/// ReserveAttachmentUploadToPathRequest, also the finish request body.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AttachmentUploadRequest {
    pub layer_name: String,
    pub attachment_name: String,
    pub attachment_type: LayerAttachmentType,
    pub attachment_dataformat: LayerAttachmentDataformat,
    pub path_prefix: Option<String>,
    pub overwrite_pending: Option<bool>,
}

/// Shared tail of the finish-upload-to-path routes (DatasetController).
async fn after_artifact_finished(
    state: &AppState,
    clients: &ServiceClients,
    record: &DatasetRecord,
) -> ApiResult<()> {
    record.store_url()?;
    if !record.is_virtual {
        if !record.is_usable {
            return Err(ApiError::bad_request(crate::msg::dataset::not_usable(
                &record.id,
            )));
        }
        if let Some(root) = &record.root_path {
            let data_source =
                crate::dataset::routes::data_source_for_rpc(&state.pool, &record.id, true).await?;
            update_data_source_on_disk(clients, record, &data_source, root).await?;
        }
    }
    crate::organization::storage::refresh_for_dataset(&state.pool, clients, &record.id).await?;
    scan_realpaths_if_virtual(&state.pool, clients, record).await?;
    invalidate_cache(clients, record).await?;
    write_mirror_for_virtual(&state.pool, clients, record).await
}

async fn finish_mag_upload_to_path(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
    Extension(clients): Extension<ServiceClients>,
    RequestJson(body): RequestJson<MagUploadRequest>,
) -> ApiResult<()> {
    let record = require_editable_by_name(&state, &user, &id).await?;
    let [x, y, z] = body.mag.map(f64::from);
    let rows_affected =
        dao::finish_mag_upload(&state.pool, &id, &body.layer_name, [x, y, z]).await?;
    if rows_affected == 0 {
        return Err(ApiError::bad_request(
            crate::msg::dataset::upload::to_paths::MAG_NOT_PENDING,
        ));
    }
    after_artifact_finished(&state, &clients, &record).await
}

async fn finish_attachment_upload_to_path(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
    Extension(clients): Extension<ServiceClients>,
    RequestJson(body): RequestJson<AttachmentUploadRequest>,
) -> ApiResult<()> {
    let record = require_editable_by_name(&state, &user, &id).await?;
    let rows_affected = dao::finish_attachment_upload(
        &state.pool,
        &id,
        &body.layer_name,
        body.attachment_type.as_str(),
        &body.attachment_name,
    )
    .await?;
    if rows_affected == 0 {
        return Err(ApiError::bad_request(
            crate::msg::dataset::upload::to_paths::ATTACHMENT_NOT_PENDING,
        ));
    }
    after_artifact_finished(&state, &clients, &record).await
}
