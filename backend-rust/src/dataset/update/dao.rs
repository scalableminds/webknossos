//! DatasetDAO.updatePartial and updateDataSource, as used by the partial update route.
use sqlx::PgConnection;

use super::PartialUpdate;
use crate::{dataset::source::UsableDataSource, util::id::ObjectId};
use serde_json::json;

/// Applies the fields present in the request; absent fields keep their value.
pub(crate) async fn update_partial(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
    body: &PartialUpdate,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"UPDATE webknossos.datasets SET
             description = CASE WHEN $2 THEN $3 ELSE description END,
             name = CASE WHEN $4 THEN $5 ELSE name END,
             sortingKey = COALESCE($6, sortingKey),
             isPublic = COALESCE($7, isPublic),
             tags = COALESCE($8, tags),
             _folder = COALESCE($9, _folder),
             metadata = COALESCE($10, metadata)
           WHERE _id = $1 AND NOT isDeleted"#,
    )
    .bind(dataset_id)
    .bind(body.description.is_some())
    .bind(body.description.clone().flatten())
    .bind(body.name.is_some())
    .bind(body.name.clone().flatten())
    .bind(body.sorting_key)
    .bind(body.is_public)
    .bind(&body.tags)
    .bind(&body.folder_id)
    .bind(body.metadata.as_ref().map(|m| json!(m)))
    .execute(connection)
    .await?;
    Ok(())
}

/// Marks the dataset usable with the source's voxel size and bumps its thumbnail cache version.
pub(crate) async fn update_data_source(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
    source: &UsableDataSource,
) -> sqlx::Result<()> {
    sqlx::query(
            r#"UPDATE webknossos.datasets SET thumbnailCacheVersion = thumbnailCacheVersion + 1,
                 inboxSourceHash = NULL, isUsable = true, status = '',
                 voxelSizeFactor = ROW($2, $3, $4)::webknossos.VECTOR3, voxelSizeUnit = $5::webknossos.LENGTH_UNIT
               WHERE _id = $1"#,
        )
        .bind(dataset_id)
        .bind(source.scale.factor.x)
        .bind(source.scale.factor.y)
        .bind(source.scale.factor.z)
        .bind(source.scale.unit.as_str())
        .execute(connection)
        .await?;
    Ok(())
}
