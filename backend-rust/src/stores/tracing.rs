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

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/tracingstore", get(first))
        .route("/tracingstores/{name}", put(update))
}

async fn first(
    State(state): State<AppState>,
    _user: OptionalAuthUser,
) -> ApiResult<ResponseJson<Value>> {
    let value = sqlx::query_scalar("SELECT jsonb_build_object('name', name, 'url', publicUrl) FROM webknossos.tracingStores_ LIMIT 1")
        .fetch_optional(&state.pool).await?.ok_or_else(|| ApiError::not_found("Tracing store not found."))?;
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
    if !user.is_admin {
        return Err(ApiError::forbidden("Not allowed."));
    }
    if body.name != name {
        return Err(ApiError::bad_request(
            "Tracing store name cannot be changed.",
        ));
    }
    // The existing API permits an organization admin to update this shared
    // registry. Preserve the private URL/key and soft-delete boundaries.
    let value = sqlx::query_scalar("UPDATE webknossos.tracingStores SET url=$2, publicUrl=$3 WHERE name=$1 AND NOT isDeleted RETURNING jsonb_build_object('name',name,'url',publicUrl)")
        .bind(name).bind(body.url).bind(body.public_url).fetch_optional(&state.pool).await?
        .ok_or_else(|| ApiError::not_found("Tracing store not found."))?;
    Ok(ResponseJson(value))
}
