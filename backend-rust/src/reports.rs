//! ReportController: project progress and available-task reports per team.
pub(crate) mod reports_dao;

use axum::{Json as ResponseJson, Router, extract::State, routing::get};
use serde_json::{Map, Value, json};

use crate::{
    AppState,
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::Path,
    util::id::{ObjectId, PathObjectId},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/teams/{id}/availableTasksReport", get(available_tasks))
        .route("/teams/{id}/projectProgressReport", get(project_progress))
}

/// TeamDAO.findOne under the requester's access context: members and
/// administrators of the team's organization.
async fn require_readable_team(state: &AppState, user: &AuthUser, id: &ObjectId) -> ApiResult<()> {
    let readable = reports_dao::is_team_readable(&state.pool, user, id).await?;
    if !readable {
        return Err(ApiError::not_found(crate::msg::team::not_found(id)));
    }
    Ok(())
}

async fn project_progress(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
) -> ApiResult<ResponseJson<Value>> {
    require_readable_team(&state, &user, &id).await?;
    let rows = reports_dao::find_project_progress_report(&state.pool, &id).await?;
    Ok(ResponseJson(Value::Array(rows)))
}

async fn available_tasks(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
) -> ApiResult<ResponseJson<Value>> {
    require_readable_team(&state, &user, &id).await?;
    let users =
        reports_dao::find_all_by_team_for_available_tasks_report(&state.pool, &user, &id).await?;
    let mut entries = Vec::with_capacity(users.len());
    for (user_id, full_name) in users {
        let counts =
            reports_dao::find_available_task_counts_for_user(&state.pool, &user_id).await?;
        let mut by_project = Map::new();
        for (project, domain, value, count) in counts.into_iter().filter(|row| row.3 > 0) {
            by_project.insert(format!("{project}/{domain}: {value}"), json!(count));
        }
        let total: i64 = by_project.values().filter_map(Value::as_i64).sum();
        entries.push(json!({
            "id": user_id,
            "user": full_name,
            "totalAvailableTasks": total,
            "availableTasksByProjects": by_project,
        }));
    }
    Ok(ResponseJson(Value::Array(entries)))
}
