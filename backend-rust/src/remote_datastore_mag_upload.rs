//! WKRemoteDataStoreController `reserveMagUpload` / `reportMagUpload`: the
//! datastore reserves a pending mag on an existing virtual dataset before a
//! resumable mag upload and reports its final path afterwards.
//!
//! Both routes authenticate the calling datastore with `?key=`
//! (DataStoreService.validateAccess, [`ValidatedDataStore`]). The reservation
//! additionally resolves the uploading user from `?token=`
//! (WebknossosBearerTokenAuthenticatorService.userForToken) and requires read
//! access to the dataset. The `pub(crate)` helpers below are shared with the
//! analogous attachment upload callbacks. Deviations from Play are listed in
//! checkpoints/remote-datastore-mag-upload.md.
use axum::{
    Extension, Json as ResponseJson, Router, extract::State, http::StatusCode, routing::post,
};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{
    AppState,
    auth::{self, AuthUser},
    dataset_access, dataset_lifecycle, dataset_paths,
    dataset_source::{self, ParseResult},
    dataset_storage,
    error::{ApiError, ApiResult},
    extract::{Json, Query},
    id::ObjectId,
    remote_datastore::ValidatedDataStore,
    service_clients::ServiceClients,
};

/// Msg.User.Token.invalid.
const TOKEN_INVALID: &str = "The supplied token is invalid or expired.";
/// Msg.notFound (Fox.Empty in a Play action).
const EMPTY_NOT_FOUND: &str = "Could not find or access the requested resource.";
/// Msg.Dataset.DataSource.notFound.
const DATA_SOURCE_NOT_FOUND: &str =
    "Data source not found on data store server. It may still be initializing.";
/// Msg.DataStore.notFound.
const DATA_STORE_NOT_FOUND: &str = "Data store could not be found or accessed.";
/// Msg.Dataset.Upload.reserveMagUploadNotVirtual.
const MAG_NOT_VIRTUAL: &str =
    "Mag upload to existing dataset is only supported for virtual datasets.";
/// Msg.Dataset.Upload.ToPaths.magAlreadyPending.
const MAG_ALREADY_PENDING: &str =
    "Conflict with existing pending mag. Pass overwritePending to overwrite.";
/// Msg.Dataset.Upload.magNotPending.
const MAG_NOT_PENDING: &str = "This mag is not marked as pending.";
/// Msg.Dataset.Upload.magPathNotSet.
const MAG_PATH_NOT_SET: &str = "Mag path is required in upload.";
const DIFFERENT_DATASTORE: &str = "Cannot upload mag to existing dataset via different datastore.";

const MAG_PREDICATE: &str =
    "_dataset = $1 AND dataLayerName = $2 AND mag = ROW($3, $4, $5)::webknossos.VECTOR3";

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/datastores/{name}/reserveMagUpload",
            post(reserve_mag_upload),
        )
        .route(
            "/datastores/{name}/reportMagUpload",
            post(report_mag_upload),
        )
}

// ---------------------------------------------------------------- shared helpers

/// `?token=` of the reserve*Upload callbacks (Play binds it before the body).
#[derive(Deserialize)]
pub(crate) struct TokenQuery {
    pub token: String,
}

/// WebknossosBearerTokenAuthenticatorService.userForToken without a status
/// override: any unusable token is a 400 with Msg.User.Token.invalid.
pub(crate) async fn user_for_callback_token(
    pool: &sqlx::PgPool,
    token: &str,
) -> ApiResult<AuthUser> {
    auth::user_for_service_token(pool, token)
        .await?
        .ok_or_else(|| ApiError::bad_request(TOKEN_INVALID))
}

/// ResumableUploadInfo; validated like Play's Reads, otherwise unused here.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub(crate) struct ResumableUploadInfo {
    pub upload_id: String,
    pub total_file_count: i64,
    pub file_paths: Option<Vec<String>>,
    pub total_file_size_in_bytes: Option<i64>,
}

