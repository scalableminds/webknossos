//! UploadController alignment project routes: reserving the tile upload, replacing the tile CSV
//! and cancelling the upload when WEBKNOSSOS deletes the project. Chunks and `finishUpload` use
//! the generic upload routes with the `alignmentProject` upload domain.
use axum::{
    Json,
    extract::{
        Multipart, RawQuery, State, multipart::MultipartRejection, rejection::JsonRejection,
    },
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};

use crate::{
    access::{AccessResult, AccessTokenService, TokenContext, UserAccessRequest},
    clients::wk::WkClient,
    error::{DsError, DsResult},
    models::{
        Vec3Double, enums::LengthUnit, json::Fields, json::JsResult, json::read_string,
        parse_object_id,
    },
    services::upload::{
        ResumableUploadInfo, UploadDomain, UploadService,
        alignment_project::{
            AlignmentProjectUploadAdditionalInfo, ReportAlignmentProjectCsvReplacementParameters,
            msg,
        },
        tile_csv,
    },
};

use super::super::helpers::{QueryFields, validated_body};

const DOMAIN: UploadDomain = UploadDomain::AlignmentProject;

/// Scala `AlignmentProjectUploadInfo`.
struct AlignmentProjectUploadInfo {
    resumable: ResumableUploadInfo,
    name: String,
    organization_id: String,
    voxel_size_factor: Vec3Double,
    voxel_size_unit: LengthUnit,
}

impl AlignmentProjectUploadInfo {
    fn from_json(json: &Value) -> JsResult<Self> {
        let mut f = Fields::new(json);
        let resumable = f.req("resumableUploadInfo", ResumableUploadInfo::from_json);
        let name = f.req("name", read_string);
        let organization_id = f.req("organizationId", read_string);
        let voxel_size_factor = f.req("voxelSizeFactor", Vec3Double::from_json);
        let voxel_size_unit = f.req("voxelSizeUnit", LengthUnit::from_json);
        f.finish()?;
        Ok(Self {
            resumable: resumable?,
            name: name?,
            organization_id: organization_id?,
            voxel_size_factor: voxel_size_factor?,
            voxel_size_unit: voxel_size_unit?,
        })
    }

    /// The parsed body as Scala forwards it to WK (`Json.toJson(request.body)`).
    fn to_json(&self) -> Value {
        json!({
            "resumableUploadInfo": self.resumable,
            "name": self.name,
            "organizationId": self.organization_id,
            "voxelSizeFactor": self.voxel_size_factor,
            "voxelSizeUnit": self.voxel_size_unit,
        })
    }
}

/// Play's `ObjectId` query binder (no `<name>-` prefix, unlike the path binder).
fn object_id_query(query: &QueryFields, key: &str) -> DsResult<String> {
    let value = query.required(key)?;
    parse_object_id(value).ok_or_else(|| {
        DsError::binding(format!(
            "Cannot parse URI query parameter {key} with value “{value}” as ObjectId."
        ))
    })
}

