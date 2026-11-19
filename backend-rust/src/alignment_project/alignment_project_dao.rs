//! AlignmentProjectDAO and the job queries of alignment projects.
//!
//! Callers own the connection and transaction; these functions only run SQL and return rows.
//! Mapping a missing row to an error is up to the caller.
use chrono::{DateTime, Utc};
use sqlx::PgConnection;

use crate::{sql::Sql, util::id::ObjectId};

/// A row of webknossos.alignmentProjects_ (AlignmentProjectDAO's AlignmentProject), with the
/// status and voxel size unit as text and the voxel size factor as an array.
#[derive(sqlx::FromRow, Clone, Debug)]
pub(crate) struct AlignmentProjectRow {
    pub id: ObjectId,
    pub organization: String,
    pub owner: ObjectId,
    pub data_store: String,
    pub name: String,
    pub description: String,
    pub status: String,
    pub invalid_reason: Option<String>,
    pub voxel_size_factor: Vec<f64>,
    pub voxel_size_unit: String,
    pub csv_path: Option<String>,
    pub file_count: Option<i64>,
    pub total_size_in_bytes: Option<i64>,
    pub first_section: Option<i32>,
    pub last_section: Option<i32>,
    pub is_input_data_deleted: bool,
    pub csv_replaced: Option<DateTime<Utc>>,
    pub created: DateTime<Utc>,
}

/// Column list for [`AlignmentProjectRow`] (alias `p`, `_dataStore` trimmed as in the parse).
const COLUMNS: &str = r#"p._id AS id, p._organization AS organization, p._owner AS owner,
  TRIM(p._dataStore) AS data_store, p.name, p.description, p.status::text AS status,
  p.invalidReason AS invalid_reason,
  ARRAY[(p.voxelSizeFactor).x, (p.voxelSizeFactor).y, (p.voxelSizeFactor).z]::float8[] AS voxel_size_factor,
  p.voxelSizeUnit::text AS voxel_size_unit, p.csvPath AS csv_path, p.fileCount AS file_count,
  p.totalSizeInBytes AS total_size_in_bytes, p.firstSection AS first_section,
  p.lastSection AS last_section, p.isInputDataDeleted AS is_input_data_deleted,
  p.csvReplaced AS csv_replaced, p.created"#;

/// AlignmentProjectDAO.readAccessQ for alias `p` (also its update and delete access): only
/// admins and dataset managers of the project's organization.
fn push_read_access(q: &mut Sql, user_id: &ObjectId) {
    q.push("p._organization IN (SELECT _organization FROM webknossos.users_ WHERE _id = ")
        .push_bind(user_id)
        .push(" AND (isAdmin OR isDatasetManager))");
}

/// AlignmentProjectDAO.findOne, with the user's read access or (`None`) global access.
pub(crate) async fn find_one(
    connection: &mut PgConnection,
    access: Option<&ObjectId>,
    id: &ObjectId,
) -> sqlx::Result<Option<AlignmentProjectRow>> {
    let mut q = Sql::new("SELECT ");
    q.push(COLUMNS)
        .push(" FROM webknossos.alignmentProjects_ p WHERE p._id = ")
        .push_bind(id);
    if let Some(user_id) = access {
        q.push(" AND ");
        push_read_access(&mut q, user_id);
    }
    q.build_query_as().fetch_optional(&mut *connection).await
}

/// AlignmentProjectDAO.findAllByOrganization with the user's read access, newest first.
pub(crate) async fn find_all_by_organization(
    connection: &mut PgConnection,
    user_id: &ObjectId,
    organization: &str,
) -> sqlx::Result<Vec<AlignmentProjectRow>> {
    let mut q = Sql::new("SELECT ");
    q.push(COLUMNS)
        .push(" FROM webknossos.alignmentProjects_ p WHERE p._organization = ")
        .push_bind(organization)
        .push(" AND ");
    push_read_access(&mut q, user_id);
    q.push(" ORDER BY p.created DESC, p._id DESC");
    q.build_query_as().fetch_all(&mut *connection).await
}

/// AlignmentProjectDAO.findAllWithExpiredInputData: projects created before `created_before`
/// whose input data still exists (abandoned uploads included), skipping projects with pending or
/// running jobs.
pub(crate) async fn find_all_with_expired_input_data(
    connection: &mut PgConnection,
    created_before: DateTime<Utc>,
) -> sqlx::Result<Vec<AlignmentProjectRow>> {
    let mut q = Sql::new("SELECT ");
    q.push(COLUMNS).push(
        " FROM webknossos.alignmentProjects_ p WHERE NOT p.isInputDataDeleted AND p.created < ",
    );
    q.push_bind(created_before).push(
        " AND NOT EXISTS (SELECT 1 FROM webknossos.jobs_ j WHERE j._alignmentProject = p._id \
         AND COALESCE(j.manualState, j.state) IN ('PENDING', 'STARTED')) \
         ORDER BY p.created, p._id",
    );
    q.build_query_as().fetch_all(&mut *connection).await
}

