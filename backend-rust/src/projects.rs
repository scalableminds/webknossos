use axum::{
    Json as ResponseJson, Router,
    extract::State,
    http::StatusCode,
    routing::{get, patch, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, Transaction};

use crate::{
    AppState, annotation_access,
    auth::AuthUser,
    dataset_access,
    error::{ApiError, ApiResult},
    extract::{Json, Path, Query},
    id::ObjectId,
    users,
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
struct ProjectParameters {
    name: String,
    #[serde(deserialize_with = "crate::id::deserialize_string")]
    team: String,
    priority: i32,
    paused: Option<bool>,
    expected_time: Option<i64>,
    #[serde(deserialize_with = "crate::id::deserialize_string")]
    owner: String,
    is_blacklisted_from_report: bool,
}

fn validate_name(name: &str) -> ApiResult<()> {
    if name.chars().count() < 3 {
        return Err(ApiError::bad_request("project.nameTooShort"));
    }
    if !name
        .bytes()
        .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
    {
        return Err(ApiError::bad_request("project.nameInvalidChars"));
    }
    Ok(())
}

// Build the public contract in PostgreSQL so absent owners/teams remain null,
// matching the Scala service's optional compact owner and team name.
const PUBLIC_PROJECT: &str = r#"SELECT jsonb_build_object(
 'id',p._id,'name',p.name,'team',p._team,'teamName',(SELECT name FROM webknossos.teams_ WHERE _id=p._team),
 'owner',(SELECT jsonb_build_object('id',u._id,'email',m.email,'firstName',m.firstname,'lastName',m.lastname,
    'isAdmin',u.isadmin,'isDatasetManager',u.isdatasetmanager,'isActive',NOT u.isdeactivated,'isAnonymous',false,
    'teams',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t._id,'name',t.name,'isTeamManager',r.isteammanager))
        FROM webknossos.user_team_roles r JOIN webknossos.teams_ t ON t._id=r._team
        WHERE r._user=u._id AND t._organization=u._organization),'[]'::jsonb))
    FROM webknossos.users_ u JOIN webknossos.multiusers_ m ON m._id=u._multiuser
    WHERE u._id=p._owner AND u._organization=$2 AND (u._id=$1 OR $3 OR EXISTS (
      SELECT 1 FROM webknossos.user_team_roles owner_role
      JOIN webknossos.user_team_roles reader_role ON reader_role._team=owner_role._team
      JOIN webknossos.teams_ shared_team ON shared_team._id=owner_role._team
      WHERE owner_role._user=u._id AND reader_role._user=$1
        AND reader_role.isTeamManager AND shared_team._organization=$2
    ))),
 'priority',p.priority,'paused',p.paused,'expectedTime',p.expectedtime,
 'isBlacklistedFromReport',p.isblacklistedfromreport,'created',floor(extract(epoch FROM p.created)*1000)::bigint
) AS value FROM webknossos.projects_ p "#;
const ACCESS: &str = " p._organization=$2 AND (p._owner=$1 OR $3 OR EXISTS(SELECT 1 FROM webknossos.user_team_roles WHERE _user=$1 AND _team=p._team)) ";

async fn project_json<'e, E: sqlx::Executor<'e, Database = Postgres>>(
    executor: E,
    user: &AuthUser,
    id: &str,
) -> ApiResult<Value> {
    ObjectId::parse(id)?;
    let query = format!("{PUBLIC_PROJECT} WHERE {ACCESS} AND p._id=$4");
    sqlx::query_scalar(&query)
        .bind(&user.id)
        .bind(&user.organization_id)
        .bind(user.is_admin)
        .bind(id)
        .fetch_optional(executor)
        .await?
        .ok_or_else(|| ApiError::not_found("project.notFound"))
}

