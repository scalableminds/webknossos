//! Script CRUD with organization-scoped reads and owner-only mutations.
use axum::{Json, Router, extract::State, http::StatusCode, routing::get};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{FromRow, PgConnection};

use crate::{
    AppState,
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::{Json as RequestJson, Path},
    id::ObjectId,
};

#[derive(Deserialize)]
struct ScriptParameters {
    name: String,
    gist: String,
    #[serde(deserialize_with = "crate::id::deserialize_string")]
    owner: String,
}

#[derive(FromRow)]
struct Script {
    id: String,
    owner_id: String,
    name: String,
    gist: String,
    owner: Value,
}

impl Script {
    fn public_json(self) -> Value {
        json!({"id": self.id, "name": self.name, "gist": self.gist, "owner": self.owner})
    }
}

// Compact owner JSON is the UserService.compactWrites contract, including memberships.
pub(crate) const SELECT_SCRIPT: &str = "SELECT s._id AS id, s._owner AS owner_id, s.name, s.gist,
    jsonb_build_object('id', u._id, 'email', m.email, 'firstName', m.firstName,
      'lastName', m.lastName, 'isAdmin', u.isAdmin, 'isDatasetManager', u.isDatasetManager,
      'isActive', NOT u.isDeactivated, 'isAnonymous', false,
      'teams', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t._id, 'name', t.name,
        'isTeamManager', r.isTeamManager) ORDER BY t._id)
        FROM webknossos.user_team_roles r JOIN webknossos.teams_ t ON t._id = r._team
        WHERE r._user = u._id), '[]'::jsonb)) AS owner
    FROM webknossos.scripts s
    JOIN webknossos.users_ u ON u._id = s._owner
    JOIN webknossos.multiUsers_ m ON m._id = u._multiUser
    WHERE NOT s.isDeleted AND u._organization = $1";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/scripts", get(list).post(create))
        .route("/scripts/{id}", get(fetch).put(update).delete(remove))
}

async fn list(State(state): State<AppState>, user: AuthUser) -> ApiResult<Json<Vec<Value>>> {
    let scripts = sqlx::query_as::<_, Script>(&format!("{SELECT_SCRIPT} ORDER BY s._id"))
        .bind(&user.organization_id)
        .fetch_all(&state.pool)
        .await?;
    Ok(Json(scripts.into_iter().map(Script::public_json).collect()))
}

async fn find(
    connection: &mut PgConnection,
    organization_id: &str,
    id: &str,
    lock: bool,
) -> ApiResult<Script> {
    let suffix = if lock {
        " AND s._id = $2 FOR UPDATE OF s"
    } else {
        " AND s._id = $2"
    };
    sqlx::query_as::<_, Script>(&format!("{SELECT_SCRIPT}{suffix}"))
        .bind(organization_id)
        .bind(id)
        .fetch_optional(connection)
        .await?
        .ok_or_else(|| {
            ApiError::not_found(format!("Script “{id}” could not be found or accessed."))
        })
}

async fn fetch(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    let id = ObjectId::parse_path(&id)?.to_string();
    let mut connection = state.pool.acquire().await?;
    Ok(Json(
        find(&mut connection, &user.organization_id, &id, false)
            .await?
            .public_json(),
    ))
}

async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    RequestJson(body): RequestJson<ScriptParameters>,
) -> ApiResult<Json<Value>> {
    ObjectId::parse(&body.owner)?;
    if !user.is_team_manager_or_admin(&state.pool).await? || body.owner != user.id {
        return Err(ApiError::forbidden(
            "You are not authorized to view or edit this resource.",
        ));
    }
    validate(&body)?;
    let id = ObjectId::new().to_string();
    let mut transaction = state.pool.begin().await?;
    sqlx::query("INSERT INTO webknossos.scripts (_id, _owner, name, gist) VALUES ($1, $2, $3, $4)")
        .bind(&id)
        .bind(&body.owner)
        .bind(&body.name)
        .bind(&body.gist)
        .execute(&mut *transaction)
        .await?;
    let script = find(&mut transaction, &user.organization_id, &id, false).await?;
    transaction.commit().await?;
    Ok(Json(script.public_json()))
}

