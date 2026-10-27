//! Queries of the datastore callbacks (WKRemoteDataStoreController): the
//! datastore lookup, the dataset inbox sync, the lookups and the dataset
//! upload report. Callbacks with a lot of SQL of their own (mag, attachment,
//! dataset upload, credentials) have a `dao.rs` next to their handlers.
use serde_json::Value;
use sqlx::{PgConnection, PgPool};

use super::UNREPORTED;
use crate::{
    dataset::source::DataSource,
    error::ApiResult,
    job::routes::{JOB_COLUMNS, Job},
    sql::Sql,
    util::id::ObjectId,
};

/// DataSourceStatus.inactiveStatusList.
const INACTIVE_STATUSES: [&str; 5] = [
    UNREPORTED,
    "Not yet fully uploaded.",
    "Not yet marked as fully uploaded to paths.",
    "Deleted by user.",
    crate::dataset::lifecycle::CONVERSION_FAILED,
];

/// A live datastore row as needed by the callbacks. The key is never selected.
#[derive(Clone, Debug, sqlx::FromRow)]
pub(crate) struct DataStoreRecord {
    pub name: String,
    pub only_allowed_organization: Option<String>,
}

#[derive(sqlx::FromRow)]
pub(crate) struct FoundDataset {
    pub id: ObjectId,
    pub directory_name: String,
    pub data_store: String,
    pub is_virtual: bool,
    pub inbox_source_hash: Option<i32>,
    pub root_path: Option<String>,
    pub root_real_path: Option<String>,
    pub status: String,
}

/// The dataset columns the upload report reads (DatasetDAO.findOne, global access).
#[derive(sqlx::FromRow)]
pub(crate) struct ReportedDataset {
    pub id: ObjectId,
    pub name: String,
    pub directory_name: String,
    pub organization: String,
    /// Raw `_dataStore` column, written back and used for job submission as is.
    pub data_store: String,
}

const FOUND_DATASET_COLUMNS: &str = "_id AS id, directoryName AS directory_name, \
    _dataStore AS data_store, isVirtual AS is_virtual, inboxSourceHash AS inbox_source_hash, \
    rootPath AS root_path, rootRealPath AS root_real_path, status";

/// Look up a live datastore by name and key (never logs the key).
pub(crate) async fn find_one_by_name_and_key(
    executor: impl sqlx::PgExecutor<'_>,
    name: &str,
    key: &str,
) -> ApiResult<Option<DataStoreRecord>> {
    Ok(sqlx::query_as(
        r#"SELECT name, onlyAllowedOrganization AS only_allowed_organization
           FROM webknossos.dataStores_ WHERE name = $1 AND key = $2"#,
    )
    .bind(name)
    .bind(key)
    .fetch_optional(executor)
    .await?)
}

pub(crate) async fn update_url(pool: &PgPool, name: &str, url: &str) -> ApiResult<()> {
    sqlx::query("UPDATE webknossos.dataStores SET url = $2 WHERE name = $1 AND NOT isDeleted")
        .bind(name)
        .bind(url)
        .execute(pool)
        .await?;
    Ok(())
}

pub(crate) async fn find_all_by_directory_names(
    connection: &mut PgConnection,
    names: &[&str],
    organization: &str,
) -> ApiResult<Vec<FoundDataset>> {
    let mut q = Sql::new("SELECT ");
    q.push(FOUND_DATASET_COLUMNS)
        .push(" FROM webknossos.datasets_ WHERE directoryName = ANY(")
        .push_bind(names)
        .push(") AND _organization = ")
        .push_bind(organization)
        .push(" ORDER BY created, _id");
    Ok(q.build_query_as().fetch_all(connection).await?)
}

/// DatasetDAO.findOneByDataSourceId.
pub(crate) async fn find_one_by_directory_name(
    connection: &mut PgConnection,
    directory_name: &str,
    organization: &str,
) -> ApiResult<Option<FoundDataset>> {
    let mut q = Sql::new("SELECT ");
    q.push(FOUND_DATASET_COLUMNS)
        .push(" FROM webknossos.datasets_ WHERE directoryName = ")
        .push_bind(directory_name)
        .push(" AND _organization = ")
        .push_bind(organization);
    Ok(q.build_query_as().fetch_optional(connection).await?)
}

/// thumbnailCachingService.removeFromCache, first half.
pub(crate) async fn delete_thumbnails(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
) -> ApiResult<()> {
    sqlx::query("DELETE FROM webknossos.dataset_thumbnails WHERE _dataset = $1")
        .bind(dataset_id)
        .execute(connection)
        .await?;
    Ok(())
}

/// thumbnailCachingService.removeFromCache, second half.
pub(crate) async fn increment_thumbnail_cache_version(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
) -> ApiResult<()> {
    sqlx::query(
        "UPDATE webknossos.datasets SET thumbnailCacheVersion = thumbnailCacheVersion + 1 WHERE _id = $1",
    )
    .bind(dataset_id)
    .execute(connection)
    .await?;
    Ok(())
}

