use axum::{Json, Router, extract::State, routing::get};
use serde_json::{Map, Value, json};

use crate::AppState;
use crate::auth::{AuthUser, OptionalAuthUser};
use crate::error::{ApiError, ApiResult};
use crate::extract::Json as RequestJson;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/user/userConfiguration", get(read).put(update))
        .route(
            "/user/keyboardShortcutsConfig",
            get(read_shortcuts).put(update_shortcuts),
        )
}

async fn read(
    State(state): State<AppState>,
    OptionalAuthUser(user): OptionalAuthUser,
) -> ApiResult<Json<Value>> {
    let configuration = match user {
        Some(user) => {
            sqlx::query_scalar("SELECT userConfiguration FROM webknossos.users_ WHERE _id = $1")
                .bind(user.id)
                .fetch_one(&state.pool)
                .await?
        }
        None => json!({}),
    };
    Ok(Json(configuration))
}

async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    RequestJson(configuration): RequestJson<Map<String, Value>>,
) -> ApiResult<Json<Value>> {
    // The Scala UserDAO replaces the entire configuration, without merging keys.
    let result = sqlx::query(
        "UPDATE webknossos.users SET userConfiguration = $2 WHERE _id = $1 AND NOT isDeleted",
    )
    .bind(user.id)
    .bind(Value::Object(configuration))
    .execute(&state.pool)
    .await?;
    if result.rows_affected() != 1 {
        return Err(ApiError::not_found("User not found."));
    }
    Ok(Json(
        json!({"messages": [{"success": "Your configuration was successfully updated."}]}),
    ))
}

async fn read_shortcuts(
    State(state): State<AppState>,
    OptionalAuthUser(user): OptionalAuthUser,
) -> ApiResult<Json<Value>> {
    let shortcuts = match user {
        Some(user) => sqlx::query_scalar(
            "SELECT config.shortcutsConfig FROM webknossos.multiUser_keyboardShortcutsConfigs AS config JOIN webknossos.users_ AS usr ON usr._multiUser = config._multiUser WHERE usr._id = $1"
        ).bind(user.id).fetch_optional(&state.pool).await?.unwrap_or_else(|| json!({})),
        None => json!({}),
    };
    Ok(Json(shortcuts))
}

async fn update_shortcuts(
    State(state): State<AppState>,
    user: AuthUser,
    RequestJson(configuration): RequestJson<Map<String, Value>>,
) -> ApiResult<Json<Value>> {
    let result = sqlx::query(
        "INSERT INTO webknossos.multiUser_keyboardShortcutsConfigs (_multiUser, shortcutsConfig) SELECT _multiUser, $2 FROM webknossos.users_ WHERE _id = $1 ON CONFLICT (_multiUser) DO UPDATE SET shortcutsConfig = EXCLUDED.shortcutsConfig"
    ).bind(user.id).bind(Value::Object(configuration)).execute(&state.pool).await?;
    if result.rows_affected() != 1 {
        return Err(ApiError::not_found("User not found."));
    }
    Ok(Json(
        json!({"messages": [{"success": "Keyboard shortcuts configuration was successfully updated."}]}),
    ))
}
