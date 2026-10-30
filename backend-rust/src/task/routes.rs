//! Task administration and task previews. Creation and assignment require tracing services.
use crate::response::Messages;
use axum::{
    Json as ResponseJson, Router,
    extract::State,
    http::{HeaderMap, HeaderValue},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgConnection, Postgres, Transaction};
use webknossos_common::geometry::BoundingBox;

use crate::{
    AppState,
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::{Json, Path, Query},
    task::task_dao,
    util::id::ObjectId,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/tasks/{id}", get(read).put(update).delete(delete))
        .route("/tasks/list", post(list))
        .route("/tasks/experienceDomains", get(experience_domains))
        .route("/taskTypes/{id}/tasks", get(for_task_type))
        .route("/projects/{id}/tasks", get(for_project))
        .route("/user/tasks/peek", get(peek))
}

#[derive(Deserialize)]
struct Experience {
    #[serde(rename = "domain")]
    _domain: String,
    #[serde(rename = "value")]
    _value: i32,
}
#[derive(Deserialize)]
struct BaseAnnotation {
    #[serde(rename = "baseId")]
    _base_id: String,
    #[serde(rename = "skeletonId")]
    _skeleton_id: Option<String>,
    #[serde(rename = "volumeId")]
    _volume_id: Option<String>,
}
// Scala validates the full TaskParameters body even though PUT changes only
// pendingInstances. Deserialize the remaining fields to preserve that contract.
#[derive(Deserialize)]
struct TaskParameters {
    #[serde(rename = "pendingInstances")]
    pending_instances: i32,
    #[serde(rename = "taskTypeId")]
    _task_type_id: ObjectId,
    #[serde(rename = "neededExperience")]
    _needed_experience: Experience,
    #[serde(rename = "projectName")]
    _project_name: String,
    #[serde(rename = "scriptId")]
    _script_id: Option<ObjectId>,
    #[serde(rename = "boundingBox")]
    _bounding_box: Option<BoundingBox>,
    #[serde(rename = "datasetId")]
    _dataset_id: ObjectId,
    #[serde(rename = "editPosition")]
    _edit_position: [i32; 3],
    #[serde(rename = "editRotation")]
    _edit_rotation: [f64; 3],
    #[serde(rename = "creationInfo")]
    _creation_info: Option<String>,
    #[serde(rename = "description")]
    _description: Option<String>,
    #[serde(rename = "baseAnnotation")]
    _base_annotation: Option<BaseAnnotation>,
    #[serde(rename = "newSkeletonTracingId")]
    _new_skeleton_tracing_id: Option<String>,
    #[serde(rename = "newVolumeTracingId")]
    _new_volume_tracing_id: Option<String>,
    #[serde(rename = "newAnnotationId")]
    _new_annotation_id: Option<ObjectId>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListParameters {
    pub(crate) user: Option<ObjectId>,
    pub(crate) project: Option<ObjectId>,
    pub(crate) ids: Option<Vec<ObjectId>>,
    pub(crate) task_type: Option<ObjectId>,
    pub(crate) random: Option<bool>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectQuery {
    limit: Option<i32>,
    page_number: Option<i32>,
    include_total_count: Option<bool>,
}

pub(crate) async fn public_json(
    connection: &mut PgConnection,
    user: &AuthUser,
    id: &ObjectId,
    global: bool,
) -> ApiResult<Value> {
    public_json_for(connection, Some(user), id, global).await
}

/// Global annotation serialization can have no authenticated requester.
/// Keep that absence explicit instead of inventing a user identity.
pub(crate) async fn public_json_for(
    connection: &mut PgConnection,
    user: Option<&AuthUser>,
    id: &ObjectId,
    global: bool,
) -> ApiResult<Value> {
    let value = task_dao::find_one_json(connection, user, id, global)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::task::not_found(id)))?;
    if value["type"].is_null() {
        return Err(ApiError::not_found(crate::msg::NOT_FOUND));
    }
    Ok(value)
}

