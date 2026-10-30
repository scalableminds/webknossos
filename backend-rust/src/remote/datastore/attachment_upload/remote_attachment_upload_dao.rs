//! DatasetLayerAttachmentDAO queries of the attachment upload callbacks.
use sqlx::{PgConnection, PgPool};
use webknossos_common::enums::LayerAttachmentType;

use crate::{sql::Sql, util::id::ObjectId};

/// One attachment row (the table's primary key).
/// The `dataset_layer_attachments` row of `dataset`'s layer `layer` with
/// type `typ` and name `name` (the primary key).
pub(crate) fn push_attachment_key<'a>(
    q: &mut Sql<'a>,
    dataset: &'a ObjectId,
    layer: &'a str,
    typ: &'a str,
    name: &'a str,
) {
    q.push("_dataset = ")
        .push_bind(dataset)
        .push(" AND layerName = ")
        .push_bind(layer)
        .push(" AND type = ")
        .push_bind(typ)
        .push("::webknossos.LAYER_ATTACHMENT_TYPE AND name = ")
        .push_bind(name);
}

/// `dataLayer.attachments.getByTypeAndNameAlwaysReturnSingletons(type, name)`
/// on the non-pending attachments (DatasetLayerAttachmentDAO
/// .findAllForDatasetAndDataLayerName); singletons match regardless of name.
pub(crate) async fn existing_attachment_exists<'e>(
    executor: impl sqlx::PgExecutor<'e>,
    dataset: &ObjectId,
    layer: &str,
    typ: LayerAttachmentType,
    name: &str,
) -> sqlx::Result<bool> {
    let name = (!typ.is_singleton()).then_some(name);
    sqlx::query_scalar(
        r#"SELECT EXISTS (SELECT 1 FROM webknossos.dataset_layer_attachments
             WHERE _dataset = $1 AND layerName = $2 AND type = $3::webknossos.LAYER_ATTACHMENT_TYPE
               AND ($4::text IS NULL OR name = $4) AND NOT uploadToPathIsPending AND NOT uploadIsPending)"#,
    )
    .bind(dataset)
    .bind(layer)
    .bind(typ.as_str())
    .bind(name)
    .fetch_one(executor)
    .await
}

pub(crate) async fn delete_pending_attachment(
    connection: &mut PgConnection,
    dataset: &ObjectId,
    layer: &str,
    typ: &str,
    name: &str,
) -> sqlx::Result<()> {
    let mut q = Sql::new("DELETE FROM webknossos.dataset_layer_attachments WHERE ");
    push_attachment_key(&mut q, dataset, layer, typ, name);
    q.push(" AND (uploadIsPending OR uploadToPathIsPending)");
    q.build().execute(connection).await?;
    Ok(())
}

pub(crate) async fn pending_attachment_exists(
    connection: &mut PgConnection,
    dataset: &ObjectId,
    layer: &str,
    typ: &str,
    name: &str,
) -> sqlx::Result<bool> {
    let mut q =
        Sql::new("SELECT EXISTS (SELECT 1 FROM webknossos.dataset_layer_attachments WHERE ");
    push_attachment_key(&mut q, dataset, layer, typ, name);
    q.push(" AND (uploadIsPending OR uploadToPathIsPending))");
    q.build_query_scalar().fetch_one(connection).await
}

/// DatasetLayerAttachmentDAO.insertWithUploadPending (credentialId unset).
pub(crate) async fn insert_with_upload_pending(
    connection: &mut PgConnection,
    dataset: &ObjectId,
    layer: &str,
    name: &str,
    path: &str,
    typ: &str,
    data_format: &str,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO webknossos.dataset_layer_attachments (_dataset, layerName, name, path, type, dataFormat, uploadToPathIsPending, uploadIsPending)
           VALUES ($1, $2, $3, $4, $5::webknossos.LAYER_ATTACHMENT_TYPE, $6::webknossos.LAYER_ATTACHMENT_DATAFORMAT, false, true)"#,
    )
    .bind(dataset)
    .bind(layer)
    .bind(name)
    .bind(path)
    .bind(typ)
    .bind(data_format)
    .execute(connection)
    .await?;
    Ok(())
}

/// findOneWithPendingUpload + finishUpload: the key is the primary key, so
/// the guarded update touches exactly the row Scala finds and updates.
/// Only the path changes (dataFormat/credentialId are kept, as in Scala).
/// Returns whether a pending attachment was finished.
pub(crate) async fn finish_upload(
    pool: &PgPool,
    dataset: &ObjectId,
    layer: &str,
    typ: &str,
    name: &str,
    path: &str,
) -> sqlx::Result<bool> {
    let mut q = Sql::new(
        "UPDATE webknossos.dataset_layer_attachments \
         SET uploadToPathIsPending = false, uploadIsPending = false, path = ",
    );
    q.push_bind(path).push(" WHERE ");
    push_attachment_key(&mut q, dataset, layer, typ, name);
    q.push(" AND uploadIsPending");
    Ok(q.build().execute(pool).await?.rows_affected() > 0)
}
