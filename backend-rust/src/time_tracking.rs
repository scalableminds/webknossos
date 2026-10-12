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
    id::{ObjectId, PathObjectId},
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

const NOT_ALLOWED: &str = "You are not authorized to view or edit this resource.";

fn user_not_found(id: &str) -> String {
    format!("User “{id}” could not be found or accessed.")
}

/// UserService.isTeamManagerOrAdminOf(requester, target) as SQL over
/// `users_ u`, with `$1` requester id, `$2` requester organization and `$3`
/// requester isAdmin. Team deletion removes memberships, so joining `teams_`
/// only adds organization scoping.
const MANAGEABLE: &str = r#"(($3 AND u._organization = $2) OR EXISTS(
    SELECT 1 FROM webknossos.user_team_roles target_role
    JOIN webknossos.teams_ team ON team._id = target_role._team AND team._organization = $2
    JOIN webknossos.user_team_roles manager_role ON manager_role._team = team._id
    WHERE target_role._user = u._id AND manager_role._user = $1 AND manager_role.isTeamManager))"#;

/// A user visible through UserDAO.readAccessQ (self or manageable), with the
/// facts UserService.isEditableBy / isTeamManagerOrAdminOf derive from it.
#[derive(sqlx::FromRow)]
struct TargetUser {
    id: String,
    manageable: bool,
    has_teams: bool,
}

impl TargetUser {
    fn is_editable(&self) -> bool {
        self.manageable || !self.has_teams
    }
}

async fn require_user(pool: &PgPool, requester: &AuthUser, id: &ObjectId) -> ApiResult<TargetUser> {
    sqlx::query_as::<_, TargetUser>(&format!(
        r#"SELECT u._id AS id, {MANAGEABLE} AS manageable,
             EXISTS(SELECT 1 FROM webknossos.user_team_roles r WHERE r._user = u._id) AS has_teams
           FROM webknossos.users_ u
           WHERE u._id = $4 AND u._organization = $2 AND (u._id = $1 OR {MANAGEABLE})"#
    ))
    .bind(&requester.id)
    .bind(&requester.organization_id)
    .bind(requester.is_admin)
    .bind(id.as_str())
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found(user_not_found(id.as_str())))
}

async fn logged_time(
    State(state): State<AppState>,
    requester: AuthUser,
    Path(id): Path<PathObjectId>,
) -> ApiResult<ResponseJson<Value>> {
    let user = require_user(&state.pool, &requester, &id).await?;
    if !user.is_editable() {
        return Err(ApiError::forbidden(NOT_ALLOWED));
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
                    || format!("The supplied resource id “{entry}” is not a valid ObjectId."),
                    str::to_owned,
                )))
            }
        })
        .collect()
}

