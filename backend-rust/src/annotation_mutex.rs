//! Saved annotation editing mutexes. Session ownership is serialized in the
//! database so independent application processes cannot both acquire a mutex.
use std::time::Duration;

use axum::{Extension, Json, Router, extract::State, http::StatusCode, routing::post};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{
    AppState, annotation_access, annotation_lists,
    annotation_metadata::NOT_ALLOWED,
    annotation_provider::{
        AccessContext, AnnotationIdentifier, AnnotationProvider, ProviderError, RESOURCE_NOT_FOUND,
        RESTRICTIONS_NOT_FOUND,
    },
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::{Path, Query},
    id::ObjectId,
};

pub const ACQUIRE_FAILED: &str = "Could not acquire annotation editing mutex.";
pub const RELEASE_FAILED: &str = "Could not release annotation editing mutex.";

#[derive(Clone, Copy)]
struct MutexExpiry(Duration);

pub fn router(expiry: Duration) -> Router<AppState> {
    Router::new()
        .route("/annotations/{id}/acquireMutex", post(acquire))
        .route("/annotations/{id}/releaseMutex", post(release))
        .layer(Extension(MutexExpiry(expiry)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionQuery {
    session_id: Option<String>,
}

fn session(query: SessionQuery) -> ApiResult<String> {
    query
        .session_id
        .ok_or_else(|| ApiError::bad_request("Missing parameter: sessionId"))
}

fn acquisition_gate(
    annotation: &annotation_access::AnnotationMetadata,
    user: &AuthUser,
) -> ApiResult<()> {
    if !matches!(
        annotation.collaboration_mode.as_str(),
        "Concurrent" | "Exclusive"
    ) || !annotation_access::restrictions(annotation, Some(user)).allow_update
    {
        return Err(ApiError::forbidden(NOT_ALLOWED));
    }
    Ok(())
}

fn acquisition_error(error: ApiError) -> ApiError {
    ApiError::new(error.status, ACQUIRE_FAILED)
}

async fn acquire(
    State(state): State<AppState>,
    Extension(provider): Extension<AnnotationProvider>,
    Extension(MutexExpiry(expiry)): Extension<MutexExpiry>,
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
        return Err(ApiError::forbidden(NOT_ALLOWED));
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
        return Err(ApiError::forbidden(NOT_ALLOWED));
    }
    let micros = i64::try_from(expiry.as_micros())
        .ok()
        .filter(|value| *value > 0)
        .ok_or_else(|| ApiError::bad_request("Invalid annotation mutex expiry."))?;

    let mut transaction = state
        .pool
        .begin()
        .await
        .map_err(ApiError::from)
        .map_err(acquisition_error)?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("annotation-mutex:{id}"))
        .execute(&mut *transaction)
        .await
        .map_err(ApiError::from)
        .map_err(acquisition_error)?;
    // Protect state, visibility, collaboration mode and owner while checking
    // runtime restrictions; collaborators do not need a DAO write grant.
    let live = annotation_access::lock_readable(&mut transaction, &user, id.as_str())
        .await?
        .ok_or_else(|| ProviderError::NotFound.into_api_error(StatusCode::NOT_FOUND))?;
    acquisition_gate(&live, &user)?;
    let acquired: Option<(String, String)> = sqlx::query_as(
        "INSERT INTO webknossos.annotation_mutexes(_annotation,_user,sessionId,expiry)
         VALUES($1,$2,$3,statement_timestamp()+($4::bigint * interval '1 microsecond'))
         ON CONFLICT (_annotation) DO UPDATE SET _user=EXCLUDED._user,
           sessionId=EXCLUDED.sessionId,expiry=EXCLUDED.expiry
         WHERE (webknossos.annotation_mutexes._user=EXCLUDED._user AND
                webknossos.annotation_mutexes.sessionId=EXCLUDED.sessionId)
            OR webknossos.annotation_mutexes.expiry<statement_timestamp()
         RETURNING _user,sessionId",
    )
    .bind(id.as_str())
    .bind(&user.id)
    .bind(&session)
    .bind(micros)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(ApiError::from)
    .map_err(acquisition_error)?;
    // The separate statement gets a fresh READ COMMITTED snapshot after any
    // conflicting insert commits. Advisory serialization also covers release.
    let (holder, holder_session) = match acquired {
        Some(holder) => holder,
        None => sqlx::query_as("SELECT _user,sessionId FROM webknossos.annotation_mutexes WHERE _annotation=$1 FOR UPDATE")
            .bind(id.as_str()).fetch_one(&mut *transaction).await.map_err(ApiError::from).map_err(acquisition_error)?,
    };
    let can_edit = holder == user.id && holder_session == session;
    let (blocked_user, blocked_session) = if can_edit {
        (Value::Null, Value::Null)
    } else {
        // Serialize before committing: a missing blocker cannot leave an
        // acquired or renewed mutex behind a failed response.
        let blocker = annotation_lists::compact_user(&mut transaction, &holder)
            .await
            .map_err(|error| {
                if error.status == StatusCode::NOT_FOUND {
                    ApiError::not_found(RESOURCE_NOT_FOUND)
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
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
            .bind(format!("annotation-mutex:{id}"))
            .execute(&mut *transaction).await?;
        sqlx::query("DELETE FROM webknossos.annotation_mutexes WHERE _annotation=$1 AND _user=$2 AND sessionId=$3")
            .bind(id.as_str()).bind(&user.id).bind(session).execute(&mut *transaction).await?;
        transaction.commit().await?;
        Ok::<_,sqlx::Error>(())
    }.await;
    operation.map_err(|error| {
        let error = ApiError::from(error);
        ApiError::new(error.status, RELEASE_FAILED)
    })?;
    Ok(StatusCode::OK)
}
