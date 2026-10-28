//! The thumbnail cache (dataset_thumbnails) and the dataset fields thumbnail rendering reads.
use serde_json::Value;
use sqlx::{PgConnection, PgPool};

use super::{JPEG, ThumbnailRecord};
use crate::util::id::ObjectId;

#[derive(sqlx::FromRow)]
pub(crate) struct DatasetRow {
    pub is_usable: bool,
    pub has_voxel_size: bool,
    pub store_url: Option<String>,
    pub cache_version: i32,
    pub default_configuration: Option<Value>,
    pub admin_configuration: Option<Value>,
}

/// The cached thumbnail image, if it exists.
pub(crate) async fn find_cached_image(
    pool: &PgPool,
    id: &ObjectId,
    layer: &str,
    width: i32,
    height: i32,
    mapping: Option<&str>,
) -> sqlx::Result<Option<Vec<u8>>> {
    // Scala's cleanup job deletes rows older than ten days; filtering here keeps
    // that expiry without depending on the periodic job having run.
    sqlx::query_scalar(
        "SELECT image FROM webknossos.dataset_thumbnails WHERE _dataset=$1 AND dataLayerName=$2 AND width=$3 AND height=$4 AND mappingName=$5 AND created > NOW() - INTERVAL '10 days'",
    )
    .bind(id)
    .bind(layer)
    .bind(width)
    .bind(height)
    .bind(mapping.unwrap_or(""))
    .fetch_optional(pool)
    .await
}

pub(crate) async fn find_dataset_row(
    pool: &PgPool,
    id: &ObjectId,
) -> sqlx::Result<Option<DatasetRow>> {
    sqlx::query_as(
        "SELECT d.isUsable AS is_usable, d.voxelSizeFactor IS NOT NULL AS has_voxel_size, s.url AS store_url, d.thumbnailCacheVersion AS cache_version, d.defaultViewConfiguration AS default_configuration, d.adminViewConfiguration AS admin_configuration FROM webknossos.datasets_ d LEFT JOIN webknossos.dataStores_ s ON s.name = trim(d._dataStore) WHERE d._id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

/// The thumbnail cache version of the live dataset, share-locked.
pub(crate) async fn find_cache_version_for_share(
    connection: &mut PgConnection,
    id: &ObjectId,
) -> sqlx::Result<Option<i32>> {
    sqlx::query_scalar(
        "SELECT thumbnailCacheVersion FROM webknossos.datasets WHERE _id=$1 AND NOT isDeleted FOR SHARE",
    )
    .bind(id)
    .fetch_optional(connection)
    .await
}

/// Stores (or replaces) the thumbnail image of the layer.
pub(crate) async fn upsert_thumbnail(
    connection: &mut PgConnection,
    id: &ObjectId,
    record: ThumbnailRecord<'_>,
    image: &[u8],
) -> sqlx::Result<()> {
    let [x, y, z, width, height, depth] = record.bounding_box.map(f64::from);
    let [mx, my, mz] = record.mag.to_array().map(f64::from);
    sqlx::query(
        r#"INSERT INTO webknossos.dataset_thumbnails
          (_dataset, dataLayerName, width, height, mappingName, image, mimetype, mag, mag1BoundingBox, created)
        VALUES ($1, $2, $3, $4, $5, $6, $7, ROW($8, $9, $10)::webknossos.VECTOR3,
          ROW($11, $12, $13, $14, $15, $16)::webknossos.BOUNDING_BOX, NOW())
        ON CONFLICT (_dataset, dataLayerName, width, height, mappingName) DO UPDATE SET
          image = EXCLUDED.image, mimetype = EXCLUDED.mimetype, mag = EXCLUDED.mag,
          mag1BoundingBox = EXCLUDED.mag1BoundingBox, created = EXCLUDED.created"#,
    )
    .bind(id)
    .bind(record.layer)
    .bind(record.width)
    .bind(record.height)
    .bind(record.mapping.unwrap_or(""))
    .bind(image)
    .bind(JPEG)
    .bind(mx)
    .bind(my)
    .bind(mz)
    .bind(x)
    .bind(y)
    .bind(z)
    .bind(width)
    .bind(height)
    .bind(depth)
    .execute(connection)
    .await?;
    Ok(())
}
