//! AlignmentProjectService: permissions, validation, pricing, the project directory on the
//! datastore, input data and project deletion, and publicWrites.
use std::time::Duration;

use chrono::{DateTime, Utc};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::{PgConnection, PgPool};
use webknossos_common::{
    datasource::VoxelSize, enums::LengthUnit, geometry::Vec3Double, upath::UPath,
};

use super::alignment_project_dao::{self, AlignmentProjectRow};
use crate::{
    auth::AuthUser,
    error::{ApiError, ApiResult},
    msg::alignment_project as msg,
    stores::client::{ServiceClients, ServiceError},
    util::id::ObjectId,
};

/// DirectoryConstants.alignmentProjectsDir: below the organization directory on the datastore.
const ALIGNMENT_PROJECTS_DIR: &str = ".alignmentProjects";
const BYTES_PER_GIGABYTE: f64 = 1e9;

/// AlignmentProjectStatus.
pub(crate) const UPLOADING: &str = "UPLOADING";
pub(crate) const READY: &str = "READY";
pub(crate) const INVALID: &str = "INVALID";

/// SectionRange: inclusive on both ends.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct SectionRange {
    pub first: i32,
    pub last: i32,
}

impl SectionRange {
    fn section_count(self) -> i64 {
        i64::from(self.last) - i64::from(self.first) + 1
    }
}

/// AlignmentProject: a parsed [`AlignmentProjectRow`].
#[derive(Clone, Debug)]
pub(crate) struct AlignmentProject {
    pub row: AlignmentProjectRow,
    pub voxel_size: VoxelSize,
    /// Set once the upload is finished and the CSV is valid.
    pub section_range: Option<SectionRange>,
}

impl AlignmentProject {
    /// AlignmentProjectDAO.parse; an unparsable row is the DAO's "Parsing failed" failure.
    pub(crate) fn parse(row: AlignmentProjectRow) -> ApiResult<Self> {
        let parsing_failed = || {
            ApiError::bad_request(format!(
                "Parsing failed for row in webknossos.alignmentProjects queried by {}",
                row.id
            ))
        };
        if ![UPLOADING, READY, INVALID].contains(&row.status.as_str()) {
            return Err(parsing_failed());
        }
        let [x, y, z] = row.voxel_size_factor[..] else {
            return Err(parsing_failed());
        };
        let unit = LengthUnit::from_name(&row.voxel_size_unit).ok_or_else(parsing_failed)?;
        let section_range = match (row.first_section, row.last_section) {
            (Some(first), Some(last)) => Some(SectionRange { first, last }),
            _ => None,
        };
        Ok(Self {
            voxel_size: VoxelSize {
                factor: Vec3Double::new(x, y, z),
                unit,
            },
            section_range,
            row,
        })
    }

    pub(crate) fn id(&self) -> &ObjectId {
        &self.row.id
    }
}

/// AlignmentProjectService.assertMayAccessAlignmentProjects: jobs enabled, admin or dataset
/// manager (`~> FORBIDDEN`).
pub(crate) fn assert_may_access(jobs_enabled: bool, user: &AuthUser) -> ApiResult<()> {
    if !jobs_enabled {
        return Err(ApiError::bad_request(crate::msg::job::NOT_ENABLED));
    }
    if !(user.is_admin || user.is_dataset_manager) {
        return Err(ApiError::forbidden(msg::NO_ADMIN_OR_DATASET_MANAGER));
    }
    Ok(())
}

/// `alignmentProjectDAO.findOne(id) ?~> Msg.AlignmentProject.notFound ~> NOT_FOUND` with the
/// user's read access.
pub(crate) async fn find_readable(
    connection: &mut PgConnection,
    user: &AuthUser,
    id: &ObjectId,
) -> ApiResult<AlignmentProject> {
    let row = alignment_project_dao::find_one(connection, Some(&user.id), id)
        .await?
        .ok_or_else(|| ApiError::not_found(msg::NOT_FOUND))?;
    AlignmentProject::parse(row).map_err(|_| ApiError::not_found(msg::NOT_FOUND))
}

/// AlignmentProjectService.assertValidName: not blank and not taken in the organization.
pub(crate) async fn assert_valid_name(
    connection: &mut PgConnection,
    organization: &str,
    name: &str,
    excluded_id: Option<&ObjectId>,
) -> ApiResult<()> {
    if name.trim().is_empty() {
        return Err(ApiError::bad_request(msg::EMPTY_NAME));
    }
    if alignment_project_dao::is_name_taken(connection, organization, name, excluded_id).await? {
        return Err(ApiError::bad_request(msg::name_taken(name)));
    }
    Ok(())
}

