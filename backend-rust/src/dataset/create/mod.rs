//! DatasetService.createDataset / createAndSetUpDataset and the validation
//! helpers shared by upload-to-paths, compose, explore+add and duplication.
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use serde_json::{Value, json};
use webknossos_common::datasource::DataSourceId;

use crate::{
    auth::AuthUser,
    dataset::source::{UsableDataSource, VoxelSize},
    error::{ApiError, ApiResult},
    stores::client::ServiceClients,
    util::id::ObjectId,
    util::text::normalize_strong,
};

pub(crate) fn generate_directory_name(name: &str, id: &str) -> String {
    match normalize_strong(name) {
        Some(prefix) => format!("{prefix}-{id}"),
        None => id.to_owned(),
    }
}

/// RandomIDGenerator.generateBlocking: URL-safe base64 without padding.
pub(crate) fn random_id(bytes: usize) -> ApiResult<String> {
    let mut random = vec![0_u8; bytes];
    getrandom::fill(&mut random).map_err(|_| ApiError::internal())?;
    Ok(URL_SAFE_NO_PAD.encode(random))
}

/// DatasetService.assertValidDatasetName.
pub(crate) fn validate_dataset_name(name: &str) -> ApiResult<()> {
    if !name
        .bytes()
        .all(|c| c.is_ascii_alphanumeric() || b"_-.".contains(&c))
    {
        return Err(ApiError::bad_request(
            crate::msg::dataset::name::INVALID_CHARACTERS,
        ));
    }
    if name.starts_with('.') {
        return Err(ApiError::bad_request(
            crate::msg::dataset::name::INVALID_STARTS_WITH_DOT,
        ));
    }
    if name.chars().count() < 3 {
        return Err(ApiError::bad_request(
            crate::msg::dataset::name::INVALID_LESS_THAN_THREE_CHARACTERS,
        ));
    }
    Ok(())
}

/// DatasetService.assertValidLayerNameLax.
pub(crate) fn validate_layer_name_lax(name: &str) -> ApiResult<()> {
    if name.contains('/') {
        return Err(ApiError::bad_request(
            crate::msg::dataset::layer::NAME_INVALID_CHARACTERS,
        ));
    }
    if name.starts_with('.') {
        return Err(ApiError::bad_request(
            crate::msg::dataset::layer::NAME_INVALID_STARTS_WITH_DOT,
        ));
    }
    Ok(())
}

/// DataSourceValidation.assertValidDataSource.
pub(crate) fn assert_valid_data_source(source: &UsableDataSource) -> ApiResult<()> {
    if source.validation_errors().is_empty() {
        Ok(())
    } else {
        Err(ApiError::bad_request(
            crate::msg::dataset::data_source::INVALID,
        ))
    }
}

/// FolderDAO update access: organization admins/dataset managers, or team
/// managers of a team allowed on the folder or one of its ancestors.
pub(crate) async fn folder_writable(
    connection: &mut sqlx::PgConnection,
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
    .fetch_one(&mut *connection)
    .await?)
}

pub(crate) struct NewDataset<'a> {
    pub id: &'a ObjectId,
    pub store_name: &'a str,
    pub name: &'a str,
    pub source: &'a UsableDataSource,
    pub is_usable: bool,
    /// None keeps the voxel size unset (unusable data sources).
    pub voxel_size: Option<VoxelSize>,
    pub status: &'a str,
    pub is_virtual: bool,
    pub metadata: Value,
    pub description: Option<&'a str>,
    pub creation_type: &'a str,
    pub import_url: Option<&'a str>,
}

/// DatasetService.createDataset (database part): the dataset starts in the
/// root folder of the data source's organization, private, without teams.
pub(crate) async fn insert_dataset(
    connection: &mut sqlx::PgConnection,
    new: NewDataset<'_>,
) -> ApiResult<()> {
    insert(connection, new, false).await.map(|_| ())
}

