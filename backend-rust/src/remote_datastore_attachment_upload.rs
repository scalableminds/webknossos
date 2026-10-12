//! WKRemoteDataStoreController `reserveAttachmentUpload` /
//! `reportAttachmentUpload`: the datastore reserves a pending layer attachment
//! on an existing virtual dataset before a resumable attachment upload and
//! reports its final path afterwards.
//!
//! Authentication and the dataset/layer lookup are shared with the mag upload
//! callbacks (`remote_datastore_mag_upload`). Deviations from Play are listed
//! in checkpoints/remote-datastore-attachment-upload.md.
use axum::{
    Extension, Json as ResponseJson, Router, extract::State, http::StatusCode, routing::post,
};
use serde::Deserialize;
use serde_json::Value;

use crate::{
    AppState,
    dataset_lifecycle::{self, AttachmentDataformat, AttachmentType},
    dataset_source,
    error::{ApiError, ApiResult},
    extract::{Json, Query},
    id::ObjectId,
    remote_datastore::ValidatedDataStore,
    remote_datastore_mag_upload::{
        ResumableUploadInfo, TokenQuery, after_upload_reported, load_virtual_upload_target,
        require_same_datastore, require_usable_layer, user_for_callback_token,
    },
    service_clients::ServiceClients,
};

/// Msg.Dataset.Upload.reserveAttachmentUploadNotVirtual.
const ATTACHMENT_NOT_VIRTUAL: &str =
    "Attachment upload to existing dataset is only supported for virtual datasets.";
/// Msg.Dataset.Layer.attachmentSingletonAlreadyFilled.
const SINGLETON_ALREADY_FILLED: &str = "There is already an attachment of this type in this layer. Only one attachment of this type can be registered per layer.";
/// Msg.Dataset.Layer.attachmentNameTaken.
const NAME_TAKEN: &str =
    "An attachment with this name already exists in this layer. Please choose a different name.";
/// UploadToPathsService.handleExistingPendingAttachment (literal failure).
const ATTACHMENT_ALREADY_PENDING: &str =
    "Conflict with existing pending attachment. Pass overwritePending to overwrite.";
/// Msg.Dataset.Upload.attachmentNotPending.
const ATTACHMENT_NOT_PENDING: &str = "This attachment is not marked as pending.";
const DIFFERENT_DATASTORE: &str =
    "Cannot upload attachment to existing dataset via different datastore.";
/// `UPath.fromString("<pending upload>")` (a relative LocalUPath, rendered
/// with its `./` prefix): placeholder path until the report.
const PENDING_UPLOAD_PATH: &str = "./<pending upload>";

/// One attachment row (the table's primary key).
const ATTACHMENT_KEY: &str = "_dataset = $1 AND layerName = $2 AND type = $3::webknossos.LAYER_ATTACHMENT_TYPE AND name = $4";

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/datastores/{name}/reserveAttachmentUpload",
            post(reserve_attachment_upload),
        )
        .route(
            "/datastores/{name}/reportAttachmentUpload",
            post(report_attachment_upload),
        )
}

/// Reads[LayerAttachment]: the path must be a valid UPath.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LayerAttachment {
    name: String,
    path: String,
    data_format: AttachmentDataformat,
    #[allow(dead_code)]
    credential_id: Option<String>,
}

impl LayerAttachment {
    /// The normalized UPath (invalid → 400 Invalid JSON request body).
    fn upath(&self) -> ApiResult<String> {
        dataset_source::normalize_upath(&self.path).map_err(dataset_source::invalid_body)
    }
}

/// LayerAttachmentType.isSingletonAttachment.
fn is_singleton(typ: AttachmentType) -> bool {
    matches!(
        typ,
        AttachmentType::SegmentIndex | AttachmentType::Cumsum | AttachmentType::SegmentStatistics
    )
}

/// `dataLayer.attachments.getByTypeAndNameAlwaysReturnSingletons(type, name)`
/// on the non-pending attachments (DatasetLayerAttachmentDAO
/// .findAllForDatasetAndDataLayerName); singletons match regardless of name.
async fn existing_attachment<'e>(
    executor: impl sqlx::PgExecutor<'e>,
    dataset: &str,
    layer: &str,
    typ: AttachmentType,
    name: &str,
) -> ApiResult<bool> {
    let name = (!is_singleton(typ)).then_some(name);
    Ok(sqlx::query_scalar(
        r#"SELECT EXISTS (SELECT 1 FROM webknossos.dataset_layer_attachments
             WHERE _dataset = $1 AND layerName = $2 AND type = $3::webknossos.LAYER_ATTACHMENT_TYPE
               AND ($4::text IS NULL OR name = $4) AND NOT uploadToPathIsPending AND NOT uploadIsPending)"#,
    )
    .bind(dataset)
    .bind(layer)
    .bind(typ.as_str())
    .bind(name)
    .fetch_one(executor)
    .await?)
}

fn exists_error(typ: AttachmentType) -> ApiError {
    ApiError::bad_request(if is_singleton(typ) {
        SINGLETON_ALREADY_FILLED
    } else {
        NAME_TAKEN
    })
}

// ---------------------------------------------------------------- reserve

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentUploadInfo {
    #[allow(dead_code)]
    resumable_upload_info: ResumableUploadInfo,
    dataset_id: ObjectId,
    layer_name: String,
    attachment_type: AttachmentType,
    attachment: LayerAttachment,
    overwrite_pending: bool,
}

