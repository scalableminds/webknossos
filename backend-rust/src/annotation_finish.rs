//! AnnotationController.finish / finishAll (private finishAnnotation) and
//! AnnotationService.finish.
//!
//! Per annotation: provideAnnotation (`~> 404`), restrictionsFor (`~> 404`,
//! Msg.Annotation.Restrictions.notFound), AnnotationService.finish
//! (allowFinishSoft = (owner || task-team manager || owner-org admin) &&
//! !isLockedByOwner, failing closed on missing owner/task/project; Active ->
//! modified=now + Finished + clear the three task compound caches; Finished ->
//! silent success "Annotation is archived."; other states -> notActive), all
//! wrapped `?~> Msg.Annotation.finishFailed` (default 400). Then the provider
//! reload and, after commit, the contributor-gated time logging with the
//! client timestamp, crediting the ORIGINAL owner/collaboration mode.
//!
//! Deliberate improvements over Scala's sequential DAO calls: the state
//! check, update-access assertion, modified/state update and cache-key lookup
//! run in one transaction on the row-locked annotation (with the owner/task/
//! project grant rows locked), and the compound caches are cleared only after
//! commit. Time logging is the writer's own transaction (TW2), so a writer
//! failure leaves the annotation Finished, exactly as in Scala.
use axum::{
    Extension, Json, Router,
    extract::{FromRequestParts, State},
    http::{StatusCode, request::Parts},
    routing::patch,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{
    AppState, annotation_access, annotation_lifecycle, annotation_lists,
    annotation_provider::{
        AccessContext, AnnotationIdentifier, AnnotationProvider, ProvidedAnnotation, ProviderError,
        RESTRICTIONS_NOT_FOUND,
    },
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::{self, Path},
    id::ObjectId,
    time_interaction_writer::TimeInteractionWriter,
};

/// Msg.Annotation.finishFailed.
pub const FINISH_FAILED: &str = "Could not finish/archive the annotation.";
/// Msg.Annotation.finished (also the silent repeat-finish success).
pub const ANNOTATION_FINISHED: &str = "Annotation is archived.";
/// Msg.Task.finished (Active task annotation finished now).
pub const TASK_FINISHED: &str = "Task is finished.";
/// Msg.Annotation.allFinished.
pub const ALL_FINISHED: &str = "All selected annotations were finished/archived.";
/// Msg.Annotation.notActive (inner chain message; wrapped by FINISH_FAILED).
pub const NOT_ACTIVE: &str = "The annotation is not active and cannot be finished.";
/// Msg.Annotation.finishNotAllowed (inner chain message; wrapped by FINISH_FAILED).
pub const FINISH_NOT_ALLOWED: &str = "Could not access annotation to finish it.";

#[derive(Clone, Copy)]
struct JobsEnabled(bool);

pub fn router(jobs_enabled: bool) -> Router<AppState> {
    Router::new()
        .route("/annotations/{typ}/{id}/finish", patch(finish))
        .route("/annotations/{typ}/finish", patch(finish_all))
        .layer(Extension(JobsEnabled(jobs_enabled)))
}

/// Play's required `timestamp: Long` query binder (first value wins). Bound
/// during routing in Play, so it is extracted before authentication.
pub struct Timestamp(pub i64);

/// Parse Play's `QueryStringBindable[Long]` for `timestamp`.
pub fn parse_timestamp(query: Option<&str>) -> ApiResult<i64> {
    const KEY: &str = "timestamp";
    let pairs: Vec<(String, String)> = serde_urlencoded::from_str(query.unwrap_or(""))
        .map_err(|_| ApiError::bad_request("Invalid query parameters."))?;
    let value = pairs
        .into_iter()
        .find(|(key, _)| key == KEY)
        .map(|(_, value)| value)
        .ok_or_else(|| ApiError::bad_request(format!("Missing parameter: {KEY}")))?;
    // java.lang.Long.parseLong: optional sign, ASCII digits, no whitespace.
    let digits = value.strip_prefix(['+', '-']).unwrap_or(&value);
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return Err(long_parse_error(&value));
    }
    value.parse::<i64>().map_err(|_| long_parse_error(&value))
}

