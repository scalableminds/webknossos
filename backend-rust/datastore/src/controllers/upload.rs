//! UploadController: upload reservation, resumable chunks, unfinished uploads, cancel and the
//! post-conversion clean-up. `finishUpload` lives in `upload_finish.rs`.
use axum::{
    Json, Router,
    extract::{Multipart, Path, RawQuery, State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use serde_json::{Value, json};

use crate::{
    AppState,
    access::{AccessResult, TokenContext, UserAccessRequest},
    controller,
    error::{DsError, DsResult},
    models::{
        DataSourceId, LayerAttachment, LayerAttachmentType, MagLocator, Vec3Double, VoxelSize,
        enums::LengthUnit,
        json::{Fields, JsResult, read_bool, read_list, read_string},
    },
    services::upload::{ResumableUploadInfo, UploadDomain},
};

use super::helpers::{QueryFields, validated_body};

const VALIDATION_FAILED: &str = "Could not validate dataset information for upload.";

pub fn router() -> Router<AppState> {
    controller(
        Router::new()
            .route(
                "/data/datasets/upload/{uploadDomain}",
                get(test_chunk).post(upload_chunk),
            )
            .route(
                "/data/datasets/upload/dataset/reserveUpload",
                post(reserve_dataset_upload),
            )
            .route(
                "/data/datasets/upload/mag/reserveUpload",
                post(reserve_mag_upload),
            )
            .route(
                "/data/datasets/upload/attachment/reserveUpload",
                post(reserve_attachment_upload),
            )
            .route(
                "/data/datasets/upload/{uploadDomain}/unfinishedUploads",
                get(unfinished_uploads),
            )
            .route(
                "/data/datasets/upload/{uploadDomain}/cancelUpload",
                post(cancel_upload),
            )
            .route(
                "/data/datasets/upload/{uploadDomain}/finishUpload",
                post(finish_upload),
            )
            .route(
                "/data/datasets/upload/dataset/cleanUpUploadFiles",
                delete(clean_up_upload_files),
            ),
        true,
    )
}

fn no_such_upload(upload_id: &str, domain: &str) -> String {
    format!("Could not find running {domain} upload with upload id “{upload_id}”.")
}

/// Scala `UploadDomain.fromString(..).toFox` (no message: `Empty`).
fn domain(name: &str) -> DsResult<UploadDomain> {
    UploadDomain::from_name(name).ok_or_else(DsError::empty)
}

/// Scala `ObjectIdFormat.reads`.
pub(super) fn read_object_id(json: &Value) -> JsResult<String> {
    let id = read_string(json)?;
    if id.len() == 24 && id.bytes().all(|b| b.is_ascii_hexdigit()) {
        Ok(id.to_ascii_lowercase())
    } else {
        Err(crate::models::JsError::new(format!(
            "The supplied resource id “{id}” is not a valid ObjectId."
        )))
    }
}

/// Scala `LinkedLayerIdentifier` (re-written like `Json.toJson`).
pub(super) fn read_linked_layer(json: &Value) -> JsResult<Value> {
    let mut f = Fields::new(json);
    let dataset_id = f.req("datasetId", read_object_id);
    let layer_name = f.req("layerName", read_string);
    let new_layer_name = f.opt("newLayerName", read_string);
    f.finish()?;
    let mut value = json!({"datasetId": dataset_id?, "layerName": layer_name?});
    if let Some(name) = new_layer_name? {
        value["newLayerName"] = Value::String(name);
    }
    Ok(value)
}

/// Scala `DatasetUploadInfo` (fields used by the datastore).
struct DatasetUploadInfo {
    resumable: ResumableUploadInfo,
    organization_id: String,
    layers_to_link: Option<Vec<Value>>,
    needs_conversion: Option<bool>,
    voxel_size_factor: Option<Vec3Double>,
    voxel_size_unit: Option<LengthUnit>,
}

impl DatasetUploadInfo {
    fn from_json(json: &Value) -> JsResult<Self> {
        let mut f = Fields::new(json);
        let resumable = f.req("resumableUploadInfo", ResumableUploadInfo::from_json);
        let _dataset_name = f.req("datasetName", read_string);
        let organization_id = f.req("organizationId", read_string);
        let layers_to_link = f.opt("layersToLink", |v| read_list(v, read_linked_layer));
        let _initial_team_ids = f.req("initialTeamIds", |v| read_list(v, read_object_id));
        let _folder_id = f.opt("folderId", read_object_id);
        let _require_unique_name = f.opt("requireUniqueName", read_bool);
        let _is_virtual = f.opt("isVirtual", read_bool);
        let needs_conversion = f.opt("needsConversion", read_bool);
        let voxel_size_factor = f.opt("voxelSizeFactor", Vec3Double::from_json);
        let voxel_size_unit = f.opt("voxelSizeUnit", LengthUnit::from_json);
        f.finish()?;
        Ok(Self {
            resumable: resumable?,
            organization_id: organization_id?,
            layers_to_link: layers_to_link?,
            needs_conversion: needs_conversion?,
            voxel_size_factor: voxel_size_factor?,
            voxel_size_unit: voxel_size_unit?,
        })
    }
}

/// Scala `MagUploadInfo` / `AttachmentUploadInfo` (shared fields).
struct ExistingDatasetUploadInfo {
    resumable: ResumableUploadInfo,
    dataset_id: String,
    layer_name: String,
}

fn read_existing(f: &mut Fields<'_>) -> JsResult<ExistingDatasetUploadInfo> {
    let resumable = f.req("resumableUploadInfo", ResumableUploadInfo::from_json);
    let dataset_id = f.req("datasetId", read_object_id);
    let layer_name = f.req("layerName", read_string);
    let _overwrite_pending = f.req("overwritePending", read_bool);
    Ok(ExistingDatasetUploadInfo {
        resumable: resumable?,
        dataset_id: dataset_id?,
        layer_name: layer_name?,
    })
}

fn read_mag_upload(json: &Value) -> JsResult<(ExistingDatasetUploadInfo, MagLocator)> {
    let mut f = Fields::new(json);
    let existing = read_existing(&mut f);
    let mag = f.req("mag", MagLocator::from_json);
    f.finish()?;
    Ok((existing?, mag?))
}

fn read_attachment_upload(
    json: &Value,
) -> JsResult<(
    ExistingDatasetUploadInfo,
    LayerAttachmentType,
    LayerAttachment,
)> {
    let mut f = Fields::new(json);
    let existing = read_existing(&mut f);
    let kind = f.req("attachmentType", LayerAttachmentType::from_json);
    let attachment = f.req("attachment", LayerAttachment::from_json);
    f.finish()?;
    Ok((existing?, kind?, attachment?))
}

fn data_source_id_from(value: &Value, key: &str) -> DsResult<DataSourceId> {
    value
        .get(key)
        .ok_or_else(|| DsError::failure(format!("'{key}' is undefined on object: {value}")))
        .and_then(|v| {
            DataSourceId::from_json(v).map_err(|e| DsError::failure(e.validation_failure_message()))
        })
}

pub(super) async fn reserve_dataset_upload(
    State(state): State<AppState>,
    tc: TokenContext,
    body: Result<Json<Value>, JsonRejection>,
) -> AccessResult<Response> {
    let raw = match validated_body(body, |v| Ok(v.clone())) {
        Ok(raw) => raw,
        Err(response) => return Ok(*response),
    };
    let info = match validated_body(Ok(Json(raw.clone())), DatasetUploadInfo::from_json) {
        Ok(info) => info,
        Err(response) => return Ok(*response),
    };
    state
        .access
        .validate_access(
            UserAccessRequest::administrate_datasets_of(&info.organization_id),
            &tc,
        )
        .await?;
    let upload_id = info.resumable.upload_id.clone();
    if state
        .uploads
        .is_known_upload(&upload_id, UploadDomain::Dataset)
        .await?
    {
        return Ok(StatusCode::OK.into_response());
    }
    let additional: Value = state
        .wk_client
        .reserve_dataset_upload(&raw, &tc)
        .await
        .map_err(|e| e.wrap(VALIDATION_FAILED))?;
    let dataset_id = additional
        .get("newDatasetId")
        .and_then(Value::as_str)
        .ok_or_else(|| DsError::failure("Invalid reserveDatasetUpload answer"))?
        .to_owned();
    let directory_name = additional
        .get("directoryName")
        .and_then(Value::as_str)
        .ok_or_else(|| DsError::failure("Invalid reserveDatasetUpload answer"))?
        .to_owned();
    let source = DataSourceId::new(directory_name, info.organization_id.clone());
    let needs_conversion = info.needs_conversion.unwrap_or(false);
    if needs_conversion && info.layers_to_link.as_ref().is_some_and(|l| !l.is_empty()) {
        return Err(
            DsError::failure("Cannot use linked layers if the dataset needs conversion").into(),
        );
    }
    let uploads = &state.uploads;
    uploads
        .reserve_resumable_upload(&info.resumable, &dataset_id, &source, UploadDomain::Dataset)
        .await?;
    let store = uploads.store(UploadDomain::Dataset);
    store
        .insert_upload_id_by_data_source_id(&source, &upload_id)
        .await?;
    store
        .insert_extra_serialized(
            &upload_id,
            "linkedLayerIdentifier",
            &info.layers_to_link.unwrap_or_default(),
        )
        .await?;
    store
        .insert_extra_serialized(&upload_id, "needsConversion", &needs_conversion)
        .await?;
    if let Some(factor) = info.voxel_size_factor {
        let voxel_size = VoxelSize::from_factor_and_unit_with_default(factor, info.voxel_size_unit);
        store
            .insert_extra_serialized(&upload_id, "voxelSize", &voxel_size)
            .await?;
    }
    Ok(StatusCode::OK.into_response())
}

async fn reserve_mag_upload(
    State(state): State<AppState>,
    tc: TokenContext,
    body: Result<Json<Value>, JsonRejection>,
) -> AccessResult<Response> {
    let raw = match validated_body(body, |v| Ok(v.clone())) {
        Ok(raw) => raw,
        Err(response) => return Ok(*response),
    };
    let (info, mag) = match validated_body(Ok(Json(raw.clone())), read_mag_upload) {
        Ok(parsed) => parsed,
        Err(response) => return Ok(*response),
    };
    state
        .access
        .validate_access(UserAccessRequest::write_dataset(&info.dataset_id), &tc)
        .await?;
    let upload_id = info.resumable.upload_id.clone();
    if !state
        .uploads
        .is_known_upload(&upload_id, UploadDomain::Mag)
        .await?
    {
        let additional: Value = state
            .wk_client
            .reserve_mag_upload(&raw, &tc)
            .await
            .map_err(|e| e.wrap(VALIDATION_FAILED))?;
        let source = data_source_id_from(&additional, "dataSourceId")?;
        state
            .uploads
            .reserve_resumable_upload(
                &info.resumable,
                &info.dataset_id,
                &source,
                UploadDomain::Mag,
            )
            .await?;
        let store = state.uploads.store(UploadDomain::Mag);
        store
            .insert_extra_serialized(&upload_id, "mag", &mag.without_credentials())
            .await?;
        store
            .insert_extra_raw(&upload_id, "layerName", &info.layer_name)
            .await?;
    }
    Ok(StatusCode::OK.into_response())
}

async fn reserve_attachment_upload(
    State(state): State<AppState>,
    tc: TokenContext,
    body: Result<Json<Value>, JsonRejection>,
) -> AccessResult<Response> {
    let raw = match validated_body(body, |v| Ok(v.clone())) {
        Ok(raw) => raw,
        Err(response) => return Ok(*response),
    };
    let (info, kind, attachment) =
        match validated_body(Ok(Json(raw.clone())), read_attachment_upload) {
            Ok(parsed) => parsed,
            Err(response) => return Ok(*response),
        };
    state
        .access
        .validate_access(UserAccessRequest::write_dataset(&info.dataset_id), &tc)
        .await?;
    let upload_id = info.resumable.upload_id.clone();
    if !state
        .uploads
        .is_known_upload(&upload_id, UploadDomain::Attachment)
        .await?
    {
        let additional: Value = state
            .wk_client
            .reserve_attachment_upload(&raw, &tc)
            .await
            // Scala uses the message key here instead of the message text.
            .map_err(|e| e.wrap("dataset.upload.validation.failed"))?;
        let source = data_source_id_from(&additional, "dataSourceId")?;
        state
            .uploads
            .reserve_resumable_upload(
                &info.resumable,
                &info.dataset_id,
                &source,
                UploadDomain::Attachment,
            )
            .await?;
        let store = state.uploads.store(UploadDomain::Attachment);
        store
            .insert_extra_serialized(&upload_id, "attachment", &attachment.without_credential())
            .await?;
        store
            .insert_extra_serialized(&upload_id, "attachmentType", &kind)
            .await?;
        store
            .insert_extra_raw(&upload_id, "layerName", &info.layer_name)
            .await?;
    }
    Ok(StatusCode::OK.into_response())
}

pub(super) async fn unfinished_uploads(
    State(state): State<AppState>,
    tc: TokenContext,
    Path(upload_domain): Path<String>,
    RawQuery(raw): RawQuery,
) -> AccessResult<Json<Vec<Value>>> {
    let organization = QueryFields::new(raw)
        .required("organizationName")?
        .to_owned();
    state
        .access
        .validate_access(
            UserAccessRequest::administrate_datasets_of(&organization),
            &tc,
        )
        .await?;
    if domain(&upload_domain)? != UploadDomain::Dataset {
        return Err(DsError::failure(
            "Listing unfinished downloads is only supported for datasets.",
        )
        .into());
    }
    let unfinished: Vec<Value> = state
        .wk_client
        .get_unfinished_uploads_for_user(&organization, &tc)
        .await?;
    let enriched = state.uploads.enrich_unfinished_uploads(unfinished).await;
    Ok(Json(
        enriched
            .into_iter()
            .map(|mut upload| {
                // Scala `withoutDataSourceId`.
                if let Value::Object(map) = &mut upload {
                    map.shift_remove("dataSourceId");
                }
                upload
            })
            .collect(),
    ))
}

/// Play `Form` binding of the chunk fields: the first error's message key.
fn form_number(
    fields: &std::collections::HashMap<String, String>,
    key: &str,
) -> Result<i64, &'static str> {
    let value = fields.get(key).ok_or("error.required")?;
    value.trim().parse::<i64>().map_err(|_| "error.number")
}

pub(super) async fn upload_chunk(
    State(state): State<AppState>,
    tc: TokenContext,
    Path(upload_domain): Path<String>,
    mut multipart: Multipart,
) -> AccessResult<Response> {
    let mut fields = std::collections::HashMap::new();
    let mut file: Option<bytes::Bytes> = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| DsError::failure(e.body_text()))?
    {
        let name = field.name().unwrap_or_default().to_owned();
        if field.file_name().is_some() {
            let bytes = field
                .bytes()
                .await
                .map_err(|e| DsError::failure(e.body_text()))?;
            if name == "file" && file.is_none() {
                file = Some(bytes);
            }
        } else {
            let text = field
                .text()
                .await
                .map_err(|e| DsError::failure(e.body_text()))?;
            fields.entry(name).or_insert(text);
        }
    }
    let bound = (|| {
        let chunk_number = form_number(&fields, "resumableChunkNumber")
            .and_then(|v| i32::try_from(v).map(i64::from).map_err(|_| "error.number"))?;
        let chunk_size = form_number(&fields, "resumableChunkSize")
            .and_then(|v| i32::try_from(v).map(i64::from).map_err(|_| "error.number"))?;
        let current_chunk_size = form_number(&fields, "resumableCurrentChunkSize")
            .and_then(|v| i32::try_from(v).map(i64::from).map_err(|_| "error.number"))?;
        let total_chunks = form_number(&fields, "resumableTotalChunks")?;
        let identifier = fields
            .get("resumableIdentifier")
            .filter(|v| !v.trim().is_empty())
            .ok_or("error.required")?
            .clone();
        Ok::<_, &'static str>((
            chunk_number,
            chunk_size,
            current_chunk_size,
            total_chunks,
            identifier,
        ))
    })();
    let (chunk_number, chunk_size, current_chunk_size, total_chunks, file_id) = match bound {
        Ok(bound) => bound,
        Err(message) => {
            return Ok((
                StatusCode::BAD_REQUEST,
                Json(json!({"messages":[{"error": message}]})),
            )
                .into_response());
        }
    };
    let upload_id = crate::services::upload::extract_upload_id(&file_id).to_owned();
    let domain = domain(&upload_domain)?;
    let dataset_id = state
        .uploads
        .dataset_id_by_upload_id(&upload_id, domain)
        .await?
        .ok_or_else(|| DsError::failure(no_such_upload(&upload_id, &upload_domain)))?;
    state
        .access
        .validate_access(UserAccessRequest::write_dataset(&dataset_id), &tc)
        .await?;
    if !state
        .uploads
        .is_known_upload_by_file_id(&file_id, domain)
        .await?
    {
        return Err(DsError::failure("dataset.upload.validation.failed").into());
    }
    let file = file.ok_or_else(|| DsError::failure("zip.file.notFound"))?;
    state
        .uploads
        .handle_upload_chunk(
            &file_id,
            chunk_size,
            current_chunk_size,
            total_chunks,
            chunk_number,
            file,
            domain,
        )
        .await
        .inspect_err(|e| tracing::warn!("Failed upload request: {e}"))?;
    Ok(StatusCode::OK.into_response())
}

