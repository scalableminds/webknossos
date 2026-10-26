//! Queries behind the used storage measurement: the storage relevant mags and
//! attachments, the `organization_usedStorage_*` tables and the datastores to measure at.
use chrono::{DateTime, Utc};
use sqlx::{PgConnection, PgPool};

use crate::{error::ApiResult, util::id::ObjectId};

#[derive(Clone, sqlx::FromRow)]
pub(super) struct MagRow {
    pub(super) dataset_id: ObjectId,
    pub(super) layer_name: String,
    pub(super) mag_x: i32,
    pub(super) mag_y: i32,
    pub(super) mag_z: i32,
    pub(super) path: Option<String>,
    pub(super) real_path: Option<String>,
    pub(super) directory_name: String,
}

#[derive(Clone, sqlx::FromRow)]
pub(super) struct AttachmentRow {
    pub(super) dataset_id: ObjectId,
    pub(super) layer_name: String,
    pub(super) name: String,
    pub(super) path: String,
    pub(super) typ: String,
    pub(super) directory_name: String,
}

/// One datastore with `reportUsedStorageEnabled` (`DataStoreDAO.findAllWithStorageReporting`).
#[derive(Clone, Debug, sqlx::FromRow)]
pub(super) struct StoreRow {
    pub(super) name: String,
    pub(super) url: String,
}

/// `DatasetMagDAO.findAllStorageRelevantMags` (optionally for one dataset).
pub(super) async fn find_all_storage_relevant_mags(
    pool: &PgPool,
    organization: &str,
    store_name: &str,
    dataset_id: Option<&ObjectId>,
) -> Result<Vec<MagRow>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT mag._dataset AS dataset_id, mag.dataLayerName AS layer_name, (mag.mag).x::int AS mag_x,
             (mag.mag).y::int AS mag_y, (mag.mag).z::int AS mag_z, mag.path, mag.realPath AS real_path,
             ds.directoryName AS directory_name
           FROM webknossos.dataset_mags AS mag JOIN webknossos.datasets AS ds ON mag._dataset = ds._id
           WHERE ds._organization = $1 AND ds._dataStore = $2 AND ($3::text IS NULL OR mag._dataset = $3)
             AND (mag.path IS NOT NULL OR mag.realPath IS NOT NULL)
             AND NOT EXISTS (SELECT 1 FROM webknossos.dataset_mags AS mag2 JOIN webknossos.datasets AS ds2 ON mag2._dataset = ds2._id
               WHERE COALESCE(mag2.realPath, mag2.path) = COALESCE(mag.realPath, mag.path)
                 AND (ds2.created < ds.created OR (ds2.created = ds.created AND ds2._id < ds._id)))"#,
    )
    .bind(organization)
    .bind(store_name)
    .bind(dataset_id)
    .fetch_all(pool)
    .await
}

/// `DatasetLayerAttachmentDAO.findAllStorageRelevantAttachments` (optionally for one dataset).
pub(super) async fn find_all_storage_relevant_attachments(
    pool: &PgPool,
    organization: &str,
    store_name: &str,
    dataset_id: Option<&ObjectId>,
) -> Result<Vec<AttachmentRow>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT att._dataset AS dataset_id, att.layerName AS layer_name, att.name, att.path, att.type::text AS typ,
             ds.directoryName AS directory_name
           FROM webknossos.dataset_layer_attachments AS att JOIN webknossos.datasets AS ds ON att._dataset = ds._id
           WHERE ds._organization = $1 AND ds._dataStore = $2 AND ($3::text IS NULL OR att._dataset = $3)
             AND NOT EXISTS (SELECT 1 FROM webknossos.dataset_layer_attachments AS att2 JOIN webknossos.datasets AS ds2 ON att2._dataset = ds2._id
               WHERE COALESCE(att2.realPath, att2.path) = COALESCE(att.realPath, att.path)
                 AND (ds2.created < ds.created OR (ds2.created = ds.created AND ds2._id < ds._id)))"#,
    )
    .bind(organization)
    .bind(store_name)
    .bind(dataset_id)
    .fetch_all(pool)
    .await
}

/// `OrganizationDAO.upsertUsedStorage` for one mag, inside the caller's transaction.
pub(super) async fn upsert_used_storage_mag(
    connection: &mut PgConnection,
    organization: &str,
    mag: &MagRow,
    path: &str,
    bytes: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO webknossos.organization_usedStorage_mags (_dataset, layerName, mag, path, _organization, usedStorageBytes, lastUpdated)
               VALUES ($1, $2, ROW($3, $4, $5)::webknossos.VECTOR3, $6, $7, $8, NOW())
               ON CONFLICT (_dataset, layerName, mag) DO UPDATE SET path = EXCLUDED.path, _organization = EXCLUDED._organization,
                 usedStorageBytes = EXCLUDED.usedStorageBytes, lastUpdated = EXCLUDED.lastUpdated"#,
    )
    .bind(&mag.dataset_id)
    .bind(&mag.layer_name)
    .bind(f64::from(mag.mag_x))
    .bind(f64::from(mag.mag_y))
    .bind(f64::from(mag.mag_z))
    .bind(path)
    .bind(organization)
    .bind(bytes)
    .execute(connection)
    .await?;
    Ok(())
}