async fn reserve_attachment_upload(
    State(state): State<AppState>,
    Query(query): Query<TokenQuery>,
    ValidatedDataStore(store): ValidatedDataStore,
    Json(body): Json<AttachmentUploadInfo>,
) -> ApiResult<ResponseJson<Value>> {
    body.attachment.upath()?;
    let pool = &state.pool;
    let user = user_for_callback_token(pool, &query.token).await?;
    let target =
        load_virtual_upload_target(pool, &user, &body.dataset_id, ATTACHMENT_NOT_VIRTUAL).await?;
    require_usable_layer(pool, &target, &body.layer_name).await?;
    let typ = body.attachment_type;
    let name = &body.attachment.name;
    if existing_attachment(pool, &target.id, &body.layer_name, typ, name).await? {
        return Err(exists_error(typ));
    }
    require_same_datastore(&target, &store.name, DIFFERENT_DATASTORE)?;
    // handleExistingPendingAttachment + insertWithUploadPending in one
    // transaction; the dataset row lock serializes concurrent reservations.
    // Unlike mags, overwriting a pending attachment deletes no stored paths.
    let mut transaction = pool.begin().await?;
    sqlx::query("SELECT 1 FROM webknossos.datasets WHERE _id = $1 FOR UPDATE")
        .bind(&target.id)
        .execute(&mut *transaction)
        .await?;
    if existing_attachment(&mut *transaction, &target.id, &body.layer_name, typ, name).await? {
        return Err(exists_error(typ));
    }
    let pending_predicate =
        format!("{ATTACHMENT_KEY} AND (uploadIsPending OR uploadToPathIsPending)");
    if body.overwrite_pending {
        sqlx::query(&format!(
            "DELETE FROM webknossos.dataset_layer_attachments WHERE {pending_predicate}"
        ))
        .bind(&target.id)
        .bind(&body.layer_name)
        .bind(typ.as_str())
        .bind(name)
        .execute(&mut *transaction)
        .await?;
    } else {
        let pending: bool = sqlx::query_scalar(&format!(
            "SELECT EXISTS (SELECT 1 FROM webknossos.dataset_layer_attachments WHERE {pending_predicate})"
        ))
        .bind(&target.id)
        .bind(&body.layer_name)
        .bind(typ.as_str())
        .bind(name)
        .fetch_one(&mut *transaction)
        .await?;
        if pending {
            return Err(ApiError::bad_request(ATTACHMENT_ALREADY_PENDING));
        }
    }
    // DatasetLayerAttachmentDAO.insertWithUploadPending (credentialId unset).
    sqlx::query(
        r#"INSERT INTO webknossos.dataset_layer_attachments (_dataset, layerName, name, path, type, dataFormat, uploadToPathIsPending, uploadIsPending)
           VALUES ($1, $2, $3, $4, $5::webknossos.LAYER_ATTACHMENT_TYPE, $6::webknossos.LAYER_ATTACHMENT_DATAFORMAT, false, true)"#,
    )
    .bind(&target.id)
    .bind(&body.layer_name)
    .bind(name)
    .bind(PENDING_UPLOAD_PATH)
    .bind(typ.as_str())
    .bind(body.attachment.data_format.as_str())
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    tracing::info!(dataset = %target.id, layer = %body.layer_name, attachment_type = typ.as_str(), user = %user.id, "Reserved attachment upload");
    Ok(ResponseJson(target.additional_info()))
}

// ---------------------------------------------------------------- report

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReportAttachmentUploadParameters {
    dataset_id: ObjectId,
    layer_name: String,
    attachment_type: AttachmentType,
    attachment: LayerAttachment,
    #[allow(dead_code)]
    attachment_size_bytes: i64,
}

async fn report_attachment_upload(
    State(state): State<AppState>,
    ValidatedDataStore(_store): ValidatedDataStore,
    Extension(clients): Extension<ServiceClients>,
    Json(body): Json<ReportAttachmentUploadParameters>,
) -> ApiResult<StatusCode> {
    let path = body.attachment.upath()?;
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
    // findOneWithPendingUpload + finishUpload: the key is the primary key, so
    // the guarded update touches exactly the row Scala finds and updates.
    // Only the path changes (dataFormat/credentialId are kept, as in Scala).
    let finished = sqlx::query(&format!(
        "UPDATE webknossos.dataset_layer_attachments SET uploadToPathIsPending = false, uploadIsPending = false, path = $5
         WHERE {ATTACHMENT_KEY} AND uploadIsPending"
    ))
    .bind(id)
    .bind(&body.layer_name)
    .bind(body.attachment_type.as_str())
    .bind(&body.attachment.name)
    .bind(&path)
    .execute(pool)
    .await?
    .rows_affected()
        > 0;
    if !finished {
        return Err(ApiError::bad_request(ATTACHMENT_NOT_PENDING));
    }
    after_upload_reported(pool, &clients, id).await?;
    Ok(StatusCode::OK)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pending_placeholder_is_a_valid_upath_and_singletons_match_scala() {
        assert_eq!(
            dataset_source::normalize_upath("<pending upload>").unwrap(),
            PENDING_UPLOAD_PATH
        );
        for (typ, singleton) in [
            (AttachmentType::Mesh, false),
            (AttachmentType::Agglomerate, false),
            (AttachmentType::Connectome, false),
            (AttachmentType::SegmentIndex, true),
            (AttachmentType::Cumsum, true),
            (AttachmentType::SegmentStatistics, true),
        ] {
            assert_eq!(is_singleton(typ), singleton, "{typ:?}");
        }
    }
}
