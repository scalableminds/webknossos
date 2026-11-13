//! DatasetDAO queries behind the health, clear-thumbnail-cache and used-storage routes.
use serde_json::Value;
use sqlx::{PgConnection, PgPool};

use crate::util::id::ObjectId;

/// (isUsable, has a voxel size, datastore url) of the dataset.
pub(crate) async fn find_health_fields(
    pool: &PgPool,
    dataset_id: &ObjectId,
) -> sqlx::Result<(bool, bool, String)> {
    sqlx::query_as(
        "SELECT d.isUsable,d.voxelSizeFactor IS NOT NULL,s.url FROM webknossos.datasets_ \
            d JOIN webknossos.dataStores_ s ON s.name=trim(d._dataStore) WHERE d._id=$1",
    )
    .bind(dataset_id)
    .fetch_one(pool)
    .await
}

/// Row-locks the dataset (`FOR UPDATE`), failing if it does not exist.
pub(crate) async fn lock_dataset(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
) -> sqlx::Result<()> {
    sqlx::query("SELECT _id FROM webknossos.datasets_ WHERE _id=$1 FOR UPDATE")
        .bind(dataset_id)
        .fetch_one(connection)
        .await?;
    Ok(())
}

pub(crate) async fn delete_thumbnails(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM webknossos.dataset_thumbnails WHERE _dataset=$1")
        .bind(dataset_id)
        .execute(connection)
        .await?;
    Ok(())
}

pub(crate) async fn increment_thumbnail_cache_version(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
) -> sqlx::Result<()> {
    sqlx::query("UPDATE webknossos.datasets SET thumbnailCacheVersion=thumbnailCacheVersion+1 WHERE _id=$1 AND NOT isDeleted")
        .bind(dataset_id).execute(connection).await?;
    Ok(())
}

/// Whether the dataset is usable.
pub(crate) async fn is_usable(pool: &PgPool, dataset_id: &ObjectId) -> sqlx::Result<bool> {
    sqlx::query_scalar("SELECT isUsable FROM webknossos.datasets_ WHERE _id=$1")
        .bind(dataset_id)
        .fetch_one(pool)
        .await
}

/// JSON of the dataset's used storage per mag.
pub(crate) async fn find_used_storage_of_mags(
    pool: &PgPool,
    dataset_id: &ObjectId,
) -> sqlx::Result<Vec<Value>> {
    sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object('layerName',layerName,
      'name',concat((mag).x::int,'-',(mag).y::int,'-',(mag).z::int),'usedStorageBytes',usedStorageBytes,
      'lastUpdated',floor(extract(epoch from lastUpdated)*1000)::bigint)
      FROM webknossos.organization_usedStorage_mags WHERE _dataset=$1"#,
    )
    .bind(dataset_id)
    .fetch_all(pool)
    .await
}

/// JSON of the dataset's used storage per attachment.
pub(crate) async fn find_used_storage_of_attachments(
    pool: &PgPool,
    dataset_id: &ObjectId,
) -> sqlx::Result<Vec<Value>> {
    sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object('layerName',layerName,'name',name,
      'attachmentType',type,'usedStorageBytes',usedStorageBytes,'lastUpdated',floor(extract(epoch from lastUpdated)*1000)::bigint)
      FROM webknossos.organization_usedStorage_attachments WHERE _dataset=$1"#,
    )
    .bind(dataset_id)
    .fetch_all(pool)
    .await
}
