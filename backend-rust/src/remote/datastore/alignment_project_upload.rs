//! WKRemoteDataStoreController alignment project callbacks: the datastore reserves a new
//! project before a resumable tile upload (`reserveAlignmentProjectUpload`), reports the
//! finished upload with the result of its tile CSV validation (`reportAlignmentProjectUpload`),
//! asks whether a user may replace the tile CSV of an uploaded project
//! (`validateAlignmentProjectCsvReplacement`) and reports the validated replacement
//! (`updateAlignmentProjectCsv`).
//!
//! All routes authenticate the calling datastore with `?key=` ([`ValidatedDataStore`]); the
//! routes acting for a user resolve them from `?token=` (`userForToken ~> FORBIDDEN`).
use axum::{Json as ResponseJson, Router, extract::State, http::StatusCode, routing::post};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use webknossos_common::{datasource::VoxelSize, enums::LengthUnit, geometry::Vec3Double};

use crate::{
    AppState,
    alignment_project::{
        alignment_project_dao::{self, FinishedUpload, NewAlignmentProject},
        service::{
            self, AlignmentProject, INVALID, READY, SectionRange, UPLOADING, assert_may_access,
        },
    },
    error::{ApiError, ApiResult},
    extract::{Json, Query},
    msg::alignment_project as msg,
    remote::datastore::{
        ValidatedDataStore,
        mag_upload::{ResumableUploadInfo, TokenQuery, user_for_token_forbidden},
    },
    state::JobsEnabled,
    util::id::ObjectId,
};

/// Msg.Dataset.Upload.datastoreRestricted.
const DATASTORE_RESTRICTED: &str = "Your organization does not have permission to upload datasets to this data store. Please choose another data store.";

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/datastores/{name}/reserveAlignmentProjectUpload",
            post(reserve_upload),
        )
        .route(
            "/datastores/{name}/reportAlignmentProjectUpload",
            post(report_upload),
        )
        .route(
            "/datastores/{name}/validateAlignmentProjectCsvReplacement",
            post(validate_csv_replacement),
        )
        .route(
            "/datastores/{name}/updateAlignmentProjectCsv",
            post(update_csv),
        )
}

/// `project._dataStore == dataStore.name ?~> Msg.notAllowed ~> FORBIDDEN`.
fn require_own_data_store(project: &AlignmentProject, store: &str) -> ApiResult<()> {
    if project.row.data_store == store.trim() {
        Ok(())
    } else {
        Err(ApiError::forbidden(crate::msg::NOT_ALLOWED))
    }
}

/// `alignmentProjectDAO.findOne(id)(GlobalAccessContext) ?~> notFound ~> NOT_FOUND`.
async fn find_global(
    connection: &mut sqlx::PgConnection,
    id: &ObjectId,
) -> ApiResult<AlignmentProject> {
    let row = alignment_project_dao::find_one(connection, None, id)
        .await?
        .ok_or_else(|| ApiError::not_found(msg::NOT_FOUND))?;
    AlignmentProject::parse(row).map_err(|_| ApiError::not_found(msg::NOT_FOUND))
}

// ---------------------------------------------------------------- reserve

/// AlignmentProjectUploadInfo.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AlignmentProjectUploadInfo {
    #[expect(
        dead_code,
        reason = "required in the request like Play's Reads, otherwise unused"
    )]
    resumable_upload_info: ResumableUploadInfo,
    name: String,
    organization_id: String,
    voxel_size_factor: Vec3Double,
    voxel_size_unit: LengthUnit,
}

async fn reserve_upload(
    State(state): State<AppState>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
    Query(query): Query<TokenQuery>,
    ValidatedDataStore(store): ValidatedDataStore,
    Json(body): Json<AlignmentProjectUploadInfo>,
) -> ApiResult<ResponseJson<Value>> {
    let user = user_for_token_forbidden(&state.pool, &query.token).await?;
    assert_may_access(jobs_enabled, &user)?;
    let organization = body.organization_id.as_str();
    if organization != user.organization_id {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    let mut transaction = state.pool.begin().await?;
    if !alignment_project_dao::organization_exists(&mut transaction, organization).await? {
        return Err(ApiError::not_found(crate::msg::organization::not_found(
            organization,
        )));
    }
    if store
        .only_allowed_organization
        .as_deref()
        .is_some_and(|allowed| allowed != organization)
    {
        return Err(ApiError::bad_request(DATASTORE_RESTRICTED));
    }
    let name = body.name.trim();
    let voxel_size = VoxelSize {
        factor: body.voxel_size_factor,
        unit: body.voxel_size_unit,
    };
    service::assert_valid_name(&mut transaction, organization, name, None).await?;
    service::assert_valid_voxel_size(&voxel_size)?;
    let id = ObjectId::new();
    alignment_project_dao::insert_one(
        &mut transaction,
        &NewAlignmentProject {
            id: &id,
            organization,
            owner: &user.id,
            data_store: store.name.trim(),
            name,
            voxel_size_factor: voxel_size.factor.to_array(),
            voxel_size_unit: voxel_size.unit.as_str(),
        },
    )
    .await
    .map_err(service::name_taken_on_conflict(name))?;
    transaction.commit().await?;
    tracing::info!(alignment_project = %id, user = %user.id, "Reserved alignment project upload");
    // AlignmentProjectUploadAdditionalInfo.
    Ok(ResponseJson(json!({"newAlignmentProjectId": id})))
}

// ---------------------------------------------------------------- report

/// ReportAlignmentProjectUploadParameters.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReportUploadParameters {
    alignment_project_id: ObjectId,
    /// Relative to the alignment project directory.
    csv_path: Option<String>,
    file_count: i64,
    total_size_in_bytes: i64,
    /// Set if the CSV is valid.
    section_range: Option<SectionRange>,
    /// Set if the CSV is invalid.
    invalid_reason: Option<String>,
}

