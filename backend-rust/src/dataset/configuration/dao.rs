//! DatasetDAO and user configuration queries behind the dataset configuration routes.
use serde_json::Value;
use sqlx::{PgConnection, PgPool};

use crate::{error::ApiResult, util::id::ObjectId};

#[derive(sqlx::FromRow)]
pub(crate) struct DatasetConfiguration {
    pub is_usable: bool,
    pub has_voxel_size: bool,
    pub default_configuration: Option<Value>,
    pub admin_configuration: Option<Value>,
}

/// (layer name, view configuration) the user saved for the given layers of the dataset.
pub(crate) async fn find_user_layer_configurations(
    pool: &PgPool,
    user_id: &ObjectId,
    dataset_id: &ObjectId,
    layer_names: &[&str],
) -> ApiResult<Vec<(String, Value)>> {
    Ok(sqlx::query_as(
        "SELECT layerName, viewConfiguration FROM \
                webknossos.user_datasetLayerConfigurations WHERE _user = $1 AND _dataset = $2 \
                AND layerName = ANY($3::text[])",
    )
    .bind(user_id)
    .bind(dataset_id)
    .bind(layer_names)
    .fetch_all(pool)
    .await?)
}

pub(crate) async fn find_configuration(
    pool: &PgPool,
    id: &ObjectId,
) -> ApiResult<Option<DatasetConfiguration>> {
    Ok(sqlx::query_as("SELECT isUsable AS is_usable, voxelSizeFactor IS NOT NULL AS has_voxel_size, defaultViewConfiguration AS default_configuration, adminViewConfiguration AS admin_configuration FROM webknossos.datasets_ WHERE _id = $1")
        .bind(id).fetch_optional(pool).await?)
}

/// The view configuration the user saved for the dataset.
pub(crate) async fn find_user_configuration(
    pool: &PgPool,
    user_id: &ObjectId,
    dataset_id: &ObjectId,
) -> ApiResult<Option<Value>> {
    Ok(sqlx::query_scalar::<_, Value>(
        "SELECT viewConfiguration FROM webknossos.user_datasetConfigurations WHERE \
                _user = $1 AND _dataset = $2",
    )
    .bind(user_id)
    .bind(dataset_id)
    .fetch_optional(pool)
    .await?)
}

/// Share-locks the dataset row, failing if it does not exist.
pub(crate) async fn lock_dataset_for_share(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
) -> ApiResult<()> {
    sqlx::query("SELECT _id FROM webknossos.datasets_ WHERE _id = $1 FOR SHARE")
        .bind(dataset_id)
        .fetch_one(connection)
        .await?;
    Ok(())
}

pub(crate) async fn upsert_user_layer_configuration(
    connection: &mut PgConnection,
    user_id: &ObjectId,
    dataset_id: &ObjectId,
    layer_name: String,
    configuration: Value,
) -> ApiResult<()> {
    sqlx::query(
        "INSERT INTO webknossos.user_datasetLayerConfigurations \
                        (_user,_dataset,layerName,viewConfiguration) VALUES ($1,$2,$3,$4) ON \
                        CONFLICT (_user,_dataset,layerName) DO UPDATE SET viewConfiguration = \
                        EXCLUDED.viewConfiguration",
    )
    .bind(user_id)
    .bind(dataset_id)
    .bind(layer_name)
    .bind(configuration)
    .execute(connection)
    .await?;
    Ok(())
}

pub(crate) async fn upsert_user_configuration(
    connection: &mut PgConnection,
    user_id: &ObjectId,
    dataset_id: &ObjectId,
    configuration: Value,
) -> ApiResult<()> {
    sqlx::query(
        "INSERT INTO webknossos.user_datasetConfigurations \
            (_user,_dataset,viewConfiguration) VALUES ($1,$2,$3) ON CONFLICT (_user,_dataset) \
            DO UPDATE SET viewConfiguration = EXCLUDED.viewConfiguration",
    )
    .bind(user_id)
    .bind(dataset_id)
    .bind(configuration)
    .execute(connection)
    .await?;
    Ok(())
}

/// Sets the dataset's admin view configuration and invalidates its thumbnails.
pub(crate) async fn update_admin_view_configuration(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
    configuration: Value,
) -> ApiResult<()> {
    sqlx::query(
        "UPDATE webknossos.datasets SET adminViewConfiguration = $2, \
            thumbnailCacheVersion = thumbnailCacheVersion + 1 WHERE _id = $1 AND NOT isDeleted",
    )
    .bind(dataset_id)
    .bind(configuration)
    .execute(connection)
    .await?;
    Ok(())
}

pub(crate) async fn update_layer_admin_view_configuration(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
    layer_name: String,
    configuration: Value,
) -> ApiResult<()> {
    sqlx::query("UPDATE webknossos.dataset_layers SET adminViewConfiguration = $3 WHERE _dataset = $1 AND name = $2")
        .bind(dataset_id).bind(layer_name).bind(configuration).execute(connection).await?;
    Ok(())
}

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
