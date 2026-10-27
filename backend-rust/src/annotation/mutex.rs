//! Saved annotation editing mutexes. Session ownership is serialized in the
//! database so independent application processes cannot both acquire a mutex.
use std::time::Duration;

use axum::{Json, Router, extract::State, http::StatusCode, routing::post};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{
    AppState,
    annotation::dao,
    annotation::provider::{
        AccessContext, AnnotationIdentifier, AnnotationProvider, ProviderError,
        RESTRICTIONS_NOT_FOUND,
    },
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::{Path, Query},
    util::id::ObjectId,
};

pub const ACQUIRE_FAILED: &str = "Could not acquire annotation editing mutex.";
pub const RELEASE_FAILED: &str = "Could not release annotation editing mutex.";

/// `webKnossos.annotation.mutex.expiryTime`.
#[derive(Clone, Copy, Debug)]
pub struct MutexExpiry(pub Duration);

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/annotations/{id}/acquireMutex", post(acquire))
        .route("/annotations/{id}/releaseMutex", post(release))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionQuery {
    session_id: Option<String>,
}

fn session(query: SessionQuery) -> ApiResult<String> {
    query
        .session_id
        .ok_or_else(|| ApiError::bad_request(crate::msg::request::missing_parameter("sessionId")))
}

fn acquisition_gate(
    annotation: &crate::annotation::access::AnnotationMetadata,
    user: &AuthUser,
) -> ApiResult<()> {
    if !matches!(
        annotation.collaboration_mode.as_str(),
        "Concurrent" | "Exclusive"
    ) || !crate::annotation::access::restrictions(annotation, Some(user)).allow_update
    {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    Ok(())
}

fn acquisition_error(error: ApiError) -> ApiError {
    ApiError::new(error.status, ACQUIRE_FAILED)
}

async fn acquire(
    State(state): State<AppState>,
    State(provider): State<AnnotationProvider>,
    State(MutexExpiry(expiry)): State<MutexExpiry>,
    user: AuthUser,
    Path(id): Path<String>,
    Query(query): Query<SessionQuery>,
) -> ApiResult<Json<Value>> {
    let session = session(query)?;
    let id = ObjectId::parse_path(&id)?;
    let context = AccessContext::requester(Some(&user));
    // The untyped provider resolves saved annotations only. Compound parent
    // IDs never become mutex IDs, even if their synthetic view is cached.
    let annotation = provider
        .provide_saved(context, &id)
        .await
        .map_err(|e| e.into_api_error(StatusCode::NOT_FOUND))?;
    if !matches!(
        annotation.collaboration_mode.as_str(),
        "Concurrent" | "Exclusive"
    ) {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    let identifier =
        AnnotationIdentifier::parse(&annotation.annotation_type, &id).map_err(|e| {
            e.wrap(RESTRICTIONS_NOT_FOUND)
                .into_api_error(StatusCode::NOT_FOUND)
        })?;
    let restrictions = provider
        .restrictions_for(context, &identifier)
        .await
        .map_err(|e| {
            e.wrap(RESTRICTIONS_NOT_FOUND)
                .into_api_error(StatusCode::NOT_FOUND)
        })?;
    if !restrictions.allow_update {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    let micros = i64::try_from(expiry.as_micros())
        .ok()
        .filter(|value| *value > 0)
        .ok_or_else(|| ApiError::bad_request(crate::msg::annotation::mutex::INVALID_EXPIRY))?;

    let mut transaction = state
        .pool
        .begin()
        .await
        .map_err(ApiError::from)
        .map_err(acquisition_error)?;
    dao::advisory_xact_lock(&mut transaction, &format!("annotation-mutex:{id}"))
        .await
        .map_err(ApiError::from)
        .map_err(acquisition_error)?;
    // Protect state, visibility, collaboration mode and owner while checking
    // runtime restrictions; collaborators do not need a DAO write grant.
    let live = crate::annotation::dao::lock_readable(&mut transaction, &user, &id)
        .await?
        .ok_or_else(|| ProviderError::NotFound.into_api_error(StatusCode::NOT_FOUND))?;
    acquisition_gate(&live, &user)?;
    let acquired = dao::upsert_mutex(&mut transaction, &id, &user.id, &session, micros)
        .await
        .map_err(ApiError::from)
        .map_err(acquisition_error)?;
    // The separate statement gets a fresh READ COMMITTED snapshot after any
    // conflicting insert commits. Advisory serialization also covers release.
    let (holder, holder_session) = match acquired {
        Some(holder) => holder,
        None => dao::find_mutex_holder_for_update(&mut transaction, &id)
            .await
            .map_err(ApiError::from)
            .map_err(acquisition_error)?,
    };
    let can_edit = holder == user.id && holder_session == session;
    let (blocked_user, blocked_session) = if can_edit {
        (Value::Null, Value::Null)
    } else {
        // Serialize before committing: a missing blocker cannot leave an
        // acquired or renewed mutex behind a failed response.
        let blocker = crate::annotation::lists::compact_user(&mut transaction, &holder)
            .await
            .map_err(|error| {
                if error.status == StatusCode::NOT_FOUND {
                    ApiError::not_found(crate::msg::NOT_FOUND)
                } else {
                    error
                }
            })?;
        (blocker, Value::String(holder_session))
    };
    transaction
        .commit()
        .await
        .map_err(ApiError::from)
        .map_err(acquisition_error)?;
    Ok(Json(
        json!({"canEdit":can_edit,"blockedByUser":blocked_user,"blockedBySessionId":blocked_session}),
    ))
}

async fn release(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Query(query): Query<SessionQuery>,
) -> ApiResult<StatusCode> {
    let session = session(query)?;
    let id = ObjectId::parse_path(&id)?;
    // There is intentionally no annotation lookup or permission gate here:
    // release remains usable after access/state/lock/visibility changes.
    let operation = async {
        let mut transaction = state.pool.begin().await?;
        dao::advisory_xact_lock(&mut transaction, &format!("annotation-mutex:{id}")).await?;
        dao::delete_mutex(&mut transaction, &id, &user.id, &session).await?;
        transaction.commit().await?;
        Ok::<_, sqlx::Error>(())
    }
    .await;
    operation.map_err(|error| {
        let error = ApiError::from(error);
        ApiError::new(error.status, RELEASE_FAILED)
    })?;
    Ok(StatusCode::OK)
}
