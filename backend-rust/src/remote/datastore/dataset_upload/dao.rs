//! Queries of the reserveDatasetUpload / getUnfinishedDatasetUploadsForUser callbacks.
use sqlx::{PgConnection, PgPool};

use crate::{auth::AuthUser, error::ApiResult, util::id::ObjectId};

#[derive(sqlx::FromRow)]
pub(crate) struct UnfinishedRow {
    pub directory_name: String,
    pub organization: String,
    pub name: String,
    pub folder: ObjectId,
    pub created: i64,
    pub teams: Vec<ObjectId>,
}

/// OrganizationDAO.findOne, reduced to `includedStorage` (outer `None`: no such organization).
pub(crate) async fn find_included_storage(
    pool: &PgPool,
    id: &str,
) -> ApiResult<Option<Option<i64>>> {
    Ok(sqlx::query_scalar::<_, Option<i64>>(
        "SELECT includedStorage FROM webknossos.organizations_ WHERE _id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?)
}

/// OrganizationDAO.getUsedStorage.
pub(crate) async fn get_used_storage(pool: &PgPool, organization: &str) -> ApiResult<i64> {
    Ok(sqlx::query_scalar(
        r#"SELECT COALESCE(SUM(usedStorageBytes), 0)::bigint FROM (
             SELECT usedStorageBytes FROM webknossos.organization_usedStorage_mags WHERE _organization = $1
             UNION ALL
             SELECT usedStorageBytes FROM webknossos.organization_usedStorage_attachments WHERE _organization = $1) combined"#,
    )
    .bind(organization)
    .fetch_one(pool)
    .await?)
}

/// Whether the user may link layers of the dataset: public dataset, dataset
/// manager or admin of its organization, or team manager. `None` if the dataset is missing.
pub(crate) async fn find_layer_link_allowed(
    pool: &PgPool,
    id: &ObjectId,
    user: &AuthUser,
) -> ApiResult<Option<bool>> {
    Ok(sqlx::query_scalar(
        r#"SELECT d.isPublic OR (($3 OR $4) AND d._organization = $5) OR EXISTS (
             SELECT 1 FROM webknossos.user_team_roles r JOIN webknossos.teams_ t ON t._id = r._team
             WHERE r._user = $2 AND r.isTeamManager AND t._organization = d._organization)
           FROM webknossos.datasets_ d WHERE d._id = $1"#,
    )
    .bind(id)
    .bind(&user.id)
    .bind(user.is_dataset_manager)
    .bind(user.is_admin)
    .bind(&user.organization_id)
    .fetch_optional(pool)
    .await?)
}

/// DatasetDAO.findOneByNameAndOrganization existence check.
pub(crate) async fn dataset_name_is_taken(
    pool: &PgPool,
    name: &str,
    organization: &str,
) -> ApiResult<bool> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM webknossos.datasets_ WHERE name = $1 AND _organization = $2)",
    )
    .bind(name)
    .bind(organization)
    .fetch_one(pool)
    .await?)
}

/// The organization's root folder, share-locked.
pub(crate) async fn find_root_folder_for_share(
    connection: &mut PgConnection,
    organization: &str,
) -> ApiResult<Option<ObjectId>> {
    Ok(sqlx::query_scalar(
        "SELECT _rootFolder FROM webknossos.organizations_ WHERE _id = $1 FOR SHARE",
    )
    .bind(organization)
    .fetch_optional(connection)
    .await?)
}

/// DatasetDAO.updateFolder + DatasetService.addUploader (fresh dataset).
pub(crate) async fn update_folder_and_uploader(
    connection: &mut PgConnection,
    id: &ObjectId,
    folder: &ObjectId,
    uploader: &ObjectId,
) -> ApiResult<()> {
    sqlx::query("UPDATE webknossos.datasets SET _folder = $2, _uploader = $3 WHERE _id = $1")
        .bind(id)
        .bind(folder)
        .bind(uploader)
        .execute(connection)
        .await?;
    Ok(())
}

/// DatasetService.getAllUnfinishedDatasetUploadsOfUser
/// (findAllCompactWithSearch under GlobalAccessContext) joined with
/// TeamDAO.findAllowedTeamIdsForDataset.
pub(crate) async fn find_all_unfinished_uploads(
    pool: &PgPool,
    user_id: &ObjectId,
    organization: &str,
    status: &str,
) -> sqlx::Result<Vec<UnfinishedRow>> {
    sqlx::query_as(
        r#"SELECT d.directoryName AS directory_name, d._organization AS organization, d.name,
             d._folder AS folder, (EXTRACT(EPOCH FROM d.created) * 1000)::bigint AS created,
             ARRAY(SELECT _team FROM webknossos.dataset_allowedTeams WHERE _dataset = d._id ORDER BY _team) AS teams
           FROM webknossos.datasets_ d
           WHERE d._uploader = $1 AND d._organization = $2 AND NOT d.isUsable AND d.status = $3
             AND d.created >= NOW() - INTERVAL '14 days'
           ORDER BY d.created, d._id"#,
    )
    .bind(user_id)
    .bind(organization)
    .bind(status)
    .fetch_all(pool)
    .await
}
