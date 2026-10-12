//! Organization teams. These routes mirror TeamController (there is no get/update route).
use axum::{
    Json, Router,
    extract::State,
    routing::{delete, get},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::FromRow;

use crate::{
    AppState,
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::{Json as RequestJson, Path, Query},
    id::ObjectId,
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
struct Team {
    id: String,
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
    let teams = sqlx::query_as::<_, Team>(
        "SELECT t._id AS id, t.name, t._organization AS organization,
                t.isOrganizationTeam AS is_organization_team
         FROM webknossos.teams_ t
         WHERE t._organization = $1 AND ($2 OR EXISTS (
           SELECT 1 FROM webknossos.user_team_roles r
           WHERE r._team = t._id AND r._user = $3
             AND (NOT $4 OR r.isTeamManager)
         )) ORDER BY t._id",
    )
    .bind(&user.organization_id)
    .bind(user.is_admin)
    .bind(&user.id)
    .bind(query.is_editable)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(teams))
}

async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    RequestJson(body): RequestJson<TeamParameters>,
) -> ApiResult<Json<Value>> {
    if !user.is_admin {
        return Err(ApiError::forbidden(
            "You do not have permission to create teams. Please ask an organization admin.",
        ));
    }
    // Teams have only the database's character constraint, not the script length constraint.
    if body.name.is_empty() || !body.name.chars().all(valid_name_character) {
        return Err(ApiError::bad_request("Invalid team name."));
    }
    let id = ObjectId::new().to_string();
    let inserted =
        sqlx::query("INSERT INTO webknossos.teams (_id, _organization, name) VALUES ($1, $2, $3)")
            .bind(&id)
            .bind(&user.organization_id)
            .bind(&body.name)
            .execute(&state.pool)
            .await;
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
    Ok(Json(json!({
        "id": id, "name": body.name, "organization": user.organization_id,
        "isOrganizationTeam": false,
        "messages": [{"success": "Team was successfully created."}]
    })))
}

async fn remove(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    let id = ObjectId::parse_path(&id)?.to_string();
    if !user.is_admin {
        return Err(ApiError::forbidden(
            "You do not have permission to delete teams. Please ask an organization admin.",
        ));
    }
    let mut transaction = state.pool.begin().await?;
    // READ COMMITTED intentionally refreshes the reference-check snapshot after
    // waiting for creators' team SHARE locks. FOR UPDATE fences new references.
    let is_organization_team: Option<bool> = sqlx::query_scalar(
        "SELECT isOrganizationTeam FROM webknossos.teams
         WHERE _id = $1 AND _organization = $2 AND NOT isDeleted FOR UPDATE",
    )
    .bind(&id)
    .bind(&user.organization_id)
    .fetch_optional(&mut *transaction)
    .await?;
    let Some(is_organization_team) = is_organization_team else {
        return Err(ApiError::not_found(format!(
            "Team “{id}” could not be found or accessed."
        )));
    };
    if is_organization_team {
        return Err(ApiError::forbidden(
            "This team cannot be deleted. Each organization requires at least one base team.",
        ));
    }
    let referenced: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM webknossos.projects_ WHERE _team = $1)
             OR EXISTS (SELECT 1 FROM webknossos.taskTypes_ WHERE _team = $1)",
    )
    .bind(&id)
    .fetch_one(&mut *transaction)
    .await?;
    if referenced {
        return Err(ApiError::forbidden(
            "Team cannot be deleted as it is referenced by at least one annotation, project or task type.",
        ));
    }
    sqlx::query("UPDATE webknossos.teams SET isDeleted = TRUE, name = name || $2 WHERE _id = $1")
        .bind(&id)
        .bind(format!(
            ".deleted.at.{}",
            chrono::Utc::now().timestamp_millis()
        ))
        .execute(&mut *transaction)
        .await?;
    for table in [
        "user_team_roles",
        "invite_team_roles",
        "annotation_sharedTeams",
        "dataset_allowedTeams",
        "folder_allowedTeams",
    ] {
        sqlx::query(&format!("DELETE FROM webknossos.{table} WHERE _team = $1"))
            .bind(&id)
            .execute(&mut *transaction)
            .await?;
    }
    transaction.commit().await?;
    Ok(Json(
        json!({"messages": [{"success": "Team was successfully deleted."}]}),
    ))
}

pub(crate) fn valid_name_character(character: char) -> bool {
    character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | ' ' | 'ß')
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn team_names_follow_database_character_contract() {
        assert!("A team-1_ß. ".chars().all(valid_name_character));
        for invalid in ['é', '/', '\n', '\t', '💡'] {
            assert!(!valid_name_character(invalid));
        }
    }
}
