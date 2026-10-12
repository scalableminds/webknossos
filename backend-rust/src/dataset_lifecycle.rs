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

use crate::{
    AppState,
    auth::AuthUser,
    dataset_access, dataset_paths, dataset_storage, datasets,
    error::{ApiError, ApiResult},
    extract::{Json as RequestJson, Path},
    id::{ObjectId, PathObjectId},
    service_clients::{ServiceClients, ServiceError},
};

pub(crate) const NOT_YET_UPLOADED: &str = "Not yet fully uploaded.";
pub(crate) const NOT_YET_UPLOADED_TO_PATHS: &str = "Not yet marked as fully uploaded to paths.";
const DELETED_BY_USER: &str = "Deleted by user.";

#[derive(Clone, Copy)]
struct LifecycleFeatures {
    allow_delete_datasets: bool,
    jobs_enabled: bool,
}

pub fn router(allow_delete_datasets: bool, jobs_enabled: bool) -> Router<AppState> {
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
            jobs_enabled,
        }))
}

#[derive(sqlx::FromRow, Clone, Debug)]
pub(crate) struct DatasetRecord {
    pub id: String,
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
            .ok_or_else(|| ApiError::bad_request("Data store could not be found or accessed."))
    }
}

pub(crate) async fn load_record(
    executor: impl sqlx::PgExecutor<'_>,
    id: &str,
) -> ApiResult<Option<DatasetRecord>> {
    Ok(sqlx::query_as(
        r#"SELECT d._id AS id, d._organization AS organization, s.url AS store_url, s.name AS store_name,
             d.isVirtual AS is_virtual, d.isUsable AS is_usable, d.status, d.rootPath AS root_path,
             d.rootRealPath AS root_real_path
           FROM webknossos.datasets_ d LEFT JOIN webknossos.dataStores_ s ON s.name = trim(d._dataStore)
           WHERE d._id = $1"#,
    )
    .bind(id)
    .fetch_optional(executor)
    .await?)
}

pub(crate) fn not_found(id: &str) -> ApiError {
    ApiError::not_found(format!("Dataset “{id}” could not be found or accessed."))
}

pub(crate) fn not_allowed() -> ApiError {
    ApiError::forbidden("You are not authorized to view or edit this resource.")
}

/// DatasetDAO.findOne (read access) followed by DatasetService.isEditableBy.
pub(crate) async fn require_editable(
    state: &AppState,
    user: &AuthUser,
    id: &ObjectId,
) -> ApiResult<DatasetRecord> {
    let record = require_readable(state, user, id).await?;
    if !dataset_access::can_edit(&state.pool, user, id.as_str()).await? {
        return Err(not_allowed());
    }
    Ok(record)
}

