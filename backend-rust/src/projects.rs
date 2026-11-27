pub(crate) mod projects_dao;

use crate::response::Messages;
use axum::{
    Json as ResponseJson, Router,
    extract::State,
    http::StatusCode,
    routing::{get, patch, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, Transaction};

pub(crate) use projects_dao::push_read_access;

use crate::{
    AppState,
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::{Json, Path, Query},
    util::id::ObjectId,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/projects", get(list).post(create))
        .route("/projects/withStatus", get(list_with_status))
        .route("/projects/byName/{name}", get(by_name))
        .route("/projects/{id}", get(read).put(update).delete(delete))
        .route("/projects/{id}/pause", patch(pause))
        .route("/projects/{id}/resume", patch(resume))
        .route(
            "/projects/{id}/incrementEachTasksInstances",
            patch(increment_instances),
        )
        .route("/projects/{id}/usersWithActiveTasks", get(active_users))
        .route(
            "/projects/{id}/transferActiveTasks",
            post(transfer_active_tasks),
        )
        .route("/taskTypes/{id}/projects", get(for_task_type))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectParameters {
    name: String,
    team: ObjectId,
    priority: i32,
    paused: Option<bool>,
    expected_time: Option<i64>,
    owner: ObjectId,
    is_blacklisted_from_report: bool,
}

fn validate_name(name: &str) -> ApiResult<()> {
    if name.chars().count() < 3 {
        return Err(ApiError::bad_request(crate::msg::project::NAME_TOO_SHORT));
    }
    if !name
        .bytes()
        .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
    {
        return Err(ApiError::bad_request(
            crate::msg::project::name_invalid_chars(name),
        ));
    }
    Ok(())
}

async fn project_json<'e, E: sqlx::Executor<'e, Database = Postgres>>(
    executor: E,
    user: &AuthUser,
    id: &ObjectId,
) -> ApiResult<Value> {
    projects_dao::find_one_json(executor, user, id)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::project::not_found(id)))
}

async fn projects(pool: &PgPool, user: &AuthUser, with_status: bool) -> ApiResult<Value> {
    let mut values = projects_dao::find_all_json(pool, user).await?;
    if with_status {
        add_status_to_all(pool, &mut values).await?;
    }
    Ok(Value::Array(values))
}

async fn add_status_to_all(pool: &PgPool, projects: &mut [Value]) -> ApiResult<()> {
    if projects.is_empty() {
        return Ok(());
    }
    let ids: Vec<&str> = projects.iter().filter_map(|p| p["id"].as_str()).collect();
    let rows = projects_dao::find_task_status_for_projects(pool, ids).await?;
    let counts: std::collections::HashMap<_, _> = rows
        .into_iter()
        .map(|(id, pending, time)| (id, (pending, time)))
        .collect();
    for project in projects {
        let (pending, time) = counts
            .get(project["id"].as_str().ok_or_else(ApiError::internal)?)
            .copied()
            .unwrap_or_default();
        project["pendingInstances"] = json!(pending);
        project["tracingTime"] = json!(time);
    }
    Ok(())
}

async fn add_status<'e, E: sqlx::Executor<'e, Database = Postgres>>(
    executor: E,
    project: &mut Value,
) -> ApiResult<()> {
    let id = project["id"].as_str().ok_or_else(ApiError::internal)?;
    let (pending, time) = projects_dao::find_task_status(executor, id).await?;
    project["pendingInstances"] = json!(pending);
    project["tracingTime"] = json!(time);
    Ok(())
}

async fn list(State(state): State<AppState>, user: AuthUser) -> ApiResult<ResponseJson<Value>> {
    Ok(ResponseJson(projects(&state.pool, &user, false).await?))
}
async fn list_with_status(
    State(state): State<AppState>,
    user: AuthUser,
) -> ApiResult<ResponseJson<Value>> {
    Ok(ResponseJson(projects(&state.pool, &user, true).await?))
}
async fn read(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<ResponseJson<Value>> {
    let id = ObjectId::parse_path(&id)?;
    Ok(ResponseJson(project_json(&state.pool, &user, &id).await?))
}
async fn by_name(
    State(state): State<AppState>,
    user: AuthUser,
    Path(name): Path<String>,
) -> ApiResult<ResponseJson<Value>> {
    let value = projects_dao::find_one_json_by_name(&state.pool, &user, &name)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::project::not_found_by_name(&name)))?;
    Ok(ResponseJson(value))
}