/// The dataset an upload callback targets, loaded under the user's read access.
#[derive(sqlx::FromRow, Debug, Clone)]
pub(crate) struct UploadTarget {
    pub id: String,
    pub organization: String,
    pub directory_name: String,
    /// Raw `_dataStore` column (compared untrimmed, as Scala does).
    pub data_store: String,
    pub is_virtual: bool,
    pub is_usable: bool,
    pub has_voxel_size: bool,
}

impl UploadTarget {
    /// MagUploadAdditionalInfo / AttachmentUploadAdditionalInfo: the
    /// DataSourceId with its legacy `name`/`team` JSON keys.
    pub(crate) fn additional_info(&self) -> Value {
        json!({"dataSourceId": {"name": self.directory_name, "team": self.organization}})
    }
}

/// `DatasetDAO.findOne(id)(AuthorizedAccessContext(user))` (Fox.Empty → 404
/// Msg.notFound) followed by the `dataset.isVirtual` assertion (400
/// `not_virtual_message`).
pub(crate) async fn load_virtual_upload_target(
    pool: &sqlx::PgPool,
    user: &AuthUser,
    dataset_id: &ObjectId,
    not_virtual_message: &str,
) -> ApiResult<UploadTarget> {
    let not_found = || ApiError::not_found(EMPTY_NOT_FOUND);
    if !dataset_access::can_read(pool, Some(user), dataset_id.as_str(), None).await? {
        return Err(not_found());
    }
    let target: UploadTarget = sqlx::query_as(
        r#"SELECT _id AS id, _organization AS organization, directoryName AS directory_name,
             _dataStore AS data_store, isVirtual AS is_virtual, isUsable AS is_usable,
             voxelSizeFactor IS NOT NULL AS has_voxel_size
           FROM webknossos.datasets_ WHERE _id = $1"#,
    )
    .bind(dataset_id.as_str())
    .fetch_optional(pool)
    .await?
    .ok_or_else(not_found)?;
    if !target.is_virtual {
        return Err(ApiError::bad_request(not_virtual_message));
    }
    Ok(target)
}

/// DatasetService.getDataSourceAndLayerFor, reduced to its failure contract:
/// usable without voxel size → 404 Msg.Dataset.DataSource.notFound, unusable
/// → 400 Msg.Dataset.notUsable, missing layer → 400 Msg.Dataset.Layer.notFound.
pub(crate) async fn require_usable_layer(
    pool: &sqlx::PgPool,
    target: &UploadTarget,
    layer_name: &str,
) -> ApiResult<()> {
    if target.is_usable && !target.has_voxel_size {
        return Err(ApiError::not_found(DATA_SOURCE_NOT_FOUND));
    }
    if !target.is_usable {
        return Err(ApiError::bad_request(format!(
            "Dataset “{}” is not imported or incomplete.",
            target.id
        )));
    }
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM webknossos.dataset_layers WHERE _dataset = $1 AND name = $2)",
    )
    .bind(&target.id)
    .bind(layer_name)
    .fetch_one(pool)
    .await?;
    if !exists {
        return Err(ApiError::bad_request(format!(
            "Could not find layer “{layer_name}” in dataset."
        )));
    }
    Ok(())
}

/// `dataset._dataStore == dataStore.name` for uploads into existing datasets.
pub(crate) fn require_same_datastore(
    target: &UploadTarget,
    store: &str,
    message: &str,
) -> ApiResult<()> {
    if target.data_store == store {
        Ok(())
    } else {
        Err(ApiError::bad_request(message))
    }
}

