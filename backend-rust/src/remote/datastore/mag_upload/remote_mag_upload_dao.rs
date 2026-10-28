//! DatasetMagDAO and the dataset lookups of the mag/attachment upload callbacks.
use serde_json::Value;
use sqlx::{PgConnection, PgPool};

use super::UploadTarget;
use crate::{sql::Sql, util::id::ObjectId};

/// The `dataset_mags` row of `dataset`'s layer `layer` at `mag`.
pub(crate) fn push_mag_predicate<'a>(
    q: &mut Sql<'a>,
    dataset: &'a ObjectId,
    layer: &'a str,
    mag: [f64; 3],
) {
    let [x, y, z] = mag;
    q.push("_dataset = ")
        .push_bind(dataset)
        .push(" AND dataLayerName = ")
        .push_bind(layer)
        .push(" AND mag = ROW(")
        .push_bind(x)
        .push(", ")
        .push_bind(y)
        .push(", ")
        .push_bind(z)
        .push(")::webknossos.VECTOR3");
}

/// The upload-relevant columns of a dataset (`None` if it does not exist).
pub(crate) async fn find_upload_target(
    pool: &PgPool,
    dataset_id: &ObjectId,
) -> sqlx::Result<Option<UploadTarget>> {
    sqlx::query_as(
        r#"SELECT _id AS id, _organization AS organization, directoryName AS directory_name,
             _dataStore AS data_store, isVirtual AS is_virtual, isUsable AS is_usable,
             voxelSizeFactor IS NOT NULL AS has_voxel_size
           FROM webknossos.datasets_ WHERE _id = $1"#,
    )
    .bind(dataset_id)
    .fetch_optional(pool)
    .await
}

pub(crate) async fn layer_exists(
    pool: &PgPool,
    dataset_id: &ObjectId,
    layer_name: &str,
) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM webknossos.dataset_layers WHERE _dataset = $1 AND name = $2)",
    )
    .bind(dataset_id)
    .bind(layer_name)
    .fetch_one(pool)
    .await
}

/// DatasetMagDAO.findMagLocatorsForLayer excludes pending mags.
pub(crate) async fn find_mags_for_layer(
    pool: &PgPool,
    dataset_id: &ObjectId,
    layer_name: &str,
) -> sqlx::Result<Vec<(i32, i32, i32)>> {
    sqlx::query_as(
        r#"SELECT (mag).x::int, (mag).y::int, (mag).z::int FROM webknossos.dataset_mags
           WHERE _dataset = $1 AND dataLayerName = $2 AND NOT uploadToPathIsPending AND NOT uploadIsPending"#,
    )
    .bind(dataset_id)
    .bind(layer_name)
    .fetch_all(pool)
    .await
}

/// findOneWithPendingUploadToPath reads paths with real-path fallback.
pub(crate) async fn find_pending_mag_paths(
    pool: &PgPool,
    dataset_id: &ObjectId,
    layer_name: &str,
    mag: [f64; 3],
) -> sqlx::Result<Vec<(Option<String>, bool)>> {
    let mut q = Sql::new(
        "SELECT COALESCE(realPath, path), uploadToPathIsPending FROM webknossos.dataset_mags WHERE ",
    );
    push_mag_predicate(&mut q, dataset_id, layer_name, mag);
    q.push(" AND (uploadToPathIsPending OR uploadIsPending)");
    q.build_query_as().fetch_all(pool).await
}

pub(crate) async fn delete_pending_mag(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
    layer_name: &str,
    mag: [f64; 3],
) -> sqlx::Result<()> {
    let mut q = Sql::new("DELETE FROM webknossos.dataset_mags WHERE ");
    push_mag_predicate(&mut q, dataset_id, layer_name, mag);
    q.push(" AND (uploadToPathIsPending OR uploadIsPending)");
    q.build().execute(connection).await?;
    Ok(())
}

pub(crate) async fn pending_mag_exists(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
    layer_name: &str,
    mag: [f64; 3],
) -> sqlx::Result<bool> {
    let mut q = Sql::new("SELECT EXISTS (SELECT 1 FROM webknossos.dataset_mags WHERE ");
    push_mag_predicate(&mut q, dataset_id, layer_name, mag);
    q.push(" AND (uploadToPathIsPending OR uploadIsPending))");
    q.build_query_scalar().fetch_one(connection).await
}

/// DatasetMagDAO.insertWithUploadPending.
pub(crate) async fn insert_with_upload_pending(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
    layer_name: &str,
    [x, y, z]: [f64; 3],
    axis_order: Option<Value>,
    channel_index: Option<i32>,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO webknossos.dataset_mags (_dataset, dataLayerName, mag, path, axisOrder, channelIndex, uploadToPathIsPending, uploadIsPending)
           VALUES ($1, $2, ROW($3, $4, $5)::webknossos.VECTOR3, NULL, $6, $7, false, true)"#,
    )
    .bind(dataset_id)
    .bind(layer_name)
    .bind(x)
    .bind(y)
    .bind(z)
    .bind(axis_order)
    .bind(channel_index)
    .execute(connection)
    .await?;
    Ok(())
}

/// DatasetMagDAO.finishUpload, guarded by findOneWithPendingUpload in the
/// same statement. Returns whether a pending mag was finished.
pub(crate) async fn finish_upload(
    pool: &PgPool,
    dataset_id: &ObjectId,
    layer_name: &str,
    mag: [f64; 3],
    path: &str,
) -> sqlx::Result<bool> {
    let mut q = Sql::new(
        "UPDATE webknossos.dataset_mags SET uploadToPathIsPending = false, uploadIsPending = false, path = ",
    );
    q.push_bind(path).push(" WHERE ");
    push_mag_predicate(&mut q, dataset_id, layer_name, mag);
    q.push(" AND uploadIsPending");
    Ok(q.build().execute(pool).await?.rows_affected() > 0)
}

pub(crate) async fn upload_is_pending(
    pool: &PgPool,
    dataset_id: &ObjectId,
    layer_name: &str,
    mag: [f64; 3],
) -> sqlx::Result<bool> {
    let mut q = Sql::new("SELECT EXISTS (SELECT 1 FROM webknossos.dataset_mags WHERE ");
    push_mag_predicate(&mut q, dataset_id, layer_name, mag);
    q.push(" AND uploadIsPending)");
    q.build_query_scalar().fetch_one(pool).await
}
