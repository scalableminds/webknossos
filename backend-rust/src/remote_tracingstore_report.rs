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
//! Token resolution reuses `auth::user_for_service_token` (any token type,
//! deactivated users rejected, as the other service callbacks).
use axum::{Extension, Router, extract::State, http::StatusCode, routing::post};
use serde::{Deserialize, Deserializer};
use serde_json::{Map, Value, json};
use sqlx::{Acquire, PgPool};

use crate::{
    AppState,
    annotation_provider::AccessContext,
    application_info::MiscState,
    auth::{self, AuthUser},
    config::TimeTrackingConfig,
    error::{ApiError, ApiResult},
    extract::{Json, Query},
    id::ObjectId,
    remote_tracingstore_reads::{CallbackError, validate_key},
    time_interaction_writer::{RESOURCE_NOT_FOUND, TimeInteractionWriter},
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
            .ok_or_else(|| serde::de::Error::custom("Invalid timestamp."))
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
    Extension(writer): Extension<TimeInteractionWriter>,
    Extension(time_tracking): Extension<TimeTrackingConfig>,
    Extension(misc): Extension<MiscState>,
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
    let user_id = ObjectId::parse(&user.id)?;
    if should_track_time(
        report.significant_changes_count,
        time_tracking.only_with_significant_changes,
    ) {
        writer
            .log_user_interaction(
                pool,
                AccessContext::global(None),
                &user_id,
                &report.annotation_id,
                &report.timestamps,
            )
            .await?;
    }
    if user.id != owner {
        sqlx::query("INSERT INTO webknossos.annotation_contributors(_annotation,_user) VALUES($1,$2) ON CONFLICT DO NOTHING")
            .bind(report.annotation_id.as_str())
            .bind(&user.id)
            .execute(pool)
            .await
            .map_err(ApiError::from)?;
    }
    after_user_resolved(&state, &misc, &user, &report).await;
    Ok(StatusCode::OK)
}

/// Steps 3–5 in one transaction. Returns the annotation owner (`_user`).
async fn touch_annotation(pool: &PgPool, report: &AnnotationUpdatesReport) -> ApiResult<String> {
    let id = report.annotation_id.as_str();
    let mut transaction = pool.begin().await?;
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT _user, state::text FROM webknossos.annotations WHERE _id=$1 AND NOT isDeleted FOR NO KEY UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut *transaction)
    .await?;
    let (owner, annotation_state) = row.ok_or_else(|| ApiError::not_found(RESOURCE_NOT_FOUND))?;
    if annotation_state == "Finished" {
        return Err(ApiError::bad_request(ANNOTATION_FINISHED));
    }
    sqlx::query("UPDATE webknossos.annotations SET modified=NOW() WHERE _id=$1")
        .bind(id)
        .execute(&mut *transaction)
        .await?;
    for (tracing_id, statistics) in report.statistics.iter().flatten() {
        // AnnotationService.updateStatistics: fail silently per layer.
        let mut savepoint = transaction.begin().await?;
        let result = sqlx::query(
            "UPDATE webknossos.annotation_layers SET statistics=$3 WHERE _annotation=$1 AND tracingId=$2",
        )
        .bind(id)
        .bind(tracing_id)
        .bind(statistics)
        .execute(&mut *savepoint)
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
    if let Err(error) = sqlx::query("UPDATE webknossos.users SET lastActivity=NOW() WHERE _id=$1")
        .bind(&user.id)
        .execute(&state.pool)
        .await
    {
        tracing::warn!(%error, "Updating user last activity failed");
    }
    for (event_type, count) in [
        ("update_annotation", report.significant_changes_count),
        ("update_annotation_view_only", report.view_changes_count),
    ] {
        if count > 0 {
            let mut properties = Map::new();
            properties.insert("annotation_id".into(), json!(report.annotation_id.as_str()));
            properties.insert("changes_count".into(), json!(count));
            crate::analytics::track(state, misc, user, event_type.into(), properties);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn time_tracking_gate_matches_scala() {
        assert!(should_track_time(1, true));
        assert!(should_track_time(0, false));
        assert!(should_track_time(3, false));
        assert!(!should_track_time(0, true));
        assert!(!should_track_time(-1, true));
    }

    #[test]
    fn report_json_accepts_scala_instant_forms_and_optional_fields() {
        let report: AnnotationUpdatesReport = serde_json::from_value(json!({
            "annotationId": "0123456789abcdef01234567",
            "timestamps": [1, "2", "1970-01-01T00:00:00.003Z"],
            "significantChangesCount": 0,
            "viewChangesCount": 2
        }))
        .unwrap();
        assert_eq!(report.timestamps, vec![1, 2, 3]);
        assert!(report.statistics.is_none() && report.user_token.is_none());
        assert!(
            serde_json::from_value::<AnnotationUpdatesReport>(json!({
                "annotationId": "0123456789abcdef01234567",
                "timestamps": [true],
                "significantChangesCount": 0,
                "viewChangesCount": 0
            }))
            .is_err()
        );
    }
}