/// Post-commit tail of report{Mag,Attachment}Upload:
/// `DatasetService.clientFor(dataset)` (missing store → 400
/// Msg.DataStore.notFound), `invalidateDatasetInDSCache`, then
/// `UsedStorageService.refreshStorageReportForDataset`. Errors propagate like
/// Scala's Fox chain; the preceding DB update stays committed.
pub(crate) async fn after_upload_reported(
    pool: &sqlx::PgPool,
    clients: &ServiceClients,
    dataset_id: &str,
) -> ApiResult<()> {
    let record = dataset_lifecycle::load_record(pool, dataset_id)
        .await?
        .ok_or_else(|| dataset_lifecycle::not_found(dataset_id))?;
    if record.store_url.is_none() {
        return Err(ApiError::bad_request(DATA_STORE_NOT_FOUND));
    }
    dataset_lifecycle::invalidate_cache(clients, &record).await?;
    dataset_storage::refresh_for_dataset(pool, clients, dataset_id).await
}

// ---------------------------------------------------------------- MagLocator

/// The MagLocator fields these callbacks use (Reads[MagLocator]: scalar or
/// vector mag, UPath path, AxisOrder with required x/y).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct MagLocator {
    pub mag: [i32; 3],
    pub path: Option<String>,
    pub axis_order: Option<Value>,
    pub channel_index: Option<i32>,
}

fn present<'a>(object: &'a Value, key: &str) -> Option<&'a Value> {
    object.get(key).filter(|value| !value.is_null())
}

fn axis_order(value: &Value) -> ParseResult<Value> {
    let required = |key: &str| dataset_source::int(value.get(key).ok_or("missing axis")?);
    let optional = |key: &str| present(value, key).map(dataset_source::int).transpose();
    let mut result = json!({"x": required("x")?, "y": required("y")?});
    if let Some(z) = optional("z")? {
        result["z"] = json!(z);
    }
    if let Some(c) = optional("c")? {
        result["c"] = json!(c);
    }
    Ok(result)
}

fn parse_mag_locator(value: &Value) -> ParseResult<MagLocator> {
    if !value.is_object() {
        return Err("expected object".into());
    }
    let path = match present(value, "path") {
        None => None,
        Some(path) => Some(dataset_source::normalize_upath(
            path.as_str().ok_or("expected string path")?,
        )?),
    };
    Ok(MagLocator {
        mag: dataset_source::mag_vec(value.get("mag").ok_or("missing mag")?)?,
        path,
        axis_order: present(value, "axisOrder").map(axis_order).transpose()?,
        channel_index: present(value, "channelIndex")
            .map(dataset_source::int)
            .transpose()?,
    })
}

fn mag_locator(value: &Value) -> ApiResult<MagLocator> {
    parse_mag_locator(value).map_err(dataset_source::invalid_body)
}

/// Vec3Int.toString.
fn vec3_display(mag: [i32; 3]) -> String {
    format!("({}, {}, {})", mag[0], mag[1], mag[2])
}

fn max_dim(mag: [i32; 3]) -> i32 {
    mag.into_iter().max().unwrap_or_default()
}

// ---------------------------------------------------------------- reserve

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MagUploadInfo {
    #[allow(dead_code)]
    resumable_upload_info: ResumableUploadInfo,
    dataset_id: ObjectId,
    layer_name: String,
    mag: Value,
    overwrite_pending: bool,
}

