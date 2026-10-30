//! Cross-instance locking of background jobs.
use sqlx::PgConnection;

/// `pg_try_advisory_xact_lock(key)` on a connection that is inside a transaction. The lock is
/// released automatically at commit or rollback. Returns false if another session holds it.
pub async fn try_advisory_xact_lock(
    connection: &mut PgConnection,
    key: i64,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT pg_try_advisory_xact_lock($1)")
        .bind(key)
        .fetch_one(connection)
        .await
}
