//! Database-backed annotation lists and AnnotationService public serialization.
mod dao;

pub(crate) use dao::push_list_grant;

use crate::{
    AppState,
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::{Path, Query},
    state::JobsEnabled,
    util::id::ObjectId,
};
use axum::{
    Json, Router,
    extract::State,
    http::{HeaderMap, HeaderValue},
    routing::get,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgConnection, PgPool};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/user/annotations", get(own_annotations))
        .route("/user/tasks", get(own_tasks))
        .route("/users/{id}/annotations", get(user_annotations))
        .route("/users/{id}/tasks", get(user_tasks))
        .route("/annotations/readable", get(readable))
        .route("/tasks/{id}/annotations", get(task_annotations))
}
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Filters {
    is_finished: Option<bool>,
    limit: Option<i32>,
    page_number: Option<i32>,
    include_total_count: Option<bool>,
    dataset_id: Option<ObjectId>,
}
impl Filters {
    fn pagination(&self) -> ApiResult<(i64, i64)> {
        let limit = i64::from(self.limit.unwrap_or(1000));
        let page = i64::from(self.page_number.unwrap_or(0));
        if limit < 0 || page < 0 {
            return Err(ApiError::bad_request(
                crate::msg::request::INVALID_PAGINATION,
            ));
        }
        Ok((limit, page * limit))
    }
}
fn headers(count: Option<i64>) -> ApiResult<HeaderMap> {
    let mut headers = HeaderMap::new();
    if let Some(count) = count {
        headers.insert(
            "X-Total-Count",
            HeaderValue::from_str(&count.to_string()).map_err(|_| ApiError::internal())?,
        );
    }
    Ok(headers)
}
async fn compact_list(
    connection: &mut PgConnection,
    user: &AuthUser,
    owner: Option<&ObjectId>,
    filters: &Filters,
    shared: bool,
) -> ApiResult<Value> {
    let (limit, offset) = filters.pagination()?;
    let values =
        dao::find_all_compact(connection, user, owner, filters, shared, limit, offset).await?;
    Ok(Value::Array(values))
}
/// Planning the list statements (permission predicates) takes 5-8 ms, several times their
/// execution, yet PostgreSQL's plan cache keeps choosing per-request custom plans because their
/// estimated cost is below the generic plan's. Their generic plans are good (the filters are
/// spelled out per combination), so force them for this read-only transaction.
const GENERIC_PLANS: &str = "BEGIN READ ONLY; SET LOCAL plan_cache_mode = force_generic_plan";
async fn compact_response(
    pool: &PgPool,
    user: &AuthUser,
    owner: Option<&ObjectId>,
    filters: &Filters,
    shared: bool,
    own_count: bool,
) -> ApiResult<(HeaderMap, Json<Value>)> {
    let mut transaction = pool.begin_with(GENERIC_PLANS).await?;
    let value = compact_list(&mut transaction, user, owner, filters, shared).await?;
    let total = if filters.include_total_count == Some(true) {
        Some(
            dao::count(
                &mut transaction,
                user,
                owner,
                "Explorational",
                filters,
                shared && !own_count,
            )
            .await?,
        )
    } else {
        None
    };
    transaction.commit().await?;
    Ok((headers(total)?, Json(value)))
}
async fn activity(pool: &PgPool, user: &AuthUser) -> ApiResult<()> {
    crate::users::dao::update_last_activity(pool, &user.id).await?;
    Ok(())
}
async fn own_annotations(
    State(state): State<AppState>,
    user: AuthUser,
    Query(filters): Query<Filters>,
) -> ApiResult<(HeaderMap, Json<Value>)> {
    let filters = Filters {
        dataset_id: None,
        ..filters
    };
    let result = compact_response(&state.pool, &user, Some(&user.id), &filters, true, true).await?;
    activity(&state.pool, &user).await?;
    Ok(result)
}
async fn readable(
    State(state): State<AppState>,
    user: AuthUser,
    Query(filters): Query<Filters>,
) -> ApiResult<(HeaderMap, Json<Value>)> {
    let result = compact_response(&state.pool, &user, None, &filters, true, false).await?;
    activity(&state.pool, &user).await?;
    Ok(result)
}
async fn assert_editable_user(pool: &PgPool, user: &AuthUser, id: &ObjectId) -> ApiResult<()> {
    let access = dao::find_user_access(pool, user, id).await?;
    match access {
        None => Err(ApiError::not_found(crate::msg::user::not_found(id))),
        Some((true, _)) | Some((_, true)) => Ok(()),
        _ => Err(ApiError::forbidden(crate::msg::NOT_ALLOWED)),
    }
}
async fn user_annotations(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Query(filters): Query<Filters>,
) -> ApiResult<(HeaderMap, Json<Value>)> {
    let id = ObjectId::parse_path(&id)?;
    assert_editable_user(&state.pool, &user, &id).await?;
    let filters = Filters {
        dataset_id: None,
        ..filters
    };
    compact_response(&state.pool, &user, Some(&id), &filters, false, true).await
}

/// AnnotationService.publicWrites is database-only; callers apply route-specific
/// annotation access first. This is not /info, which needs tracing-store version data.
pub(crate) async fn full_json(
    connection: &mut PgConnection,
    user: &AuthUser,
    id: &ObjectId,
    jobs_enabled: bool,
) -> ApiResult<Value> {
    full_json_for(connection, Some(user), id, jobs_enabled).await
}