pub(crate) async fn find_organization_id(
    connection: &mut PgConnection,
    organization: &str,
) -> ApiResult<Option<String>> {
    Ok(
        sqlx::query_scalar("SELECT _id FROM webknossos.organizations_ WHERE _id = $1")
            .bind(organization)
            .fetch_optional(connection)
            .await?,
    )
}

/// DatasetDAO.updateDataSource (the dataset row): None root paths keep the stored values.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn update_data_source(
    connection: &mut PgConnection,
    id: &ObjectId,
    store_name: &str,
    organization: &str,
    hash: i32,
    source: &DataSource,
    root_path: Option<&str>,
    root_real_path: Option<&str>,
) -> ApiResult<()> {
    let voxel_size = source.voxel_size_opt();
    let status: String = source
        .status_opt()
        .unwrap_or_default()
        .chars()
        .take(1024)
        .collect();
    sqlx::query(
        r#"UPDATE webknossos.datasets SET _dataStore = $2, _organization = $3, inboxSourceHash = $4,
             defaultViewConfiguration = $5, isUsable = $6,
             voxelSizeFactor = CASE WHEN $7::float8 IS NULL THEN NULL ELSE ROW($7, $8, $9)::webknossos.VECTOR3 END,
             voxelSizeUnit = $10::webknossos.LENGTH_UNIT, status = $11,
             rootPath = COALESCE($12, rootPath), rootRealPath = COALESCE($13, rootRealPath)
           WHERE _id = $1"#,
    )
    .bind(id)
    .bind(store_name)
    .bind(organization)
    .bind(hash)
    .bind(source.default_view_configuration().cloned().map(Value::Object))
    .bind(source.is_usable())
    .bind(voxel_size.map(|v| v.factor.x))
    .bind(voxel_size.map(|v| v.factor.y))
    .bind(voxel_size.map(|v| v.factor.z))
    .bind(voxel_size.map(|v| v.unit.as_str()))
    .bind(status)
    .bind(root_path)
    .bind(root_real_path)
    .execute(connection)
    .await?;
    Ok(())
}

/// The inbox fields of a freshly inserted disk-scan dataset.
pub(crate) async fn update_inbox_source(
    connection: &mut PgConnection,
    id: &ObjectId,
    hash: Option<i32>,
    root_path: Option<&str>,
    root_real_path: Option<&str>,
) -> ApiResult<()> {
    sqlx::query(
        "UPDATE webknossos.datasets SET inboxSourceHash = $2, rootPath = $3, rootRealPath = $4 WHERE _id = $1",
    )
    .bind(id)
    .bind(hash)
    .bind(root_path)
    .bind(root_real_path)
    .execute(connection)
    .await?;
    Ok(())
}

/// DatasetDAO.deactivateUnreported.
pub(crate) async fn deactivate_unreported(
    connection: &mut PgConnection,
    existing_ids: &[ObjectId],
    store_name: &str,
    organization: Option<&str>,
) -> ApiResult<()> {
    for table in ["dataset_mags", "dataset_layers"] {
        let mut q = Sql::new("DELETE FROM webknossos.");
        q.push(table)
            .push(" WHERE _dataset IN (SELECT _id FROM webknossos.datasets WHERE _dataStore = ")
            .push_bind(store_name)
            .push(" AND NOT (_id = ANY(")
            .push_bind(existing_ids)
            .push(")) AND NOT isVirtual");
        if let Some(organization) = organization {
            q.push(" AND _organization = ").push_bind(organization);
        }
        q.push(")");
        q.build().execute(&mut *connection).await?;
    }
    sqlx::query(
        r#"UPDATE webknossos.datasets
           SET isUsable = false, status = $4, voxelSizeFactor = NULL, voxelSizeUnit = NULL, inboxSourceHash = NULL
           WHERE _dataStore = $1 AND NOT (_id = ANY($2)) AND NOT isVirtual AND ($3::text IS NULL OR _organization = $3)
             AND NOT (status = ANY($5))"#,
    )
    .bind(store_name)
    .bind(existing_ids)
    .bind(organization)
    .bind(UNREPORTED)
    .bind(&INACTIVE_STATUSES[..])
    .execute(&mut *connection)
    .await?;
    Ok(())
}

pub(crate) async fn find_dataset_id_by_directory_name(
    connection: &mut PgConnection,
    directory_name: &str,
    organization: &str,
) -> ApiResult<Option<ObjectId>> {
    Ok(sqlx::query_scalar(
        "SELECT _id FROM webknossos.datasets_ WHERE directoryName = $1 AND _organization = $2 LIMIT 1",
    )
    .bind(directory_name)
    .bind(organization)
    .fetch_optional(connection)
    .await?)
}

