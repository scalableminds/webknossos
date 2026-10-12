//! ReportController: project progress and available-task reports per team.
use axum::{Json as ResponseJson, Router, extract::State, routing::get};
use serde_json::{Map, Value, json};

use crate::{
    AppState,
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::Path,
    id::{ObjectId, PathObjectId},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/teams/{id}/availableTasksReport", get(available_tasks))
        .route("/teams/{id}/projectProgressReport", get(project_progress))
}

/// TeamDAO.findOne under the requester's access context: members and
/// administrators of the team's organization.
async fn require_readable_team(state: &AppState, user: &AuthUser, id: &ObjectId) -> ApiResult<()> {
    let readable: bool = sqlx::query_scalar(
        r#"SELECT EXISTS(SELECT 1 FROM webknossos.teams_ t WHERE t._id = $1 AND t._organization = $3
             AND ($4 OR EXISTS(SELECT 1 FROM webknossos.user_team_roles r WHERE r._team = t._id AND r._user = $2)))"#,
    )
    .bind(id.as_str())
    .bind(&user.id)
    .bind(&user.organization_id)
    .bind(user.is_admin)
    .fetch_one(&state.pool)
    .await?;
    if !readable {
        return Err(ApiError::not_found(format!(
            "Team “{id}” could not be found or accessed."
        )));
    }
    Ok(())
}

async fn project_progress(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
) -> ApiResult<ResponseJson<Value>> {
    require_readable_team(&state, &user, &id).await?;
    let rows: Vec<Value> = sqlx::query_scalar(
        r#"WITH teamMembers AS (
             SELECT _user FROM webknossos.user_team_roles ut WHERE ut._team = $1
           ), experiences AS (
             SELECT ue.domain, ue.value FROM teamMembers u
             JOIN webknossos.user_experiences ue ON ue._user = u._user
           ), filteredProjects AS (
             SELECT p._id, p.name, p.paused, p.priority
             FROM webknossos.projects_ p
             JOIN webknossos.tasks_ t ON t._project = p._id
             CROSS JOIN experiences ue
             WHERE p._team = $1
               AND t.neededExperience_domain = ue.domain
               AND t.neededExperience_value <= ue.value
               AND NOT p.isblacklistedfromreport
             GROUP BY p._id, p.name, p.paused, p.priority
           ), projectModifiedTimes AS (
             SELECT p._id, MAX(a.modified) AS modified
             FROM filteredProjects p
             JOIN webknossos.tasks_ t ON t._project = p._id
             LEFT JOIN webknossos.annotations_ a ON t._id = a._task
             GROUP BY p._id
           ), s1 AS (
             SELECT p._id, p.name projectName, p.paused paused, p.priority priority,
               COUNT(t._id) totalTasks, SUM(t.totalInstances) totalInstances,
               SUM(t.pendingInstances) pendingInstances, SUM(t.tracingTime) tracingTime
             FROM filteredProjects p
             JOIN webknossos.tasks_ t ON p._id = t._project
             GROUP BY p._id, p.name, p.paused, p.priority
           ), s2 AS (
             SELECT p._id, COUNT(a._id) activeInstances
             FROM filteredProjects p
             JOIN webknossos.tasks_ t ON p._id = t._project
             LEFT JOIN (
               SELECT a._id, a._task FROM webknossos.annotations_ a
               WHERE a.state = 'Active' AND a.typ = 'Task'
             ) a ON t._id = a._task
             GROUP BY p._id
           )
           SELECT jsonb_build_object(
             'projectName', s1.projectName, 'paused', s1.paused, 'priority', s1.priority,
             'totalTasks', s1.totalTasks, 'totalInstances', s1.totalInstances,
             'pendingInstances', s1.pendingInstances,
             'finishedInstances', s1.totalInstances - s1.pendingInstances - s2.activeInstances,
             'activeInstances', s2.activeInstances,
             'billedMilliseconds', COALESCE(s1.tracingTime, 0))
           FROM s1
           JOIN s2 ON s1._id = s2._id
           JOIN projectModifiedTimes pmt ON s1._id = pmt._id
           WHERE NOT (s1.paused AND s1.totalInstances = s1.pendingInstances)
             AND ((s1.pendingInstances > 0 AND NOT s1.paused)
               OR s2.activeInstances > 0
               OR pmt.modified > NOW() - INTERVAL '30 days')
           ORDER BY s1._id"#,
    )
    .bind(id.as_str())
    .fetch_all(&state.pool)
    .await?;
    Ok(ResponseJson(Value::Array(rows)))
}

async fn available_tasks(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
) -> ApiResult<ResponseJson<Value>> {
    require_readable_team(&state, &user, &id).await?;
    // UserDAO.findAllByTeams (listable, active members of the team), minus
    // unlisted users and users who manage the team or administer its organization.
    let users: Vec<(String, String)> = sqlx::query_as(
        r#"SELECT u._id, m.firstName || ' ' || m.lastName
           FROM webknossos.users_ u
           JOIN webknossos.multiUsers_ m ON m._id = u._multiUser
           JOIN webknossos.user_team_roles member ON member._user = u._id AND member._team = $1
           JOIN webknossos.teams_ team ON team._id = member._team
           WHERE u._organization = $3 AND NOT u.isDeactivated AND NOT u.isUnlisted
             AND (u._id = $2 OR $4 OR EXISTS(
               SELECT 1 FROM webknossos.user_team_roles target_role
               JOIN webknossos.teams_ shared ON shared._id = target_role._team AND shared._organization = $3
               JOIN webknossos.user_team_roles manager_role ON manager_role._team = shared._id
               WHERE target_role._user = u._id AND manager_role._user = $2 AND manager_role.isTeamManager))
             AND NOT member.isTeamManager
             AND NOT (u.isAdmin AND u._organization = team._organization)
           ORDER BY u._id"#,
    )
    .bind(id.as_str())
    .bind(&user.id)
    .bind(&user.organization_id)
    .bind(user.is_admin)
    .fetch_all(&state.pool)
    .await?;
    let mut entries = Vec::with_capacity(users.len());
    for (user_id, full_name) in users {
        let counts: Vec<(String, String, i32, i64)> = sqlx::query_as(
            r#"SELECT p.name, t.neededExperience_domain, t.neededExperience_value, COUNT(t._id)
               FROM webknossos.tasks_ t
               JOIN (SELECT domain, value FROM webknossos.user_experiences WHERE _user = $1) AS ue
                 ON t.neededExperience_domain = ue.domain AND t.neededExperience_value <= ue.value
               JOIN webknossos.projects_ p ON t._project = p._id
               LEFT JOIN (
                 SELECT _task FROM webknossos.annotations_ WHERE _user = $1 AND typ = 'Task'
               ) AS userAnnotations ON t._id = userAnnotations._task
               WHERE t.pendingInstances > 0 AND userAnnotations._task IS NULL AND NOT p.paused
               GROUP BY p._id, p.name, t.neededExperience_domain, t.neededExperience_value
               ORDER BY p._id, t.neededExperience_domain, t.neededExperience_value"#,
        )
        .bind(&user_id)
        .fetch_all(&state.pool)
        .await?;
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