fn long_parse_error(value: &str) -> ApiError {
    ApiError::bad_request(format!(
        "Cannot parse parameter timestamp as Long: For input string: \"{value}\""
    ))
}

impl<S: Send + Sync> FromRequestParts<S> for Timestamp {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Self::Rejection> {
        parse_timestamp(parts.uri.query()).map(Self)
    }
}

/// FinishAllParameters(annotations: Seq[ObjectId]); IDs validated up front.
#[derive(Deserialize)]
struct FinishAllParameters {
    annotations: Vec<ObjectId>,
}

/// Where finishAnnotation failed; decides the Scala status/message for the
/// single route (outer `?~> finishFailed`) and finishAll (no outer wrap).
enum FinishFailure {
    /// provideAnnotation `~> NOT_FOUND`.
    Provide(ProviderError),
    /// restrictionsFor `?~> Restrictions.notFound ~> NOT_FOUND`.
    Restrictions(ProviderError),
    /// AnnotationService.finish `?~> finishFailed` (default 400).
    Finish(ApiError),
    /// Second provideAnnotation, no explicit status.
    Reload(ProviderError),
    /// TimeSpanService failure.
    TimeLog(ApiError),
}

fn passthrough(error: &ApiError) -> bool {
    error.status.is_server_error()
}

impl FinishFailure {
    /// finishAll: the inner Fox failure unchanged.
    fn into_inner(self) -> ApiError {
        match self {
            Self::Provide(error) => error.into_api_error(StatusCode::NOT_FOUND),
            Self::Restrictions(error) => error
                .wrap(RESTRICTIONS_NOT_FOUND)
                .into_api_error(StatusCode::NOT_FOUND),
            Self::Finish(error) | Self::TimeLog(error) => error,
            Self::Reload(error) => error.into(),
        }
    }

    /// finish: `finishAnnotation(..) ?~> finishFailed` replaces the message
    /// and keeps a ParamFailure status; plain failures/Empty become 400.
    fn into_wrapped(self) -> ApiError {
        let status = match &self {
            Self::Provide(_) | Self::Restrictions(_) => StatusCode::NOT_FOUND,
            Self::Reload(error) => match error {
                ProviderError::Failure(failure) => {
                    failure.status.unwrap_or(StatusCode::BAD_REQUEST)
                }
                _ => StatusCode::BAD_REQUEST,
            },
            Self::Finish(_) | Self::TimeLog(_) => StatusCode::BAD_REQUEST,
        };
        let inner = self.into_inner();
        if passthrough(&inner) {
            inner
        } else {
            ApiError::new(status, FINISH_FAILED)
        }
    }
}

fn finish_error(error: ApiError) -> FinishFailure {
    FinishFailure::Finish(if passthrough(&error) {
        error
    } else {
        ApiError::bad_request(FINISH_FAILED)
    })
}

fn infrastructure(error: ProviderError) -> Result<ProviderError, ApiError> {
    match error {
        ProviderError::Api(error) if passthrough(&error) => Err(error),
        other => Ok(other),
    }
}

/// Instant.now at millisecond precision.
fn now_millis() -> DateTime<Utc> {
    DateTime::from_timestamp_millis(Utc::now().timestamp_millis()).unwrap_or_else(Utc::now)
}

