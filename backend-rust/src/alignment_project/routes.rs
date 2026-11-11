//! AlignmentProjectController: list, read, update, delete, the credit cost of an alignment and
//! `POST /jobs/run/alignAlignmentProject/{alignmentProjectId}`.
//!
//! Deviations from Play: the request body is read after authentication (Play validates it
//! first), and failed job requests are not reported to Slack (like the other Rust job routes).
use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use webknossos_common::datasource::VoxelSize;

use super::{
    AlignmentProjectsConfig, alignment_project_dao,
    service::{
        self, AlignmentProject, AlignmentProjectJson, READY, SectionRange, assert_may_access,
        find_readable,
    },
};
use crate::{
    AppState,
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::{Json as RequestJson, Path, Query},
    job::{
        routes::JobCompactInfo,
        submission::{Failure, RunError, RunResult, Submission, begin_paid_job_with_cost},
    },
    msg::alignment_project as msg,
    state::JobsEnabled,
    stores::client::ServiceClients,
    system::application_info::MiscState,
    util::id::PathObjectId,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/alignmentProjects", get(list))
        .route(
            "/alignmentProjects/{id}",
            get(read).patch(update).delete(delete),
        )
        .route(
            "/alignmentProjects/{id}/jobCreditCost",
            get(job_credit_cost),
        )
        .route(
            "/jobs/run/alignAlignmentProject/{alignmentProjectId}",
            post(run_align_job),
        )
}

async fn list(
    State(state): State<AppState>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
    State(config): State<AlignmentProjectsConfig>,
    user: AuthUser,
) -> ApiResult<Json<Vec<AlignmentProjectJson>>> {
    assert_may_access(jobs_enabled, &user)?;
    let mut connection = state.pool.acquire().await?;
    let rows = alignment_project_dao::find_all_by_organization(
        &mut connection,
        &user.id,
        &user.organization_id,
    )
    .await?;
    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        let project = AlignmentProject::parse(row).map_err(|_| {
            ApiError::bad_request(
                "Parsing failed for a row in webknossos.alignmentProjects during list query",
            )
        })?;
        result.push(
            service::public_writes(&mut connection, config.input_data_retention, &project).await?,
        );
    }
    Ok(Json(result))
}

async fn read(
    State(state): State<AppState>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
    State(config): State<AlignmentProjectsConfig>,
    Path(id): Path<PathObjectId>,
    user: AuthUser,
) -> ApiResult<Json<AlignmentProjectJson>> {
    assert_may_access(jobs_enabled, &user)?;
    let mut connection = state.pool.acquire().await?;
    let project = find_readable(&mut connection, &user, &id).await?;
    Ok(Json(
        service::public_writes(&mut connection, config.input_data_retention, &project).await?,
    ))
}

/// AlignmentProjectUpdateParameters: absent (or null) fields keep their value.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateParameters {
    name: Option<String>,
    description: Option<String>,
    voxel_size: Option<VoxelSize>,
}

async fn update(
    State(state): State<AppState>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
    State(config): State<AlignmentProjectsConfig>,
    Path(id): Path<PathObjectId>,
    user: AuthUser,
    RequestJson(body): RequestJson<UpdateParameters>,
) -> ApiResult<Json<AlignmentProjectJson>> {
    assert_may_access(jobs_enabled, &user)?;
    let mut transaction = state.pool.begin().await?;
    let project = find_readable(&mut transaction, &user, &id).await?;
    let name = body
        .name
        .as_deref()
        .map_or(project.row.name.as_str(), str::trim)
        .to_owned();
    let voxel_size = body.voxel_size.unwrap_or(project.voxel_size);
    if name != project.row.name {
        service::assert_valid_name(
            &mut transaction,
            &project.row.organization,
            &name,
            Some(project.id()),
        )
        .await?;
    }
    service::assert_valid_voxel_size(&voxel_size)?;
    let updated = alignment_project_dao::update_metadata(
        &mut transaction,
        &user.id,
        project.id(),
        &name,
        body.description
            .as_deref()
            .unwrap_or(&project.row.description),
        voxel_size.factor.to_array(),
        voxel_size.unit.as_str(),
    )
    .await
    .map_err(service::name_taken_on_conflict(&name))?;
    if !updated {
        // SecuredSQLDAO.assertUpdateAccess.
        return Err(ApiError::bad_request("No update access."));
    }
    let updated = find_readable(&mut transaction, &user, &id).await?;
    let json =
        service::public_writes(&mut transaction, config.input_data_retention, &updated).await?;
    transaction.commit().await?;
    Ok(Json(json))
}

