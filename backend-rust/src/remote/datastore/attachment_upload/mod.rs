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
use webknossos_common::{
    enums::{LayerAttachmentDataformat, LayerAttachmentType},
    upath::UPath,
};

use crate::{
    AppState,
    error::{ApiError, ApiResult},
    extract::{Json, Query},
    remote::datastore::ValidatedDataStore,
    remote::datastore::mag_upload::{
        ResumableUploadInfo, TokenQuery, after_upload_reported, load_virtual_upload_target,
        require_same_datastore, require_usable_layer, user_for_callback_token,
    },
    sql::Sql,
    stores::client::ServiceClients,
    util::id::ObjectId,
};

/// Msg.Dataset.Upload.reserveAttachmentUploadNotVirtual.
const ATTACHMENT_NOT_VIRTUAL: &str =
    "Attachment upload to existing dataset is only supported for virtual datasets.";
/// Msg.Dataset.Upload.attachmentNotPending.
const ATTACHMENT_NOT_PENDING: &str = "This attachment is not marked as pending.";
const DIFFERENT_DATASTORE: &str =
    "Cannot upload attachment to existing dataset via different datastore.";
/// `UPath.fromString("<pending upload>")` (a relative LocalUPath, rendered
/// with its `./` prefix): placeholder path until the report.
const PENDING_UPLOAD_PATH: &str = "./<pending upload>";

/// One attachment row (the table's primary key).
/// The `dataset_layer_attachments` row of `dataset`'s layer `layer` with
/// type `typ` and name `name` (the primary key).
pub(crate) fn push_attachment_key<'a>(
    q: &mut Sql<'a>,
    dataset: &'a ObjectId,
    layer: &'a str,
    typ: &'a str,
    name: &'a str,
) {
    q.push("_dataset = ")
        .push_bind(dataset)
        .push(" AND layerName = ")
        .push_bind(layer)
        .push(" AND type = ")
        .push_bind(typ)
        .push("::webknossos.LAYER_ATTACHMENT_TYPE AND name = ")
        .push_bind(name);
}

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
    data_format: LayerAttachmentDataformat,
    #[expect(
        dead_code,
        reason = "required in the request like Play's Reads, otherwise unused"
    )]
    credential_id: Option<String>,
}

impl LayerAttachment {
    /// The normalized UPath (invalid → 400 Invalid JSON request body).
    fn upath(&self) -> ApiResult<String> {
        UPath::parse(&self.path)
            .map(|path| path.to_string())
            .map_err(crate::dataset::source::invalid_body)
    }
}

/// `dataLayer.attachments.getByTypeAndNameAlwaysReturnSingletons(type, name)`
/// on the non-pending attachments (DatasetLayerAttachmentDAO
/// .findAllForDatasetAndDataLayerName); singletons match regardless of name.
async fn existing_attachment<'e>(
    executor: impl sqlx::PgExecutor<'e>,
    dataset: &ObjectId,
    layer: &str,
    typ: LayerAttachmentType,
    name: &str,
) -> ApiResult<bool> {
    let name = (!typ.is_singleton()).then_some(name);
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

fn exists_error(typ: LayerAttachmentType) -> ApiError {
    ApiError::bad_request(if typ.is_singleton() {
        crate::msg::dataset::layer::ATTACHMENT_SINGLETON_ALREADY_FILLED
    } else {
        crate::msg::dataset::layer::ATTACHMENT_NAME_TAKEN
    })
}

// ---------------------------------------------------------------- reserve

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentUploadInfo {
    #[expect(
        dead_code,
        reason = "required in the request like Play's Reads, otherwise unused"
    )]
    resumable_upload_info: ResumableUploadInfo,
    dataset_id: ObjectId,
    layer_name: String,
    attachment_type: LayerAttachmentType,
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
    if body.overwrite_pending {
        let mut q = Sql::new("DELETE FROM webknossos.dataset_layer_attachments WHERE ");
        push_attachment_key(&mut q, &target.id, &body.layer_name, typ.as_str(), name);
        q.push(" AND (uploadIsPending OR uploadToPathIsPending)");
        q.build().execute(&mut *transaction).await?;
    } else {
        let mut q =
            Sql::new("SELECT EXISTS (SELECT 1 FROM webknossos.dataset_layer_attachments WHERE ");
        push_attachment_key(&mut q, &target.id, &body.layer_name, typ.as_str(), name);
        q.push(" AND (uploadIsPending OR uploadToPathIsPending))");
        let pending: bool = q.build_query_scalar().fetch_one(&mut *transaction).await?;
        if pending {
            return Err(ApiError::bad_request(
                crate::msg::dataset::layer::ATTACHMENT_ALREADY_PENDING,
            ));
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
    attachment_type: LayerAttachmentType,
    attachment: LayerAttachment,
    #[expect(
        dead_code,
        reason = "required in the request like Play's Reads, otherwise unused"
    )]
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
    let id = &body.dataset_id;
    // DatasetDAO.findOne under GlobalAccessContext; the reporting store need
    // not be the dataset's store (Scala does not check it either).
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM webknossos.datasets_ WHERE _id = $1)")
            .bind(id)
            .fetch_one(pool)
            .await?;
    if !exists {
        return Err(crate::dataset::lifecycle::not_found(id));
    }
    // findOneWithPendingUpload + finishUpload: the key is the primary key, so
    // the guarded update touches exactly the row Scala finds and updates.
    // Only the path changes (dataFormat/credentialId are kept, as in Scala).
    let mut q = Sql::new(
        "UPDATE webknossos.dataset_layer_attachments \
         SET uploadToPathIsPending = false, uploadIsPending = false, path = ",
    );
    q.push_bind(&path).push(" WHERE ");
    push_attachment_key(
        &mut q,
        id,
        &body.layer_name,
        body.attachment_type.as_str(),
        &body.attachment.name,
    );
    q.push(" AND uploadIsPending");
    let finished = q.build().execute(pool).await?.rows_affected() > 0;
    if !finished {
        return Err(ApiError::bad_request(ATTACHMENT_NOT_PENDING));
    }
    after_upload_reported(pool, &clients, id).await?;
    Ok(StatusCode::OK)
}

#[cfg(test)]
mod tests;
