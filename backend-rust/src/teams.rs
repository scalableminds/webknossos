//! Organization teams. These routes mirror TeamController (there is no get/update route).
pub(crate) mod teams_dao;

use crate::response::{Messages, WithMessages};
use axum::{
    Json, Router,
    extract::State,
    routing::{delete, get},
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

use crate::{
    AppState,
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::{Json as RequestJson, Path, Query},
    util::id::ObjectId,
};

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ListQuery {
    #[serde(default)]
    is_editable: bool,
}

#[derive(Deserialize)]
struct TeamParameters {
    name: String,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Team {
    id: ObjectId,
    name: String,
    organization: String,
    is_organization_team: bool,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/teams", get(list).post(create))
        .route("/teams/{id}", delete(remove))
}

async fn list(
    State(state): State<AppState>,
    user: AuthUser,
    Query(query): Query<ListQuery>,
) -> ApiResult<Json<Vec<Team>>> {
    let teams = teams_dao::find_all_for_user(&state.pool, &user, query.is_editable).await?;
    Ok(Json(teams))
}

async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    RequestJson(body): RequestJson<TeamParameters>,
) -> ApiResult<Json<WithMessages<Team>>> {
    if !user.is_admin {
        return Err(ApiError::forbidden(crate::msg::team::CREATE_ONLY_ADMIN));
    }
    // Teams have only the database's character constraint, not the script length constraint.
    if body.name.is_empty() || !body.name.chars().all(valid_name_character) {
        return Err(ApiError::bad_request(crate::msg::team::INVALID_NAME));
    }
    let id = ObjectId::new();
    let inserted = teams_dao::insert_one(&state.pool, &id, &user.organization_id, &body.name).await;
    if let Err(error) = inserted {
        if error
            .as_database_error()
            .is_some_and(|error| error.is_unique_violation())
        {
            return Err(ApiError::bad_request(format!(
                "A team named “{}” already exists. Please choose a different name.",
                body.name
            )));
        }
        return Err(error.into());
    }
    Ok(WithMessages::success(
        Team {
            id,
            name: body.name,
            organization: user.organization_id,
            is_organization_team: false,
        },
        crate::msg::team::CREATE_SUCCESS,
    ))
}

async fn remove(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<Json<Messages>> {
    let id = ObjectId::parse_path(&id)?;
    if !user.is_admin {
        return Err(ApiError::forbidden(crate::msg::team::DELETE_ONLY_ADMIN));
    }
    let mut transaction = state.pool.begin().await?;
    // READ COMMITTED intentionally refreshes the reference-check snapshot after
    // waiting for creators' team SHARE locks. FOR UPDATE fences new references.
    let is_organization_team =
        teams_dao::is_organization_team_for_update(&mut transaction, &id, &user.organization_id)
            .await?;
    let Some(is_organization_team) = is_organization_team else {
        return Err(ApiError::not_found(crate::msg::team::not_found(&id)));
    };
    if is_organization_team {
        return Err(ApiError::forbidden(
            crate::msg::team::DELETE_ORGANIZATION_TEAM,
        ));
    }
    let referenced = teams_dao::is_referenced(&mut transaction, &id).await?;
    if referenced {
        return Err(ApiError::forbidden(crate::msg::team::DELETE_IN_USE));
    }
    teams_dao::mark_deleted(
        &mut transaction,
        &id,
        &format!(".deleted.at.{}", chrono::Utc::now().timestamp_millis()),
    )
    .await?;
    teams_dao::delete_team_references(&mut transaction, &id).await?;
    transaction.commit().await?;
    Ok(Messages::success(crate::msg::team::DELETE_SUCCESS))
}

pub(crate) fn valid_name_character(character: char) -> bool {
    character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | ' ' | 'ß')
}

#[cfg(test)]
mod teams_tests;
