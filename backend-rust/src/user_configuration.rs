pub(crate) mod user_configuration_dao;

use crate::response::Messages;
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
        Some(user) => user_configuration_dao::find_user_configuration(&state.pool, user.id).await?,
        None => json!({}),
    };
    Ok(Json(configuration))
}

async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    RequestJson(configuration): RequestJson<Map<String, Value>>,
) -> ApiResult<Json<Messages>> {
    let rows_affected = user_configuration_dao::update_user_configuration(
        &state.pool,
        user.id,
        Value::Object(configuration),
    )
    .await?;
    if rows_affected != 1 {
        return Err(ApiError::not_found(crate::msg::user::MISSING));
    }
    Ok(Messages::success(
        crate::msg::user::configuration::UPDATE_SUCCESS,
    ))
}

async fn read_shortcuts(
    State(state): State<AppState>,
    OptionalAuthUser(user): OptionalAuthUser,
) -> ApiResult<Json<Value>> {
    let shortcuts = match user {
        Some(user) => user_configuration_dao::find_keyboard_shortcuts_config(&state.pool, user.id)
            .await?
            .unwrap_or_else(|| json!({})),
        None => json!({}),
    };
    Ok(Json(shortcuts))
}

async fn update_shortcuts(
    State(state): State<AppState>,
    user: AuthUser,
    RequestJson(configuration): RequestJson<Map<String, Value>>,
) -> ApiResult<Json<Messages>> {
    let rows_affected = user_configuration_dao::upsert_keyboard_shortcuts_config(
        &state.pool,
        user.id,
        Value::Object(configuration),
    )
    .await?;
    if rows_affected != 1 {
        return Err(ApiError::not_found(crate::msg::user::MISSING));
    }
    Ok(Messages::success(
        crate::msg::user::configuration::UPDATED_KEYBOARD_SHORTCUTS_CONFIG,
    ))
}
