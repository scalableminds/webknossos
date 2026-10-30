//! Cleanup statements of the housekeeping jobs. Each returns the number of affected rows.
use chrono::{DateTime, Utc};
use sqlx::PgConnection;

pub(super) async fn mark_expired_tokens_deleted(
    connection: &mut PgConnection,
    now: DateTime<Utc>,
) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query(
        "UPDATE webknossos.tokens SET isDeleted = TRUE WHERE NOT isDeleted AND expirationDateTime <= $1",
    )
    .bind(now)
    .execute(connection)
    .await?
    .rows_affected())
}

pub(super) async fn delete_old_tokens(
    connection: &mut PgConnection,
    expired_before: DateTime<Utc>,
) -> Result<u64, sqlx::Error> {
    Ok(
        sqlx::query("DELETE FROM webknossos.tokens WHERE isDeleted AND expirationDateTime <= $1")
            .bind(expired_before)
            .execute(connection)
            .await?
            .rows_affected(),
    )
}

pub(super) async fn mark_expired_invites_deleted(
    connection: &mut PgConnection,
    now: DateTime<Utc>,
) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query(
        "UPDATE webknossos.invites SET isDeleted = TRUE WHERE NOT isDeleted AND expirationDateTime <= $1",
    )
    .bind(now)
    .execute(connection)
    .await?
    .rows_affected())
}

pub(super) async fn delete_initializing_annotations(
    connection: &mut PgConnection,
) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query(
        "DELETE FROM webknossos.annotations \
         WHERE state = 'Initializing'::webknossos.ANNOTATION_STATE \
         AND created < (NOW() - INTERVAL '1 hour')",
    )
    .execute(connection)
    .await?
    .rows_affected())
}

pub(super) async fn delete_expired_thumbnails(
    connection: &mut PgConnection,
    created_before: DateTime<Utc>,
) -> Result<u64, sqlx::Error> {
    Ok(
        sqlx::query("DELETE FROM webknossos.dataset_thumbnails WHERE created < $1")
            .bind(created_before)
            .execute(connection)
            .await?
            .rows_affected(),
    )
}

pub(super) async fn delete_expired_annotation_mutexes(
    connection: &mut PgConnection,
) -> Result<u64, sqlx::Error> {
    Ok(
        sqlx::query("DELETE FROM webknossos.annotation_mutexes WHERE expiry < NOW()")
            .execute(connection)
            .await?
            .rows_affected(),
    )
}