fn instant(millis: i64) -> ApiResult<DateTime<Utc>> {
    DateTime::from_timestamp_millis(millis)
        .ok_or_else(|| ApiError::bad_request("Invalid query parameters."))
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
        return Err(ApiError::forbidden(NOT_ALLOWED));
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

// $1 user/users, $2 start, $3 end, $4 types, $5 states, $6 projects.
const SPAN_FILTER: &str = r#"ts.time > 0 AND ts.created >= $2 AND ts.created < $3
    AND (cardinality($6::text[]) = 0 OR p._id = ANY($6::text[]))
    AND a.typ::text = ANY($4::text[]) AND a.state::text = ANY($5::text[])"#;

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
    let sql = format!(
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
           WHERE ts._user = $1 AND {SPAN_FILTER}
           ORDER BY ts.created, ts._id"#
    );
    let rows: Vec<Value> = sqlx::query_scalar(&sql)
        .bind(&user.id)
        .bind(filters.start)
        .bind(filters.end)
        .bind(&filters.types)
        .bind(&filters.states)
        .bind(&filters.projects)
        .fetch_all(&state.pool)
        .await?;
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
    let sql = format!(
        r#"WITH timeSummedPerAnnotation AS (
             SELECT a._id AS _annotation, t._id AS _task, p.name AS projectName, SUM(ts.time) AS timeSummed
             FROM webknossos.timespans_ ts
             JOIN webknossos.annotations_ a ON ts._annotation = a._id
             LEFT JOIN webknossos.tasks_ t ON a._task = t._id
             LEFT JOIN webknossos.projects_ p ON t._project = p._id
             WHERE ts._user = $1 AND {SPAN_FILTER}
             GROUP BY a._id, t._id, p.name
           )
           SELECT jsonb_build_object('annotation', ti._annotation, 'task', ti._task,
             'projectName', ti.projectName, 'timeMillis', ti.timeSummed::bigint,
             'annotationLayerStats', jsonb_object_agg(al.tracingId, al.statistics))
           FROM timeSummedPerAnnotation ti
           JOIN webknossos.annotation_layers al ON al._annotation = ti._annotation
           GROUP BY ti._annotation, ti._task, ti.projectName, ti.timeSummed
           ORDER BY ti._annotation"#
    );
    let rows: Vec<Value> = sqlx::query_scalar(&sql)
        .bind(&user.id)
        .bind(filters.start)
        .bind(filters.end)
        .bind(&filters.types)
        .bind(&filters.states)
        .bind(&filters.projects)
        .fetch_all(&state.pool)
        .await?;
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
        return Err(ApiError::bad_request("No annotation types specified."));
    }
    if !types
        .iter()
        .all(|typ| typ == "Explorational" || typ == "Task")
    {
        return Err(ApiError::bad_request(
            "One of the selected annotation types is not supported for time tracking.",
        ));
    }
    let projects = parse_object_ids(query.project_ids.as_deref(), None)?;
    let (start, end) = (instant(query.start)?, instant(query.end)?);
    // UserDAO.findAll (or findAllByTeams: active members of the given teams)
    // plus findAdminsByOrg, all under UserDAO.listAccessQ.
    let users: Vec<String> = sqlx::query_scalar(&format!(
        r#"WITH listable AS (
             SELECT u._id, u.isAdmin, u.isDeactivated FROM webknossos.users_ u
             WHERE u._organization = $2 AND (u._id = $1 OR {MANAGEABLE})
               AND (NOT u.isUnlisted OR $4)
           )
           SELECT _id FROM listable WHERE cardinality($5::text[]) = 0
           UNION SELECT l._id FROM listable l JOIN webknossos.user_team_roles r ON r._user = l._id
             WHERE r._team = ANY($5::text[]) AND NOT l.isDeactivated
           UNION SELECT _id FROM listable WHERE isAdmin AND NOT isDeactivated"#
    ))
    .bind(&requester.id)
    .bind(&requester.organization_id)
    .bind(requester.is_admin)
    .bind(requester.is_superuser)
    .bind(&teams)
    .fetch_all(&state.pool)
    .await?;
    if users.is_empty() {
        return Ok(ResponseJson(json!([])));
    }
    let rows: Vec<Value> = sqlx::query_scalar(&format!(
        r#"SELECT jsonb_build_object(
             'user', jsonb_build_object('id', u._id, 'firstName', mu.firstName,
               'lastName', mu.lastName, 'email', mu.email),
             'timeMillis', SUM(ts.time)::bigint, 'annotationCount', COUNT(DISTINCT a._id))
           FROM webknossos.timespans_ ts
           JOIN webknossos.annotations_ a ON ts._annotation = a._id
           JOIN webknossos.users_ u ON ts._user = u._id
           JOIN webknossos.multiUsers_ mu ON u._multiUser = mu._id
           LEFT JOIN webknossos.tasks_ t ON a._task = t._id
           LEFT JOIN webknossos.projects_ p ON t._project = p._id
           WHERE u._id = ANY($1::text[]) AND {SPAN_FILTER}
           GROUP BY u._id, mu.firstName, mu.lastName, mu.email
           ORDER BY u._id"#
    ))
    .bind(&users)
    .bind(start)
    .bind(end)
    .bind(&types)
    .bind(&states)
    .bind(&projects)
    .fetch_all(&state.pool)
    .await?;
    Ok(ResponseJson(Value::Array(rows)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn comma_separated_lists_follow_scala_split() {
        assert!(split_comma_separated(None).is_empty());
        assert!(split_comma_separated(Some("")).is_empty());
        assert_eq!(split_comma_separated(Some("a,b,")), vec!["a", "b"]);
        assert_eq!(split_comma_separated(Some("a,,b")), vec!["a", "", "b"]);
        assert!(parse_enum_list("Task,Foo", &ANNOTATION_TYPES, "x").is_err());
        assert_eq!(
            parse_object_ids(Some("ABCDEFABCDEFABCDEFABCDEF"), None).unwrap(),
            vec!["abcdefabcdefabcdefabcdef"]
        );
        assert!(parse_object_ids(Some("xyz"), Some("Invalid team ids.")).is_err());
    }
}
