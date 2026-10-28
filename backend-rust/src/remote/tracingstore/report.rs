//! `POST /tracingstores/{name}/handleTracingUpdateReport?key=` —
//! WKRemoteTracingStoreController.handleTracingUpdateReport.
//!
//! Scala order (GlobalAccessContext throughout):
//! 1. `validateJson[AnnotationUpdatesReport]` body parser (before the key).
//! 2. TracingStoreService.validateAccess: shared live service-key check,
//!    plain-text 403 (`{name}` informational).
//! 3. `annotationDAO.findOne` on live `annotations_`: missing/soft-deleted is
//!    Fox.Empty -> 404 `Could not find or access the requested resource.`.
//! 4. `Finished` -> 400 `annotation already finished` (other states pass).
//! 5. `updateModified(now)`; per-tracing-id statistics updates are
//!    fire-and-forget in Scala (failures, e.g. non-object statistics or a
//!    layer not (yet) in postgres, are silent).
//! 6. `userForTokenOpt(userToken).shiftBox`: absent/unusable tokens simply
//!    skip the user-dependent steps; they never fail the request.
//! 7. With a user: `logUserInteraction(timestamps)` (no contributor gate) iff
//!    `significantChangesCount > 0 || !timeTrackingOnlyWithSignificantChanges`;
//!    then `addContributor` unless the user owns the annotation; then
//!    fire-and-forget `updateLastActivity`, `update_annotation` (significant
//!    count > 0) and `update_annotation_view_only` (view count > 0) analytics.
//!
//! Rust deviations: step 3–5 run in one transaction with the annotation row
//! locked, so a concurrent finish cannot interleave between the state check
//! and `modified`; each statistics update runs in its own savepoint so its
//! failure stays silent (as Scala) without aborting the transaction, and it is
//! awaited before the response. `updateLastActivity` is awaited and its
//! failure only logged. Database failures while resolving the token remain
//! 5xx (crate convention for service-auth infrastructure errors) instead of
//! being swallowed by `shiftBox`. Invalid JSON uses the crate's
//! `Invalid JSON request body.` 400 rather than Play's JsError document.
//! Token resolution reuses `auth::user_for_service_token` (all but reset-password tokens,
//! deactivated users rejected, as the other service callbacks).
mod remote_report_dao;

use axum::{Router, extract::State, http::StatusCode, routing::post};
use serde::{Deserialize, Deserializer};
use serde_json::{Map, Value, json};
use sqlx::{Acquire, PgPool};

use crate::{
    AppState,
    annotation::provider::AccessContext,
    auth::{self, AuthUser},
    config::TimeTrackingConfig,
    error::{ApiError, ApiResult},
    extract::{Json, Query},
    remote::tracingstore::reads::{CallbackError, validate_key},
    system::application_info::MiscState,
    time::interaction_writer::TimeInteractionWriter,
    util::id::ObjectId,
};

pub fn router() -> Router<AppState> {
    Router::new().route(
        "/tracingstores/{name}/handleTracingUpdateReport",
        post(handle_report),
    )
}

const ANNOTATION_FINISHED: &str = "annotation already finished";

#[derive(Deserialize)]
struct KeyQuery {
    key: String,
}

/// TSRemoteWebknossosClient.AnnotationUpdatesReport.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnnotationUpdatesReport {
    annotation_id: ObjectId,
    #[serde(deserialize_with = "instants")]
    timestamps: Vec<i64>,
    #[serde(default)]
    statistics: Option<Map<String, Value>>,
    significant_changes_count: i32,
    view_changes_count: i32,
    #[serde(default)]
    user_token: Option<String>,
}

