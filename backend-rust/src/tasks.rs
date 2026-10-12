//! Task administration and task previews. Creation and assignment require tracing services.
use axum::{
    Json as ResponseJson, Router,
    extract::State,
    http::{HeaderMap, HeaderValue},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgConnection, Postgres, Transaction};

use crate::{
    AppState,
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::{Json, Path, Query},
    id::ObjectId,
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
struct BoundingBox {
    #[serde(rename = "topLeft")]
    _top_left: [i32; 3],
    #[serde(rename = "width")]
    _width: i32,
    #[serde(rename = "height")]
    _height: i32,
    #[serde(rename = "depth")]
    _depth: i32,
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
struct ListParameters {
    user: Option<ObjectId>,
    project: Option<ObjectId>,
    ids: Option<Vec<ObjectId>>,
    task_type: Option<ObjectId>,
    random: Option<bool>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectQuery {
    limit: Option<i32>,
    page_number: Option<i32>,
    include_total_count: Option<bool>,
}

const TASK_READ: &str = r#"p._organization=$2 AND EXISTS (SELECT 1 FROM webknossos.teams_ access_team WHERE access_team._id=p._team AND access_team._organization=$2) AND ($3 OR EXISTS (
    SELECT 1 FROM webknossos.user_team_roles WHERE _user=$1 AND _team=p._team))"#;
const TASK_LIST: &str = r#"p._organization=$2 AND EXISTS (SELECT 1 FROM webknossos.teams_ access_team WHERE access_team._id=p._team AND access_team._organization=$2) AND ($3 OR EXISTS (
    SELECT 1 FROM webknossos.user_team_roles WHERE _user=$1 AND _team=p._team AND isteammanager))"#;
// The alias a is deliberately reused for the base annotation and active count.
const ANNOTATION_READ: &str = r#"($5 OR a.visibility='Public' OR
    (a.visibility='Internal' AND EXISTS (SELECT 1 FROM webknossos.users_ au WHERE au._id=a._user AND au._organization=$2)) OR
    (a.visibility='Private' AND (a._user=$1 OR ($3 AND EXISTS (SELECT 1 FROM webknossos.users_ au WHERE au._id=a._user AND au._organization=$2)))))"#;

pub(crate) async fn public_json(
    connection: &mut PgConnection,
    user: &AuthUser,
    id: &str,
    global: bool,
) -> ApiResult<Value> {
    public_json_for(connection, Some(user), id, global).await
}

