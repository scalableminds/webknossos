//! The annotation_reserved_ids queries.
use sqlx::PgConnection;

use crate::util::id::ObjectId;

/// The IDs the user reserved for the layer's domain, ascending.
pub(crate) async fn find_all_reserved_ids(
    connection: &mut PgConnection,
    annotation_id: &ObjectId,
    tracing_id: &str,
    user_id: &ObjectId,
    domain: &str,
) -> sqlx::Result<Vec<i64>> {
    sqlx::query_scalar(
        "SELECT id FROM webknossos.annotation_reserved_ids
         WHERE _annotation=$1 AND tracingId=$2 AND _user=$3
           AND domain=$4::webknossos.ANNOTATION_ID_DOMAIN
         ORDER BY id",
    )
    .bind(annotation_id)
    .bind(tracing_id)
    .bind(user_id)
    .bind(domain)
    .fetch_all(connection)
    .await
}

/// The largest ID reserved for the layer's domain by any user.
pub(crate) async fn find_largest_reserved_id(
    connection: &mut PgConnection,
    annotation_id: &ObjectId,
    tracing_id: &str,
    domain: &str,
) -> sqlx::Result<Option<i64>> {
    sqlx::query_scalar(
        "SELECT MAX(id) FROM webknossos.annotation_reserved_ids
         WHERE _annotation=$1 AND tracingId=$2 AND domain=$3::webknossos.ANNOTATION_ID_DOMAIN",
    )
    .bind(annotation_id)
    .bind(tracing_id)
    .bind(domain)
    .fetch_one(connection)
    .await
}

pub(crate) async fn insert_reserved_ids(
    connection: &mut PgConnection,
    annotation_id: &ObjectId,
    tracing_id: &str,
    domain: &str,
    user_id: &ObjectId,
    ids: &[i64],
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO webknossos.annotation_reserved_ids(_annotation,tracingId,domain,_user,id)
             SELECT $1,$2,$3::webknossos.ANNOTATION_ID_DOMAIN,$4,UNNEST($5::bigint[])",
    )
    .bind(annotation_id)
    .bind(tracing_id)
    .bind(domain)
    .bind(user_id)
    .bind(ids)
    .execute(connection)
    .await?;
    Ok(())
}

pub(crate) async fn delete_reserved_ids(
    connection: &mut PgConnection,
    annotation_id: &ObjectId,
    tracing_id: &str,
    domain: &str,
    user_id: &ObjectId,
    ids: &[i64],
) -> sqlx::Result<()> {
    sqlx::query(
        "DELETE FROM webknossos.annotation_reserved_ids
             WHERE _annotation=$1 AND tracingId=$2 AND domain=$3::webknossos.ANNOTATION_ID_DOMAIN
               AND _user=$4 AND id=ANY($5::bigint[])",
    )
    .bind(annotation_id)
    .bind(tracing_id)
    .bind(domain)
    .bind(user_id)
    .bind(ids)
    .execute(connection)
    .await?;
    Ok(())
}