/// A unique-index violation on (organization, name): a concurrent request took the name.
pub(crate) fn name_taken_on_conflict(name: &str) -> impl Fn(sqlx::Error) -> ApiError + '_ {
    move |error| {
        if let sqlx::Error::Database(database) = &error
            && database.code().as_deref() == Some("23505")
        {
            return ApiError::bad_request(msg::name_taken(name));
        }
        error.into()
    }
}

/// VoxelSize.isValid: all components positive and finite (NaN fails the comparison).
pub(crate) fn is_valid_voxel_size(voxel_size: &VoxelSize) -> bool {
    voxel_size
        .factor
        .to_array()
        .iter()
        .all(|component| *component > 0.0 && !component.is_infinite())
}

/// AlignmentProjectService.assertValidVoxelSize.
pub(crate) fn assert_valid_voxel_size(voxel_size: &VoxelSize) -> ApiResult<()> {
    if is_valid_voxel_size(voxel_size) {
        Ok(())
    } else {
        Err(ApiError::bad_request(msg::INVALID_VOXEL_SIZE))
    }
}

/// `features.alignmentProject*CostInMilliCreditsPerGB` (default 0, free during the trial phase).
fn price_per_gigabyte(features: &Map<String, Value>, render_unaligned: bool) -> i32 {
    let key = if render_unaligned {
        "alignmentProjectRenderUnalignedCostInMilliCreditsPerGB"
    } else {
        "alignmentProjectAlignCostInMilliCreditsPerGB"
    };
    features
        .get(key)
        .and_then(Value::as_i64)
        .and_then(|value| i32::try_from(value).ok())
        .unwrap_or(0)
}

/// AlignmentProjectService.costInMilliCredits: priced by the size of the uploaded input data,
/// prorated for section subsets (assuming a roughly uniform size per section).
pub(crate) fn cost_in_milli_credits(
    features: &Map<String, Value>,
    total_size_in_bytes: Option<i64>,
    project_section_range: SectionRange,
    selected_section_range: SectionRange,
    render_unaligned: bool,
) -> i32 {
    let price = f64::from(price_per_gigabyte(features, render_unaligned));
    let selected_fraction = selected_section_range.section_count() as f64
        / project_section_range.section_count() as f64;
    let size_in_gigabytes = total_size_in_bytes.unwrap_or(0) as f64 / BYTES_PER_GIGABYTE;
    // Scala's Double.toInt saturates like `as i32`.
    ((size_in_gigabytes * selected_fraction * price).ceil() as i32).max(0)
}

/// The project's datastore (DataStoreDAO.findOneByName with global access): its internal URL.
async fn data_store_url(executor: &mut PgConnection, data_store: &str) -> ApiResult<String> {
    crate::job::job_dao::find_data_store_url(&mut *executor, data_store)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))
}

/// AlignmentProjectService.directoryOnDataStore: `<organization base dir>/.alignmentProjects/<id>`.
/// The base dir must match the one the datastore chose for the upload (`requireAllowsUpload`).
pub(crate) async fn directory_on_data_store(
    connection: &mut PgConnection,
    clients: &ServiceClients,
    project: &AlignmentProject,
) -> ApiResult<UPath> {
    let url = data_store_url(connection, &project.row.data_store).await?;
    directory_on(clients, &url, project).await
}

async fn directory_on(
    clients: &ServiceClients,
    data_store_url: &str,
    project: &AlignmentProject,
) -> ApiResult<UPath> {
    let base: String = clients
        .get_json(
            data_store_url,
            &["data", "datasets", "getOneBaseDirForOrgaAbsolute"],
            &[
                ("organizationId", project.row.organization.clone()),
                ("requireAllowsUpload", "true".to_owned()),
            ],
        )
        .await?;
    let base = UPath::parse(&base).map_err(|_| ApiError::from(ServiceError::InvalidJson))?;
    Ok(base
        .join(ALIGNMENT_PROJECTS_DIR)
        .join(project.row.id.as_str()))
}

/// AlignmentProjectService.deleteInputData: cancels the project's unfinished jobs, removes the
/// partially uploaded files (if still uploading) and the project directory on the datastore,
/// then marks the input data as deleted.
pub(crate) async fn delete_input_data(
    pool: &PgPool,
    clients: &ServiceClients,
    project: &AlignmentProject,
) -> ApiResult<()> {
    cancel_unfinished_jobs(pool, project.id()).await?;
    if !project.row.is_input_data_deleted {
        let mut connection = pool.acquire().await?;
        let url = data_store_url(&mut connection, &project.row.data_store).await?;
        drop(connection);
        // The final directory is deleted anyway, in case the upload just finished.
        if project.row.status == UPLOADING {
            clients
                .request(
                    Method::DELETE,
                    &url,
                    &[
                        "data",
                        "datasets",
                        "upload",
                        "alignmentProject",
                        "cancelUploadForProject",
                    ],
                    &[("alignmentProjectId", project.id().to_string())],
                    None,
                )
                .await?;
        }
        let directory = directory_on(clients, &url, project).await?;
        crate::dataset::paths::delete_paths(pool, clients, &url, &[directory.to_string()]).await?;
    }
    let mut connection = pool.acquire().await?;
    alignment_project_dao::mark_input_data_deleted(&mut connection, project.id()).await?;
    Ok(())
}