async fn delete(
    State(state): State<AppState>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
    State(clients): State<ServiceClients>,
    Path(id): Path<PathObjectId>,
    user: AuthUser,
) -> RunResult<StatusCode> {
    assert_may_access(jobs_enabled, &user)?;
    let mut connection = state.pool.acquire().await?;
    let project = find_readable(&mut connection, &user, &id).await?;
    drop(connection);
    service::delete_project(&state.pool, &clients, &user, &project)
        .await
        .map_err(|error| RunError::from(error).wrap(msg::DELETE_FAILED))?;
    Ok(StatusCode::OK)
}

/// `assertCanStartJob`: the input data still exists and the CSV is valid.
fn assert_can_start_job(project: &AlignmentProject) -> ApiResult<()> {
    if project.row.is_input_data_deleted {
        return Err(ApiError::bad_request(msg::INPUT_DATA_DELETED));
    }
    if project.row.status != READY {
        return Err(ApiError::bad_request(msg::NOT_READY));
    }
    Ok(())
}

/// The project's section range, set for READY projects.
fn project_section_range(project: &AlignmentProject) -> ApiResult<SectionRange> {
    project
        .section_range
        .ok_or_else(|| ApiError::bad_request(msg::NOT_READY))
}

/// `selectedSectionRangeFor`: all sections, or a valid subset of them.
fn selected_section_range(
    project_range: SectionRange,
    requested: Option<SectionRange>,
) -> ApiResult<SectionRange> {
    match requested {
        None => Ok(project_range),
        Some(range)
            if range.first <= range.last
                && range.first >= project_range.first
                && range.last <= project_range.last =>
        {
            Ok(range)
        }
        Some(_) => Err(ApiError::bad_request(msg::INVALID_SECTION_RANGE)),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreditCostQuery {
    render_unaligned: bool,
    first_section: Option<i32>,
    last_section: Option<i32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreditCost {
    cost_in_milli_credits: i32,
    has_enough_credits: bool,
    organization_milli_credits: i64,
}

// Query extraction precedes authentication: Play binds route parameters first.
async fn job_credit_cost(
    State(state): State<AppState>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
    State(misc): State<MiscState>,
    Path(id): Path<PathObjectId>,
    Query(query): Query<CreditCostQuery>,
    user: AuthUser,
) -> ApiResult<Json<CreditCost>> {
    assert_may_access(jobs_enabled, &user)?;
    let mut connection = state.pool.acquire().await?;
    let project = find_readable(&mut connection, &user, &id).await?;
    assert_can_start_job(&project)?;
    let project_range = project_section_range(&project)?;
    let requested = match (query.first_section, query.last_section) {
        (Some(first), Some(last)) => Some(SectionRange { first, last }),
        (None, None) => None,
        _ => return Err(ApiError::bad_request(msg::INVALID_SECTION_RANGE)),
    };
    let selected = selected_section_range(project_range, requested)?;
    let cost = service::cost_in_milli_credits(
        &misc.config().features,
        project.row.total_size_in_bytes,
        project_range,
        selected,
        query.render_unaligned,
    );
    // CreditTransactionDAO.getMilliCreditBalance with the user's access.
    let balance = crate::job::job_dao::get_milli_credit_balance(
        &mut connection,
        &user.id,
        &user.organization_id,
    )
    .await?;
    Ok(Json(CreditCost {
        cost_in_milli_credits: cost,
        has_enough_credits: i64::from(cost) <= balance,
        organization_milli_credits: balance,
    }))
}

/// AlignmentProjectJobParameters.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JobParameters {
    new_dataset_name: String,
    /// `None` means the organization's root folder.
    folder_id: Option<crate::util::id::ObjectId>,
    render_unaligned: bool,
    /// `None` means all sections.
    section_range: Option<SectionRange>,
}

/// AlignmentProjectController.runAlignJob: a paid `align` job of the project, priced by its
/// input data size.
async fn run_align_job(
    State(state): State<AppState>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
    State(misc): State<MiscState>,
    State(clients): State<ServiceClients>,
    Path(id): Path<PathObjectId>,
    user: AuthUser,
    RequestJson(parameters): RequestJson<JobParameters>,
) -> RunResult<Json<JobCompactInfo>> {
    assert_may_access(jobs_enabled, &user)?;
    let mut connection = state.pool.acquire().await?;
    let project = find_readable(&mut connection, &user, &id).await?;
    assert_can_start_job(&project)?;
    let project_range = project_section_range(&project)?;
    let selected = selected_section_range(project_range, parameters.section_range)?;
    let csv_path = project
        .row
        .csv_path
        .as_deref()
        .ok_or_else(|| ApiError::bad_request(msg::NOT_READY))?;
    let organization = &project.row.organization;
    crate::dataset::create::validate_dataset_name(&parameters.new_dataset_name)?;
    // DatasetService.checkNameAvailable.
    if crate::remote::datastore::dataset_upload::dataset_name_is_taken(
        &state.pool,
        &parameters.new_dataset_name,
        organization,
    )
    .await?
    {
        return Err(Failure::new(crate::msg::dataset::name::taken(
            &parameters.new_dataset_name,
        ))
        .into());
    }
    let root_folder =
        alignment_project_dao::find_organization_root_folder(&mut connection, organization)
            .await?
            .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    let folder_id = parameters.folder_id.unwrap_or(root_folder);
    if !crate::dataset::create::folder_writable(&mut connection, &user, &folder_id).await? {
        return Err(Failure::new(crate::msg::folder::NO_WRITE_ACCESS).into());
    }
    let project_directory =
        service::directory_on_data_store(&mut connection, &clients, &project).await?;
    drop(connection);
    let args = json!({
        "alignment_project_id": project.id(),
        "tiles_csv_path": project_directory.join(csv_path).to_string(),
        "voxel_size": project.voxel_size.factor,
        "voxel_size_unit": project.voxel_size.unit,
        "organization_id": organization,
        "new_dataset_name": parameters.new_dataset_name,
        "webknossos_folder_id": folder_id,
        // The section range is inclusive, voxelytics expects the upper bound exclusive.
        "section_range": parameters
            .section_range
            .map(|range| [i64::from(range.first), i64::from(range.last) + 1]),
        "render_unaligned": parameters.render_unaligned,
    });
    let cost = service::cost_in_milli_credits(
        &misc.config().features,
        project.row.total_size_in_bytes,
        project_range,
        selected,
        parameters.render_unaligned,
    );
    let submission = Submission {
        command: "align",
        args,
        data_store: &project.row.data_store,
        alignment_project: Some(project.id()),
    };
    let comment = format!("Align alignment project {}", project.row.name);
    let job_id = begin_paid_job_with_cost(&state, jobs_enabled, &user, &submission, cost, &comment)
        .await?
        .commit(&state, &misc, &user)
        .await?;
    let mut connection = state.pool.acquire().await?;
    let job = crate::job::routes::find_job(&mut connection, &user.id, &job_id)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    Ok(Json(
        crate::job::routes::public_writes(&mut connection, &user.id, &job).await?,
    ))
}