/// Rows already carrying the reported values are left untouched. `table` is
/// `dataset_mags` or `dataset_layer_attachments`.
pub(crate) async fn update_real_path(
    connection: &mut PgConnection,
    table: &str,
    dataset: &ObjectId,
    path: &str,
    real_path: &str,
    has_local_data: bool,
) -> ApiResult<()> {
    let mut q = Sql::new("UPDATE webknossos.");
    q.push(table)
        .push(" SET realPath = ")
        .push_bind(real_path)
        .push(", hasLocalData = ")
        .push_bind(has_local_data)
        .push(" WHERE _dataset = ")
        .push_bind(dataset)
        .push(" AND path = ")
        .push_bind(path)
        .push(" AND (realPath IS DISTINCT FROM ")
        .push_bind(real_path)
        .push(" OR hasLocalData <> ")
        .push_bind(has_local_data)
        .push(")");
    q.build().execute(connection).await?;
    Ok(())
}

/// `(isUsable, voxelSizeFactor IS NOT NULL)` of a dataset.
pub(crate) async fn find_usable_flags(
    pool: &PgPool,
    id: &ObjectId,
) -> ApiResult<Option<(bool, bool)>> {
    Ok(sqlx::query_as(
        "SELECT isUsable, voxelSizeFactor IS NOT NULL FROM webknossos.datasets_ WHERE _id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?)
}

/// `isVirtual` of a dataset, locking its row.
pub(crate) async fn find_is_virtual_for_update(
    connection: &mut PgConnection,
    id: &ObjectId,
) -> ApiResult<Option<bool>> {
    Ok(sqlx::query_scalar(
        "SELECT isVirtual FROM webknossos.datasets_ WHERE _id = $1 FOR NO KEY UPDATE",
    )
    .bind(id)
    .fetch_optional(connection)
    .await?)
}

/// Whether the dataset exists (DatasetDAO.findOne under GlobalAccessContext).
pub(crate) async fn dataset_exists(pool: &PgPool, id: &ObjectId) -> ApiResult<bool> {
    Ok(
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM webknossos.datasets_ WHERE _id = $1)")
            .bind(id)
            .fetch_one(pool)
            .await?,
    )
}

/// Row lock on the dataset, serializing concurrent upload reservations.
pub(crate) async fn lock_dataset(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
) -> ApiResult<()> {
    sqlx::query("SELECT 1 FROM webknossos.datasets WHERE _id = $1 FOR UPDATE")
        .bind(dataset_id)
        .execute(connection)
        .await?;
    Ok(())
}

// ---------------------------------------------------------------- lookups

/// The oldest dataset with this directory name in the organization.
pub(crate) async fn find_oldest_dataset_id(
    pool: &PgPool,
    directory_name: &str,
    organization: &str,
) -> ApiResult<Option<ObjectId>> {
    Ok(sqlx::query_scalar(
        "SELECT _id FROM webknossos.datasets_ WHERE directoryName=$1 AND \
                _organization=$2 ORDER BY created ASC, _id ASC LIMIT 1",
    )
    .bind(directory_name)
    .bind(organization)
    .fetch_optional(pool)
    .await?)
}

pub(crate) async fn find_job(pool: &PgPool, id: &ObjectId) -> ApiResult<Option<Job>> {
    let mut q = Sql::new("SELECT ");
    q.push(JOB_COLUMNS)
        .push(" FROM webknossos.jobs_ j WHERE j._id=")
        .push_bind(id);
    Ok(q.build_query_as().fetch_optional(pool).await?)
}

/// The organization of a user.
pub(crate) async fn find_organization_id_for_user(
    pool: &PgPool,
    user_id: &ObjectId,
) -> ApiResult<Option<String>> {
    Ok(sqlx::query_scalar(
        "SELECT o._id FROM webknossos.users_ u JOIN webknossos.organizations_ o ON \
                o._id=u._organization WHERE u._id=$1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?)
}

// ---------------------------------------------------------------- dataset upload report

pub(crate) async fn find_reported_dataset(
    pool: &PgPool,
    id: &ObjectId,
) -> ApiResult<Option<ReportedDataset>> {
    Ok(sqlx::query_as(
        r#"SELECT _id AS id, name, directoryName AS directory_name,
             _organization AS organization, _dataStore AS data_store
           FROM webknossos.datasets_ WHERE _id = $1"#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await?)
}

/// DataStoreDAO.findOneByName, reduced to the public URL.
pub(crate) async fn find_public_url(pool: &PgPool, name: &str) -> sqlx::Result<Option<String>> {
    sqlx::query_scalar("SELECT publicUrl FROM webknossos.dataStores_ WHERE name = $1")
        .bind(name)
        .fetch_optional(pool)
        .await
}

/// OrganizationDAO.findOne, reduced to id and name.
pub(crate) async fn find_organization_id_and_name(
    pool: &PgPool,
    id: &str,
) -> sqlx::Result<Option<(String, String)>> {
    sqlx::query_as("SELECT _id, name FROM webknossos.organizations_ WHERE _id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}