/// AlignmentProjectDAO.isNameTaken among the organization's non-deleted projects.
pub(crate) async fn is_name_taken(
    connection: &mut PgConnection,
    organization: &str,
    name: &str,
    excluded_id: Option<&ObjectId>,
) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM webknossos.alignmentProjects_ \
         WHERE _organization = $1 AND name = $2 AND ($3::text IS NULL OR _id != $3))",
    )
    .bind(organization)
    .bind(name)
    .bind(excluded_id)
    .fetch_one(&mut *connection)
    .await
}

/// The fields of a new project (AlignmentProjectDAO.insertOne); status UPLOADING, no CSV yet.
pub(crate) struct NewAlignmentProject<'a> {
    pub id: &'a ObjectId,
    pub organization: &'a str,
    pub owner: &'a ObjectId,
    pub data_store: &'a str,
    pub name: &'a str,
    pub voxel_size_factor: [f64; 3],
    pub voxel_size_unit: &'a str,
}

/// AlignmentProjectDAO.insertOne for a new upload: empty description, status UPLOADING.
pub(crate) async fn insert_one(
    connection: &mut PgConnection,
    project: &NewAlignmentProject<'_>,
) -> sqlx::Result<()> {
    let [x, y, z] = project.voxel_size_factor;
    sqlx::query(
        r#"INSERT INTO webknossos.alignmentProjects(
            _id, _organization, _owner, _dataStore, name, description, status, invalidReason,
            voxelSizeFactor, voxelSizeUnit, csvPath, fileCount, totalSizeInBytes, firstSection,
            lastSection, isInputDataDeleted, created, isDeleted)
          VALUES ($1, $2, $3, $4, $5, '', 'UPLOADING', NULL,
            ROW($6, $7, $8)::webknossos.VECTOR3, $9::webknossos.LENGTH_UNIT, NULL, NULL, NULL, NULL,
            NULL, FALSE, NOW(), FALSE)"#,
    )
    .bind(project.id)
    .bind(project.organization)
    .bind(project.owner)
    .bind(project.data_store)
    .bind(project.name)
    .bind(x)
    .bind(y)
    .bind(z)
    .bind(project.voxel_size_unit)
    .execute(&mut *connection)
    .await?;
    Ok(())
}

/// AlignmentProjectDAO.updateMetadata, with the user's update access (the read access).
/// Returns whether the project was updated.
pub(crate) async fn update_metadata(
    connection: &mut PgConnection,
    user_id: &ObjectId,
    id: &ObjectId,
    name: &str,
    description: &str,
    voxel_size_factor: [f64; 3],
    voxel_size_unit: &str,
) -> sqlx::Result<bool> {
    let [x, y, z] = voxel_size_factor;
    let mut q = Sql::new("UPDATE webknossos.alignmentProjects p SET name = ");
    q.push_bind(name)
        .push(", description = ")
        .push_bind(description)
        .push(", voxelSizeFactor = ROW(")
        .push_bind(x)
        .push(", ")
        .push_bind(y)
        .push(", ")
        .push_bind(z)
        .push(")::webknossos.VECTOR3, voxelSizeUnit = ")
        .push_bind(voxel_size_unit)
        .push("::webknossos.LENGTH_UNIT WHERE p._id = ")
        .push_bind(id)
        .push(" AND NOT p.isDeleted AND ");
    push_read_access(&mut q, user_id);
    Ok(q.build().execute(&mut *connection).await?.rows_affected() == 1)
}

/// The report of a finished upload (AlignmentProjectDAO.finishUpload).
pub(crate) struct FinishedUpload<'a> {
    pub status: &'a str,
    pub invalid_reason: Option<&'a str>,
    pub csv_path: Option<&'a str>,
    pub file_count: i64,
    pub total_size_in_bytes: i64,
    pub section_range: Option<(i32, i32)>,
}

/// AlignmentProjectDAO.finishUpload.
pub(crate) async fn finish_upload(
    connection: &mut PgConnection,
    id: &ObjectId,
    upload: &FinishedUpload<'_>,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"UPDATE webknossos.alignmentProjects
          SET status = $2::webknossos.ALIGNMENT_PROJECT_STATUS, invalidReason = $3, csvPath = $4,
            fileCount = $5, totalSizeInBytes = $6, firstSection = $7, lastSection = $8
          WHERE _id = $1"#,
    )
    .bind(id)
    .bind(upload.status)
    .bind(upload.invalid_reason)
    .bind(upload.csv_path)
    .bind(upload.file_count)
    .bind(upload.total_size_in_bytes)
    .bind(upload.section_range.map(|range| range.0))
    .bind(upload.section_range.map(|range| range.1))
    .execute(&mut *connection)
    .await?;
    Ok(())
}