async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    RequestJson(body): RequestJson<ScriptParameters>,
) -> ApiResult<Json<Value>> {
    let id = ObjectId::parse_path(&id)?.to_string();
    ObjectId::parse(&body.owner)?;
    let mut transaction = state.pool.begin().await?;
    let old = find(&mut transaction, &user.organization_id, &id, true).await?;
    if old.owner_id != user.id {
        return Err(ApiError::forbidden(
            "You do not have permission to update this script. Please ask the script owner.",
        ));
    }
    validate(&body)?;
    let target_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM webknossos.users_ WHERE _id = $1 AND _organization = $2)",
    )
    .bind(&body.owner)
    .bind(&user.organization_id)
    .fetch_one(&mut *transaction)
    .await?;
    if !target_exists {
        return Err(ApiError::bad_request(format!(
            "User “{}” could not be found or accessed.",
            body.owner
        )));
    }
    sqlx::query("UPDATE webknossos.scripts SET _owner = $2, name = $3, gist = $4 WHERE _id = $1")
        .bind(&id)
        .bind(&body.owner)
        .bind(&body.name)
        .bind(&body.gist)
        .execute(&mut *transaction)
        .await?;
    let script = find(&mut transaction, &user.organization_id, &id, false).await?;
    transaction.commit().await?;
    Ok(Json(script.public_json()))
}

async fn remove(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    let id = ObjectId::parse_path(&id)?.to_string();
    let mut transaction = state.pool.begin().await?;
    let old = find(&mut transaction, &user.organization_id, &id, true).await?;
    if old.owner_id != user.id {
        return Err(ApiError::forbidden(
            "You do not have permission to delete this script. Please ask the script owner.",
        ));
    }
    sqlx::query("UPDATE webknossos.scripts SET isDeleted = TRUE WHERE _id = $1")
        .bind(&id)
        .execute(&mut *transaction)
        .await?;
    // Include deleted tasks, matching TaskDAO.removeScriptFromAllTasks.
    sqlx::query("UPDATE webknossos.tasks SET _script = NULL WHERE _script = $1")
        .bind(&id)
        .execute(&mut *transaction)
        .await?;
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
        return Err(ApiError::bad_request("Invalid script gist URL."));
    }
    Ok(())
}

fn validate_name(name: &str) -> ApiResult<()> {
    let length = name.encode_utf16().count();
    if length < 2 {
        return Err(ApiError::bad_request(
            "Script name must be at least two characters long.",
        ));
    }
    if length > 50 {
        return Err(ApiError::bad_request(
            "Script name must be at most 50 characters long.",
        ));
    }
    if !name.chars().all(crate::teams::valid_name_character) {
        return Err(ApiError::bad_request(format!(
            "Script name “{name}” is invalid. Please use only letters, digits, dots, space, underscores, hyphens."
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn script_name_validation_matches_scala_boundaries_and_characters() {
        assert!(validate_name("a").is_err());
        assert!(validate_name("ab").is_ok());
        assert!(validate_name(&"ß".repeat(50)).is_ok());
        assert!(validate_name(&"a".repeat(51)).is_err());
        assert!(validate_name("a-b_c.d ß").is_ok());
        for name in ["éé", "a/b", "a\nb", "💡"] {
            assert!(validate_name(name).is_err());
        }
    }
    #[test]
    fn gist_accepts_existing_http_contract_without_fetching() {
        for gist in [
            "http://gist.github.com/id",
            "HTTPS://example.org/x",
            "https://localhost",
        ] {
            assert!(
                validate(&ScriptParameters {
                    name: "ab".into(),
                    gist: gist.into(),
                    owner: String::new()
                })
                .is_ok()
            );
        }
        for gist in ["", "file:///tmp/x", "javascript:alert(1)", "https://"] {
            assert!(
                validate(&ScriptParameters {
                    name: "ab".into(),
                    gist: gist.into(),
                    owner: String::new()
                })
                .is_err()
            );
        }
    }
}
