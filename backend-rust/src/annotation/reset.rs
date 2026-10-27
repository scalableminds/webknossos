//! AnnotationController.reset (`PUT /annotations/:typ/:id/reset`):
//! AnnotationService.resetToBase asks the tracing store to reset a task
//! annotation to its task base (`POST /tracings/annotation/:id/resetToBase`).
//! No database row is written by the main application; the annotation is
//! re-provided and serialized afterwards.
use axum::{Extension, Json, Router, extract::State, http::StatusCode, routing::put};
use serde_json::{Value, json};

use crate::{
    AppState,
    annotation::provider::{
        AccessContext, AnnotationProvider, AnnotationType, ProvidedAnnotation, ProviderError,
    },
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::Path,
    state::JobsEnabled,
    stores::tracing_client::TracingStoreClient,
    util::id::ObjectId,
};

/// Msg.Annotation.Reset.failed.
pub const RESET_FAILED: &str = "Could not reset annotation to base state.";
/// Msg.Annotation.Reset.success.
pub const RESET_SUCCESS: &str = "Annotation was successfully reset.";
/// Msg.Annotation.Reset.tasksOnly (chained below RESET_FAILED).
pub const RESET_TASKS_ONLY: &str =
    "Resetting an annotation to base state is only implemented for tasks.";

pub fn router() -> Router<AppState> {
    Router::new().route("/annotations/{typ}/{id}/reset", put(reset))
}

/// AnnotationService.resetToBase: only Task annotations (actual type);
/// datasetDAO.findOne under the requester's access context; first tracing
/// store; then WKRemoteTracingStoreClient.resetToBase.
///
/// Scala sends this RPC `withLongTimeout` (2 h), as does the client here; the
/// route is exempt from the router-wide request timeout (lib.rs).
async fn reset_to_base(
    state: &AppState,
    client: &TracingStoreClient,
    user: &AuthUser,
    annotation: &ProvidedAnnotation,
) -> Result<(), ProviderError> {
    if annotation.annotation_type() != Some(AnnotationType::Task) {
        return Err(ProviderError::failure(RESET_TASKS_ONLY));
    }
    if !crate::dataset::access::can_read(&state.pool, Some(user), annotation.dataset_id(), None)
        .await?
    {
        return Err(ProviderError::Empty);
    }
    let url = crate::stores::tracing_client::find_first_tracing_store_url(&state.pool)
        .await?
        .ok_or_else(|| ProviderError::failure(crate::msg::tracing_store::NOT_FOUND))?;
    client
        .reset_to_base(&url, annotation.id())
        .await
        .map_err(ProviderError::from)
        .map_err(|error| error.wrap(RESET_FAILED))?;
    Ok(())
}

/// PUT /annotations/:typ/:id/reset
async fn reset(
    State(state): State<AppState>,
    Extension(provider): Extension<AnnotationProvider>,
    State(client): State<TracingStoreClient>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
    user: AuthUser,
    Path((typ, id)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    let id = ObjectId::parse_path(&id)?;
    let access = AccessContext::requester(Some(&user));
    // provideAnnotation ?~> Msg.Annotation.notFound ~> NOT_FOUND.
    let annotation = provider.provide(access, &typ, &id).await.map_err(|error| {
        error
            .wrap(crate::msg::annotation::NOT_FOUND)
            .into_api_error(StatusCode::NOT_FOUND)
    })?;
    // Owner (global) + Fox.assertTrue(isTeamManagerOrAdminOf(..)): false is
    // Fox.empty, rendered as 404 Msg.notFound. A compound has no task.
    let (owner, task) = match &annotation {
        ProvidedAnnotation::Saved(saved) => (&saved.owner_id, saved.task_id.as_ref()),
        ProvidedAnnotation::Compound(compound) => (&compound.owner_id, None),
    };
    let mut connection = state.pool.acquire().await?;
    let allowed =
        crate::annotation::lifecycle::is_manager_or_admin(&mut connection, &user, owner, task)
            .await?;
    drop(connection);
    if !allowed {
        return Err(ApiError::not_found(crate::msg::NOT_FOUND));
    }
    // resetToBase(..) ?~> Msg.Annotation.Reset.failed (default 400, or the
    // upstream status of an unsuccessful RPC).
    reset_to_base(&state, &client, &user, &annotation)
        .await
        .map_err(|error| ApiError::from(error.wrap(RESET_FAILED)))?;
    // Re-provide without route status adaptation, then publicWrites with
    // default restrictions for the requester. Only saved Task annotations
    // pass resetToBase, so the reloaded annotation is saved.
    let updated = provider
        .provide(access, &typ, &id)
        .await
        .map_err(ApiError::from)?;
    let saved = updated.saved().ok_or_else(ApiError::internal)?;
    let mut connection = state.pool.acquire().await?;
    let mut json =
        crate::annotation::lists::full_json(&mut connection, &user, &saved.id, jobs_enabled)
            .await?;
    json["messages"] = json!([{ "success": RESET_SUCCESS }]);
    Ok(Json(json))
}