async fn projects(pool: &PgPool, user: &AuthUser, with_status: bool) -> ApiResult<Value> {
    let query = format!("{PUBLIC_PROJECT} WHERE {ACCESS} ORDER BY p.created");
    let mut values: Vec<Value> = sqlx::query_scalar(&query)
        .bind(&user.id)
        .bind(&user.organization_id)
        .bind(user.is_admin)
        .fetch_all(pool)
        .await?;
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
    let rows: Vec<(String,i64,i64)> = sqlx::query_as("SELECT _project,COALESCE(sum(pendinginstances),0)::bigint,COALESCE(sum(tracingtime),0)::bigint FROM webknossos.tasks_ WHERE _project=ANY($1) GROUP BY _project")
        .bind(ids).fetch_all(pool).await?;
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
    let (pending, time): (i64,i64) = sqlx::query_as("SELECT COALESCE(sum(pendinginstances),0)::bigint, COALESCE(sum(tracingtime),0)::bigint FROM webknossos.tasks_ WHERE _project=$1")
        .bind(project["id"].as_str().ok_or_else(ApiError::internal)?).fetch_one(executor).await?;
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
    let id = ObjectId::parse_path(&id)?.to_string();
    Ok(ResponseJson(project_json(&state.pool, &user, &id).await?))
}
async fn by_name(
    State(state): State<AppState>,
    user: AuthUser,
    Path(name): Path<String>,
) -> ApiResult<ResponseJson<Value>> {
    let query = format!("{PUBLIC_PROJECT} WHERE {ACCESS} AND p.name=$4");
    let value = sqlx::query_scalar(&query)
        .bind(&user.id)
        .bind(&user.organization_id)
        .bind(user.is_admin)
        .bind(name)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| ApiError::not_found("project.notFound"))?;
    Ok(ResponseJson(value))
}

async fn check_references(
    tx: &mut Transaction<'_, Postgres>,
    user: &AuthUser,
    parameters: &ProjectParameters,
) -> ApiResult<()> {
    ObjectId::parse(&parameters.team)?;
    ObjectId::parse(&parameters.owner)?;
    if !can_manage_team_in_tx(tx, user, &parameters.team).await? {
        return Err(ApiError::forbidden("notAllowed"));
    }
    let owner: Option<String> = sqlx::query_scalar(
        "SELECT _id FROM webknossos.users WHERE _id=$1 AND _organization=$2 AND NOT isDeleted FOR SHARE",
    )
    .bind(&parameters.owner)
    .bind(&user.organization_id)
    .fetch_optional(&mut **tx)
    .await?;
    if owner.is_none() {
        return Err(ApiError::bad_request("user.notFound"));
    }
    Ok(())
}

async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    Json(parameters): Json<ProjectParameters>,
) -> ApiResult<ResponseJson<Value>> {
    validate_name(&parameters.name)?;
    let id = ObjectId::new().to_string();
    let mut tx = state.pool.begin().await?;
    check_references(&mut tx, &user, &parameters).await?;
    // Projects have no database uniqueness constraint. Serialize contenders for
    // an organization/name to make the uniqueness check atomic.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!(
            "project:{}:{}",
            user.organization_id, parameters.name
        ))
        .execute(&mut *tx)
        .await?;
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM webknossos.projects_ WHERE name=$1 AND _organization=$2)",
    )
    .bind(&parameters.name)
    .bind(&user.organization_id)
    .fetch_one(&mut *tx)
    .await?;
    if exists {
        return Err(ApiError::conflict("project.nameTaken"));
    }
    sqlx::query("INSERT INTO webknossos.projects(_id,_organization,_team,_owner,name,priority,paused,expectedtime,isblacklistedfromreport) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)")
        .bind(&id).bind(&user.organization_id).bind(&parameters.team).bind(&parameters.owner).bind(&parameters.name)
        .bind(i64::from(parameters.priority)).bind(parameters.paused.unwrap_or(false)).bind(parameters.expected_time)
        .bind(parameters.is_blacklisted_from_report).execute(&mut *tx).await?;
    let response = project_json(&mut *tx, &user, &id).await?;
    tx.commit().await?;
    Ok(ResponseJson(response))
}

async fn managed_project(
    tx: &mut Transaction<'_, Postgres>,
    user: &AuthUser,
    id: &str,
) -> ApiResult<Value> {
    let project = project_json(&mut **tx, user, id).await?;
    if !can_manage_team_in_tx(
        tx,
        user,
        project["team"].as_str().ok_or_else(ApiError::internal)?,
    )
    .await?
    {
        return Err(ApiError::forbidden("notAllowed"));
    }
    Ok(project)
}