/// JobService.cancelJob (global access) for every pending or running job of the project, in
/// one transaction.
async fn cancel_unfinished_jobs(pool: &PgPool, project_id: &ObjectId) -> ApiResult<()> {
    let mut transaction = crate::db::begin_serializable(pool).await?;
    let job_ids =
        alignment_project_dao::find_unfinished_job_ids(&mut transaction, project_id).await?;
    for job_id in job_ids {
        let job = crate::job::routes::find_job_global(&mut transaction, &job_id)
            .await?
            .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
        crate::job::routes::cancel_job(&mut transaction, &job).await?;
    }
    transaction.commit().await?;
    Ok(())
}

/// AlignmentProjectService.deleteProject: deletes the input data, keeps the project's jobs
/// without the reference, and soft-deletes the project with the user's delete access.
pub(crate) async fn delete_project(
    pool: &PgPool,
    clients: &ServiceClients,
    user: &AuthUser,
    project: &AlignmentProject,
) -> ApiResult<()> {
    delete_input_data(pool, clients, project).await?;
    let mut transaction = pool.begin().await?;
    alignment_project_dao::clear_job_references(&mut transaction, project.id()).await?;
    if !alignment_project_dao::delete_one(&mut transaction, &user.id, project.id()).await? {
        return Err(ApiError::bad_request("No delete access."));
    }
    transaction.commit().await?;
    Ok(())
}

/// AlignmentProjectService.publicWrites. `null` for absent optional values, as Play's Json.obj.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AlignmentProjectJson {
    id: ObjectId,
    name: String,
    description: String,
    status: String,
    invalid_reason: Option<String>,
    #[serde(with = "chrono::serde::ts_milliseconds")]
    created: DateTime<Utc>,
    owner_first_name: String,
    owner_last_name: String,
    data_store_name: String,
    data_store_url: String,
    voxel_size: VoxelSize,
    csv_path: Option<String>,
    file_count: Option<i64>,
    total_size_in_bytes: Option<i64>,
    section_range: Option<SectionRange>,
    is_input_data_deleted: bool,
    #[serde(with = "chrono::serde::ts_milliseconds_option")]
    csv_replaced: Option<DateTime<Utc>>,
    /// The actual deletion is postponed while alignments are pending or running.
    #[serde(with = "chrono::serde::ts_milliseconds")]
    input_data_deletion_date: DateTime<Utc>,
    job_count: i64,
}

/// AlignmentProjectService.publicWrites: owner, datastore and job count with global access; a
/// missing owner or datastore is Play's empty Fox (404).
pub(crate) async fn public_writes(
    connection: &mut PgConnection,
    input_data_retention: Duration,
    project: &AlignmentProject,
) -> ApiResult<AlignmentProjectJson> {
    let details = alignment_project_dao::find_public_details(connection, &project.row).await?;
    let not_found = || ApiError::not_found(crate::msg::NOT_FOUND);
    let (Some(owner_first_name), Some(owner_last_name)) =
        (details.owner_first_name, details.owner_last_name)
    else {
        return Err(not_found());
    };
    let data_store_url = details.data_store_public_url.ok_or_else(not_found)?;
    let retention =
        chrono::Duration::from_std(input_data_retention).map_err(|_| ApiError::internal())?;
    let row = &project.row;
    Ok(AlignmentProjectJson {
        id: row.id.clone(),
        name: row.name.clone(),
        description: row.description.clone(),
        status: row.status.clone(),
        invalid_reason: row.invalid_reason.clone(),
        created: row.created,
        owner_first_name,
        owner_last_name,
        data_store_name: row.data_store.clone(),
        data_store_url,
        voxel_size: project.voxel_size,
        csv_path: row.csv_path.clone(),
        file_count: row.file_count,
        total_size_in_bytes: row.total_size_in_bytes,
        section_range: project.section_range,
        is_input_data_deleted: row.is_input_data_deleted,
        csv_replaced: row.csv_replaced,
        input_data_deletion_date: row
            .created
            .checked_add_signed(retention)
            .ok_or_else(ApiError::internal)?,
        job_count: details.job_count,
    })
}
