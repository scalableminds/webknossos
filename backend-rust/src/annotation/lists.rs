//! Database-backed annotation lists and AnnotationService public serialization.
use crate::{
    AppState,
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::{Path, Query},
    util::id::ObjectId,
};
use axum::{
    Extension, Json, Router,
    extract::State,
    http::{HeaderMap, HeaderValue},
    routing::get,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgConnection, PgPool};

#[derive(Clone, Copy)]
struct JobsEnabled(bool);
pub fn router(jobs_enabled: bool) -> Router<AppState> {
    Router::new()
        .route("/user/annotations", get(own_annotations))
        .route("/user/tasks", get(own_tasks))
        .route("/users/{id}/annotations", get(user_annotations))
        .route("/users/{id}/tasks", get(user_tasks))
        .route("/annotations/readable", get(readable))
        .route("/tasks/{id}/annotations", get(task_annotations))
        .layer(Extension(JobsEnabled(jobs_enabled)))
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
// The optional filters are spelled into the statement text instead of `($n IS NULL OR ...)`:
// each combination is its own cached prepared statement, and its generic plan then estimates
// rows correctly (the catch-all form led to a 14x slower nested-loop plan for the list page).
fn state_filter(is_finished: Option<bool>) -> &'static str {
    match is_finished {
        None => "a.state<>'Cancelled'",
        Some(true) => "a.state='Finished'",
        Some(false) => "a.state='Active'",
    }
}
/// Owner ($4) and dataset ($6) filters; the parameters stay bound when unused.
fn optional_filters(owner: Option<&str>, filters: &Filters) -> String {
    let mut sql = format!(" AND {}", state_filter(filters.is_finished));
    if owner.is_some() {
        sql.push_str(" AND a._user=$4");
    }
    if filters.dataset_id.is_some() {
        sql.push_str(" AND a._dataset=$6");
    }
    sql
}
const LAYERS: &str = "SELECT jsonb_agg(jsonb_build_object('tracingId',layer.tracingId,'typ',layer.typ,'name',layer.name,'stats',layer.statistics) ORDER BY layer.tracingId) FROM webknossos.annotation_layers layer WHERE layer._annotation=a._id";
const COMPACT_USER: &str = r#"SELECT jsonb_build_object('id',u._id,'email',m.email,'firstName',m.firstName,'lastName',m.lastName,
    'isAdmin',u.isAdmin,'isDatasetManager',u.isDatasetManager,'isActive',NOT u.isDeactivated,'isAnonymous',false,
    'teams',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',team._id,'name',team.name,'isTeamManager',role.isTeamManager) ORDER BY team._id)
      FROM webknossos.user_team_roles role JOIN webknossos.teams_ team ON team._id=role._team WHERE role._user=u._id AND team._organization=u._organization),'[]'::jsonb))
    FROM webknossos.users_ u JOIN webknossos.multiUsers_ m ON m._id=u._multiUser WHERE u._id=$1"#;