/// Global annotation serialization can have no authenticated requester.
/// Keep that absence explicit instead of inventing a user identity.
pub(crate) async fn public_json_for(
    connection: &mut PgConnection,
    user: Option<&AuthUser>,
    id: &str,
    global: bool,
) -> ApiResult<Value> {
    let task_type = crate::task_types::PUBLIC_TASK_TYPE;
    // Script lookup is request-scoped; ScriptService.compactWrites uses global
    // access for its owner. A missing/deleted script is serialized as null.
    let script = crate::scripts::SELECT_SCRIPT
        .replace("u._organization = $1", "($5 OR u._organization = $2)");
    let dataset_read = crate::dataset_access::READ_PREDICATE.replace("$2", "NULL::text");
    let query = format!(
        r#"SELECT jsonb_build_object(
      'id',t._id,'projectId',p._id,'projectName',p.name,'team',team.name,
      'type',({task_type} WHERE tt._id=t._tasktype),
      'datasetName',d.name,'datasetId',d._id,
      'neededExperience',jsonb_build_object('domain',t.neededexperience_domain,'value',t.neededexperience_value),
      'created',floor(extract(epoch FROM t.created)*1000)::bigint,
      'status',jsonb_build_object('pending',t.pendinginstances,'active',active.count,'finished',t.totalinstances-t.pendinginstances-active.count),
      'script',(SELECT jsonb_build_object('id',s.id,'name',s.name,'gist',s.gist,'owner',s.owner) FROM ({script} AND s._id=t._script) s),
      'tracingTime',t.tracingtime,'creationInfo',t.creationinfo,
      'boundingBox',CASE WHEN t.boundingbox IS NULL THEN NULL ELSE jsonb_build_object('topLeft',jsonb_build_array((t.boundingbox).x::int,(t.boundingbox).y::int,(t.boundingbox).z::int),'width',(t.boundingbox).width::int,'height',(t.boundingbox).height::int,'depth',(t.boundingbox).depth::int) END,
      'editPosition',jsonb_build_array((t.editposition).x::int,(t.editposition).y::int,(t.editposition).z::int),
      'editRotation',jsonb_build_array((t.editrotation).x,(t.editrotation).y,(t.editrotation).z))
      FROM webknossos.tasks_ t JOIN webknossos.projects_ p ON p._id=t._project
      JOIN webknossos.teams_ team ON team._id=p._team
      JOIN LATERAL (SELECT a._dataset FROM webknossos.annotations_ a WHERE a._task=t._id AND a.typ='TracingBase' AND a.state<>'Cancelled' AND {ANNOTATION_READ} LIMIT 1) base ON true
      JOIN webknossos.datasets_ d ON d._id=base._dataset AND ($5 OR {dataset_read})
      CROSS JOIN LATERAL (SELECT count(*) AS count FROM webknossos.annotations_ a WHERE a._task=t._id AND a.typ='Task' AND a.state='Active' AND {ANNOTATION_READ}) active
      WHERE t._id=$4 AND ($5 OR ({TASK_READ}))"#
    );
    let value: Value = sqlx::query_scalar(&query)
        .bind(user.map(|user| user.id.as_str()))
        .bind(user.map(|user| user.organization_id.as_str()))
        .bind(user.is_some_and(|user| user.is_admin))
        .bind(id)
        .bind(global)
        .fetch_optional(connection)
        .await?
        .ok_or_else(|| ApiError::not_found("task.notFound"))?;
    if value["type"].is_null() {
        return Err(ApiError::not_found("taskType.notFound"));
    }
    Ok(value)
}

