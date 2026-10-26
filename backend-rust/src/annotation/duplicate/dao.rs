//! Dataset lookups for duplicating an annotation.
use sqlx::PgPool;

use crate::{error::ApiResult, util::id::ObjectId};

/// The live dataset (global access): whether it is usable and has a voxel size.
pub(crate) async fn find_dataset_usability(
    pool: &PgPool,
    dataset_id: &ObjectId,
) -> ApiResult<Option<(bool, bool)>> {
    Ok(sqlx::query_as(
        "SELECT isUsable, voxelSizeFactor IS NOT NULL FROM webknossos.datasets_ WHERE _id=$1",
    )
    .bind(dataset_id)
    .fetch_optional(pool)
    .await?)
}

/// The bounding box of each layer of the dataset as `[x, y, z, width, height, depth]`.
pub(crate) async fn find_layer_bounding_boxes(
    pool: &PgPool,
    dataset_id: &ObjectId,
) -> ApiResult<Vec<Vec<i32>>> {
    Ok(sqlx::query_scalar(
        "SELECT ARRAY[(boundingBox).x::int,(boundingBox).y::int,(boundingBox).z::int,
           (boundingBox).width::int,(boundingBox).height::int,(boundingBox).depth::int]
         FROM webknossos.dataset_layers WHERE _dataset=$1 ORDER BY name",
    )
    .bind(dataset_id)
    .fetch_all(pool)
    .await?)
}