/// AnnotationService.finish on the live saved annotation. Returns the success
/// message and the cache keys to clear after commit.
async fn finish_saved(
    state: &AppState,
    provider: &AnnotationProvider,
    user: &AuthUser,
    id: &str,
) -> Result<&'static str, FinishFailure> {
    let mut transaction = state
        .pool
        .begin()
        .await
        .map_err(|e| FinishFailure::Finish(e.into()))?;
    // restrictionsFor: AnnotationDAO.findOne under the requester's access.
    let annotation = annotation_access::lock_readable(&mut transaction, user, id)
        .await
        .map_err(|e| {
            if passthrough(&e) {
                FinishFailure::Finish(e)
            } else {
                FinishFailure::Restrictions(ProviderError::NotFound)
            }
        })?
        .ok_or(FinishFailure::Restrictions(ProviderError::NotFound))?;
    // allowFinishSoft: owner lookup and task/project grant failures yield
    // false (`orElse(false)`), also for the owner and administrators.
    let manager = match annotation_lifecycle::is_manager_or_admin(
        &mut transaction,
        user,
        &annotation.owner_id,
        annotation.task_id.as_deref(),
    )
    .await
    {
        Ok(manager) => Some(manager),
        Err(error) if passthrough(&error) => return Err(FinishFailure::Finish(error)),
        Err(_) => None,
    };
    let allowed = manager.is_some_and(|manager| manager || annotation.owner_id == user.id)
        && !annotation.is_locked_by_owner;
    if !allowed {
        tracing::info!(annotation = %annotation.id, "Not finishing annotation due to missing permissions");
        return Err(FinishFailure::Finish(ApiError::bad_request(FINISH_FAILED)));
    }
    match annotation.state.as_str() {
        "Active" => {}
        "Finished" => {
            tracing::info!(annotation = %annotation.id, "Silently not finishing already finished annotation");
            return Ok(ANNOTATION_FINISHED);
        }
        other => {
            tracing::info!(annotation = %annotation.id, state = other, "Not finishing annotation that is not active");
            return Err(FinishFailure::Finish(ApiError::bad_request(FINISH_FAILED)));
        }
    }
    // updateModified/updateState: AnnotationDAO.assertUpdateAccess.
    if !annotation_access::lock_update_access(&mut transaction, user, &annotation.id)
        .await
        .map_err(finish_error)?
    {
        return Err(finish_error(ApiError::bad_request(FINISH_FAILED)));
    }
    sqlx::query("UPDATE webknossos.annotations SET modified=$2,state='Finished' WHERE _id=$1")
        .bind(&annotation.id)
        .bind(now_millis())
        .execute(&mut *transaction)
        .await
        .map_err(|e| finish_error(e.into()))?;
    // TaskService.clearCompoundCache: a missing live task fails the finish.
    let cache_keys: Option<[AnnotationIdentifier; 3]> = match annotation.task_id.as_deref() {
        Some(task) => Some(
            annotation_lifecycle::task_cache_keys(&mut transaction, task)
                .await
                .map_err(finish_error)?,
        ),
        None => None,
    };
    transaction
        .commit()
        .await
        .map_err(|e| finish_error(e.into()))?;
    tracing::info!(annotation = %annotation.id, "Finished annotation");
    if let Some(keys) = cache_keys {
        for key in keys {
            provider.remove_from_cache(&key);
        }
    }
    Ok(if annotation.task_id.is_some() {
        TASK_FINISHED
    } else {
        ANNOTATION_FINISHED
    })
}

/// AnnotationController.finishAnnotation; returns the finish message.
async fn finish_annotation(
    state: &AppState,
    provider: &AnnotationProvider,
    writer: &TimeInteractionWriter,
    user: &AuthUser,
    typ: &str,
    id: &ObjectId,
    timestamp: i64,
) -> Result<&'static str, FinishFailure> {
    let context = AccessContext::requester(Some(user));
    let provided = provider
        .provide(context, typ, id)
        .await
        .map_err(FinishFailure::Provide)?;
    let (owner, collaboration_mode, annotation_id) = match &provided {
        ProvidedAnnotation::Saved(saved) => (
            saved.owner_id.clone(),
            saved.collaboration_mode.clone(),
            saved.id.clone(),
        ),
        ProvidedAnnotation::Compound(compound) => {
            // Compound restrictions never allow finishing; restrictionsFor
            // failures (e.g. a task deleted since caching) are still 404.
            let identifier =
                AnnotationIdentifier::parse(typ, id).map_err(FinishFailure::Restrictions)?;
            // Compound handlers never override allowFinish (default false).
            provider
                .restrictions_for(context, &identifier)
                .await
                .map_err(|e| match infrastructure(e) {
                    Ok(e) => FinishFailure::Restrictions(e),
                    Err(e) => FinishFailure::Finish(e),
                })?;
            tracing::info!(annotation = %compound.id.as_str(), "Not finishing compound annotation due to missing permissions");
            return Err(FinishFailure::Finish(ApiError::bad_request(FINISH_FAILED)));
        }
    };
    let message = finish_saved(state, provider, user, &annotation_id).await?;
    provider
        .provide(context, typ, id)
        .await
        .map_err(FinishFailure::Reload)?;
    let user_id = ObjectId::parse(&user.id).map_err(FinishFailure::TimeLog)?;
    let owner_id = ObjectId::parse(&owner).map_err(FinishFailure::TimeLog)?;
    let annotation_id = ObjectId::parse(&annotation_id).map_err(FinishFailure::TimeLog)?;
    writer
        .log_user_interaction_if_potential_contributor(
            &state.pool,
            context,
            &user_id,
            &annotation_id,
            &owner_id,
            &collaboration_mode,
            timestamp,
        )
        .await
        .map_err(FinishFailure::TimeLog)?;
    Ok(message)
}

