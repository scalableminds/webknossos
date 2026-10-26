//! DatasetDAO queries behind the dataset delete, mirror and finish-upload routes.
use sqlx::{PgConnection, PgPool};

use super::DatasetRecord;
use crate::{error::ApiResult, util::id::ObjectId};

pub(crate) async fn find_record(
    executor: impl sqlx::PgExecutor<'_>,
    id: &ObjectId,
) -> ApiResult<Option<DatasetRecord>> {
    Ok(sqlx::query_as(
        r#"SELECT d._id AS id, d._organization AS organization, s.url AS store_url, s.name AS store_name,
             d.isVirtual AS is_virtual, d.isUsable AS is_usable, d.status, d.rootPath AS root_path,
             d.rootRealPath AS root_real_path
           FROM webknossos.datasets_ d LEFT JOIN webknossos.dataStores_ s ON s.name = trim(d._dataStore)
           WHERE d._id = $1"#,
    )
    .bind(id)
    .fetch_optional(executor)
    .await?)
}

pub(crate) async fn update_mirror_path(
    pool: &PgPool,
    dataset_id: &str,
    path: &str,
) -> ApiResult<()> {
    sqlx::query("UPDATE webknossos.datasets SET mirrorPath = $2 WHERE _id = $1")
        .bind(dataset_id)
        .bind(path)
        .execute(pool)
        .await?;
    Ok(())
}

/// The ids of other datasets of the datastore whose real paths lie inside `directory`.
pub(crate) async fn find_ids_referencing_directory(
    pool: &PgPool,
    directory: &str,
    dataset_id: &ObjectId,
    store_name: &str,
) -> ApiResult<Vec<String>> {
    Ok(sqlx::query_scalar(
            r#"SELECT DISTINCT id FROM (
                 SELECT d._id AS id FROM webknossos.dataset_mags m JOIN webknossos.datasets d ON m._dataset = d._id
                 WHERE m.realpath IS NOT NULL AND starts_with(m.realpath, $1) AND d._id != $2 AND d._datastore = $3
                 UNION ALL
                 SELECT d._id FROM webknossos.dataset_layer_attachments a JOIN webknossos.datasets d ON a._dataset = d._id
                 WHERE a.realpath IS NOT NULL AND starts_with(a.realpath, $1) AND d._id != $2 AND d._datastore = $3) referencing
               ORDER BY id"#,
        )
        .bind(directory)
        .bind(dataset_id)
        .bind(store_name)
        .fetch_all(pool)
        .await?)
}

/// Cancels the pending or started `convert_to_wkw` jobs of the dataset.
pub(crate) async fn cancel_conversion_jobs(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
) -> ApiResult<()> {
    sqlx::query("UPDATE webknossos.jobs SET manualState = 'CANCELLED' WHERE command = 'convert_to_wkw' AND commandArgs->>'dataset_id' = $1 AND (state = 'PENDING' OR state = 'STARTED')")
        .bind(dataset_id).execute(connection).await?;
    Ok(())
}

pub(crate) async fn count_annotations(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
) -> ApiResult<i64> {
    Ok(
        sqlx::query_scalar("SELECT COUNT(*) FROM webknossos.annotations WHERE _dataset = $1")
            .bind(dataset_id)
            .fetch_one(connection)
            .await?,
    )
}

/// Deletes the rows that reference the dataset, except annotations and the dataset itself.
pub(crate) async fn delete_dependent_rows(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
) -> ApiResult<()> {
    for statement in [
        "DELETE FROM webknossos.dataset_mags WHERE _dataset = $1",
        "DELETE FROM webknossos.dataset_layer_additionalAxes WHERE _dataset = $1",
        "DELETE FROM webknossos.dataset_layers WHERE _dataset = $1",
        "DELETE FROM webknossos.dataset_allowedTeams WHERE _dataset = $1",
        "DELETE FROM webknossos.dataset_layer_coordinateTransformations WHERE _dataset = $1",
        // refreshStorageReportForDataset finds no remaining mags/attachments
        // afterwards and therefore only clears these rows.
        "DELETE FROM webknossos.organization_usedStorage_mags WHERE _dataset = $1",
        "DELETE FROM webknossos.organization_usedStorage_attachments WHERE _dataset = $1",
    ] {
        sqlx::query(statement)
            .bind(dataset_id)
            .execute(&mut *connection)
            .await?;
    }
    Ok(())
}