async fn reserve_mag_upload(
    State(state): State<AppState>,
    Query(query): Query<TokenQuery>,
    ValidatedDataStore(store): ValidatedDataStore,
    Extension(clients): Extension<ServiceClients>,
    Json(body): Json<MagUploadInfo>,
) -> ApiResult<ResponseJson<Value>> {
    let mag = mag_locator(&body.mag)?;
    let pool = &state.pool;
    let user = user_for_callback_token(pool, &query.token).await?;
    let target = load_virtual_upload_target(pool, &user, &body.dataset_id, MAG_NOT_VIRTUAL).await?;
    require_usable_layer(pool, &target, &body.layer_name).await?;
    let [x, y, z] = mag.mag.map(f64::from);
    // DatasetMagDAO.findMagLocatorsForLayer excludes pending mags.
    let existing: Vec<(i32, i32, i32)> = sqlx::query_as(
        r#"SELECT (mag).x::int, (mag).y::int, (mag).z::int FROM webknossos.dataset_mags
           WHERE _dataset = $1 AND dataLayerName = $2 AND NOT uploadToPathIsPending AND NOT uploadIsPending"#,
    )
    .bind(&target.id)
    .bind(&body.layer_name)
    .fetch_all(pool)
    .await?;
    if existing
        .iter()
        .any(|&(ex, ey, ez)| max_dim([ex, ey, ez]) == max_dim(mag.mag))
    {
        return Err(ApiError::bad_request(format!(
            "New mag {} conflicts with existing mag of the layer.",
            vec3_display(mag.mag)
        )));
    }
    require_same_datastore(&target, &store.name, DIFFERENT_DATASTORE)?;
    // UploadToPathsService.handleExistingPendingMag (shared with uploadToPaths).
    // findOneWithPendingUploadToPath reads paths with real-path fallback.
    let pending: Vec<(Option<String>, bool)> = sqlx::query_as(&format!(
        "SELECT COALESCE(realPath, path), uploadToPathIsPending FROM webknossos.dataset_mags
         WHERE {MAG_PREDICATE} AND (uploadToPathIsPending OR uploadIsPending)"
    ))
    .bind(&target.id)
    .bind(&body.layer_name)
    .bind(x)
    .bind(y)
    .bind(z)
    .fetch_all(pool)
    .await?;
    if !pending.is_empty() && !body.overwrite_pending {
        return Err(ApiError::bad_request(MAG_ALREADY_PENDING));
    }
    if body.overwrite_pending {
        let old_paths: Vec<String> = pending
            .into_iter()
            .filter(|(_, to_path)| *to_path)
            .filter_map(|(path, _)| path)
            .collect();
        if !old_paths.is_empty() {
            let record = dataset_lifecycle::load_record(pool, &target.id)
                .await?
                .ok_or_else(|| ApiError::not_found(EMPTY_NOT_FOUND))?;
            let store_url = record
                .store_url
                .as_deref()
                .ok_or_else(|| ApiError::bad_request(DATA_STORE_NOT_FOUND))?;
            dataset_paths::delete_paths(pool, &clients, store_url, &old_paths).await?;
        }
    }
    // Pending replacement and the new reservation commit together; the dataset
    // row lock serializes concurrent reservations of the same dataset.
    let mut transaction = pool.begin().await?;
    sqlx::query("SELECT 1 FROM webknossos.datasets WHERE _id = $1 FOR UPDATE")
        .bind(&target.id)
        .execute(&mut *transaction)
        .await?;
    if body.overwrite_pending {
        sqlx::query(&format!(
            "DELETE FROM webknossos.dataset_mags WHERE {MAG_PREDICATE} AND (uploadToPathIsPending OR uploadIsPending)"
        ))
        .bind(&target.id)
        .bind(&body.layer_name)
        .bind(x)
        .bind(y)
        .bind(z)
        .execute(&mut *transaction)
        .await?;
    } else {
        let raced: bool = sqlx::query_scalar(&format!(
            "SELECT EXISTS (SELECT 1 FROM webknossos.dataset_mags WHERE {MAG_PREDICATE} AND (uploadToPathIsPending OR uploadIsPending))"
        ))
        .bind(&target.id)
        .bind(&body.layer_name)
        .bind(x)
        .bind(y)
        .bind(z)
        .fetch_one(&mut *transaction)
        .await?;
        if raced {
            return Err(ApiError::bad_request(MAG_ALREADY_PENDING));
        }
    }
    // DatasetMagDAO.insertWithUploadPending.
    sqlx::query(
        r#"INSERT INTO webknossos.dataset_mags (_dataset, dataLayerName, mag, path, axisOrder, channelIndex, uploadToPathIsPending, uploadIsPending)
           VALUES ($1, $2, ROW($3, $4, $5)::webknossos.VECTOR3, NULL, $6, $7, false, true)"#,
    )
    .bind(&target.id)
    .bind(&body.layer_name)
    .bind(x)
    .bind(y)
    .bind(z)
    .bind(&mag.axis_order)
    .bind(mag.channel_index)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    tracing::info!(dataset = %target.id, layer = %body.layer_name, user = %user.id, "Reserved mag upload");
    Ok(ResponseJson(target.additional_info()))
}