/// `POST /datasets/upload/alignmentProject/reserveUpload`: WEBKNOSSOS creates the project (and
/// validates name, voxel size and permissions), then the resumable upload is reserved for it.
/// Answers the project id, also for an already known upload.
pub(super) async fn reserve_upload(
    State(access): State<AccessTokenService>,
    State(uploads): State<UploadService>,
    State(wk_client): State<WkClient>,
    tc: TokenContext,
    body: Result<Json<Value>, JsonRejection>,
) -> AccessResult<Response> {
    let info = match validated_body(body, AlignmentProjectUploadInfo::from_json) {
        Ok(info) => info,
        Err(response) => return Ok(*response),
    };
    access
        .validate_access(
            UserAccessRequest::administrate_datasets_of(&info.organization_id),
            &tc,
        )
        .await?;
    let upload_id = &info.resumable.upload_id;
    let alignment_project_id = if uploads.is_known_upload(upload_id, DOMAIN).await? {
        uploads
            .dataset_id_by_upload_id(upload_id, DOMAIN)
            .await?
            .ok_or_else(DsError::empty)?
    } else {
        let additional = wk_client
            .reserve_alignment_project_upload(&info.to_json(), &tc)
            .await
            .and_then(|additional| {
                parse_object_id(&additional.new_alignment_project_id).ok_or_else(|| {
                    DsError::failure(format!(
                        "JSON parsing failed: The supplied resource id “{}” is not a valid ObjectId.",
                        additional.new_alignment_project_id
                    ))
                })
            })
            .map_err(|e| e.wrap(msg::UPLOAD_VALIDATION_FAILED))?;
        uploads
            .reserve_alignment_project_upload(&info.resumable, &info.organization_id, &additional)
            .await?;
        additional
    };
    Ok(Json(AlignmentProjectUploadAdditionalInfo {
        new_alignment_project_id: alignment_project_id,
    })
    .into_response())
}

/// `POST /datasets/upload/alignmentProject/replaceCsv?alignmentProjectId=`: replaces the tile CSV
/// of an alignment project. Expects the CSV as file attachment `file`. WEBKNOSSOS checks the
/// permissions.
pub(super) async fn replace_csv(
    State(uploads): State<UploadService>,
    State(wk_client): State<WkClient>,
    tc: TokenContext,
    RawQuery(raw): RawQuery,
    multipart: Result<Multipart, MultipartRejection>,
) -> AccessResult<Response> {
    let alignment_project_id = object_id_query(&QueryFields::new(raw), "alignmentProjectId")?;
    let mut multipart = multipart.map_err(|e| DsError::failure(e.body_text()))?;
    // Play `request.body.file("file")`: the first file part with that key.
    let mut csv_file: Option<(String, bytes::Bytes)> = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| DsError::failure(e.body_text()))?
    {
        let is_csv_file = csv_file.is_none() && field.name() == Some("file");
        match field.file_name().map(str::to_owned) {
            Some(file_name) if is_csv_file => {
                let bytes = field
                    .bytes()
                    .await
                    .map_err(|e| DsError::failure(e.body_text()))?;
                csv_file = Some((file_name, bytes));
            }
            _ => {
                field
                    .bytes()
                    .await
                    .map_err(|e| DsError::failure(e.body_text()))?;
            }
        }
    }
    let (file_name, bytes) =
        csv_file.ok_or_else(|| DsError::failure(tile_csv::msg::NOT_ATTACHED))?;
    let replacement = wk_client
        .validate_alignment_project_csv_replacement(&alignment_project_id, &tc)
        .await?;
    let (csv_path, section_range) = uploads
        .replace_alignment_project_csv(&alignment_project_id, &replacement, bytes, &file_name)
        .await
        .map_err(|e| e.with_param_status(StatusCode::BAD_REQUEST))?;
    wk_client
        .report_alignment_project_csv_replacement(&ReportAlignmentProjectCsvReplacementParameters {
            alignment_project_id,
            csv_path: csv_path.clone(),
            section_range,
        })
        .await?;
    Ok(Json(json!({"csvPath": csv_path, "sectionRange": section_range})).into_response())
}

/// `DELETE /datasets/upload/alignmentProject/cancelUploadForProject?alignmentProjectId=`: called
/// by WEBKNOSSOS when an alignment project is deleted.
pub(super) async fn cancel_upload_for_project(
    State(access): State<AccessTokenService>,
    State(uploads): State<UploadService>,
    tc: TokenContext,
    RawQuery(raw): RawQuery,
) -> AccessResult<StatusCode> {
    let alignment_project_id = object_id_query(&QueryFields::new(raw), "alignmentProjectId")?;
    access
        .validate_access(UserAccessRequest::webknossos(), &tc)
        .await?;
    uploads
        .cancel_alignment_project_upload(&alignment_project_id)
        .await?;
    Ok(StatusCode::OK)
}