/// Marks the dataset unusable with the given status, keeping the row.
pub(crate) async fn mark_unusable(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
    status: &str,
) -> ApiResult<()> {
    sqlx::query("UPDATE webknossos.datasets SET status = $2, isUsable = false WHERE _id = $1")
        .bind(dataset_id)
        .bind(status)
        .execute(connection)
        .await?;
    Ok(())
}

pub(crate) async fn delete_one(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
) -> ApiResult<()> {
    sqlx::query("DELETE FROM webknossos.datasets WHERE _id = $1")
        .bind(dataset_id)
        .execute(connection)
        .await?;
    Ok(())
}

/// (datastore name, ids) of the usable virtual datasets, grouped by datastore.
pub(crate) async fn find_virtual_usable_ids_by_store(
    pool: &PgPool,
) -> ApiResult<Vec<(String, Vec<String>)>> {
    Ok(sqlx::query_as(
        "SELECT _dataStore, array_agg(_id ORDER BY _id) FROM webknossos.datasets_ WHERE isVirtual AND isUsable GROUP BY _dataStore ORDER BY _dataStore",
    )
    .fetch_all(pool)
    .await?)
}

/// The URL of the datastore with this (possibly padded) name.
pub(crate) async fn find_store_url(pool: &PgPool, store_name: &str) -> ApiResult<Option<String>> {
    Ok(
        sqlx::query_scalar("SELECT url FROM webknossos.dataStores_ WHERE name = trim($1)")
            .bind(store_name)
            .fetch_optional(pool)
            .await?,
    )
}

/// (status, isUsable) of the live dataset, row-locked.
pub(crate) async fn find_status_for_update(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
) -> ApiResult<Option<(String, bool)>> {
    Ok(sqlx::query_as(
        "SELECT status, isUsable FROM webknossos.datasets WHERE _id = $1 AND NOT isDeleted FOR UPDATE",
    )
    .bind(dataset_id)
    .fetch_optional(connection)
    .await?)
}

pub(crate) async fn mark_usable(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
) -> ApiResult<()> {
    sqlx::query("UPDATE webknossos.datasets SET isUsable = true, status = '' WHERE _id = $1")
        .bind(dataset_id)
        .execute(connection)
        .await?;
    Ok(())
}

/// Marks the pending mag upload as finished; returns the number of rows changed.
pub(crate) async fn finish_mag_upload(
    pool: &PgPool,
    dataset_id: &ObjectId,
    layer_name: &str,
    [x, y, z]: [f64; 3],
) -> ApiResult<u64> {
    Ok(sqlx::query(
        r#"UPDATE webknossos.dataset_mags SET uploadToPathIsPending = false, uploadIsPending = false
           WHERE _dataset = $1 AND dataLayerName = $2 AND mag = ROW($3, $4, $5)::webknossos.VECTOR3 AND uploadToPathIsPending"#,
    )
    .bind(dataset_id)
    .bind(layer_name)
    .bind(x)
    .bind(y)
    .bind(z)
    .execute(pool)
    .await?
    .rows_affected())
}

/// Marks the pending attachment upload as finished; returns the number of rows changed.
pub(crate) async fn finish_attachment_upload(
    pool: &PgPool,
    dataset_id: &ObjectId,
    layer_name: &str,
    attachment_type: &str,
    attachment_name: &str,
) -> ApiResult<u64> {
    Ok(sqlx::query(
        r#"UPDATE webknossos.dataset_layer_attachments SET uploadToPathIsPending = false, uploadIsPending = false
           WHERE _dataset = $1 AND layerName = $2 AND type = $3::webknossos.LAYER_ATTACHMENT_TYPE AND name = $4 AND uploadToPathIsPending"#,
    )
    .bind(dataset_id)
    .bind(layer_name)
    .bind(attachment_type)
    .bind(attachment_name)
    .execute(pool)
    .await?
    .rows_affected())
}
