//! Queries of the tracing store callbacks (WKRemoteTracingStoreController):
//! service-key validation, the read callbacks, createTracing and updateAnnotation.
use sqlx::{PgConnection, PgPool};

use crate::util::id::ObjectId;

/// TracingStoreService.validateAccess: whether a live tracing store has this key.
pub(crate) async fn key_is_valid(pool: &PgPool, key: &str) -> sqlx::Result<bool> {
    sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM webknossos.tracingStores_ WHERE key=$1)")
        .bind(key)
        .fetch_one(pool)
        .await
}

pub(crate) async fn dataset_exists(pool: &PgPool, id: &ObjectId) -> sqlx::Result<bool> {
    sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM webknossos.datasets_ WHERE _id=$1)")
        .bind(id)
        .fetch_one(pool)
        .await
}

/// The dataset of a live annotation.
pub(crate) async fn find_dataset_id_for_annotation(
    pool: &PgPool,
    annotation_id: &ObjectId,
) -> sqlx::Result<Option<ObjectId>> {
    sqlx::query_scalar("SELECT _dataset FROM webknossos.annotations_ WHERE _id=$1")
        .bind(annotation_id)
        .fetch_optional(pool)
        .await
}

/// The `(tracingId, typ, name)` rows of an annotation's layers.
pub(crate) async fn find_all_layers_for_annotation(
    pool: &PgPool,
    annotation_id: &ObjectId,
) -> sqlx::Result<Vec<(String, String, String)>> {
    sqlx::query_as(
        "SELECT tracingId,typ::text,name FROM webknossos.annotation_layers WHERE _annotation=$1 ORDER BY tracingId",
    )
    .bind(annotation_id)
    .fetch_all(pool)
    .await
}

/// The annotation a tracing id belongs to.
pub(crate) async fn find_annotation_id_for_tracing(
    pool: &PgPool,
    tracing_id: &str,
) -> sqlx::Result<Option<ObjectId>> {
    sqlx::query_scalar("SELECT _annotation FROM webknossos.annotation_layers WHERE tracingId=$1")
        .bind(tracing_id)
        .fetch_optional(pool)
        .await
}

/// Whether the annotation has a layer of an unsupported type or with
/// non-object statistics.
pub(crate) async fn has_unreadable_layer(
    pool: &PgPool,
    annotation_id: &ObjectId,
) -> sqlx::Result<bool> {
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM webknossos.annotation_layers WHERE _annotation=$1 AND (typ::text NOT IN ('Skeleton','Volume') OR jsonb_typeof(statistics)<>'object'))",
    ).bind(annotation_id).fetch_one(pool).await
}

/// Whether the dataset is usable but has no voxel size.
pub(crate) async fn is_usable_without_voxel_size(
    pool: &PgPool,
    dataset_id: &ObjectId,
) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        "SELECT isUsable AND voxelSizeFactor IS NULL FROM webknossos.datasets_ WHERE _id=$1",
    )
    .bind(dataset_id)
    .fetch_one(pool)
    .await
}

/// The (internal) URL of the data store of a dataset.
pub(crate) async fn find_data_store_url_for_dataset(
    pool: &PgPool,
    dataset_id: &ObjectId,
) -> sqlx::Result<Option<String>> {
    sqlx::query_scalar(
        "SELECT store.url FROM webknossos.datasets_ dataset JOIN webknossos.dataStores_ store ON store.name=TRIM(dataset._dataStore) WHERE dataset._id=$1",
    )
    .bind(dataset_id)
    .fetch_optional(pool)
    .await
}

// ---------------------------------------------------------------- updateAnnotation

/// Layers may arrive before their parent annotation: schema185 deliberately
/// has no annotation_layers -> annotations foreign key. Serialize those
/// callbacks too, where no annotation row exists to lock yet.
pub(crate) async fn lock_annotation_layers(
    connection: &mut PgConnection,
    annotation_id: &ObjectId,
) -> sqlx::Result<()> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("annotation-layers:{annotation_id}"))
        .execute(connection)
        .await?;
    Ok(())
}

/// Serialize replacements of the same annotation across server processes.
/// Global Scala update access deliberately does not require a live row:
/// an empty update for a nonexistent annotation is a successful no-op.
pub(crate) async fn lock_annotation(
    connection: &mut PgConnection,
    annotation_id: &ObjectId,
) -> sqlx::Result<()> {
    sqlx::query("SELECT _id FROM webknossos.annotations WHERE _id=$1 FOR UPDATE")
        .bind(annotation_id)
        .fetch_optional(connection)
        .await?;
    Ok(())
}

pub(crate) async fn find_all_tracing_ids_for_annotation(
    connection: &mut PgConnection,
    annotation_id: &ObjectId,
) -> sqlx::Result<Vec<String>> {
    sqlx::query_scalar("SELECT tracingId FROM webknossos.annotation_layers WHERE _annotation=$1")
        .bind(annotation_id)
        .fetch_all(connection)
        .await
}

pub(crate) async fn delete_layers_except(
    connection: &mut PgConnection,
    annotation_id: &ObjectId,
    keep_tracing_ids: &[&str],
) -> sqlx::Result<()> {
    sqlx::query(
        "DELETE FROM webknossos.annotation_layers WHERE _annotation=$1 AND NOT (tracingId=ANY($2::text[]))",
    )
    .bind(annotation_id)
    .bind(keep_tracing_ids)
    .execute(connection)
    .await?;
    Ok(())
}

pub(crate) async fn update_layer_name(
    connection: &mut PgConnection,
    annotation_id: &ObjectId,
    tracing_id: &str,
    name: &str,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE webknossos.annotation_layers SET name=$3 WHERE _annotation=$1 AND tracingId=$2",
    )
    .bind(annotation_id)
    .bind(tracing_id)
    .bind(name)
    .execute(connection)
    .await?;
    Ok(())
}

/// Do not use UPSERT: duplicate new tracing IDs must fail rather than
/// silently becoming repeated updates to the inserted row.
pub(crate) async fn insert_layer(
    connection: &mut PgConnection,
    annotation_id: &ObjectId,
    tracing_id: &str,
    typ: &str,
    name: &str,
) -> sqlx::Result<()> {
    sqlx::query("INSERT INTO webknossos.annotation_layers(_annotation,tracingId,typ,name,statistics) VALUES($1,$2,$3::webknossos.ANNOTATION_LAYER_TYPE,$4,'{}'::jsonb)")
        .bind(annotation_id).bind(tracing_id).bind(typ).bind(name)
        .execute(connection).await?;
    Ok(())
}

pub(crate) async fn update_description(
    connection: &mut PgConnection,
    annotation_id: &ObjectId,
    description: String,
) -> sqlx::Result<()> {
    sqlx::query("UPDATE webknossos.annotations SET description=$2 WHERE _id=$1")
        .bind(annotation_id)
        .bind(description)
        .execute(connection)
        .await?;
    Ok(())
}