pub(super) async fn test_chunk(
    State(state): State<AppState>,
    tc: TokenContext,
    Path(upload_domain): Path<String>,
    RawQuery(raw): RawQuery,
) -> AccessResult<StatusCode> {
    let q = QueryFields::new(raw);
    let chunk_number = q.int("resumableChunkNumber")?;
    let identifier = q.required("resumableIdentifier")?.to_owned();
    let upload_id = crate::services::upload::extract_upload_id(&identifier).to_owned();
    let domain = domain(&upload_domain)?;
    let missing = || DsError::failure(no_such_upload(&upload_id, &upload_domain));
    let dataset_id = state
        .uploads
        .dataset_id_by_upload_id(&upload_id, domain)
        .await?
        .ok_or_else(missing)?;
    state
        .access
        .validate_access(UserAccessRequest::write_dataset(&dataset_id), &tc)
        .await?;
    if !state
        .uploads
        .is_known_upload_by_file_id(&identifier, domain)
        .await?
    {
        return Err(missing().into());
    }
    Ok(
        if state
            .uploads
            .is_chunk_present(&identifier, i64::from(chunk_number), domain)
            .await?
        {
            StatusCode::OK
        } else {
            StatusCode::NO_CONTENT
        },
    )
}

async fn cancel_upload(
    State(state): State<AppState>,
    tc: TokenContext,
    Path(upload_domain): Path<String>,
    RawQuery(raw): RawQuery,
) -> AccessResult<StatusCode> {
    let upload_id = QueryFields::new(raw).required("uploadId")?.to_owned();
    if domain(&upload_domain)? != UploadDomain::Dataset {
        return Err(DsError::failure("Cancel upload is only supported for datasets.").into());
    }
    if !state
        .uploads
        .is_known_upload(&upload_id, UploadDomain::Dataset)
        .await?
    {
        return Err(DsError::failure(no_such_upload(&upload_id, &upload_domain)).into());
    }
    let dataset_id = state
        .uploads
        .dataset_id_by_upload_id(&upload_id, UploadDomain::Dataset)
        .await?
        .ok_or_else(DsError::empty)?;
    state
        .access
        .validate_access(UserAccessRequest::delete_dataset(&dataset_id), &tc)
        .await?;
    state
        .wk_client
        .delete_dataset(&dataset_id)
        .await
        .map_err(|e| e.wrap("Could not delete dataset from WEBKNOSSOS database."))?;
    state
        .uploads
        .cancel_upload(UploadDomain::Dataset, &upload_id)
        .await
        .map_err(|e| e.wrap("Could not cancel the upload."))?;
    Ok(StatusCode::OK)
}