/// PATCH /annotations/:typ/:id/finish?timestamp=
async fn finish(
    State(state): State<AppState>,
    Extension(provider): Extension<AnnotationProvider>,
    Extension(writer): Extension<TimeInteractionWriter>,
    Extension(JobsEnabled(jobs)): Extension<JobsEnabled>,
    Path((typ, id)): Path<(String, String)>,
    Timestamp(timestamp): Timestamp,
    user: AuthUser,
) -> ApiResult<Json<Value>> {
    let id = ObjectId::parse_path(&id)?;
    let message = finish_annotation(&state, &provider, &writer, &user, &typ, &id, timestamp)
        .await
        .map_err(FinishFailure::into_wrapped)?;
    // restrictionsFor(typ, id), then publicWrites of the updated annotation.
    let identifier = AnnotationIdentifier::parse(&typ, &id).map_err(ApiError::from)?;
    provider
        .restrictions_for(AccessContext::requester(Some(&user)), &identifier)
        .await
        .map_err(ApiError::from)?;
    let mut connection = state.pool.acquire().await?;
    let mut json = annotation_lists::full_json(&mut connection, &user, id.as_str(), jobs).await?;
    json["messages"] = json!([{ "success": message }]);
    Ok(Json(json))
}

/// PATCH /annotations/:typ/finish?timestamp= with FinishAllParameters:
/// serial, stopping at the first failure (earlier finishes stay committed).
async fn finish_all(
    State(state): State<AppState>,
    Extension(provider): Extension<AnnotationProvider>,
    Extension(writer): Extension<TimeInteractionWriter>,
    Path(typ): Path<String>,
    Timestamp(timestamp): Timestamp,
    user: AuthUser,
    extract::Json(body): extract::Json<FinishAllParameters>,
) -> ApiResult<Json<Value>> {
    for id in &body.annotations {
        finish_annotation(&state, &provider, &writer, &user, &typ, id, timestamp)
            .await
            .map_err(FinishFailure::into_inner)?;
    }
    Ok(Json(json!({"messages":[{"success":ALL_FINISHED}]})))
}

#[cfg(test)]
mod tests {
    use super::parse_timestamp;

    #[test]
    fn timestamp_follows_play_long_binder() {
        assert_eq!(parse_timestamp(Some("timestamp=123")).unwrap(), 123);
        assert_eq!(
            parse_timestamp(Some("timestamp=-5&timestamp=7")).unwrap(),
            -5
        );
        assert_eq!(parse_timestamp(Some("timestamp=%2B9")).unwrap(), 9);
        assert_eq!(
            parse_timestamp(None).unwrap_err().message,
            "Missing parameter: timestamp"
        );
        for bad in ["abc", "", "1.5", " 1", "9223372036854775808"] {
            let query = format!("timestamp={}", bad.replace(' ', "%20"));
            assert_eq!(
                parse_timestamp(Some(&query)).unwrap_err().message,
                format!("Cannot parse parameter timestamp as Long: For input string: \"{bad}\""),
            );
        }
    }
}