fn list_grant(shared: bool) -> String {
    if !shared {
        return crate::annotation::access::READ_PREDICATE.to_owned();
    }
    let dataset_read = crate::dataset::access::READ_PREDICATE.replace("$2", "NULL::text");
    format!(
        "(a._user=$1 OR ({} AND EXISTS(SELECT 1 FROM webknossos.datasets_ d WHERE d._id=a._dataset AND {dataset_read})))",
        crate::annotation::access::OWNED_OR_SHARED_PREDICATE
    )
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
async fn count(
    connection: &mut PgConnection,
    user: &AuthUser,
    owner: Option<&str>,
    typ: &str,
    filters: &Filters,
    shared: bool,
) -> ApiResult<i64> {
    let grant = list_grant(shared);
    let optional = optional_filters(owner, filters);
    let query = format!(
        "SELECT count(*) FROM webknossos.annotations_ a WHERE {grant}{optional} AND a.typ::text=$7"
    );
    Ok(sqlx::query_scalar(&query)
        .bind(&user.id)
        .bind(&user.organization_id)
        .bind(user.is_admin)
        .bind(owner)
        .bind(filters.is_finished)
        .bind(filters.dataset_id.as_ref().map(ObjectId::as_str))
        .bind(typ)
        .fetch_one(connection)
        .await?)
}
async fn compact_list(
    connection: &mut PgConnection,
    user: &AuthUser,
    owner: Option<&str>,
    filters: &Filters,
    shared: bool,
) -> ApiResult<Value> {
    let (limit, offset) = filters.pagination()?;
    let grant = list_grant(shared);
    let optional = optional_filters(owner, filters);
    // Two steps: select the page of ids over narrow rows first, then build the JSON (layers,
    // tags, shared teams) only for that page instead of for every row up to the offset.
    let query = format!(
        r#"WITH page AS MATERIALIZED (SELECT a._id
        FROM webknossos.annotations_ a JOIN webknossos.users_ u ON u._id=a._user JOIN webknossos.multiUsers_ m ON m._id=u._multiUser
        JOIN webknossos.datasets_ d ON d._id=a._dataset JOIN webknossos.organizations_ organization ON organization._id=d._organization
        WHERE a.typ='Explorational' AND {grant}{optional}
        AND EXISTS(SELECT 1 FROM webknossos.annotation_layers layer WHERE layer._annotation=a._id)
        ORDER BY a._id DESC LIMIT $7 OFFSET $8)
        SELECT jsonb_build_object('modified',floor(extract(epoch FROM a.modified)*1000)::bigint,'created',floor(extract(epoch FROM a.created)*1000)::bigint,
        'state',a.state,'id',a._id,'name',a.name,'description',a.description,'typ',a.typ,'stats','{{}}'::jsonb,
        'isLockedByOwner',a.isLockedByOwner,'annotationLayers',({LAYERS}),'dataSetName',d.name,'datasetId',d._id,'organization',organization._id,
        'visibility',a.visibility,'tracingTime',COALESCE(a.tracingTime,0),'collaborationMode',a.collaborationMode,
        -- annotation.tags ++ Set(dataset.name): Scala's small immutable sets keep insertion order.
        'tags',ARRAY(SELECT tag FROM (SELECT DISTINCT ON (tag) tag,ord FROM unnest(a.tags||ARRAY[d.name]) WITH ORDINALITY t(tag,ord) ORDER BY tag,ord) first ORDER BY ord),
        'owner',jsonb_build_object('id',u._id,'firstName',m.firstName,'lastName',m.lastName),
        'teams',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',team._id,'name',team.name,'organizationId',team._organization) ORDER BY team._id)
            FROM webknossos.annotation_sharedTeams shared JOIN webknossos.teams_ team ON team._id=shared._team
            JOIN webknossos.organizations_ team_org ON team_org._id=team._organization WHERE shared._annotation=a._id),'[]'::jsonb))
        FROM page JOIN webknossos.annotations_ a ON a._id=page._id JOIN webknossos.users_ u ON u._id=a._user
        JOIN webknossos.multiUsers_ m ON m._id=u._multiUser JOIN webknossos.datasets_ d ON d._id=a._dataset
        JOIN webknossos.organizations_ organization ON organization._id=d._organization
        ORDER BY a._id DESC"#
    );
    // Run inside `GENERIC_PLANS` (see there).
    let values: Vec<Value> = sqlx::query_scalar(&query)
        .bind(&user.id)
        .bind(&user.organization_id)
        .bind(user.is_admin)
        .bind(owner)
        .bind(filters.is_finished)
        .bind(filters.dataset_id.as_ref().map(ObjectId::as_str))
        .bind(limit)
        .bind(offset)
        .fetch_all(connection)
        .await?;
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
    owner: Option<&str>,
    filters: &Filters,
    shared: bool,
    own_count: bool,
) -> ApiResult<(HeaderMap, Json<Value>)> {
    let mut transaction = pool.begin_with(GENERIC_PLANS).await?;
    let value = compact_list(&mut transaction, user, owner, filters, shared).await?;
    let total = if filters.include_total_count == Some(true) {
        Some(
            count(
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
    sqlx::query("UPDATE webknossos.users SET lastActivity=now() WHERE _id=$1 AND NOT isDeleted")
        .bind(&user.id)
        .execute(pool)
        .await?;
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
async fn assert_editable_user(pool: &PgPool, user: &AuthUser, id: &str) -> ApiResult<()> {
    ObjectId::parse(id)?;
    let access: Option<(bool, bool)> = sqlx::query_as(
        r#"SELECT ($3 OR EXISTS(SELECT 1 FROM webknossos.user_team_roles target_role
        JOIN webknossos.teams_ team ON team._id=target_role._team AND team._organization=$2
        JOIN webknossos.user_team_roles requester_role ON requester_role._team=team._id AND requester_role._user=$1 AND requester_role.isTeamManager
        WHERE target_role._user=target._id)) AS manager,
        NOT EXISTS(SELECT 1 FROM webknossos.user_team_roles role JOIN webknossos.teams_ team ON team._id=role._team WHERE role._user=target._id AND team._organization=target._organization) AS unteamed
        FROM webknossos.users_ target WHERE target._id=$4 AND target._organization=$2 AND (target._id=$1 OR $3 OR EXISTS(
          SELECT 1 FROM webknossos.user_team_roles target_role JOIN webknossos.teams_ team ON team._id=target_role._team AND team._organization=$2
          JOIN webknossos.user_team_roles requester_role ON requester_role._team=team._id AND requester_role._user=$1 AND requester_role.isTeamManager WHERE target_role._user=target._id))"#,
    )
    .bind(&user.id)
    .bind(&user.organization_id)
    .bind(user.is_admin)
    .bind(id)
    .fetch_optional(pool)
    .await?;
    match access {
        None => Err(ApiError::not_found(crate::msg::user::MISSING)),
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
    let id = ObjectId::parse_path(&id)?.to_string();
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
    id: &str,
    jobs_enabled: bool,
) -> ApiResult<Value> {
    full_json_for(connection, Some(user), id, jobs_enabled).await
}

/// AnnotationService.publicWrites takes an optional requester. Anonymous
/// responses have no user-specific view configuration or editing grants.
pub(crate) async fn full_json_for(
    connection: &mut PgConnection,
    user: Option<&AuthUser>,
    id: &str,
    jobs_enabled: bool,
) -> ApiResult<Value> {
    let metadata = crate::annotation::access::find(&mut *connection, user, id, true).await?;
    let query = format!(
        r#"SELECT jsonb_build_object('modified',floor(extract(epoch FROM a.modified)*1000)::bigint,'created',floor(extract(epoch FROM a.created)*1000)::bigint,
        'state',a.state,'isLockedByOwner',a.isLockedByOwner,'id',a._id,'name',a.name,'description',a.description,
        'viewConfiguration',CASE WHEN $2::text IS NULL THEN NULL ELSE (SELECT viewConfiguration FROM webknossos.user_annotationViewConfigurations config WHERE config._annotation=a._id AND config._user IN ($2,a._user) ORDER BY (config._user=$2) DESC LIMIT 1) END,
        'typ',a.typ,'stats','{{}}'::jsonb,'annotationLayers',COALESCE(({LAYERS}),'[]'::jsonb),'datasetId',d._id,'dataSetName',d.name,'organization',organization._id,
        'visibility',a.visibility,'tracingTime',a.tracingTime,'collaborationMode',a.collaborationMode,
        'tags',ARRAY(SELECT tag FROM (SELECT DISTINCT ON (tag) tag,ord FROM unnest(a.tags||ARRAY[d.name]) WITH ORDINALITY t(tag,ord) ORDER BY tag,ord) first ORDER BY ord),
        'teams',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',team._id,'name',team.name,'organization',team._organization,'isOrganizationTeam',team.isOrganizationTeam) ORDER BY team._id)
          FROM webknossos.annotation_sharedTeams shared JOIN webknossos.teams_ team ON team._id=shared._team JOIN webknossos.organizations_ team_org ON team_org._id=team._organization WHERE shared._annotation=a._id),'[]'::jsonb),
        'tracingStore',(SELECT jsonb_build_object('name',store.name,'url',store.publicUrl) FROM webknossos.tracingStores_ store LIMIT 1))
        FROM webknossos.annotations_ a JOIN webknossos.datasets_ d ON d._id=a._dataset JOIN webknossos.organizations_ organization ON organization._id=d._organization WHERE a._id=$1"#
    );
    let mut value: Value = sqlx::query_scalar(&query)
        .bind(id)
        .bind(user.map(|user| user.id.as_str()))
        .fetch_optional(&mut *connection)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::annotation::DATASET_MISSING))?;
    if value["tracingStore"].is_null() {
        return Err(ApiError::not_found(crate::msg::tracing_store::MISSING));
    }
    let owner = if metadata.owner_id == "000000000000000000000000" {
        Value::Null
    } else {
        compact_user(connection, &metadata.owner_id).await?
    };
    value["owner"] = owner.clone();
    value["user"] = owner;
    let contributor_ids: Vec<String> = sqlx::query_scalar(
        "SELECT u._id FROM webknossos.annotation_contributors contributor JOIN \
            webknossos.users_ u ON u._id=contributor._user WHERE contributor._annotation=$1 AND \
            NOT u.isUnlisted ORDER BY u._id",
    )
    .bind(id)
    .fetch_all(&mut *connection)
    .await?;
    let mut contributors = Vec::new();
    for id in contributor_ids {
        contributors.push(compact_user(connection, &id).await?);
    }
    value["contributors"] = Value::Array(contributors);
    let restrictions = crate::annotation::access::restrictions(&metadata, user);
    value["restrictions"] = restrictions.public_json();
    let datastore: String =
        sqlx::query_scalar("SELECT trim(_dataStore) FROM webknossos.datasets_ WHERE _id=$1")
            .bind(&metadata.dataset_id)
            .fetch_one(&mut *connection)
            .await?;
    value["dataStore"] = crate::dataset::routes::public_datastore_json_on_connection(
        connection,
        &datastore,
        jobs_enabled,
    )
    .await?;
    let task = if let Some(task) = metadata.task_id.as_deref() {
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
pub(crate) async fn compact_user(connection: &mut PgConnection, id: &str) -> ApiResult<Value> {
    sqlx::query_scalar(COMPACT_USER)
        .bind(id)
        .fetch_optional(connection)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::annotation::USER_MISSING))
}
async fn task_list(
    pool: &PgPool,
    user: &AuthUser,
    owner: &str,
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
    let query = format!(
        "SELECT a._id FROM webknossos.annotations_ a WHERE {} AND a._user=$4 AND {} AND a.typ='Task' ORDER BY a._id DESC LIMIT $6 OFFSET $7",
        crate::annotation::access::READ_PREDICATE,
        state_filter(filters.is_finished)
    );
    let ids: Vec<String> = sqlx::query_scalar(&query)
        .bind(&user.id)
        .bind(&user.organization_id)
        .bind(user.is_admin)
        .bind(owner)
        .bind(filters.is_finished)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await?;
    let total = if filters.include_total_count == Some(true) {
        Some(
            count(
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
    Extension(JobsEnabled(jobs)): Extension<JobsEnabled>,
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
    Extension(JobsEnabled(jobs)): Extension<JobsEnabled>,
) -> ApiResult<(HeaderMap, Json<Value>)> {
    let id = ObjectId::parse_path(&id)?.to_string();
    assert_editable_user(&state.pool, &user, &id).await?;
    task_list(&state.pool, &user, &id, &filters, jobs).await
}
async fn task_annotations(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Extension(JobsEnabled(jobs)): Extension<JobsEnabled>,
) -> ApiResult<Json<Value>> {
    let id = ObjectId::parse_path(&id)?.to_string();
    let team: String = sqlx::query_scalar(
        "SELECT p._team FROM webknossos.tasks_ task JOIN webknossos.projects_ p ON \
            p._id=task._project JOIN webknossos.teams_ team ON team._id=p._team AND \
            team._organization=$2 WHERE task._id=$4 AND p._organization=$2 AND ($3 OR \
            EXISTS(SELECT 1 FROM webknossos.user_team_roles role WHERE role._team=p._team AND \
            role._user=$1))",
    )
    .bind(&user.id)
    .bind(&user.organization_id)
    .bind(user.is_admin)
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::not_found(crate::msg::task::MISSING))?;
    if !user.can_manage_team(&state.pool, &team).await? {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    let query = format!(
        "SELECT a._id FROM webknossos.annotations_ a WHERE a._task=$4 AND a.typ='Task' AND a.state<>'Cancelled' AND {}",
        crate::annotation::access::READ_PREDICATE
    );
    let ids: Vec<String> = sqlx::query_scalar(&query)
        .bind(&user.id)
        .bind(&user.organization_id)
        .bind(user.is_admin)
        .bind(&id)
        .fetch_all(&state.pool)
        .await?;
    let mut connection = state.pool.acquire().await?;
    let mut values = Vec::new();
    for id in ids {
        values.push(full_json(&mut connection, &user, &id, jobs).await?);
    }
    Ok(Json(Value::Array(values)))
}