pub(crate) async fn require_readable(
    state: &AppState,
    user: &AuthUser,
    id: &ObjectId,
) -> ApiResult<DatasetRecord> {
    if !dataset_access::can_read(&state.pool, Some(user), id.as_str(), None).await? {
        return Err(not_found(id.as_str()));
    }
    load_record(&state.pool, id.as_str())
        .await?
        .ok_or_else(|| not_found(id.as_str()))
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
            &["data", "datasets", &record.id],
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
            &["data", "datasets", &record.id],
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
        sqlx::query("UPDATE webknossos.datasets SET mirrorPath = $2 WHERE _id = $1")
            .bind(&record.id)
            .bind(path)
            .execute(pool)
            .await?;
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
    let data_source = datasets::data_source_for_rpc(pool, &record.id, false).await?;
    if !explicit_paths(&data_source)
        .iter()
        .any(|p| dataset_storage::is_local_path(p))
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
    Extension(clients): Extension<ServiceClients>,
) -> ApiResult<()> {
    let record = require_readable(&state, &user, &id).await?;
    if !features.allow_delete_datasets {
        return Err(ApiError::bad_request(
            "Dataset deletion is not enabled for this WEBKNOSSOS instance.",
        ));
    }
    if !dataset_access::can_edit(&state.pool, &user, id.as_str()).await? {
        return Err(not_allowed());
    }
    tracing::info!(dataset = %id, user = %user.id, is_virtual = record.is_virtual, "Deleting dataset");
    let store_url = record.store_url()?.to_owned();
    if record.is_virtual {
        let paths: Vec<String> = sqlx::query_scalar(
            r#"SELECT m1.path FROM webknossos.dataset_mags m1 WHERE m1._dataset = $1 AND m1.path IS NOT NULL
                 AND NOT EXISTS (SELECT 1 FROM webknossos.dataset_mags m2 WHERE m2._dataset != $1
                   AND (m2.path = m1.path OR (m2.realpath IS NOT NULL AND m2.realpath = m1.realpath)))
               UNION ALL
               SELECT a1.path FROM webknossos.dataset_layer_attachments a1 WHERE a1._dataset = $1
                 AND NOT EXISTS (SELECT 1 FROM webknossos.dataset_layer_attachments a2 WHERE a2._dataset != $1
                   AND (a2.path = a1.path OR (a2.realpath IS NOT NULL AND a2.realpath = a1.realpath)))"#,
        )
        .bind(id.as_str())
        .fetch_all(&state.pool)
        .await?;
        dataset_paths::delete_paths(&state.pool, &clients, &store_url, &paths).await?;
    } else if let Some(root) = record.root_path.clone().or(record.root_real_path.clone()) {
        if !dataset_storage::is_local_path(&root) {
            return Err(ApiError::bad_request(
                "Cannot delete a dataset whose root path is not local.",
            ));
        }
        let directory = if root.ends_with('/') {
            root.clone()
        } else {
            format!("{root}/")
        };
        let store_name = record.store_name.clone().unwrap_or_default();
        let users: Vec<String> = sqlx::query_scalar(
            r#"SELECT DISTINCT id FROM (
                 SELECT d._id AS id FROM webknossos.dataset_mags m JOIN webknossos.datasets d ON m._dataset = d._id
                 WHERE m.realpath IS NOT NULL AND starts_with(m.realpath, $1) AND d._id != $2 AND d._datastore = $3
                 UNION ALL
                 SELECT d._id FROM webknossos.dataset_layer_attachments a JOIN webknossos.datasets d ON a._dataset = d._id
                 WHERE a.realpath IS NOT NULL AND starts_with(a.realpath, $1) AND d._id != $2 AND d._datastore = $3) referencing
               ORDER BY id"#,
        )
        .bind(&directory)
        .bind(id.as_str())
        .bind(&store_name)
        .fetch_all(&state.pool)
        .await?;
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
            .map_err(|_| ApiError::bad_request("Could not delete the dataset on disk."))?;
    }
    let mut transaction = state.pool.begin().await?;
    let exists: Option<String> =
        sqlx::query_scalar("SELECT _id FROM webknossos.datasets_ WHERE _id = $1 FOR UPDATE")
            .bind(id.as_str())
            .fetch_optional(&mut *transaction)
            .await?;
    if exists.is_none() {
        return Ok(());
    }
    if features.jobs_enabled
        && matches!(
            record.status.as_str(),
            NOT_YET_UPLOADED | NOT_YET_UPLOADED_TO_PATHS
        )
    {
        sqlx::query("UPDATE webknossos.jobs SET manualState = 'CANCELLED' WHERE command = 'convert_to_wkw' AND commandArgs->>'dataset_id' = $1 AND (state = 'PENDING' OR state = 'STARTED')")
            .bind(id.as_str()).execute(&mut *transaction).await?;
    }
    delete_from_db_on_connection(&mut transaction, id.as_str()).await?;
    transaction.commit().await?;
    Ok(())
}

/// DatasetService.deleteDatasetFromDB, without disk/RPC deletion or conversion
/// job cancellation. A missing or already deleted dataset is an idempotent no-op.
pub(crate) async fn delete_from_db(pool: &sqlx::PgPool, id: &str) -> ApiResult<()> {
    let mut transaction = pool.begin().await?;
    delete_from_db_on_connection(&mut transaction, id).await?;
    transaction.commit().await?;
    Ok(())
}