/// AnnotationService.publicWrites takes an optional requester. Anonymous
/// responses have no user-specific view configuration or editing grants.
pub(crate) async fn full_json_for(
    connection: &mut PgConnection,
    user: Option<&AuthUser>,
    id: &ObjectId,
    jobs_enabled: bool,
) -> ApiResult<Value> {
    let metadata = crate::annotation::access::find(&mut *connection, user, id, true).await?;
    let viewer = user.map(|user| &user.id);
    let mut value: Value = dao::find_full_json(connection, viewer, id)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::annotation::DATASET_MISSING))?;
    if value["tracingStore"].is_null() {
        return Err(ApiError::not_found(crate::msg::tracing_store::MISSING));
    }
    let owner = if metadata.owner_id == ObjectId::dummy() {
        Value::Null
    } else {
        compact_user(connection, &metadata.owner_id).await?
    };
    value["owner"] = owner.clone();
    value["user"] = owner;
    let contributor_ids = dao::find_contributor_ids(connection, id).await?;
    let mut contributors = Vec::new();
    for id in contributor_ids {
        contributors.push(compact_user(connection, &id).await?);
    }
    value["contributors"] = Value::Array(contributors);
    let restrictions = crate::annotation::access::restrictions(&metadata, user);
    value["restrictions"] = restrictions.public_json();
    let datastore = dao::find_dataset_data_store(connection, &metadata.dataset_id).await?;
    value["dataStore"] = crate::dataset::routes::public_datastore_json_on_connection(
        connection,
        &datastore,
        jobs_enabled,
    )
    .await?;
    let task = if let Some(task) = &metadata.task_id {
        Some(crate::task::routes::public_json_for(connection, user, task, true).await?)
    } else {
        None
    };
    value["task"] = task.clone().unwrap_or(Value::Null);
    value["settings"] = if matches!(metadata.annotation_type.as_str(), "Task" | "TracingBase") {
        task.ok_or_else(|| ApiError::not_found(crate::msg::task::MISSING))?["type"]["settings"]
            .clone()
    } else {
        let skeleton = value["annotationLayers"]
            .as_array()
            .is_some_and(|layers| layers.iter().any(|layer| layer["typ"] == "Skeleton"));
        default_settings(skeleton)
    };
    Ok(value)
}

/// AnnotationSettings.defaultFor: flight mode only when a skeleton layer exists.
pub(crate) fn default_settings(skeleton: bool) -> Value {
    json!({"allowedModes":if skeleton{json!(["orthogonal","flight"])}else{json!(["orthogonal"])},"branchPointsAllowed":true,"somaClickingAllowed":true,"volumeInterpolationAllowed":true,"mergerMode":false,"magRestrictions":{}})
}
pub(crate) async fn compact_user(connection: &mut PgConnection, id: &ObjectId) -> ApiResult<Value> {
    dao::find_compact_user(connection, id)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::annotation::USER_MISSING))
}
async fn task_list(
    pool: &PgPool,
    user: &AuthUser,
    owner: &ObjectId,
    filters: &Filters,
    jobs_enabled: bool,
) -> ApiResult<(HeaderMap, Json<Value>)> {
    let filters = Filters {
        dataset_id: None,
        is_finished: filters.is_finished,
        limit: filters.limit,
        page_number: filters.page_number,
        include_total_count: filters.include_total_count,
    };
    let (limit, offset) = filters.pagination()?;
    let ids = dao::find_all_task_annotation_ids(pool, user, owner, &filters, limit, offset).await?;
    let total = if filters.include_total_count == Some(true) {
        Some(
            dao::count(
                &mut *pool.acquire().await?,
                user,
                Some(owner),
                "Task",
                &filters,
                false,
            )
            .await?,
        )
    } else {
        None
    };
    let mut connection = pool.acquire().await?;
    let mut values = Vec::new();
    for id in ids {
        values.push(full_json(&mut connection, user, &id, jobs_enabled).await?);
    }
    Ok((headers(total)?, Json(Value::Array(values))))
}
async fn own_tasks(
    State(state): State<AppState>,
    user: AuthUser,
    Query(filters): Query<Filters>,
    State(JobsEnabled(jobs)): State<JobsEnabled>,
) -> ApiResult<(HeaderMap, Json<Value>)> {
    let result = task_list(&state.pool, &user, &user.id, &filters, jobs).await?;
    activity(&state.pool, &user).await?;
    Ok(result)
}
async fn user_tasks(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Query(filters): Query<Filters>,
    State(JobsEnabled(jobs)): State<JobsEnabled>,
) -> ApiResult<(HeaderMap, Json<Value>)> {
    let id = ObjectId::parse_path(&id)?;
    assert_editable_user(&state.pool, &user, &id).await?;
    task_list(&state.pool, &user, &id, &filters, jobs).await
}
async fn task_annotations(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    State(JobsEnabled(jobs)): State<JobsEnabled>,
) -> ApiResult<Json<Value>> {
    let id = ObjectId::parse_path(&id)?;
    let team = dao::find_task_team(&state.pool, &user, &id)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::task::MISSING))?;
    if !user.can_manage_team(&state.pool, &team).await? {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    let ids = dao::find_all_annotation_ids_for_task(&state.pool, &user, &id).await?;
    let mut connection = state.pool.acquire().await?;
    let mut values = Vec::new();
    for id in ids {
        values.push(full_json(&mut connection, &user, &id, jobs).await?);
    }
    Ok(Json(Value::Array(values)))
}