/// AlignmentProjectDAO.replaceCsv: a validated replacement makes the project READY. Returns
/// whether it was replaced (not if the input data was deleted in the meantime).
pub(crate) async fn replace_csv(
    connection: &mut PgConnection,
    id: &ObjectId,
    csv_path: &str,
    section_range: (i32, i32),
) -> sqlx::Result<bool> {
    Ok(sqlx::query(
        r#"UPDATE webknossos.alignmentProjects
          SET status = 'READY', invalidReason = NULL, csvPath = $2, firstSection = $3,
            lastSection = $4, csvReplaced = NOW()
          WHERE _id = $1 AND NOT isInputDataDeleted"#,
    )
    .bind(id)
    .bind(csv_path)
    .bind(section_range.0)
    .bind(section_range.1)
    .execute(&mut *connection)
    .await?
    .rows_affected()
        == 1)
}

/// AlignmentProjectDAO.markInputDataDeleted.
pub(crate) async fn mark_input_data_deleted(
    connection: &mut PgConnection,
    id: &ObjectId,
) -> sqlx::Result<()> {
    sqlx::query("UPDATE webknossos.alignmentProjects SET isInputDataDeleted = TRUE WHERE _id = $1")
        .bind(id)
        .execute(&mut *connection)
        .await?;
    Ok(())
}

/// AlignmentProjectDAO.deleteOne (soft delete) with the user's delete access (the read access).
/// Returns whether the project was deleted.
pub(crate) async fn delete_one(
    connection: &mut PgConnection,
    user_id: &ObjectId,
    id: &ObjectId,
) -> sqlx::Result<bool> {
    let mut q =
        Sql::new("UPDATE webknossos.alignmentProjects p SET isDeleted = TRUE WHERE p._id = ");
    q.push_bind(id).push(" AND NOT p.isDeleted AND ");
    push_read_access(&mut q, user_id);
    Ok(q.build().execute(&mut *connection).await?.rows_affected() == 1)
}

/// The owner's names and the datastore's public URL of AlignmentProjectService.publicWrites
/// (global access; `None` if not found) plus JobDAO.countByAlignmentProject.
#[derive(sqlx::FromRow)]
pub(crate) struct PublicDetails {
    pub owner_first_name: Option<String>,
    pub owner_last_name: Option<String>,
    pub data_store_public_url: Option<String>,
    pub job_count: i64,
}

pub(crate) async fn find_public_details(
    connection: &mut PgConnection,
    project: &AlignmentProjectRow,
) -> sqlx::Result<PublicDetails> {
    sqlx::query_as(
        r#"SELECT mu.firstName AS owner_first_name, mu.lastName AS owner_last_name,
            (SELECT publicUrl FROM webknossos.dataStores_ WHERE name = $2) AS data_store_public_url,
            (SELECT COUNT(*) FROM webknossos.jobs_ WHERE _alignmentProject = $3) AS job_count
          FROM (SELECT 1) one
          LEFT JOIN webknossos.users_ u ON u._id = $1
          LEFT JOIN webknossos.multiUsers_ mu ON mu._id = u._multiUser"#,
    )
    .bind(&project.owner)
    .bind(&project.data_store)
    .bind(&project.id)
    .fetch_one(&mut *connection)
    .await
}

/// JobDAO.findAllUnfinishedByAlignmentProject: the ids of the project's pending or running jobs.
pub(crate) async fn find_unfinished_job_ids(
    connection: &mut PgConnection,
    id: &ObjectId,
) -> sqlx::Result<Vec<ObjectId>> {
    sqlx::query_scalar(
        "SELECT _id FROM webknossos.jobs_ WHERE _alignmentProject = $1 \
         AND COALESCE(manualState, state) IN ('PENDING', 'STARTED') ORDER BY created, _id",
    )
    .bind(id)
    .fetch_all(&mut *connection)
    .await
}

/// JobDAO.clearAlignmentProject: jobs of a deleted project are kept without the reference.
pub(crate) async fn clear_job_references(
    connection: &mut PgConnection,
    id: &ObjectId,
) -> sqlx::Result<()> {
    sqlx::query("UPDATE webknossos.jobs SET _alignmentProject = NULL WHERE _alignmentProject = $1")
        .bind(id)
        .execute(&mut *connection)
        .await?;
    Ok(())
}

/// OrganizationDAO.findOne with global access: the root folder.
pub(crate) async fn find_organization_root_folder(
    connection: &mut PgConnection,
    organization: &str,
) -> sqlx::Result<Option<ObjectId>> {
    sqlx::query_scalar("SELECT _rootFolder FROM webknossos.organizations_ WHERE _id = $1")
        .bind(organization)
        .fetch_optional(&mut *connection)
        .await
}

/// OrganizationDAO.findOne with global access: whether the organization exists.
pub(crate) async fn organization_exists(
    connection: &mut PgConnection,
    organization: &str,
) -> sqlx::Result<bool> {
    sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM webknossos.organizations_ WHERE _id = $1)")
        .bind(organization)
        .fetch_one(&mut *connection)
        .await
}