/// DatasetDAO.insertOne with skipOnDirectoryNameConflict: returns false (and
/// writes nothing) if the organization already has a dataset with this
/// directory name, e.g. inserted by a concurrent disk scan.
pub(crate) async fn insert_dataset_unless_directory_name_taken(
    connection: &mut sqlx::PgConnection,
    new: NewDataset<'_>,
) -> ApiResult<bool> {
    insert(connection, new, true).await
}

async fn insert(
    connection: &mut sqlx::PgConnection,
    new: NewDataset<'_>,
    skip_on_directory_name_conflict: bool,
) -> ApiResult<bool> {
    let root: Option<String> = sqlx::query_scalar(
        "SELECT _rootFolder FROM webknossos.organizations_ WHERE _id = $1 FOR SHARE",
    )
    .bind(&new.source.id.organization_id)
    .fetch_optional(&mut *connection)
    .await?;
    let root = root.ok_or_else(|| {
        ApiError::bad_request(crate::msg::organization::not_found(
            &new.source.id.organization_id,
        ))
    })?;
    let status: String = new.status.chars().take(1024).collect();
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
        .bind(&root)
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
        .bind(new.metadata)
        .bind(new.creation_type)
        .bind(new.import_url)
        .execute(&mut *connection)
        .await?
        .rows_affected()
        > 0;
    if inserted {
        crate::dataset::source::write_layers(connection, new.id, &new.source.data_layers).await?;
    }
    Ok(inserted)
}

/// DatasetService.createAndSetUpDataset (database part, in the caller's
/// transaction): validate the name, require folder write access, create the
/// dataset in the folder (fallback root) and record the uploader.
pub(crate) struct SetUp<'a> {
    pub name: &'a str,
    pub store_name: &'a str,
    pub source: &'a UsableDataSource,
    pub folder: Option<&'a ObjectId>,
    pub creation_type: &'a str,
    pub import_url: Option<&'a str>,
}

pub(crate) async fn set_up_dataset(
    connection: &mut sqlx::PgConnection,
    user: &AuthUser,
    setup: SetUp<'_>,
) -> ApiResult<ObjectId> {
    validate_dataset_name(setup.name)?;
    let root: ObjectId = sqlx::query_scalar(
        "SELECT _rootFolder FROM webknossos.organizations_ WHERE _id = $1 FOR SHARE",
    )
    .bind(&user.organization_id)
    .fetch_optional(&mut *connection)
    .await?
    .ok_or_else(|| {
        ApiError::bad_request(crate::msg::organization::not_found(&user.organization_id))
    })?;
    let folder = setup.folder.unwrap_or(&root);
    if !folder_writable(connection, user, folder).await? {
        return Err(ApiError::bad_request(crate::msg::folder::NO_WRITE_ACCESS));
    }
    let id = ObjectId::new();
    let mut source = setup.source.clone();
    source.id = DataSourceId::new(
        generate_directory_name(setup.name, id.as_str()),
        &user.organization_id,
    );
    insert_dataset(
        connection,
        NewDataset {
            id: &id,
            store_name: setup.store_name,
            name: setup.name,
            source: &source,
            is_usable: true,
            voxel_size: Some(source.scale),
            status: source.status_opt.as_deref().unwrap_or(""),
            is_virtual: true,
            metadata: json!([]),
            description: None,
            creation_type: setup.creation_type,
            import_url: setup.import_url,
        },
    )
    .await?;
    sqlx::query("UPDATE webknossos.datasets SET _folder = $2, _uploader = $3 WHERE _id = $1")
        .bind(&id)
        .bind(folder)
        .bind(&user.id)
        .execute(&mut *connection)
        .await?;
    Ok(id)
}

/// The datastore side effects of createDataset, run after the commit.
pub(crate) async fn after_create(
    pool: &sqlx::PgPool,
    clients: &ServiceClients,
    id: &ObjectId,
) -> ApiResult<()> {
    let record = crate::dataset::lifecycle::load_record(pool, id)
        .await?
        .ok_or_else(ApiError::internal)?;
    crate::dataset::lifecycle::scan_realpaths_if_virtual(pool, clients, &record).await?;
    crate::dataset::lifecycle::write_mirror_for_virtual(pool, clients, &record).await
}

#[cfg(test)]
mod tests;
