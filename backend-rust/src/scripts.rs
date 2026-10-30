//! Script CRUD with organization-scoped reads and owner-only mutations.
pub(crate) mod scripts_dao;

use axum::{Json, Router, extract::State, http::StatusCode, routing::get};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{FromRow, PgConnection};

use crate::{
    AppState,
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::{Json as RequestJson, Path},
    util::id::ObjectId,
};

#[derive(Deserialize)]
struct ScriptParameters {
    name: String,
    gist: String,
    owner: ObjectId,
}

/// ScriptService.publicWrites (the owner as UserService.compactWrites).
#[derive(FromRow, Serialize)]
pub(crate) struct Script {
    id: ObjectId,
    #[serde(skip)]
    owner_id: ObjectId,
    name: String,
    gist: String,
    owner: Value,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/scripts", get(list).post(create))
        .route("/scripts/{id}", get(fetch).put(update).delete(remove))
}

async fn list(State(state): State<AppState>, user: AuthUser) -> ApiResult<Json<Vec<Script>>> {
    let scripts = scripts_dao::find_all(&state.pool, &user.organization_id).await?;
    Ok(Json(scripts))
}

async fn find(
    connection: &mut PgConnection,
    organization_id: &str,
    id: &ObjectId,
    lock: bool,
) -> ApiResult<Script> {
    scripts_dao::find_one(connection, organization_id, id, lock)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::script::not_found(id)))
}

async fn fetch(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<Json<Script>> {
    let id = ObjectId::parse_path(&id)?;
    let mut connection = state.pool.acquire().await?;
    Ok(Json(
        find(&mut connection, &user.organization_id, &id, false).await?,
    ))
}

async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    RequestJson(body): RequestJson<ScriptParameters>,
) -> ApiResult<Json<Script>> {
    if !user.is_team_manager_or_admin(&state.pool).await? || body.owner != user.id {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    validate(&body)?;
    let id = ObjectId::new();
    let mut transaction = state.pool.begin().await?;
    scripts_dao::insert_one(&mut transaction, &id, &body.owner, &body.name, &body.gist).await?;
    let script = find(&mut transaction, &user.organization_id, &id, false).await?;
    transaction.commit().await?;
    Ok(Json(script))
}

async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    RequestJson(body): RequestJson<ScriptParameters>,
) -> ApiResult<Json<Script>> {
    let id = ObjectId::parse_path(&id)?;
    let mut transaction = state.pool.begin().await?;
    let old = find(&mut transaction, &user.organization_id, &id, true).await?;
    if old.owner_id != user.id {
        return Err(ApiError::forbidden(crate::msg::script::UPDATE_ONLY_OWNER));
    }
    validate(&body)?;
    let target_exists =
        scripts_dao::is_user_in_organization(&mut transaction, &body.owner, &user.organization_id)
            .await?;
    if !target_exists {
        return Err(ApiError::bad_request(crate::msg::user::not_found(
            &body.owner,
        )));
    }
    scripts_dao::update_one(&mut transaction, &id, &body.owner, &body.name, &body.gist).await?;
    let script = find(&mut transaction, &user.organization_id, &id, false).await?;
    transaction.commit().await?;
    Ok(Json(script))
}

async fn remove(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    let id = ObjectId::parse_path(&id)?;
    let mut transaction = state.pool.begin().await?;
    let old = find(&mut transaction, &user.organization_id, &id, true).await?;
    if old.owner_id != user.id {
        return Err(ApiError::forbidden(crate::msg::script::DELETE_ONLY_OWNER));
    }
    scripts_dao::delete_one(&mut transaction, &id).await?;
    scripts_dao::remove_script_from_all_tasks(&mut transaction, &id).await?;
    transaction.commit().await?;
    Ok(StatusCode::OK)
}

fn validate(body: &ScriptParameters) -> ApiResult<()> {
    validate_name(&body.name)?;
    let gist_lower = body.gist.to_ascii_lowercase();
    let host = gist_lower
        .strip_prefix("http://")
        .or_else(|| gist_lower.strip_prefix("https://"));
    if !host
        .and_then(|host| host.chars().next())
        .is_some_and(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return Err(ApiError::bad_request(crate::msg::script::INVALID_GIST_URL));
    }
    Ok(())
}

fn validate_name(name: &str) -> ApiResult<()> {
    let length = name.encode_utf16().count();
    if length < 2 {
        return Err(ApiError::bad_request(crate::msg::script::NAME_TOO_SHORT));
    }
    if length > 50 {
        return Err(ApiError::bad_request(crate::msg::script::NAME_TOO_LONG));
    }
    if !name.chars().all(crate::teams::valid_name_character) {
        return Err(ApiError::bad_request(format!(
            "Script name “{name}” is invalid. Please use only letters, digits, dots, space, underscores, hyphens."
        )));
    }
    Ok(())
}

#[cfg(test)]
mod scripts_tests;