/// Shared database deletion, in the caller's transaction so the public route's
/// conversion job cancellation and deletion remain atomic.
async fn delete_from_db_on_connection(
    connection: &mut sqlx::PgConnection,
    id: &str,
) -> ApiResult<()> {
    let exists: Option<String> =
        sqlx::query_scalar("SELECT _id FROM webknossos.datasets_ WHERE _id = $1 FOR UPDATE")
            .bind(id)
            .fetch_optional(&mut *connection)
            .await?;
    if exists.is_none() {
        return Ok(());
    }
    let annotations: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM webknossos.annotations WHERE _dataset = $1")
            .bind(id)
            .fetch_one(&mut *connection)
            .await?;
    for statement in [
        "DELETE FROM webknossos.dataset_mags WHERE _dataset = $1",
        "DELETE FROM webknossos.dataset_layer_additionalAxes WHERE _dataset = $1",
        "DELETE FROM webknossos.dataset_layers WHERE _dataset = $1",
        "DELETE FROM webknossos.dataset_allowedTeams WHERE _dataset = $1",
        "DELETE FROM webknossos.dataset_layer_coordinateTransformations WHERE _dataset = $1",
        // refreshStorageReportForDataset finds no remaining mags/attachments
        // afterwards and therefore only clears these rows.
        "DELETE FROM webknossos.organization_usedStorage_mags WHERE _dataset = $1",
        "DELETE FROM webknossos.organization_usedStorage_attachments WHERE _dataset = $1",
    ] {
        sqlx::query(statement)
            .bind(id)
            .execute(&mut *connection)
            .await?;
    }
    if annotations > 0 {
        // Annotations keep referencing the dataset; it stays as an unusable row.
        sqlx::query("UPDATE webknossos.datasets SET status = $2, isUsable = false WHERE _id = $1")
            .bind(id)
            .bind(DELETED_BY_USER)
            .execute(&mut *connection)
            .await?;
    } else {
        sqlx::query("DELETE FROM webknossos.datasets WHERE _id = $1")
            .bind(id)
            .execute(&mut *connection)
            .await?;
    }
    Ok(())
}

async fn write_mirror(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
    Extension(clients): Extension<ServiceClients>,
) -> ApiResult<()> {
    let record = require_editable(&state, &user, &id).await?;
    if !record.is_virtual {
        return Err(ApiError::bad_request(
            "Can only write on-disk dataset mirrors for virtual (db-based) datasets.",
        ));
    }
    if !record.is_usable {
        return Err(ApiError::bad_request(
            "Can only write on-disk dataset mirrors for usable datasets.",
        ));
    }
    write_mirror_for_virtual(&state.pool, &clients, &record)
        .await
        .map_err(|error| {
            if error.status.is_server_error() {
                error
            } else {
                ApiError::bad_request("Could not write on-disk dataset mirror.")
            }
        })
}

