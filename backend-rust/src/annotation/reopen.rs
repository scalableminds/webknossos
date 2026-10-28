//! AnnotationController.reopen, including the owner's reopen window: owners may
//! only reopen within the configured time (plus 10 s) after the last change.
use axum::{Json, Router, extract::State, routing::patch};
use chrono::Utc;
use serde_json::Value;
use sqlx::PgConnection;

use crate::{
    AppState,
    annotation::metadata::PUBLIC_WRITES_FAILED,
    annotation::provider::{AccessContext, AnnotationProvider, ProvidedAnnotation},
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::Path,
    state::JobsEnabled,
    system::application_info::MiscState,
    util::id::ObjectId,
};

pub const REOPEN_FAILED: &str = "Could not reopen the annotation.";
pub const UPDATE_STATE_FAILED: &str = "Could not update state of annotation.";
pub const REOPEN_SUCCESS: &str = "Annotation was reopened.";

pub fn router() -> Router<AppState> {
    Router::new().route("/annotations/{typ}/{id}/reopen", patch(reopen))
}

/// Owner-only gate: `!(modified + configured + 10 s).isPast`. Instant.isPast
/// compares millisecond instants strictly, so the deadline itself is still
/// inside the window. Managers and owner-organization administrators bypass it.
pub fn owner_reopen_window_open(now_ms: i64, modified_ms: i64, configured_seconds: i32) -> bool {
    let wait_ms = (i64::from(configured_seconds) + 10) * 1000;
    modified_ms
        .checked_add(wait_ms)
        .is_none_or(|deadline| now_ms <= deadline)
}

fn guard_error(error: ApiError) -> ApiError {
    if error.status.is_server_error() {
        error
    } else {
        ApiError::bad_request(REOPEN_FAILED)
    }
}

async fn require_reopen(
    connection: &mut PgConnection,
    user: &AuthUser,
    owner: &ObjectId,
    task: Option<&ObjectId>,
    state: &str,
    modified_ms: i64,
    configured_seconds: i32,
) -> ApiResult<()> {
    // The globally loaded owner/task context must exist even when the state
    // is not Finished or the requester is already an administrator.
    let manager = crate::annotation::lifecycle::is_manager_or_admin(connection, user, owner, task)
        .await
        .map_err(guard_error)?;
    if state != "Finished"
        || (!manager && *owner != user.id)
        || (!manager
            && !owner_reopen_window_open(
                Utc::now().timestamp_millis(),
                modified_ms,
                configured_seconds,
            ))
    {
        return Err(ApiError::bad_request(REOPEN_FAILED));
    }
    Ok(())
}

async fn reopen(
    State(state): State<AppState>,
    State(provider): State<AnnotationProvider>,
    State(misc): State<MiscState>,
    State(JobsEnabled(jobs)): State<JobsEnabled>,
    user: AuthUser,
    Path((typ, id)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    let id = ObjectId::parse_path(&id)?;
    let configured_seconds = misc
        .config()
        .features
        .get("taskReopenAllowedInSeconds")
        .and_then(Value::as_i64)
        .and_then(|seconds| i32::try_from(seconds).ok())
        .ok_or_else(ApiError::internal)?;
    let provided = provider
        .provide(AccessContext::requester(Some(&user)), &typ, &id)
        .await
        .map_err(ApiError::from)?;
    let mut transaction = state.pool.begin().await?;
    let annotation = match provided {
        ProvidedAnnotation::Saved(saved) => {
            crate::annotation::annotation_dao::lock_readable(&mut transaction, &user, &saved.id)
                .await?
                .ok_or_else(|| ApiError::bad_request(UPDATE_STATE_FAILED))?
        }
        ProvidedAnnotation::Compound(compound) => {
            // The actual synthetic annotation is Active. Still execute the
            // owner's manager lookup first, as Scala does after real merge.
            require_reopen(
                &mut transaction,
                &user,
                &compound.owner_id,
                None,
                "Active",
                compound.created.timestamp_millis(),
                configured_seconds,
            )
            .await?;
            return Err(ApiError::bad_request(REOPEN_FAILED));
        }
    };
    require_reopen(
        &mut transaction,
        &user,
        &annotation.owner_id,
        annotation.task_id.as_ref(),
        &annotation.state,
        annotation.modified.timestamp_millis(),
        configured_seconds,
    )
    .await?;
    if !crate::annotation::annotation_dao::lock_update_access(
        &mut transaction,
        &user,
        &annotation.id,
    )
    .await?
    {
        return Err(ApiError::bad_request(UPDATE_STATE_FAILED));
    }
    let cache_keys = if let Some(task) = &annotation.task_id {
        Some(crate::annotation::lifecycle::task_cache_keys(&mut transaction, task).await?)
    } else {
        None
    };
    crate::annotation::annotation_dao::update_state_active(&mut transaction, &annotation.id)
        .await
        .map_err(|error| {
            let error = ApiError::from(error);
            if error.status.is_server_error() {
                error
            } else {
                ApiError::bad_request(UPDATE_STATE_FAILED)
            }
        })?;
    // This is a real saved-provider reload under requester read access, with
    // the route's explicit NOT_FOUND status. PublicWrites runs before commit
    // so a missing serializer dependency rolls back the state and caches.
    crate::annotation::access::find_optional(&mut *transaction, Some(&user), &annotation.id, false)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::annotation::NOT_FOUND))?;
    let mut json =
        crate::annotation::lists::full_json(&mut transaction, &user, &annotation.id, jobs)
            .await
            .map_err(|error| {
                if error.status.is_server_error() {
                    error
                } else {
                    ApiError::bad_request(PUBLIC_WRITES_FAILED)
                }
            })?;
    transaction.commit().await?;
    if let Some(keys) = cache_keys {
        for key in keys {
            provider.remove_from_cache(&key);
        }
    }
    json["messages"] = serde_json::json!([{"success":REOPEN_SUCCESS}]);
    Ok(Json(json))
}

#[cfg(test)]
mod tests;
