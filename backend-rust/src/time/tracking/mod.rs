//! TimeController: logged time per month and time-span reports.
use axum::{Json as ResponseJson, Router, extract::State, routing::get};
use chrono::{DateTime, Datelike, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgPool;
use std::collections::BTreeMap;

use crate::{
    AppState,
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::{Path, Query},
    sql::{PushArg, Requester, Sql},
    util::id::{ObjectId, PathObjectId},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/users/{id}/loggedTime", get(logged_time))
        .route("/time/user/{id}/spans", get(spans))
        .route(
            "/time/user/{id}/summedByAnnotation",
            get(summed_by_annotation),
        )
        .route("/time/overview", get(overview))
}

/// UserService.isTeamManagerOrAdminOf(requester, target) as SQL over
/// `users_ u`. Team deletion removes memberships, so joining `teams_` only
/// adds organization scoping.
fn push_manageable<'a>(q: &mut Sql<'a>, requester: Requester<'a>) {
    q.push("((")
        .push_bind(requester.is_admin)
        .push(" AND u._organization = ")
        .push_arg(requester.organization)
        .push(
            ") OR EXISTS(
    SELECT 1 FROM webknossos.user_team_roles target_role
    JOIN webknossos.teams_ team ON team._id = target_role._team AND team._organization = ",
        )
        .push_arg(requester.organization)
        .push(
            "
    JOIN webknossos.user_team_roles manager_role ON manager_role._team = team._id
    WHERE target_role._user = u._id AND manager_role._user = ",
        )
        .push_arg(requester.id)
        .push(" AND manager_role.isTeamManager))");
}

/// A user visible through UserDAO.readAccessQ (self or manageable), with the
/// facts UserService.isEditableBy / isTeamManagerOrAdminOf derive from it.
#[derive(sqlx::FromRow)]
struct TargetUser {
    id: ObjectId,
    manageable: bool,
    has_teams: bool,
}

impl TargetUser {
    fn is_editable(&self) -> bool {
        self.manageable || !self.has_teams
    }
}

async fn require_user(pool: &PgPool, requester: &AuthUser, id: &ObjectId) -> ApiResult<TargetUser> {
    let mut q = Sql::new("SELECT u._id AS id, ");
    push_manageable(&mut q, requester.into());
    q.push(
        " AS manageable,
             EXISTS(SELECT 1 FROM webknossos.user_team_roles r WHERE r._user = u._id) AS has_teams
           FROM webknossos.users_ u
           WHERE u._id = ",
    )
    .push_bind(id.as_str())
    .push(" AND u._organization = ")
    .push_bind(requester.organization_id.as_str())
    .push(" AND (u._id = ")
    .push_bind(&requester.id)
    .push(" OR ");
    push_manageable(&mut q, requester.into());
    q.push(")");
    q.build_query_as::<TargetUser>()
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::user::not_found(id.as_str())))
}

