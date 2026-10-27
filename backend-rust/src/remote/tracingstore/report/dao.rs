//! Queries of the handleTracingUpdateReport callback.
use serde_json::Value;
use sqlx::{PgConnection, PgPool};

use crate::{error::ApiResult, util::id::ObjectId};

/// The `(owner, state)` of a live annotation, locking its row.
pub(crate) async fn find_owner_and_state_for_update(
    connection: &mut PgConnection,
    id: &ObjectId,
) -> ApiResult<Option<(ObjectId, String)>> {
    Ok(sqlx::query_as(
        "SELECT _user, state::text FROM webknossos.annotations WHERE _id=$1 AND NOT isDeleted FOR NO KEY UPDATE",
    )
    .bind(id)
    .fetch_optional(connection)
    .await?)
}

pub(crate) async fn update_modified(connection: &mut PgConnection, id: &ObjectId) -> ApiResult<()> {
    sqlx::query("UPDATE webknossos.annotations SET modified=NOW() WHERE _id=$1")
        .bind(id)
        .execute(connection)
        .await?;
    Ok(())
}

/// AnnotationService.updateStatistics for one layer. The caller inspects the
/// error: it may fail silently per layer.
pub(crate) async fn update_layer_statistics(
    connection: &mut PgConnection,
    id: &ObjectId,
    tracing_id: &str,
    statistics: &Value,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE webknossos.annotation_layers SET statistics=$3 WHERE _annotation=$1 AND tracingId=$2",
    )
    .bind(id)
    .bind(tracing_id)
    .bind(statistics)
    .execute(connection)
    .await
    .map(|_| ())
}

pub(crate) async fn insert_contributor(
    pool: &PgPool,
    annotation_id: &ObjectId,
    user_id: &ObjectId,
) -> ApiResult<()> {
    sqlx::query("INSERT INTO webknossos.annotation_contributors(_annotation,_user) VALUES($1,$2) ON CONFLICT DO NOTHING")
        .bind(annotation_id)
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}
