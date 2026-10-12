use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::{ConnectOptions, PgPool};

use crate::config::DatabaseConfig;
use crate::error::{ApiError, ApiResult};

/// The checked-in Scala schema. This service never creates or migrates production tables.
pub const SCHEMA_VERSION: i64 = 185;

pub async fn connect(config: &DatabaseConfig) -> ApiResult<PgPool> {
    let options = config
        .url
        .parse::<PgConnectOptions>()?
        .disable_statement_logging();
    let pool = PgPoolOptions::new()
        .max_connections(config.max_connections)
        .min_connections(config.min_connections)
        .acquire_timeout(config.acquire_timeout)
        .connect_with(options)
        .await?;
    if let Err(error) = check_schema(&pool).await {
        // Startup.checkPostgresSchema reports a mismatch to Slack (the Rust
        // backend then refuses to start instead of continuing).
        crate::slack::global()
            .notice_schema_mismatch(&format!(
                "The database schema version is not {SCHEMA_VERSION} (webknossos.releaseInformation), which this backend requires."
            ))
            .await;
        return Err(error);
    }
    Ok(pool)
}

pub async fn check_schema(pool: &PgPool) -> ApiResult<()> {
    let versions: Vec<i64> =
        sqlx::query_scalar("SELECT schemaVersion FROM webknossos.releaseInformation")
            .fetch_all(pool)
            .await?;
    if versions.as_slice() != [SCHEMA_VERSION] {
        tracing::error!(expected = SCHEMA_VERSION, actual = ?versions, "Unsupported database schema version");
        return Err(ApiError::internal());
    }
    Ok(())
}

pub async fn ready(pool: &PgPool) -> ApiResult<()> {
    sqlx::query("SELECT 1")
        .execute(pool)
        .await
        .map_err(|_| ApiError::service_unavailable("Database unavailable."))?;
    check_schema(pool)
        .await
        .map_err(|_| ApiError::service_unavailable("Database schema unavailable or incompatible."))
}