async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(parameters): Json<ProjectParameters>,
) -> ApiResult<ResponseJson<Value>> {
    let id = ObjectId::parse_path(&id)?.to_string();
    let mut tx = state.pool.begin().await?;
    lock_project(&mut tx, &id, &user.organization_id).await?;
    managed_project(&mut tx, &user, &id).await?;
    check_references(&mut tx, &user, &parameters).await?;
    // Project names and paused state are immutable through PUT in Scala.
    sqlx::query("UPDATE webknossos.projects SET _team=$2,_owner=$3,priority=$4,expectedtime=$5,isblacklistedfromreport=$6 WHERE _id=$1 AND NOT isdeleted")
        .bind(&id).bind(parameters.team).bind(parameters.owner).bind(i64::from(parameters.priority))
        .bind(parameters.expected_time).bind(parameters.is_blacklisted_from_report).execute(&mut *tx).await?;
    let response = project_json(&mut *tx, &user, &id).await?;
    tx.commit().await?;
    Ok(ResponseJson(response))
}

async fn set_paused(pool: &PgPool, user: &AuthUser, id: &str, paused: bool) -> ApiResult<Value> {
    ObjectId::parse(id)?;
    let mut tx = pool.begin().await?;
    lock_project(&mut tx, id, &user.organization_id).await?;
    managed_project(&mut tx, user, id).await?;
    sqlx::query("UPDATE webknossos.projects SET paused=$2 WHERE _id=$1 AND NOT isdeleted")
        .bind(id)
        .bind(paused)
        .execute(&mut *tx)
        .await?;
    let response = project_json(&mut *tx, user, id).await?;
    tx.commit().await?;
    Ok(response)
}
async fn pause(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<ResponseJson<Value>> {
    let id = ObjectId::parse_path(&id)?.to_string();
    Ok(ResponseJson(
        set_paused(&state.pool, &user, &id, true).await?,
    ))
}
async fn resume(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<ResponseJson<Value>> {
    let id = ObjectId::parse_path(&id)?.to_string();
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
    let id = ObjectId::parse_path(&id)?.to_string();
    let delta = parameters.delta.unwrap_or(1);
    if delta < 0 {
        return Err(ApiError::bad_request(
            "project.increaseTaskInstancesNegative",
        ));
    }
    let mut tx = state.pool.begin().await?;
    lock_project(&mut tx, &id, &user.organization_id).await?;
    let mut project = project_json(&mut *tx, &user, &id).await?;
    // Scala permits project readers to increase instances, but the task DAO
    // restricts affected tasks to team members and organization administrators.
    sqlx::query("UPDATE webknossos.tasks t SET totalinstances=totalinstances+$2 FROM webknossos.projects_ p WHERE t._project=p._id AND p._id=$1 AND NOT t.isdeleted AND ($3 OR EXISTS(SELECT 1 FROM webknossos.user_team_roles WHERE _user=$4 AND _team=p._team))")
        .bind(&id).bind(delta).bind(user.is_admin).bind(&user.id).execute(&mut *tx).await?;
    add_status(&mut *tx, &mut project).await?;
    tx.commit().await?;
    Ok(ResponseJson(project))
}

pub(crate) async fn delete_tasks(
    tx: &mut Transaction<'_, Postgres>,
    column: &str,
    id: &str,
) -> ApiResult<()> {
    // column is chosen only by these two internal call sites, never request input.
    if !matches!(column, "_project" | "_tasktype") {
        return Err(ApiError::internal());
    }
    let annotations = format!(
        "UPDATE webknossos.annotations SET isdeleted=true WHERE _task IN (SELECT _id FROM webknossos.tasks WHERE {column}=$1)"
    );
    sqlx::query(&annotations)
        .bind(id)
        .execute(&mut **tx)
        .await?;
    let tasks = format!("UPDATE webknossos.tasks SET isdeleted=true WHERE {column}=$1");
    sqlx::query(&tasks).bind(id).execute(&mut **tx).await?;
    Ok(())
}

async fn delete(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<ResponseJson<Value>> {
    let id = ObjectId::parse_path(&id)?.to_string();
    let mut tx = state.pool.begin().await?;
    lock_project(&mut tx, &id, &user.organization_id).await?;
    project_json(&mut *tx, &user, &id).await?;
    // Authorization uses the stored owner, independently of response privacy.
    let owner: String = sqlx::query_scalar("SELECT _owner FROM webknossos.projects WHERE _id=$1")
        .bind(&id)
        .fetch_one(&mut *tx)
        .await?;
    if !user.is_admin && owner != user.id {
        return Err(ApiError::forbidden("project.deleteNotAllowed"));
    }
    sqlx::query("UPDATE webknossos.projects SET isdeleted=true,name=name || '.deleted.at.' || floor(extract(epoch FROM clock_timestamp())*1000)::bigint::text WHERE _id=$1 AND NOT isdeleted")
        .bind(&id).execute(&mut *tx).await?;
    delete_tasks(&mut tx, "_project", &id).await?;
    tx.commit().await?;
    Ok(ResponseJson(
        json!({"messages":[{"success":"project.deleteSuccess"}]}),
    ))
}

async fn lock_project(
    tx: &mut Transaction<'_, Postgres>,
    id: &str,
    organization: &str,
) -> ApiResult<()> {
    sqlx::query_scalar::<_,String>("SELECT _id FROM webknossos.projects WHERE _id=$1 AND _organization=$2 AND NOT isdeleted FOR UPDATE")
        .bind(id).bind(organization).fetch_optional(&mut **tx).await?
        .ok_or_else(||ApiError::not_found("project.notFound"))?;
    Ok(())
}

pub(crate) async fn can_manage_team_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    user: &AuthUser,
    team: &str,
) -> ApiResult<bool> {
    // SHARE conflicts with soft deletion (KEY SHARE would not). Hold the live
    // referenced team until the project/task type mutation commits.
    let team: Option<String> = sqlx::query_scalar("SELECT t._id FROM webknossos.teams t WHERE t._id=$1 AND t._organization=$2 AND NOT t.isDeleted AND ($3 OR EXISTS(SELECT 1 FROM webknossos.user_team_roles WHERE _team=t._id AND _user=$4 AND isteammanager)) FOR SHARE OF t")
        .bind(team).bind(&user.organization_id).bind(user.is_admin).bind(&user.id).fetch_optional(&mut **tx).await?;
    Ok(team.is_some())
}

async fn for_task_type(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<ResponseJson<Value>> {
    let id = ObjectId::parse_path(&id)?.to_string();
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM webknossos.tasktypes_ t WHERE t._id=$1 AND t._organization=$2 AND ($3 OR EXISTS(SELECT 1 FROM webknossos.user_team_roles WHERE _user=$4 AND _team=t._team)))")
        .bind(&id).bind(&user.organization_id).bind(user.is_admin).bind(&user.id).fetch_one(&state.pool).await?;
    if !exists {
        return Err(ApiError::not_found("taskType.notFound"));
    }
    let query = format!(
        "{PUBLIC_PROJECT} WHERE {ACCESS} AND EXISTS(SELECT 1 FROM webknossos.tasks_ WHERE _project=p._id AND _tasktype=$4) ORDER BY p.created"
    );
    let mut values: Vec<Value> = sqlx::query_scalar(&query)
        .bind(&user.id)
        .bind(&user.organization_id)
        .bind(user.is_admin)
        .bind(id)
        .fetch_all(&state.pool)
        .await?;
    add_status_to_all(&state.pool, &mut values).await?;
    Ok(ResponseJson(Value::Array(values)))
}

async fn active_users(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<ResponseJson<Value>> {
    let id = ObjectId::parse_path(&id)?.to_string();
    project_json(&state.pool, &user, &id).await?;
    let values: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('email',m.email,'firstName',m.firstname,'lastName',m.lastname,'activeTasks',count(a._id)) FROM webknossos.annotations_ a JOIN webknossos.tasks_ t ON t._id=a._task JOIN webknossos.users_ u ON u._id=a._user JOIN webknossos.multiusers_ m ON m._id=u._multiuser WHERE t._project=$1 AND a.state='Active' AND a.typ='Task' GROUP BY m.email,m.firstname,m.lastname")
        .bind(id).fetch_all(&state.pool).await?;
    Ok(ResponseJson(Value::Array(values)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TransferParameters {
    user_id: ObjectId,
}

const ANNOTATION_NOT_FOUND: &str = "Annotation could not be found or accessed.";
const TRANSFEREE_NO_DATASET_ACCESS: &str =
    "Cannot transfer annotation to a user who has no access to the dataset.";

/// ProjectController.transferActiveTasks: hand every active task annotation of
/// the project to another user. Play transfers one annotation after another
/// without a transaction; here the transfer is all-or-nothing.
async fn transfer_active_tasks(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(parameters): Json<TransferParameters>,
) -> ApiResult<StatusCode> {
    let id = ObjectId::parse_path(&id)?.to_string();
    let new_user = parameters.user_id.as_str();
    let mut tx = state.pool.begin().await?;
    // ProjectDAO.findOne with the requester's read access.
    let team: String = sqlx::query_scalar(&format!(
        "SELECT p._team FROM webknossos.projects_ p WHERE {ACCESS} AND p._id=$4"
    ))
    .bind(&user.id)
    .bind(&user.organization_id)
    .bind(user.is_admin)
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| {
        ApiError::not_found(format!("Project “{id}” could not be found or accessed."))
    })?;
    if !can_manage_team_in_tx(&mut tx, &user, &team).await? {
        return Err(ApiError::forbidden(users::msg::NOT_ALLOWED));
    }
    // UserDAO.findOne with the requester's read access; Play answers 400 here.
    let transferee: Option<String> = sqlx::query_scalar(&format!(
        "SELECT usr._id FROM webknossos.users_ AS usr WHERE usr._id = $2 AND {} FOR SHARE OF usr",
        users::READ_ACCESS_PREDICATE
    ))
    .bind(&user.id)
    .bind(new_user)
    .fetch_optional(&mut *tx)
    .await?;
    if transferee.is_none() {
        return Err(ApiError::bad_request(users::msg::user_not_found(new_user)));
    }
    let annotations: Vec<String> = sqlx::query_scalar("SELECT a._id FROM webknossos.annotations_ a JOIN webknossos.tasks_ t ON a._task=t._id JOIN webknossos.projects_ p ON t._project=p._id JOIN webknossos.users_ u ON a._user=u._id WHERE p._id=$1 AND a.state='Active' AND a.typ='Task' ORDER BY a._id")
        .bind(&id).fetch_all(&mut *tx).await?;
    for annotation in annotations {
        // AnnotationService.transferAnnotationToUser, under the requester's context.
        let (dataset, mutable): (String, bool) = sqlx::query_as(&format!(
            "SELECT a._dataset, {} FROM webknossos.annotations a WHERE a._id=$4 AND NOT a.isDeleted AND {} FOR UPDATE OF a",
            annotation_access::MUTATE_PREDICATE,
            annotation_access::READ_PREDICATE
        ))
        .bind(&user.id)
        .bind(&user.organization_id)
        .bind(user.is_admin)
        .bind(&annotation)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| ApiError::bad_request(ANNOTATION_NOT_FOUND))?;
        let dataset_readable: bool = sqlx::query_scalar(&format!(
            "SELECT EXISTS (SELECT 1 FROM webknossos.datasets_ d WHERE d._id = $3 AND {})",
            dataset_access::READ_PREDICATE
        ))
        .bind(new_user)
        .bind(None::<&str>)
        .bind(&dataset)
        .fetch_one(&mut *tx)
        .await?;
        if !dataset_readable {
            return Err(ApiError::bad_request(TRANSFEREE_NO_DATASET_ACCESS));
        }
        if !mutable {
            return Err(ApiError::bad_request("No update access."));
        }
        sqlx::query("UPDATE webknossos.annotations SET _user=$2 WHERE _id=$1")
            .bind(&annotation)
            .bind(new_user)
            .execute(&mut *tx)
            .await?;
        // Play re-reads the transferred annotation with the requester's access.
        let readable: bool = sqlx::query_scalar(&format!(
            "SELECT EXISTS (SELECT 1 FROM webknossos.annotations_ a WHERE a._id=$4 AND {})",
            annotation_access::READ_PREDICATE
        ))
        .bind(&user.id)
        .bind(&user.organization_id)
        .bind(user.is_admin)
        .bind(&annotation)
        .fetch_one(&mut *tx)
        .await?;
        if !readable {
            return Err(ApiError::bad_request(ANNOTATION_NOT_FOUND));
        }
    }
    tx.commit().await?;
    Ok(StatusCode::OK)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn project_name_contract() {
        for name in ["", "ab", "a b", "äbc", "abc.def", "abc/def"] {
            assert!(validate_name(name).is_err(), "{name}");
        }
        for name in ["abc", "Project-1", "project_2"] {
            assert!(validate_name(name).is_ok(), "{name}");
        }
    }
}
