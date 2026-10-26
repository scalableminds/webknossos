//! DatasetDAO.insertOne and the folder/organization lookups behind dataset creation.
use serde_json::Value;
use sqlx::PgConnection;

use super::NewDataset;
use crate::{auth::AuthUser, error::ApiResult, util::id::ObjectId};

/// FolderDAO update access: organization admins/dataset managers, or team
/// managers of a team allowed on the folder or one of its ancestors.
pub(crate) async fn is_folder_writable(
    connection: &mut PgConnection,
    user: &AuthUser,
    folder: &ObjectId,
) -> ApiResult<bool> {
    Ok(sqlx::query_scalar(
        r#"SELECT EXISTS (SELECT 1 FROM webknossos.folders_ f WHERE f._id = $1 AND (
             f._id IN (SELECT fp._descendant FROM webknossos.folder_paths fp WHERE fp._ancestor IN (
               SELECT o._rootFolder FROM webknossos.organizations_ o JOIN webknossos.users_ u ON u._organization = o._id
               WHERE u._id = $2 AND (u.isAdmin OR u.isDatasetManager)))
             OR f._id IN (SELECT fp._descendant FROM webknossos.folder_paths fp WHERE fp._ancestor IN (
               SELECT at._folder FROM webknossos.folder_allowedTeams at JOIN webknossos.user_team_roles tr ON at._team = tr._team
               WHERE tr._user = $2 AND tr.isTeamManager))))"#,
    )
    .bind(folder)
    .bind(&user.id)
    .fetch_one(connection)
    .await?)
}

/// Share-locks and returns the root folder of the organization.
pub(crate) async fn find_root_folder_for_share(
    connection: &mut PgConnection,
    organization_id: &str,
) -> ApiResult<Option<ObjectId>> {
    Ok(sqlx::query_scalar(
        "SELECT _rootFolder FROM webknossos.organizations_ WHERE _id = $1 FOR SHARE",
    )
    .bind(organization_id)
    .fetch_optional(connection)
    .await?)
}

/// Inserts the dataset row; returns whether a row was written (it is not when
/// `skip_on_directory_name_conflict` and the directory name is taken).
pub(crate) async fn insert_one(
    connection: &mut PgConnection,
    new: &NewDataset<'_>,
    root: &ObjectId,
    status: String,
    skip_on_directory_name_conflict: bool,
) -> ApiResult<bool> {
    let statement = r#"INSERT INTO webknossos.datasets (_id, _dataStore, _organization, _folder, inboxSourceHash,
             defaultViewConfiguration, description, directoryName, isPublic, isUsable, isVirtual, name,
             voxelSizeFactor, voxelSizeUnit, status, sortingKey, metadata, tags, creationType, importURL, created)
           VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, false, $8, $9, $10,
             CASE WHEN $11::float8 IS NULL THEN NULL ELSE ROW($11, $12, $13)::webknossos.VECTOR3 END,
             $14::webknossos.LENGTH_UNIT, $15, NOW(), $16, '{}',
             $17::webknossos.DATASET_CREATION_TYPE, $18, NOW())"#;
    let on_conflict = if skip_on_directory_name_conflict {
        " ON CONFLICT (directoryName, _organization) DO NOTHING"
    } else {
        ""
    };
    let inserted = sqlx::query(&format!("{statement}{on_conflict}"))
        .bind(new.id)
        .bind(new.store_name)
        .bind(&new.source.id.organization_id)
        .bind(root)
        .bind(
            new.source
                .default_view_configuration
                .clone()
                .map(Value::Object),
        )
        .bind(new.description)
        .bind(&new.source.id.directory_name)
        .bind(new.is_usable)
        .bind(new.is_virtual)
        .bind(new.name)
        .bind(new.voxel_size.map(|v| v.factor.x))
        .bind(new.voxel_size.map(|v| v.factor.y))
        .bind(new.voxel_size.map(|v| v.factor.z))
        .bind(new.voxel_size.map(|v| v.unit.as_str()))
        .bind(status)
        .bind(new.metadata.clone())
        .bind(new.creation_type)
        .bind(new.import_url)
        .execute(connection)
        .await?
        .rows_affected()
        > 0;
    Ok(inserted)
}