async fn read(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<ResponseJson<Value>> {
    let id = ObjectId::parse_path(&id)?.to_string();
    let mut connection = state.pool.acquire().await?;
    Ok(ResponseJson(
        public_json(&mut connection, &user, &id, false).await?,
    ))
}

async fn task_ids(
    connection: &mut PgConnection,
    user: &AuthUser,
    parameters: &ListParameters,
) -> ApiResult<Vec<String>> {
    let order = if parameters.random == Some(true) {
        " ORDER BY RANDOM()"
    } else {
        ""
    };
    let query = format!(
        r#"SELECT t._id FROM webknossos.tasks_ t JOIN webknossos.projects_ p ON p._id=t._project
        WHERE {TASK_LIST} AND ($4::text IS NULL OR t._project=$4) AND ($5::text IS NULL OR t._tasktype=$5)
        AND ($6::text[] IS NULL OR t._id=ANY($6)) AND ($7::text IS NULL OR EXISTS (
          SELECT 1 FROM webknossos.annotations_ a JOIN webknossos.users_ u ON u._id=a._user
          WHERE a._task=t._id AND a.typ='Task' AND a.state<>'Cancelled' AND u._id=$7)){order} LIMIT 1000"#
    );
    let ids = parameters
        .ids
        .as_ref()
        .map(|ids| ids.iter().map(ObjectId::as_str).collect::<Vec<_>>());
    Ok(sqlx::query_scalar(&query)
        .bind(&user.id)
        .bind(&user.organization_id)
        .bind(user.is_admin)
        .bind(parameters.project.as_ref().map(ObjectId::as_str))
        .bind(parameters.task_type.as_ref().map(ObjectId::as_str))
        .bind(ids)
        .bind(parameters.user.as_ref().map(ObjectId::as_str))
        .fetch_all(connection)
        .await?)
}
async fn serialize_all(
    connection: &mut PgConnection,
    user: &AuthUser,
    ids: Vec<String>,
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
    let ids = task_ids(&mut connection, &user, &parameters).await?;
    Ok(ResponseJson(
        serialize_all(&mut connection, &user, ids).await?,
    ))
}
async fn for_task_type(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<ResponseJson<Value>> {
    let id = ObjectId::parse_path(&id)?.to_string();
    let parameters = ListParameters {
        task_type: Some(ObjectId::parse(&id)?),
        ..Default::default()
    };
    let mut connection = state.pool.acquire().await?;
    let ids = task_ids(&mut connection, &user, &parameters).await?;
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
    let id = ObjectId::parse_path(&id)?.to_string();
    let limit = parameters.limit.unwrap_or(i32::MAX);
    let page = parameters.page_number.unwrap_or(0);
    if limit < 0 || page < 0 {
        return Err(ApiError::bad_request("Invalid pagination."));
    }
    let mut connection = state.pool.acquire().await?;
    let team: String = sqlx::query_scalar("SELECT p._team FROM webknossos.projects_ p WHERE p._id=$4 AND p._organization=$2 AND (p._owner=$1 OR $3 OR EXISTS(SELECT 1 FROM webknossos.user_team_roles WHERE _user=$1 AND _team=p._team))")
        .bind(&user.id).bind(&user.organization_id).bind(user.is_admin).bind(&id).fetch_optional(&mut *connection).await?
        .ok_or_else(||ApiError::not_found("project.notFound"))?;
    let can_manage: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM webknossos.teams_ t WHERE t._id=$1 AND t._organization=$2 AND ($3 OR EXISTS(SELECT 1 FROM webknossos.user_team_roles r WHERE r._team=t._id AND r._user=$4 AND r.isteammanager)))")
        .bind(&team).bind(&user.organization_id).bind(user.is_admin).bind(&user.id).fetch_one(&mut *connection).await?;
    if !can_manage {
        return Err(ApiError::forbidden("notAllowed"));
    }
    let query = format!(
        "SELECT t._id FROM webknossos.tasks_ t JOIN webknossos.projects_ p ON p._id=t._project WHERE {TASK_LIST} AND p._id=$4 ORDER BY t._id DESC LIMIT $5 OFFSET $6"
    );
    let ids = sqlx::query_scalar(&query)
        .bind(&user.id)
        .bind(&user.organization_id)
        .bind(user.is_admin)
        .bind(&id)
        .bind(i64::from(limit))
        .bind(i64::from(page) * i64::from(limit))
        .fetch_all(&mut *connection)
        .await?;
    let mut headers = HeaderMap::new();
    if parameters.include_total_count == Some(true) {
        let count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM webknossos.tasks_ WHERE _project=$1")
                .bind(&id)
                .fetch_one(&mut *connection)
                .await?;
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
    id: &str,
) -> ApiResult<(i64, i64)> {
    // Lock the project before the task, in the same order as project mutations.
    // This keeps concurrent changes to project team/visibility from invalidating authorization.
    let project: String=sqlx::query_scalar("SELECT t._project FROM webknossos.tasks_ t JOIN webknossos.projects_ p ON p._id=t._project WHERE t._id=$4 AND p._organization=$2 AND ($3 OR EXISTS(SELECT 1 FROM webknossos.user_team_roles WHERE _user=$1 AND _team=p._team))")
        .bind(&user.id).bind(&user.organization_id).bind(user.is_admin).bind(id).fetch_optional(&mut **tx).await?
        .ok_or_else(||ApiError::not_found("task.notFound"))?;
    let team:String=sqlx::query_scalar("SELECT _team FROM webknossos.projects WHERE _id=$1 AND _organization=$2 AND NOT isdeleted FOR SHARE")
        .bind(&project).bind(&user.organization_id).fetch_optional(&mut **tx).await?.ok_or_else(||ApiError::not_found("project.notFound"))?;
    if !crate::projects::can_manage_team_in_tx(tx, user, &team).await? {
        return Err(ApiError::forbidden("notAllowed"));
    }
    sqlx::query_as("SELECT totalinstances,pendinginstances FROM webknossos.tasks WHERE _id=$1 AND _project=$2 AND NOT isdeleted FOR UPDATE")
        .bind(id).bind(&project).fetch_optional(&mut **tx).await?.ok_or_else(||ApiError::not_found("task.notFound"))
}
async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(parameters): Json<TaskParameters>,
) -> ApiResult<ResponseJson<Value>> {
    let id = ObjectId::parse_path(&id)?.to_string();
    let mut tx = state.pool.begin().await?;
    let (total, pending) = lock_managed_task(&mut tx, &user, &id).await?;
    let total = total
        .checked_sub(pending)
        .and_then(|used| used.checked_add(i64::from(parameters.pending_instances)))
        .ok_or_else(|| ApiError::bad_request("Invalid resource values."))?;
    sqlx::query("UPDATE webknossos.tasks SET totalinstances=$2 WHERE _id=$1")
        .bind(&id)
        .bind(total)
        .execute(&mut *tx)
        .await?;
    let mut value = public_json(&mut tx, &user, &id, false).await?;
    tx.commit().await?;
    value["messages"] = json!([{"success":"task.editSuccess"}]);
    Ok(ResponseJson(value))
}
async fn delete(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<ResponseJson<Value>> {
    let id = ObjectId::parse_path(&id)?.to_string();
    let mut tx = state.pool.begin().await?;
    lock_managed_task(&mut tx, &user, &id).await?;
    sqlx::query("UPDATE webknossos.tasks SET isdeleted=true WHERE _id=$1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE webknossos.annotations SET isdeleted=true WHERE _task=$1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(ResponseJson(
        json!({"messages":[{"success":"task.deleteSuccess"}]}),
    ))
}
async fn experience_domains(
    State(state): State<AppState>,
    user: AuthUser,
) -> ApiResult<ResponseJson<Vec<String>>> {
    Ok(ResponseJson(
        sqlx::query_scalar(
            "SELECT domain FROM webknossos.experiencedomains WHERE _organization=$1",
        )
        .bind(&user.organization_id)
        .fetch_all(&state.pool)
        .await?,
    ))
}
async fn peek(State(state): State<AppState>, user: AuthUser) -> ApiResult<ResponseJson<Value>> {
    let manager = user.is_team_manager_or_admin(&state.pool).await?;
    let id:String=sqlx::query_scalar(r#"SELECT t._id FROM webknossos.tasks_ t
        JOIN webknossos.user_experiences e ON e.domain=t.neededexperience_domain AND e._user=$1 AND e.value>=t.neededexperience_value
        JOIN webknossos.projects_ p ON p._id=t._project
        JOIN webknossos.teams_ team ON team._id=p._team AND team._organization=$3
        WHERE p._organization=$3 AND t.pendinginstances>0 AND NOT p.paused AND p._team IN (SELECT _team FROM webknossos.user_team_roles WHERE _user=$1)
        AND NOT EXISTS (SELECT 1 FROM webknossos.annotations_ a WHERE a._task=t._id AND a._user=$1 AND a.typ='Task' AND NOT ($2 AND a.state='Cancelled'))
        ORDER BY p.priority DESC LIMIT 1"#).bind(&user.id).bind(manager).bind(&user.organization_id).fetch_optional(&state.pool).await?.ok_or_else(||ApiError::bad_request("task.unavailable"))?;
    let mut connection = state.pool.acquire().await?;
    Ok(ResponseJson(
        public_json(&mut connection, &user, &id, true).await?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn update_requires_scala_task_parameters() {
        assert!(serde_json::from_value::<TaskParameters>(json!({"pendingInstances":2})).is_err());
        let body = json!({"pendingInstances":2,"taskTypeId":"000000000000000000000001","neededExperience":{"domain":"test","value":1},"projectName":"project","datasetId":"000000000000000000000002","editPosition":[1,2,3],"editRotation":[0,0,0]});
        assert!(serde_json::from_value::<TaskParameters>(body.clone()).is_ok());
        let mut invalid = body;
        invalid["editPosition"] = json!([1, 2]);
        assert!(serde_json::from_value::<TaskParameters>(invalid).is_err());
    }
}
