//! Dataset, data store and layer queries for creating explorational annotations.
use serde_json::Value;
use sqlx::{PgConnection, PgPool};

use crate::{error::ApiResult, util::id::ObjectId};

/// The name, organization, trimmed data store and usability of the live
/// dataset (global access), as `(name, organization, data store, is usable, has voxel size)`.
pub(crate) async fn find_dataset(
    pool: &PgPool,
    id: &ObjectId,
) -> ApiResult<Option<(String, String, String, bool, bool)>> {
    Ok(sqlx::query_as(
        "SELECT name,_organization,trim(_dataStore),isUsable,voxelSizeFactor IS NOT NULL
         FROM webknossos.datasets_ WHERE _id=$1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?)
}

/// dataStoreDAO.findOneByName: the internal URL of the data store.
pub(crate) async fn find_data_store_url(pool: &PgPool, name: &str) -> ApiResult<Option<String>> {
    Ok(
        sqlx::query_scalar("SELECT url FROM webknossos.dataStores_ WHERE name=$1")
            .bind(name)
            .fetch_optional(pool)
            .await?,
    )
}

pub(crate) async fn update_layer_statistics(
    connection: &mut PgConnection,
    annotation_id: &ObjectId,
    tracing_id: &str,
    statistics: Value,
) -> ApiResult<()> {
    sqlx::query(
        "UPDATE webknossos.annotation_layers SET statistics=$3 WHERE _annotation=$1 AND tracingId=$2",
    )
    .bind(annotation_id)
    .bind(tracing_id)
    .bind(statistics)
    .execute(connection)
    .await?;
    Ok(())
}