/// `OrganizationDAO.upsertUsedStorage` for one attachment, inside the caller's transaction.
pub(super) async fn upsert_used_storage_attachment(
    connection: &mut PgConnection,
    organization: &str,
    attachment: &AttachmentRow,
    path: &str,
    bytes: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO webknossos.organization_usedStorage_attachments (_dataset, layerName, name, path, type, _organization, usedStorageBytes, lastUpdated)
               VALUES ($1, $2, $3, $4, $5::webknossos.LAYER_ATTACHMENT_TYPE, $6, $7, NOW())
               ON CONFLICT (_dataset, layerName, name, type) DO UPDATE SET path = EXCLUDED.path, _organization = EXCLUDED._organization,
                 usedStorageBytes = EXCLUDED.usedStorageBytes, lastUpdated = EXCLUDED.lastUpdated"#,
    )
    .bind(&attachment.dataset_id)
    .bind(&attachment.layer_name)
    .bind(&attachment.name)
    .bind(path)
    .bind(&attachment.typ)
    .bind(organization)
    .bind(bytes)
    .execute(connection)
    .await?;
    Ok(())
}

/// The organization and datastore name of the dataset.
pub(super) async fn find_organization_and_store_name(
    pool: &PgPool,
    dataset_id: &ObjectId,
) -> ApiResult<Option<(String, String)>> {
    Ok(
        sqlx::query_as("SELECT _organization, _dataStore FROM webknossos.datasets WHERE _id=$1")
            .bind(dataset_id)
            .fetch_optional(pool)
            .await?,
    )
}

/// Returns `(name, url, reportUsedStorageEnabled)` of the datastore.
pub(super) async fn find_store_for_reporting(
    pool: &PgPool,
    store_name: &str,
) -> ApiResult<Option<(String, String, bool)>> {
    Ok(sqlx::query_as(
        "SELECT name, url, reportUsedStorageEnabled FROM webknossos.dataStores_ WHERE name=trim($1)",
    )
    .bind(store_name)
    .fetch_optional(pool)
    .await?)
}

pub(super) async fn delete_used_storage_mags_for_dataset(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
) -> ApiResult<()> {
    sqlx::query("DELETE FROM webknossos.organization_usedStorage_mags WHERE _dataset = $1")
        .bind(dataset_id)
        .execute(connection)
        .await?;
    Ok(())
}

pub(super) async fn delete_used_storage_attachments_for_dataset(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
) -> ApiResult<()> {
    sqlx::query("DELETE FROM webknossos.organization_usedStorage_attachments WHERE _dataset = $1")
        .bind(dataset_id)
        .execute(connection)
        .await?;
    Ok(())
}

pub(super) async fn delete_used_storage_mags_for_organization(
    connection: &mut PgConnection,
    organization: &str,
) -> ApiResult<()> {
    sqlx::query("DELETE FROM webknossos.organization_usedStorage_mags WHERE _organization = $1")
        .bind(organization)
        .execute(connection)
        .await?;
    Ok(())
}

pub(super) async fn delete_used_storage_attachments_for_organization(
    connection: &mut PgConnection,
    organization: &str,
) -> ApiResult<()> {
    sqlx::query(
        "DELETE FROM webknossos.organization_usedStorage_attachments WHERE _organization = $1",
    )
    .bind(organization)
    .execute(connection)
    .await?;
    Ok(())
}

pub(super) async fn update_last_storage_scan_time(
    connection: &mut PgConnection,
    organization: &str,
    time: DateTime<Utc>,
) -> ApiResult<()> {
    sqlx::query("UPDATE webknossos.organizations SET lastStorageScanTime = $1 WHERE _id = $2")
        .bind(time)
        .bind(organization)
        .execute(connection)
        .await?;
    Ok(())
}

/// `OrganizationDAO.findNotRecentlyScanned`: the ids of at most `limit` organizations whose last
/// scan is older than `scanned_before`, oldest first.
pub(super) async fn find_not_recently_scanned(
    pool: &PgPool,
    scanned_before: DateTime<Utc>,
    limit: i64,
) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT _id FROM webknossos.organizations_ WHERE lastStorageScanTime < $1 \
         ORDER BY lastStorageScanTime LIMIT $2",
    )
    .bind(scanned_before)
    .bind(limit)
    .fetch_all(pool)
    .await
}

pub(super) async fn find_all_with_storage_reporting(
    pool: &PgPool,
) -> Result<Vec<StoreRow>, sqlx::Error> {
    sqlx::query_as(
        "SELECT name, url FROM webknossos.dataStores_ WHERE reportUsedStorageEnabled ORDER BY name",
    )
    .fetch_all(pool)
    .await
}