// ---------------------------------------------------------------- report

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReportMagUploadParameters {
    dataset_id: ObjectId,
    layer_name: String,
    mag: Value,
    #[allow(dead_code)]
    mag_size_bytes: i64,
}

async fn report_mag_upload(
    State(state): State<AppState>,
    ValidatedDataStore(_store): ValidatedDataStore,
    Extension(clients): Extension<ServiceClients>,
    Json(body): Json<ReportMagUploadParameters>,
) -> ApiResult<StatusCode> {
    let mag = mag_locator(&body.mag)?;
    let pool = &state.pool;
    let id = body.dataset_id.as_str();
    // DatasetDAO.findOne under GlobalAccessContext; the reporting store need
    // not be the dataset's store (Scala does not check it either).
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM webknossos.datasets_ WHERE _id = $1)")
            .bind(id)
            .fetch_one(pool)
            .await?;
    if !exists {
        return Err(dataset_lifecycle::not_found(id));
    }
    let [x, y, z] = mag.mag.map(f64::from);
    let finished = match &mag.path {
        // DatasetMagDAO.finishUpload, guarded by findOneWithPendingUpload in
        // the same statement.
        Some(path) => {
            sqlx::query(&format!(
                "UPDATE webknossos.dataset_mags SET uploadToPathIsPending = false, uploadIsPending = false, path = $6
                 WHERE {MAG_PREDICATE} AND uploadIsPending"
            ))
            .bind(id)
            .bind(&body.layer_name)
            .bind(x)
            .bind(y)
            .bind(z)
            .bind(path)
            .execute(pool)
            .await?
            .rows_affected()
                > 0
        }
        None => {
            let pending: bool = sqlx::query_scalar(&format!(
                "SELECT EXISTS (SELECT 1 FROM webknossos.dataset_mags WHERE {MAG_PREDICATE} AND uploadIsPending)"
            ))
            .bind(id)
            .bind(&body.layer_name)
            .bind(x)
            .bind(y)
            .bind(z)
            .fetch_one(pool)
            .await?;
            if pending {
                return Err(ApiError::bad_request(MAG_PATH_NOT_SET));
            }
            false
        }
    };
    if !finished {
        return Err(ApiError::bad_request(MAG_NOT_PENDING));
    }
    after_upload_reported(pool, &clients, id).await?;
    Ok(StatusCode::OK)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mag_locator_reads_scalar_vector_paths_and_axis_order() {
        let parsed = parse_mag_locator(&json!({"mag": 2, "path": "s3://b/x/../y", "axisOrder": {"x": 1, "y": 2, "c": 0}, "channelIndex": 3, "credentials": null})).unwrap();
        assert_eq!(parsed.mag, [2, 2, 2]);
        assert_eq!(parsed.path.as_deref(), Some("s3://b/y"));
        assert_eq!(parsed.axis_order, Some(json!({"x": 1, "y": 2, "c": 0})));
        assert_eq!(parsed.channel_index, Some(3));
        let vector = parse_mag_locator(&json!({"mag": [4, 4, 1], "path": null})).unwrap();
        assert_eq!((vector.mag, vector.path), ([4, 4, 1], None));
        for invalid in [
            json!({"mag": [1, 1]}),
            json!({"mag": 1, "axisOrder": {"x": 1}}),
            json!({"mag": 1, "path": 3}),
            json!({"mag": 1.5}),
            json!([1, 1, 1]),
        ] {
            assert!(parse_mag_locator(&invalid).is_err(), "{invalid}");
        }
        assert_eq!(vec3_display([4, 4, 1]), "(4, 4, 1)");
        assert_eq!(max_dim([4, 8, 1]), 8);
    }
}