async fn report_upload(
    State(state): State<AppState>,
    ValidatedDataStore(store): ValidatedDataStore,
    Json(report): Json<ReportUploadParameters>,
) -> ApiResult<StatusCode> {
    let mut transaction = state.pool.begin().await?;
    let project = find_global(&mut transaction, &report.alignment_project_id).await?;
    require_own_data_store(&project, &store.name)?;
    if project.row.status != UPLOADING {
        return Err(ApiError::bad_request(msg::NOT_UPLOADING));
    }
    let is_valid = report.section_range.is_some() && report.invalid_reason.is_none();
    alignment_project_dao::finish_upload(
        &mut transaction,
        project.id(),
        &FinishedUpload {
            status: if is_valid { READY } else { INVALID },
            invalid_reason: report.invalid_reason.as_deref(),
            csv_path: report.csv_path.as_deref(),
            file_count: report.file_count,
            total_size_in_bytes: report.total_size_in_bytes,
            section_range: report
                .section_range
                .filter(|_| is_valid)
                .map(|range| (range.first, range.last)),
        },
    )
    .await?;
    transaction.commit().await?;
    Ok(StatusCode::OK)
}

// ---------------------------------------------------------------- CSV replacement

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ValidateCsvReplacementQuery {
    token: String,
    alignment_project_id: ObjectId,
}

/// AlignmentProjectCsvReplacementInfo (JsonAutoFormat: an absent path is omitted).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CsvReplacementInfo {
    organization_id: String,
    /// Relative to the alignment project directory.
    #[serde(skip_serializing_if = "Option::is_none")]
    current_csv_path: Option<String>,
}

/// Checks whether the user may replace the tile CSV. The datastore then validates and stores
/// the new CSV.
async fn validate_csv_replacement(
    State(state): State<AppState>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
    Query(query): Query<ValidateCsvReplacementQuery>,
    ValidatedDataStore(store): ValidatedDataStore,
) -> ApiResult<ResponseJson<CsvReplacementInfo>> {
    let user = user_for_token_forbidden(&state.pool, &query.token).await?;
    assert_may_access(jobs_enabled, &user)?;
    let mut connection = state.pool.acquire().await?;
    let project =
        service::find_readable(&mut connection, &user, &query.alignment_project_id).await?;
    require_own_data_store(&project, &store.name)?;
    if project.row.status == UPLOADING {
        return Err(ApiError::bad_request(msg::UPLOAD_UNFINISHED));
    }
    if project.row.is_input_data_deleted {
        return Err(ApiError::bad_request(msg::INPUT_DATA_DELETED));
    }
    Ok(ResponseJson(CsvReplacementInfo {
        organization_id: project.row.organization,
        current_csv_path: project.row.csv_path,
    }))
}

/// ReportAlignmentProjectCsvReplacementParameters.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CsvReplacementParameters {
    alignment_project_id: ObjectId,
    csv_path: String,
    section_range: SectionRange,
}

async fn update_csv(
    State(state): State<AppState>,
    ValidatedDataStore(store): ValidatedDataStore,
    Json(report): Json<CsvReplacementParameters>,
) -> ApiResult<StatusCode> {
    let mut connection = state.pool.acquire().await?;
    let project = find_global(&mut connection, &report.alignment_project_id).await?;
    require_own_data_store(&project, &store.name)?;
    let range = report.section_range;
    // A replaced CSV was validated by the datastore, so the project becomes READY; fails if the
    // input data was deleted in the meantime.
    if !alignment_project_dao::replace_csv(
        &mut connection,
        project.id(),
        &report.csv_path,
        (range.first, range.last),
    )
    .await?
    {
        return Err(ApiError::bad_request(msg::INPUT_DATA_DELETED));
    }
    Ok(StatusCode::OK)
}