async fn check_references(
    tx: &mut Transaction<'_, Postgres>,
    user: &AuthUser,
    parameters: &ProjectParameters,
) -> ApiResult<()> {
    if !can_manage_team_in_tx(tx, user, &parameters.team).await? {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    let owner =
        projects_dao::find_owner_for_share(tx, &parameters.owner, &user.organization_id).await?;
    if owner.is_none() {
        return Err(ApiError::bad_request(crate::msg::user::not_found(
            &parameters.owner,
        )));
    }
    Ok(())
}

async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    Json(parameters): Json<ProjectParameters>,
) -> ApiResult<ResponseJson<Value>> {
    validate_name(&parameters.name)?;
    let id = ObjectId::new();
    let mut tx = state.pool.begin().await?;
    check_references(&mut tx, &user, &parameters).await?;
    // Projects have no database uniqueness constraint. Serialize contenders for
    // an organization/name to make the uniqueness check atomic.
    projects_dao::lock_name(&mut tx, &user.organization_id, &parameters.name).await?;
    let exists =
        projects_dao::is_name_taken(&mut tx, &parameters.name, &user.organization_id).await?;
    if exists {
        return Err(ApiError::bad_request(crate::msg::project::name_taken(
            &parameters.name,
        )));
    }
    projects_dao::insert_one(&mut tx, &id, &user.organization_id, &parameters).await?;
    let response = project_json(&mut *tx, &user, &id).await?;
    tx.commit().await?;
    Ok(ResponseJson(response))
}

async fn managed_project(
    tx: &mut Transaction<'_, Postgres>,
    user: &AuthUser,
    id: &ObjectId,
    team: &ObjectId,
) -> ApiResult<Value> {
    let project = project_json(&mut **tx, user, id).await?;
    if !can_manage_team_in_tx(tx, user, team).await? {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    Ok(project)
}

async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(parameters): Json<ProjectParameters>,
) -> ApiResult<ResponseJson<Value>> {
    let id = ObjectId::parse_path(&id)?;
    let mut tx = state.pool.begin().await?;
    let team = lock_project(&mut tx, &id, &user.organization_id).await?;
    managed_project(&mut tx, &user, &id, &team).await?;
    check_references(&mut tx, &user, &parameters).await?;
    // Project names and paused state are immutable through PUT in Scala.
    projects_dao::update_one(&mut tx, &id, &parameters).await?;
    let response = project_json(&mut *tx, &user, &id).await?;
    tx.commit().await?;
    Ok(ResponseJson(response))
}

async fn set_paused(
    pool: &PgPool,
    user: &AuthUser,
    id: &ObjectId,
    paused: bool,
) -> ApiResult<Value> {
    let mut tx = pool.begin().await?;
    let team = lock_project(&mut tx, id, &user.organization_id).await?;
    managed_project(&mut tx, user, id, &team).await?;
    projects_dao::update_paused(&mut tx, id, paused).await?;
    let response = project_json(&mut *tx, user, id).await?;
    tx.commit().await?;
    Ok(response)
}
async fn pause(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<ResponseJson<Value>> {
    let id = ObjectId::parse_path(&id)?;
    Ok(ResponseJson(
        set_paused(&state.pool, &user, &id, true).await?,
    ))
}
async fn resume(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<ResponseJson<Value>> {
    let id = ObjectId::parse_path(&id)?;
    Ok(ResponseJson(
        set_paused(&state.pool, &user, &id, false).await?,
    ))
}

#[derive(Deserialize)]
struct IncrementParameters {
    delta: Option<i64>,
}
async fn increment_instances(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Query(parameters): Query<IncrementParameters>,
) -> ApiResult<ResponseJson<Value>> {
    let id = ObjectId::parse_path(&id)?;
    let delta = parameters.delta.unwrap_or(1);
    if delta < 0 {
        return Err(ApiError::bad_request(
            crate::msg::project::INCREASE_TASK_INSTANCES_NEGATIVE,
        ));
    }
    let mut tx = state.pool.begin().await?;
    let team = lock_project(&mut tx, &id, &user.organization_id).await?;
    // Only team managers of the project's team and organization admins
    // (isTeamManagerOrAdminOf, else 403 Msg.notAllowed). The task DAO
    // additionally restricts affected tasks to team members and admins.
    let mut project = managed_project(&mut tx, &user, &id, &team).await?;
    projects_dao::increase_task_instances(&mut tx, &user, &id, delta).await?;
    add_status(&mut *tx, &mut project).await?;
    tx.commit().await?;
    Ok(ResponseJson(project))
}

async fn delete(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<ResponseJson<Messages>> {
    let id = ObjectId::parse_path(&id)?;
    let mut tx = state.pool.begin().await?;
    lock_project(&mut tx, &id, &user.organization_id).await?;
    project_json(&mut *tx, &user, &id).await?;
    // Authorization uses the stored owner, independently of response privacy.
    let owner = projects_dao::find_owner(&mut tx, &id).await?;
    if !user.is_admin && owner != user.id {
        return Err(ApiError::forbidden(crate::msg::project::DELETE_NOT_ALLOWED));
    }
    projects_dao::delete_one(&mut tx, &id).await?;
    projects_dao::delete_tasks(&mut tx, projects_dao::TaskParent::Project, &id).await?;
    tx.commit().await?;
    Ok(Messages::success(crate::msg::project::DELETE_SUCCESS))
}

async fn lock_project(
    tx: &mut Transaction<'_, Postgres>,
    id: &ObjectId,
    organization: &str,
) -> ApiResult<ObjectId> {
    projects_dao::lock_one(tx, id, organization)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::project::not_found(id)))
}

pub(crate) async fn can_manage_team_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    user: &AuthUser,
    team: &ObjectId,
) -> ApiResult<bool> {
    Ok(projects_dao::can_manage_team(tx, user, team).await?)
}

