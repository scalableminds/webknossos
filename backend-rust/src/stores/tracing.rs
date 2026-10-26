//! Main-application tracing-store registry; tracing storage runs separately.
use axum::{
    Json as ResponseJson, Router,
    extract::State,
    routing::{get, put},
};
use serde::Deserialize;
use serde_json::Value;

use crate::{
    AppState,
    auth::{AuthUser, OptionalAuthUser},
    error::{ApiError, ApiResult},
    extract::{Json, Path},
};

use super::dao;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/tracingstore", get(first))
        .route("/tracingstores/{name}", put(update))
}

async fn first(
    State(state): State<AppState>,
    _user: OptionalAuthUser,
) -> ApiResult<ResponseJson<Value>> {
    let value = dao::find_first_public_json(&state.pool)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::tracing_store::MISSING))?;
    Ok(ResponseJson(value))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoreUpdate {
    name: String,
    url: String,
    public_url: String,
}

async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    Path(name): Path<String>,
    Json(body): Json<StoreUpdate>,
) -> ApiResult<ResponseJson<Value>> {
    // Play's bare `Fox.fromBool` checks fail as empty Foxes: the generic 404.
    if !user.is_admin {
        return Err(ApiError::not_found(crate::msg::NOT_FOUND));
    }
    let exists = dao::tracing_store_exists(&state.pool, &name).await?;
    if !exists {
        return Err(ApiError::not_found(crate::msg::tracing_store::NOT_FOUND));
    }
    if body.name != name {
        return Err(ApiError::not_found(crate::msg::NOT_FOUND));
    }
    // The existing API permits an organization admin to update this shared
    // registry. Preserve the private URL/key and soft-delete boundaries.
    let value = dao::update_tracing_store(&state.pool, name, body.url, body.public_url)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::tracing_store::NOT_FOUND))?;
    Ok(ResponseJson(value))
}
