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
mod dao;

pub(crate) use dao::push_mag_predicate;

use axum::{
    Extension, Json as ResponseJson, Router, extract::State, http::StatusCode, routing::post,
};
use serde::Deserialize;
use serde_json::{Value, json};
use webknossos_common::geometry::Vec3Int;

use crate::{
    AppState,
    auth::{self, AuthUser},
    dataset::source::MagLocator,
    error::{ApiError, ApiResult},
    extract::{Json, Query},
    remote::datastore::{ValidatedDataStore, dao as datastore_dao},
    stores::client::ServiceClients,
    util::id::ObjectId,
};

/// Msg.Dataset.Upload.reserveMagUploadNotVirtual.
const MAG_NOT_VIRTUAL: &str =
    "Mag upload to existing dataset is only supported for virtual datasets.";
/// Msg.Dataset.Upload.magNotPending.
const MAG_NOT_PENDING: &str = "This mag is not marked as pending.";
/// Msg.Dataset.Upload.magPathNotSet.
const MAG_PATH_NOT_SET: &str = "Mag path is required in upload.";
const DIFFERENT_DATASTORE: &str = "Cannot upload mag to existing dataset via different datastore.";

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
        .ok_or_else(|| ApiError::bad_request(crate::msg::user::token::INVALID))
}

/// `bearerTokenService.userForToken(token) ~> FORBIDDEN`: the token failure
/// keeps its message (Msg.User.Token.invalid) with status 403.
pub(crate) async fn user_for_token_forbidden(
    pool: &sqlx::PgPool,
    token: &str,
) -> ApiResult<AuthUser> {
    user_for_callback_token(pool, token)
        .await
        .map_err(|mut error| {
            if error.status == StatusCode::BAD_REQUEST {
                error.status = StatusCode::FORBIDDEN;
            }
            error
        })
}

/// ResumableUploadInfo; validated like Play's Reads, otherwise unused here.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[expect(
    dead_code,
    reason = "required in the request like Play's Reads, otherwise unused"
)]
pub(crate) struct ResumableUploadInfo {
    pub upload_id: String,
    pub total_file_count: i64,
    pub file_paths: Option<Vec<String>>,
    pub total_file_size_in_bytes: Option<i64>,
}

/// The dataset an upload callback targets, loaded under the user's read access.
#[derive(sqlx::FromRow, Debug, Clone)]
pub(crate) struct UploadTarget {
    pub id: ObjectId,
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
    let not_found = || ApiError::not_found(crate::msg::NOT_FOUND);
    if !crate::dataset::access::can_read(pool, Some(user), dataset_id, None).await? {
        return Err(not_found());
    }
    let target = dao::find_upload_target(pool, dataset_id)
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
        return Err(ApiError::not_found(
            crate::msg::dataset::data_source::NOT_FOUND,
        ));
    }
    if !target.is_usable {
        return Err(ApiError::bad_request(crate::msg::dataset::not_usable(
            &target.id,
        )));
    }
    let exists = dao::layer_exists(pool, &target.id, layer_name).await?;
    if !exists {
        return Err(ApiError::bad_request(
            crate::msg::dataset::layer::not_found(layer_name),
        ));
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
    dataset_id: &ObjectId,
) -> ApiResult<()> {
    let record = crate::dataset::lifecycle::load_record(pool, dataset_id)
        .await?
        .ok_or_else(|| crate::dataset::lifecycle::not_found(dataset_id))?;
    if record.store_url.is_none() {
        return Err(ApiError::bad_request(crate::msg::data_store::NOT_FOUND));
    }
    crate::dataset::lifecycle::invalidate_cache(clients, &record).await?;
    crate::organization::storage::refresh_for_dataset(pool, clients, dataset_id).await
}

/// Reads[MagLocator] (invalid → 400 Invalid JSON request body).
fn mag_locator(value: &Value) -> ApiResult<MagLocator> {
    MagLocator::from_json(value).map_err(crate::dataset::source::invalid_body)
}

// ---------------------------------------------------------------- reserve

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MagUploadInfo {
    #[expect(
        dead_code,
        reason = "required in the request like Play's Reads, otherwise unused"
    )]
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
    let [x, y, z] = [mag.mag.x, mag.mag.y, mag.mag.z].map(f64::from);
    let existing = dao::find_mags_for_layer(pool, &target.id, &body.layer_name).await?;
    if existing
        .iter()
        .any(|&(ex, ey, ez)| Vec3Int::new(ex, ey, ez).max_dim() == mag.mag.max_dim())
    {
        return Err(ApiError::bad_request(format!(
            "New mag {} conflicts with existing mag of the layer.",
            mag.mag
        )));
    }
    require_same_datastore(&target, &store.name, DIFFERENT_DATASTORE)?;
    // UploadToPathsService.handleExistingPendingMag (shared with uploadToPaths).
    let pending =
        dao::find_pending_mag_paths(pool, &target.id, &body.layer_name, [x, y, z]).await?;
    if !pending.is_empty() && !body.overwrite_pending {
        return Err(ApiError::bad_request(
            crate::msg::dataset::upload::to_paths::MAG_ALREADY_PENDING,
        ));
    }
    if body.overwrite_pending {
        let old_paths: Vec<String> = pending
            .into_iter()
            .filter(|(_, to_path)| *to_path)
            .filter_map(|(path, _)| path)
            .collect();
        if !old_paths.is_empty() {
            let record = crate::dataset::lifecycle::load_record(pool, &target.id)
                .await?
                .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
            let store_url = record
                .store_url
                .as_deref()
                .ok_or_else(|| ApiError::bad_request(crate::msg::data_store::NOT_FOUND))?;
            crate::dataset::paths::delete_paths(pool, &clients, store_url, &old_paths).await?;
        }
    }
    // Pending replacement and the new reservation commit together; the dataset
    // row lock serializes concurrent reservations of the same dataset.
    let mut transaction = pool.begin().await?;
    datastore_dao::lock_dataset(&mut transaction, &target.id).await?;
    if body.overwrite_pending {
        dao::delete_pending_mag(&mut transaction, &target.id, &body.layer_name, [x, y, z]).await?;
    } else {
        let raced =
            dao::pending_mag_exists(&mut transaction, &target.id, &body.layer_name, [x, y, z])
                .await?;
        if raced {
            return Err(ApiError::bad_request(
                crate::msg::dataset::upload::to_paths::MAG_ALREADY_PENDING,
            ));
        }
    }
    dao::insert_with_upload_pending(
        &mut transaction,
        &target.id,
        &body.layer_name,
        [x, y, z],
        mag.axis_order.map(|order| json!(order)),
        mag.channel_index,
    )
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
    #[expect(
        dead_code,
        reason = "required in the request like Play's Reads, otherwise unused"
    )]
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
    let id = &body.dataset_id;
    // DatasetDAO.findOne under GlobalAccessContext; the reporting store need
    // not be the dataset's store (Scala does not check it either).
    let exists = datastore_dao::dataset_exists(pool, id).await?;
    if !exists {
        return Err(crate::dataset::lifecycle::not_found(id));
    }
    let [x, y, z] = [mag.mag.x, mag.mag.y, mag.mag.z].map(f64::from);
    let finished = match mag.path.as_ref().map(ToString::to_string) {
        // DatasetMagDAO.finishUpload, guarded by findOneWithPendingUpload in
        // the same statement.
        Some(path) => dao::finish_upload(pool, id, &body.layer_name, [x, y, z], &path).await?,
        None => {
            let pending = dao::upload_is_pending(pool, id, &body.layer_name, [x, y, z]).await?;
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