async fn for_task_type(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<ResponseJson<Value>> {
    let id = ObjectId::parse_path(&id)?;
    let exists = projects_dao::is_task_type_readable(&state.pool, &user, &id).await?;
    if !exists {
        return Err(ApiError::not_found(crate::msg::task_type::not_found(&id)));
    }
    let mut values = projects_dao::find_all_json_for_task_type(&state.pool, &user, &id).await?;
    add_status_to_all(&state.pool, &mut values).await?;
    Ok(ResponseJson(Value::Array(values)))
}

async fn active_users(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<ResponseJson<Value>> {
    let id = ObjectId::parse_path(&id)?;
    project_json(&state.pool, &user, &id).await?;
    let values = projects_dao::find_active_users_json(&state.pool, id).await?;
    Ok(ResponseJson(Value::Array(values)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TransferParameters {
    user_id: ObjectId,
}

/// ProjectController.transferActiveTasks: hand every active task annotation of
/// the project to another user. Play transfers one annotation after another
/// without a transaction; here the transfer is all-or-nothing.
async fn transfer_active_tasks(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(parameters): Json<TransferParameters>,
) -> ApiResult<StatusCode> {
    let id = ObjectId::parse_path(&id)?;
    let new_user = &parameters.user_id;
    let mut tx = state.pool.begin().await?;
    let team = projects_dao::find_team_with_read_access(&mut tx, &user, &id)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::project::not_found(&id)))?;
    if !can_manage_team_in_tx(&mut tx, &user, &team).await? {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    // Play answers 400 here.
    let transferee = projects_dao::find_user_for_share(&mut tx, &user, new_user).await?;
    if transferee.is_none() {
        return Err(ApiError::bad_request(crate::msg::user::not_found(new_user)));
    }
    let annotations = projects_dao::find_active_task_annotation_ids(&mut tx, &id).await?;
    for annotation in annotations {
        let (dataset, mutable) =
            projects_dao::find_annotation_for_transfer(&mut tx, &user, &annotation)
                .await?
                .ok_or_else(|| ApiError::bad_request(crate::msg::annotation::NOT_FOUND))?;
        let dataset_readable =
            projects_dao::is_dataset_readable(&mut tx, &dataset, new_user).await?;
        if !dataset_readable {
            return Err(ApiError::bad_request(
                crate::msg::annotation::TRANSFEREE_NO_DATASET_ACCESS,
            ));
        }
        if !mutable {
            return Err(ApiError::bad_request(
                crate::msg::annotation::NO_UPDATE_ACCESS,
            ));
        }
        projects_dao::update_annotation_user(&mut tx, &annotation, new_user).await?;
        // Play re-reads the transferred annotation with the requester's access.
        let readable = projects_dao::is_annotation_readable(&mut tx, &user, &annotation).await?;
        if !readable {
            return Err(ApiError::bad_request(crate::msg::annotation::NOT_FOUND));
        }
    }
    tx.commit().await?;
    Ok(StatusCode::OK)
}

#[cfg(test)]
mod projects_tests;