async fn logged_time(
    State(state): State<AppState>,
    requester: AuthUser,
    Path(id): Path<PathObjectId>,
) -> ApiResult<ResponseJson<Value>> {
    let user = require_user(&state.pool, &requester, &id).await?;
    if !user.is_editable() {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    let spans: Vec<(DateTime<Utc>, i64)> =
        sqlx::query_as("SELECT created, time FROM webknossos.timespans_ WHERE _user = $1")
            .bind(&user.id)
            .fetch_all(&state.pool)
            .await?;
    // TimeSpan.groupByMonth (UTC), summed as a Duration and truncated to seconds.
    let mut months: BTreeMap<(i32, u32), i128> = BTreeMap::new();
    for (created, time) in spans {
        *months.entry((created.year(), created.month())).or_default() += i128::from(time);
    }
    let logged: Vec<Value> = months
        .into_iter()
        .map(|((year, month), millis)| {
            json!({
                "paymentInterval": {"month": month, "year": year},
                "durationInSeconds": (millis / 1000) as i64,
            })
        })
        .collect();
    Ok(ResponseJson(json!({ "loggedTime": logged })))
}

const ANNOTATION_TYPES: [&str; 8] = [
    "Task",
    "View",
    "Explorational",
    "TracingBase",
    "Orphan",
    "CompoundTask",
    "CompoundProject",
    "CompoundTaskType",
];
const ANNOTATION_STATES: [&str; 4] = ["Cancelled", "Active", "Finished", "Initializing"];

/// TextUtils.parseCommaSeparated: empty string means no entries; Java's
/// String.split drops trailing empty entries but keeps inner ones.
fn split_comma_separated(value: Option<&str>) -> Vec<&str> {
    let Some(value) = value.filter(|v| !v.is_empty()) else {
        return Vec::new();
    };
    let mut parts: Vec<&str> = value.split(',').collect();
    while parts.last() == Some(&"") {
        parts.pop();
    }
    parts
}

fn parse_enum_list(value: &str, allowed: &[&str], message: &str) -> ApiResult<Vec<String>> {
    split_comma_separated(Some(value))
        .into_iter()
        .map(|entry| {
            allowed
                .contains(&entry)
                .then(|| entry.to_owned())
                .ok_or_else(|| ApiError::bad_request(message))
        })
        .collect()
}

/// ObjectId.fromCommaSeparated (accepts upper-case hex, normalizes to lower).
fn parse_object_ids(value: Option<&str>, message: Option<&str>) -> ApiResult<Vec<String>> {
    split_comma_separated(value)
        .into_iter()
        .map(|entry| {
            if entry.len() == 24 && entry.bytes().all(|b| b.is_ascii_hexdigit()) {
                Ok(entry.to_ascii_lowercase())
            } else {
                Err(ApiError::bad_request(message.map_or_else(
                    || crate::msg::object_id::invalid(entry),
                    str::to_owned,
                )))
            }
        })
        .collect()
}

fn instant(millis: i64) -> ApiResult<DateTime<Utc>> {
    DateTime::from_timestamp_millis(millis)
        .ok_or_else(|| ApiError::bad_request(crate::msg::request::INVALID_QUERY))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UserTimeQuery {
    start: i64,
    end: i64,
    annotation_types: String,
    annotation_states: String,
    project_ids: Option<String>,
}

struct Filters {
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    types: Vec<String>,
    states: Vec<String>,
    projects: Vec<String>,
}

async fn user_time_filters(
    pool: &PgPool,
    requester: &AuthUser,
    id: &ObjectId,
    query: UserTimeQuery,
) -> ApiResult<(TargetUser, Filters)> {
    let projects = parse_object_ids(query.project_ids.as_deref(), None)?;
    let types = parse_enum_list(
        &query.annotation_types,
        &ANNOTATION_TYPES,
        "Invalid annotation type.",
    )?;
    let states = parse_enum_list(
        &query.annotation_states,
        &ANNOTATION_STATES,
        "Invalid annotation state.",
    )?;
    let user = require_user(pool, requester, id).await?;
    if !(user.manageable || user.id == requester.id) {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    Ok((
        user,
        Filters {
            start: instant(query.start)?,
            end: instant(query.end)?,
            types,
            states,
            projects,
        },
    ))
}

/// Time spans (alias `ts`, annotation `a`, project `p`) within the filters'
/// period, annotation types and states, and projects (all if empty).
fn push_span_filter<'a>(q: &mut Sql<'a>, filters: &'a Filters) {
    q.push("ts.time > 0 AND ts.created >= ")
        .push_bind(filters.start)
        .push(" AND ts.created < ")
        .push_bind(filters.end);
    if !filters.projects.is_empty() {
        q.push(" AND p._id = ANY(")
            .push_bind(&filters.projects)
            .push("::text[])");
    }
    q.push(" AND a.typ::text = ANY(")
        .push_bind(&filters.types)
        .push("::text[]) AND a.state::text = ANY(")
        .push_bind(&filters.states)
        .push("::text[])");
}

async fn spans(
    State(state): State<AppState>,
    requester: AuthUser,
    Path(id): Path<PathObjectId>,
    Query(query): Query<UserTimeQuery>,
) -> ApiResult<ResponseJson<Value>> {
    let (user, filters) = user_time_filters(&state.pool, &requester, &id, query).await?;
    if filters.types.is_empty() {
        return Ok(ResponseJson(json!([])));
    }
    let mut q = Sql::new(
        r#"SELECT jsonb_build_object(
             'userId', ts._user, 'userEmail', mu.email, 'datasetOrganization', o._id,
             'datasetName', d.name, 'annotationId', a._id, 'annotationState', a.state,
             'taskId', t._id, 'projectName', p.name, 'taskTypeId', tt._id,
             'taskTypeSummary', tt.summary, 'timeSpanId', ts._id,
             'timeSpanCreated', floor(extract(epoch FROM ts.created) * 1000)::bigint,
             'timeSpanTimeMillis', ts.time)
           FROM webknossos.timespans_ ts
           JOIN webknossos.annotations_ a ON ts._annotation = a._id
           JOIN webknossos.users_ u ON ts._user = u._id
           JOIN webknossos.multiUsers_ mu ON u._multiUser = mu._id
           JOIN webknossos.datasets_ d ON a._dataset = d._id
           JOIN webknossos.organizations_ o ON d._organization = o._id
           LEFT JOIN webknossos.tasks_ t ON a._task = t._id
           LEFT JOIN webknossos.projects_ p ON t._project = p._id
           LEFT JOIN webknossos.taskTypes_ tt ON t._taskType = tt._id
           WHERE ts._user = "#,
    );
    q.push_bind(&user.id).push(" AND ");
    push_span_filter(&mut q, &filters);
    q.push(" ORDER BY ts.created, ts._id");
    let rows: Vec<Value> = q.build_query_scalar().fetch_all(&state.pool).await?;
    Ok(ResponseJson(Value::Array(rows)))
}

async fn summed_by_annotation(
    State(state): State<AppState>,
    requester: AuthUser,
    Path(id): Path<PathObjectId>,
    Query(query): Query<UserTimeQuery>,
) -> ApiResult<ResponseJson<Value>> {
    let (user, filters) = user_time_filters(&state.pool, &requester, &id, query).await?;
    if filters.types.is_empty() {
        return Ok(ResponseJson(json!([])));
    }
    let mut q = Sql::new(
        "WITH timeSummedPerAnnotation AS (
             SELECT a._id AS _annotation, t._id AS _task, p.name AS projectName, SUM(ts.time) AS timeSummed
             FROM webknossos.timespans_ ts
             JOIN webknossos.annotations_ a ON ts._annotation = a._id
             LEFT JOIN webknossos.tasks_ t ON a._task = t._id
             LEFT JOIN webknossos.projects_ p ON t._project = p._id
             WHERE ts._user = ",
    );
    q.push_bind(&user.id).push(" AND ");
    push_span_filter(&mut q, &filters);
    q.push(
        r#" GROUP BY a._id, t._id, p.name
           )
           SELECT jsonb_build_object('annotation', ti._annotation, 'task', ti._task,
             'projectName', ti.projectName, 'timeMillis', ti.timeSummed::bigint,
             'annotationLayerStats', jsonb_object_agg(al.tracingId, al.statistics))
           FROM timeSummedPerAnnotation ti
           JOIN webknossos.annotation_layers al ON al._annotation = ti._annotation
           GROUP BY ti._annotation, ti._task, ti.projectName, ti.timeSummed
           ORDER BY ti._annotation"#,
    );
    let rows: Vec<Value> = q.build_query_scalar().fetch_all(&state.pool).await?;
    Ok(ResponseJson(Value::Array(rows)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OverviewQuery {
    start: i64,
    end: i64,
    annotation_types: String,
    annotation_states: String,
    team_ids: Option<String>,
    project_ids: Option<String>,
}

async fn overview(
    State(state): State<AppState>,
    requester: AuthUser,
    Query(query): Query<OverviewQuery>,
) -> ApiResult<ResponseJson<Value>> {
    let teams = parse_object_ids(query.team_ids.as_deref(), Some("Invalid team ids."))?;
    let types = parse_enum_list(
        &query.annotation_types,
        &ANNOTATION_TYPES,
        "Invalid annotation type.",
    )?;
    let states = parse_enum_list(
        &query.annotation_states,
        &ANNOTATION_STATES,
        "Invalid annotation state.",
    )?;
    if types.is_empty() {
        return Err(ApiError::bad_request(crate::msg::annotation::TYPES_EMPTY));
    }
    if !types
        .iter()
        .all(|typ| typ == "Explorational" || typ == "Task")
    {
        return Err(ApiError::bad_request(
            crate::msg::time_tracking::UNSUPPORTED_ANNOTATION_TYPE,
        ));
    }
    let projects = parse_object_ids(query.project_ids.as_deref(), None)?;
    let (start, end) = (instant(query.start)?, instant(query.end)?);
    // UserDAO.findAll (or findAllByTeams: active members of the given teams)
    // plus findAdminsByOrg, all under UserDAO.listAccessQ.
    let mut q = Sql::new(
        "WITH listable AS (
             SELECT u._id, u.isAdmin, u.isDeactivated FROM webknossos.users_ u
             WHERE u._organization = ",
    );
    q.push_bind(requester.organization_id.as_str())
        .push(" AND (u._id = ")
        .push_bind(&requester.id)
        .push(" OR ");
    push_manageable(&mut q, (&requester).into());
    q.push(") AND (NOT u.isUnlisted OR ")
        .push_bind(requester.is_superuser)
        .push("))");
    // All listable users, or the active members of the given teams.
    if teams.is_empty() {
        q.push(" SELECT _id FROM listable");
    } else {
        q.push(
            " SELECT l._id FROM listable l JOIN webknossos.user_team_roles r ON r._user = l._id
             WHERE r._team = ANY(",
        )
        .push_bind(&teams)
        .push("::text[]) AND NOT l.isDeactivated");
    }
    q.push(" UNION SELECT _id FROM listable WHERE isAdmin AND NOT isDeactivated");
    let users: Vec<ObjectId> = q.build_query_scalar().fetch_all(&state.pool).await?;
    if users.is_empty() {
        return Ok(ResponseJson(json!([])));
    }
    let filters = Filters {
        start,
        end,
        types,
        states,
        projects,
    };
    let mut q = Sql::new(
        "SELECT jsonb_build_object(
             'user', jsonb_build_object('id', u._id, 'firstName', mu.firstName,
               'lastName', mu.lastName, 'email', mu.email),
             'timeMillis', SUM(ts.time)::bigint, 'annotationCount', COUNT(DISTINCT a._id))
           FROM webknossos.timespans_ ts
           JOIN webknossos.annotations_ a ON ts._annotation = a._id
           JOIN webknossos.users_ u ON ts._user = u._id
           JOIN webknossos.multiUsers_ mu ON u._multiUser = mu._id
           LEFT JOIN webknossos.tasks_ t ON a._task = t._id
           LEFT JOIN webknossos.projects_ p ON t._project = p._id
           WHERE u._id = ANY(",
    );
    q.push_bind(&users).push("::text[]) AND ");
    push_span_filter(&mut q, &filters);
    q.push(
        " GROUP BY u._id, mu.firstName, mu.lastName, mu.email
           ORDER BY u._id",
    );
    let rows: Vec<Value> = q.build_query_scalar().fetch_all(&state.pool).await?;
    Ok(ResponseJson(Value::Array(rows)))
}

#[cfg(test)]
mod tests;