/// Scala `Instant` reads: an epoch-millisecond number, or a string holding
/// epoch milliseconds or an ISO-8601 instant.
fn instants<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<i64>, D::Error> {
    Vec::<Value>::deserialize(deserializer)?
        .into_iter()
        .map(|value| {
            match value {
                Value::Number(number) => number.as_i64(),
                Value::String(text) => text.parse::<i64>().ok().or_else(|| {
                    chrono::DateTime::parse_from_rfc3339(&text)
                        .ok()
                        .map(|date| date.timestamp_millis())
                }),
                _ => None,
            }
            .ok_or_else(|| serde::de::Error::custom(crate::msg::request::INVALID_TIMESTAMP))
        })
        .collect()
}

/// `significantChangesCount > 0 || !timeTrackingOnlyWithSignificantChanges`.
pub fn should_track_time(
    significant_changes_count: i32,
    only_with_significant_changes: bool,
) -> bool {
    significant_changes_count > 0 || !only_with_significant_changes
}

async fn handle_report(
    State(state): State<AppState>,
    State(writer): State<TimeInteractionWriter>,
    State(time_tracking): State<TimeTrackingConfig>,
    State(misc): State<MiscState>,
    Query(query): Query<KeyQuery>,
    Json(report): Json<AnnotationUpdatesReport>,
) -> Result<StatusCode, CallbackError> {
    validate_key(&state.pool, &query.key).await?;
    let pool = &state.pool;
    let owner = touch_annotation(pool, &report).await?;
    let user = match &report.user_token {
        Some(token) => auth::user_for_service_token(pool, token).await?,
        None => None,
    };
    let Some(user) = user else {
        return Ok(StatusCode::OK);
    };
    if should_track_time(
        report.significant_changes_count,
        time_tracking.only_with_significant_changes,
    ) {
        writer
            .log_user_interaction(
                pool,
                AccessContext::global(None),
                &user.id,
                &report.annotation_id,
                &report.timestamps,
            )
            .await?;
    }
    if user.id != owner {
        remote_report_dao::insert_contributor(pool, &report.annotation_id, &user.id).await?;
    }
    after_user_resolved(&state, &misc, &user, &report).await;
    Ok(StatusCode::OK)
}

/// Steps 3–5 in one transaction. Returns the annotation owner (`_user`).
async fn touch_annotation(pool: &PgPool, report: &AnnotationUpdatesReport) -> ApiResult<ObjectId> {
    let id = &report.annotation_id;
    let mut transaction = pool.begin().await?;
    let row = remote_report_dao::find_owner_and_state_for_update(&mut transaction, id).await?;
    let (owner, annotation_state) =
        row.ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    if annotation_state == "Finished" {
        return Err(ApiError::bad_request(ANNOTATION_FINISHED));
    }
    remote_report_dao::update_modified(&mut transaction, id).await?;
    for (tracing_id, statistics) in report.statistics.iter().flatten() {
        // AnnotationService.updateStatistics: fail silently per layer.
        let mut savepoint = transaction.begin().await?;
        let result =
            remote_report_dao::update_layer_statistics(&mut savepoint, id, tracing_id, statistics)
                .await;
        match result {
            Ok(_) => savepoint.commit().await?,
            Err(error) => {
                tracing::debug!(%error, "Updating annotation layer statistics failed");
                savepoint.rollback().await?;
            }
        }
    }
    transaction.commit().await?;
    Ok(owner)
}

/// Scala's fire-and-forget tail: last activity and analytics events.
async fn after_user_resolved(
    state: &AppState,
    misc: &MiscState,
    user: &AuthUser,
    report: &AnnotationUpdatesReport,
) {
    if let Err(error) = crate::users::users_dao::update_last_activity(&state.pool, &user.id).await {
        tracing::warn!(%error, "Updating user last activity failed");
    }
    for (event_type, count) in [
        ("update_annotation", report.significant_changes_count),
        ("update_annotation_view_only", report.view_changes_count),
    ] {
        if count > 0 {
            let mut properties = Map::new();
            properties.insert("annotation_id".into(), json!(report.annotation_id));
            properties.insert("changes_count".into(), json!(count));
            crate::system::analytics::track(state, misc, user, event_type.into(), properties);
        }
    }
}

#[cfg(test)]
mod tests;