async fn write_all_mirrors(
    State(state): State<AppState>,
    user: AuthUser,
    Extension(clients): Extension<ServiceClients>,
) -> ApiResult<()> {
    if !user.is_superuser {
        return Err(ApiError::bad_request(
            "This feature is currently only available for superusers.",
        ));
    }
    tracing::info!(user = %user.id, "Writing mirrors for all datasets");
    let groups: Vec<(String, Vec<String>)> = sqlx::query_as(
        "SELECT _dataStore, array_agg(_id ORDER BY _id) FROM webknossos.datasets_ WHERE isVirtual AND isUsable GROUP BY _dataStore ORDER BY _dataStore",
    )
    .fetch_all(&state.pool)
    .await?;
    for (store_name, ids) in groups {
        let url: Option<String> =
            sqlx::query_scalar("SELECT url FROM webknossos.dataStores_ WHERE name = trim($1)")
                .bind(&store_name)
                .fetch_optional(&state.pool)
                .await?;
        let url = url.ok_or_else(|| ApiError::bad_request("datastore.notFound"))?;
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
            sqlx::query("UPDATE webknossos.datasets SET mirrorPath = $2 WHERE _id = $1")
                .bind(dataset)
                .bind(path)
                .execute(&state.pool)
                .await?;
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
    let (status, usable): (String, bool) = sqlx::query_as(
        "SELECT status, isUsable FROM webknossos.datasets WHERE _id = $1 AND NOT isDeleted FOR UPDATE",
    )
    .bind(id.as_str())
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(|| not_found(id.as_str()))?;
    if !matches!(
        status.as_str(),
        NOT_YET_UPLOADED | NOT_YET_UPLOADED_TO_PATHS
    ) {
        return Err(ApiError::bad_request(format!(
            "Dataset is not in uploading-to-paths status, got {status}."
        )));
    }
    if usable {
        return Err(ApiError::bad_request(
            "Dataset is already marked as usable.",
        ));
    }
    sqlx::query("UPDATE webknossos.datasets SET isUsable = true, status = '' WHERE _id = $1")
        .bind(id.as_str())
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    let updated = load_record(&state.pool, id.as_str())
        .await?
        .ok_or_else(|| not_found(id.as_str()))?;
    scan_realpaths_if_virtual(&state.pool, &clients, &updated).await?;
    write_mirror_for_virtual(&state.pool, &clients, &updated).await?;
    dataset_storage::refresh_for_dataset(&state.pool, &clients, id.as_str()).await?;
    tracing::info!(dataset = %id, user = %user.id, "Finished uploadToPaths");
    Ok(())
}

/// ReserveMagUploadToPathRequest, also the finish request body.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
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
#[allow(dead_code)]
pub(crate) struct AttachmentUploadRequest {
    pub layer_name: String,
    pub attachment_name: String,
    pub attachment_type: AttachmentType,
    pub attachment_dataformat: AttachmentDataformat,
    pub path_prefix: Option<String>,
    pub overwrite_pending: Option<bool>,
}

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AttachmentType {
    Agglomerate,
    Connectome,
    SegmentIndex,
    Mesh,
    Cumsum,
    SegmentStatistics,
}

impl AttachmentType {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Agglomerate => "agglomerate",
            Self::Connectome => "connectome",
            Self::SegmentIndex => "segmentIndex",
            Self::Mesh => "mesh",
            Self::Cumsum => "cumsum",
            Self::SegmentStatistics => "segmentStatistics",
        }
    }
}

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AttachmentDataformat {
    Hdf5,
    Zarr3,
    Json,
    NeuroglancerPrecomputed,
}

impl AttachmentDataformat {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Hdf5 => "hdf5",
            Self::Zarr3 => "zarr3",
            Self::Json => "json",
            Self::NeuroglancerPrecomputed => "neuroglancerPrecomputed",
        }
    }
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
            return Err(ApiError::bad_request(format!(
                "Dataset “{}” is not imported or incomplete.",
                record.id
            )));
        }
        if let Some(root) = &record.root_path {
            let data_source = datasets::data_source_for_rpc(&state.pool, &record.id, true).await?;
            update_data_source_on_disk(clients, record, &data_source, root).await?;
        }
    }
    dataset_storage::refresh_for_dataset(&state.pool, clients, &record.id).await?;
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
    let record = require_editable(&state, &user, &id).await?;
    let [x, y, z] = body.mag.map(f64::from);
    let updated = sqlx::query(
        r#"UPDATE webknossos.dataset_mags SET uploadToPathIsPending = false, uploadIsPending = false
           WHERE _dataset = $1 AND dataLayerName = $2 AND mag = ROW($3, $4, $5)::webknossos.VECTOR3 AND uploadToPathIsPending"#,
    )
    .bind(id.as_str())
    .bind(&body.layer_name)
    .bind(x)
    .bind(y)
    .bind(z)
    .execute(&state.pool)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(ApiError::bad_request(
            "This mag is not marked as pending upload to path.",
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
    let record = require_editable(&state, &user, &id).await?;
    let updated = sqlx::query(
        r#"UPDATE webknossos.dataset_layer_attachments SET uploadToPathIsPending = false, uploadIsPending = false
           WHERE _dataset = $1 AND layerName = $2 AND type = $3::webknossos.LAYER_ATTACHMENT_TYPE AND name = $4 AND uploadToPathIsPending"#,
    )
    .bind(id.as_str())
    .bind(&body.layer_name)
    .bind(body.attachment_type.as_str())
    .bind(&body.attachment_name)
    .execute(&state.pool)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(ApiError::bad_request(
            "This attachment is not marked as pending (upload to path).",
        ));
    }
    after_artifact_finished(&state, &clients, &record).await
}
