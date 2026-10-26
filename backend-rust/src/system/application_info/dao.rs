//! Queries behind the application info routes.
use sqlx::PgPool;

use crate::{error::ApiResult, util::id::ObjectId};

/// The schema version of the release information table.
pub(super) async fn find_schema_version(pool: &PgPool) -> Result<Option<i64>, sqlx::Error> {
    sqlx::query_scalar("SELECT schemaVersion FROM webknossos.releaseInformation")
        .fetch_optional(pool)
        .await
}

/// Returns `(organization name, first name, last name, email)` of the user.
pub(super) async fn find_help_email_context(
    pool: &PgPool,
    user_id: &ObjectId,
) -> ApiResult<Option<(String, String, String, String)>> {
    Ok(sqlx::query_as(
        r#"SELECT o.name, m.firstName, m.lastName, m.email FROM webknossos.users_ u
               JOIN webknossos.organizations_ o ON o._id = u._organization
               JOIN webknossos.multiUsers_ m ON m._id = u._multiUser WHERE u._id = $1"#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?)
}
