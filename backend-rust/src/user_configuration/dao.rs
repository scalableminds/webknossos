//! UserDAO: the user configuration and keyboard shortcut queries.
use serde_json::Value;
use sqlx::PgPool;

use crate::{error::ApiResult, util::id::ObjectId};

pub(crate) async fn find_user_configuration(pool: &PgPool, user_id: ObjectId) -> ApiResult<Value> {
    Ok(
        sqlx::query_scalar("SELECT userConfiguration FROM webknossos.users_ WHERE _id = $1")
            .bind(user_id)
            .fetch_one(pool)
            .await?,
    )
}

/// Returns the number of updated rows.
pub(crate) async fn update_user_configuration(
    pool: &PgPool,
    user_id: ObjectId,
    configuration: Value,
) -> ApiResult<u64> {
    let result = sqlx::query(
        "UPDATE webknossos.users SET userConfiguration = $2 WHERE _id = $1 AND NOT isDeleted",
    )
    .bind(user_id)
    .bind(configuration)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

pub(crate) async fn find_keyboard_shortcuts_config(
    pool: &PgPool,
    user_id: ObjectId,
) -> ApiResult<Option<Value>> {
    Ok(sqlx::query_scalar(
        "SELECT config.shortcutsConfig FROM webknossos.multiUser_keyboardShortcutsConfigs AS config JOIN webknossos.users_ AS usr ON usr._multiUser = config._multiUser WHERE usr._id = $1"
    ).bind(user_id).fetch_optional(pool).await?)
}

/// Returns the number of upserted rows.
pub(crate) async fn upsert_keyboard_shortcuts_config(
    pool: &PgPool,
    user_id: ObjectId,
    configuration: Value,
) -> ApiResult<u64> {
    let result = sqlx::query(
        "INSERT INTO webknossos.multiUser_keyboardShortcutsConfigs (_multiUser, shortcutsConfig) SELECT _multiUser, $2 FROM webknossos.users_ WHERE _id = $1 ON CONFLICT (_multiUser) DO UPDATE SET shortcutsConfig = EXCLUDED.shortcutsConfig"
    ).bind(user_id).bind(configuration).execute(pool).await?;
    Ok(result.rows_affected())
}