async fn read(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<ResponseJson<Value>> {
    let id = ObjectId::parse_path(&id)?;
    let mut connection = state.pool.acquire().await?;
    Ok(ResponseJson(
        public_json(&mut connection, &user, &id, false).await?,
    ))
}

async fn serialize_all(
    connection: &mut PgConnection,
    user: &AuthUser,
    ids: Vec<ObjectId>,
) -> ApiResult<Value> {
    let mut values = Vec::with_capacity(ids.len());
    for id in ids {
        values.push(public_json(connection, user, &id, false).await?);
    }
    Ok(Value::Array(values))
}
async fn list(
    State(state): State<AppState>,
    user: AuthUser,
    Json(parameters): Json<ListParameters>,
) -> ApiResult<ResponseJson<Value>> {
    let mut connection = state.pool.acquire().await?;
    let ids = task_dao::find_all_ids(&mut connection, &user, &parameters).await?;
    Ok(ResponseJson(
        serialize_all(&mut connection, &user, ids).await?,
    ))
}
async fn for_task_type(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<ResponseJson<Value>> {
    let id = ObjectId::parse_path(&id)?;
    let parameters = ListParameters {
        task_type: Some(id.clone()),
        ..Default::default()
    };
    let mut connection = state.pool.acquire().await?;
    let ids = task_dao::find_all_ids(&mut connection, &user, &parameters).await?;
    Ok(ResponseJson(
        serialize_all(&mut connection, &user, ids).await?,
    ))
}

async fn for_project(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Query(parameters): Query<ProjectQuery>,
) -> ApiResult<(HeaderMap, ResponseJson<Value>)> {
    let id = ObjectId::parse_path(&id)?;
    let limit = parameters.limit.unwrap_or(i32::MAX);
    let page = parameters.page_number.unwrap_or(0);
    if limit < 0 || page < 0 {
        return Err(ApiError::bad_request(
            crate::msg::request::INVALID_PAGINATION,
        ));
    }
    let mut connection = state.pool.acquire().await?;
    let team = task_dao::find_project_team_with_read_access(&mut connection, &user, &id)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::project::not_found(&id)))?;
    let can_manage = task_dao::can_manage_team(&mut connection, &user, &team).await?;
    if !can_manage {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    let ids = task_dao::find_ids_for_project(&mut connection, &user, &id, limit, page).await?;
    let mut headers = HeaderMap::new();
    if parameters.include_total_count == Some(true) {
        let count = task_dao::count_for_project(&mut connection, &id).await?;
        headers.insert(
            "X-Total-Count",
            HeaderValue::from_str(&count.to_string()).map_err(|_| ApiError::internal())?,
        );
    }
    Ok((
        headers,
        ResponseJson(serialize_all(&mut connection, &user, ids).await?),
    ))
}

async fn lock_managed_task(
    tx: &mut Transaction<'_, Postgres>,
    user: &AuthUser,
    id: &ObjectId,
) -> ApiResult<(i64, i64)> {
    // Lock the project before the task, in the same order as project mutations.
    // This keeps concurrent changes to project team/visibility from invalidating authorization.
    let project = task_dao::find_project_id_with_read_access(tx, user, id)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::task::not_found(id)))?;
    let team = task_dao::lock_project_team_for_share(tx, &project, &user.organization_id)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::project::not_found(&project)))?;
    if !crate::projects::can_manage_team_in_tx(tx, user, &team).await? {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    task_dao::lock_instances(tx, id, &project)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::task::not_found(id)))
}
async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(parameters): Json<TaskParameters>,
) -> ApiResult<ResponseJson<Value>> {
    let id = ObjectId::parse_path(&id)?;
    let mut tx = state.pool.begin().await?;
    let (total, pending) = lock_managed_task(&mut tx, &user, &id).await?;
    let total = total
        .checked_sub(pending)
        .and_then(|used| used.checked_add(i64::from(parameters.pending_instances)))
        .ok_or_else(|| ApiError::bad_request(crate::msg::request::INVALID_RESOURCE_VALUES))?;
    task_dao::update_total_instances(&mut tx, &id, total).await?;
    let mut value = public_json(&mut tx, &user, &id, false).await?;
    tx.commit().await?;
    value["messages"] = json!([{"success":crate::msg::task::EDIT_SUCCESS}]);
    Ok(ResponseJson(value))
}
async fn delete(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<ResponseJson<Messages>> {
    let id = ObjectId::parse_path(&id)?;
    let mut tx = state.pool.begin().await?;
    lock_managed_task(&mut tx, &user, &id).await?;
    task_dao::delete_one(&mut tx, &id).await?;
    task_dao::delete_annotations(&mut tx, &id).await?;
    tx.commit().await?;
    Ok(Messages::success(crate::msg::task::DELETE_SUCCESS))
}
async fn experience_domains(
    State(state): State<AppState>,
    user: AuthUser,
) -> ApiResult<ResponseJson<Vec<String>>> {
    Ok(ResponseJson(
        task_dao::find_experience_domains(&state.pool, &user.organization_id).await?,
    ))
}
async fn peek(State(state): State<AppState>, user: AuthUser) -> ApiResult<ResponseJson<Value>> {
    let manager = user.is_team_manager_or_admin(&state.pool).await?;
    let id = task_dao::find_next_task_id_for_peek(&state.pool, &user, manager)
        .await?
        .ok_or_else(|| ApiError::bad_request(crate::msg::task::UNAVAILABLE))?;
    let mut connection = state.pool.acquire().await?;
    Ok(ResponseJson(
        public_json(&mut connection, &user, &id, true).await?,
    ))
}

#[cfg(test)]
mod task_routes_tests;
