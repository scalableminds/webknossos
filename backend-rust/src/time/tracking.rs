//! TimeController: logged time per month and time-span reports.
mod time_tracking_dao;

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

/// A user visible through UserDAO.readAccessQ (self or manageable), with the
/// facts UserService.isEditableBy / isTeamManagerOrAdminOf derive from it.
#[derive(sqlx::FromRow)]
pub(super) struct TargetUser {
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
    time_tracking_dao::find_target_user(pool, requester, id)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::user::not_found(id)))
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
    let spans =
        time_tracking_dao::find_all_created_and_time_for_user(&state.pool, &user.id).await?;
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
fn parse_object_ids(value: Option<&str>, message: Option<&str>) -> ApiResult<Vec<ObjectId>> {
    split_comma_separated(value)
        .into_iter()
        .map(|entry| {
            ObjectId::parse(entry).map_err(|_| {
                ApiError::bad_request(
                    message.map_or_else(|| crate::msg::object_id::invalid(entry), str::to_owned),
                )
            })
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

pub(super) struct Filters {
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    types: Vec<String>,
    states: Vec<String>,
    projects: Vec<ObjectId>,
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
    let rows =
        time_tracking_dao::find_all_span_json_for_user(&state.pool, &user.id, &filters).await?;
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
    let rows = time_tracking_dao::find_all_summed_by_annotation_json_for_user(
        &state.pool,
        &user.id,
        &filters,
    )
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
    let users =
        time_tracking_dao::find_all_listable_user_ids(&state.pool, &requester, &teams).await?;
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
    let rows = time_tracking_dao::find_all_overview_json(&state.pool, &users, &filters).await?;
    Ok(ResponseJson(Value::Array(rows)))
}

#[cfg(test)]
mod time_tracking_tests;