async fn clean_up_upload_files(
    State(state): State<AppState>,
    tc: TokenContext,
    RawQuery(raw): RawQuery,
) -> AccessResult<StatusCode> {
    let q = QueryFields::new(raw);
    let organization = q.required("organizationId")?.to_owned();
    let directory_name = q.required("directoryName")?.to_owned();
    let job_id = q.required("jobId")?.to_owned();
    state
        .access
        .validate_access(UserAccessRequest::webknossos(), &tc)
        .await?;
    let uploads = state.uploads.clone();
    tokio::task::spawn_blocking(move || {
        uploads.clean_up_upload_files_after_convert_job(&organization, &directory_name, &job_id)
    })
    .await
    .map_err(DsError::from_exception)?;
    Ok(StatusCode::OK)
}

pub(super) async fn finish_upload(
    State(state): State<AppState>,
    tc: TokenContext,
    Path(upload_domain): Path<String>,
    RawQuery(raw): RawQuery,
) -> AccessResult<Json<Value>> {
    let upload_id = QueryFields::new(raw).required("uploadId")?.to_owned();
    let domain = domain(&upload_domain)?;
    let dataset_id = state
        .uploads
        .dataset_id_by_upload_id(&upload_id, domain)
        .await?
        .ok_or_else(|| DsError::failure(no_such_upload(&upload_id, &upload_domain)))?;
    state
        .access
        .validate_access(UserAccessRequest::write_dataset(&dataset_id), &tc)
        .await?;
    let started = std::time::Instant::now();
    let context = crate::services::upload_finish::FinishContext {
        uploads: &state.uploads,
        data_sources: &state.data_sources,
        wk_client: &state.wk_client,
        tc: &tc,
    };
    let result = match domain {
        UploadDomain::Dataset => context.finish_dataset_upload(&upload_id, &dataset_id).await,
        other => {
            context
                .finish_mag_or_attachment_upload(&upload_id, &dataset_id, other)
                .await
        }
    };
    if started.elapsed() > std::time::Duration::from_secs(30) {
        tracing::info!(
            "finishUpload for {dataset_id} was slow: {:?}",
            started.elapsed()
        );
    }
    result.map_err(|e| {
        tracing::warn!("Failed upload request: {e}");
        e.wrap(format!(
            "Could not finalize upload for {upload_domain} “{dataset_id}”."
        ))
    })?;
    Ok(Json(json!({ "datasetId": dataset_id })))
}
