//! AnnotationController.reset (`PUT /annotations/:typ/:id/reset`):
//! AnnotationService.resetToBase asks the tracing store to reset a task
//! annotation to its task base (`POST /tracings/annotation/:id/resetToBase`).
//! No database row is written by the main application; the annotation is
//! re-provided and serialized afterwards.
use axum::{Extension, Json, Router, extract::State, http::StatusCode, routing::put};
use serde_json::{Value, json};

use crate::{
    AppState, annotation_lifecycle, annotation_lists,
    annotation_provider::{
        ANNOTATION_NOT_FOUND, AccessContext, AnnotationProvider, AnnotationType, FoxFailure,
        ProvidedAnnotation, ProviderError, RESOURCE_NOT_FOUND,
    },
    auth::AuthUser,
    dataset_access,
    error::{ApiError, ApiResult},
    extract::Path,
    id::ObjectId,
    service_clients::ServiceError,
    tracingstore_client::{self, TRACING_STORE_NOT_FOUND, TracingStoreClient},
};

/// Msg.Annotation.Reset.failed.
pub const RESET_FAILED: &str = "Could not reset annotation to base state.";
/// Msg.Annotation.Reset.success.
pub const RESET_SUCCESS: &str = "Annotation was successfully reset.";
/// Msg.Annotation.Reset.tasksOnly (chained below RESET_FAILED).
pub const RESET_TASKS_ONLY: &str =
    "Resetting an annotation to base state is only implemented for tasks.";

#[derive(Clone, Copy)]
struct JobsEnabled(bool);

pub fn router(jobs_enabled: bool) -> Router<AppState> {
    Router::new()
        .route("/annotations/{typ}/{id}/reset", put(reset))
        .layer(Extension(JobsEnabled(jobs_enabled)))
}

fn failure(message: &str, status: Option<StatusCode>) -> ProviderError {
    ProviderError::Failure(FoxFailure {
        message: message.to_owned(),
        chain: Vec::new(),
        status,
    })
}

/// RPC failures are Fox failures; only an unsuccessful upstream HTTP status
/// is kept as ParamFailure status (RPCRequest `~> result.status`).
fn rpc_failure(error: ServiceError) -> ProviderError {
    let status = match &error {
        ServiceError::UpstreamStatus(code) => StatusCode::from_u16(*code).ok(),
        _ => None,
    };
    failure(&error.to_string(), status)
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
        return Err(failure(RESET_TASKS_ONLY, None));
    }
    if !dataset_access::can_read(&state.pool, Some(user), annotation.dataset_id(), None).await? {
        return Err(ProviderError::Empty);
    }
    let url = tracingstore_client::find_first_tracing_store_url(&state.pool)
        .await?
        .ok_or_else(|| failure(TRACING_STORE_NOT_FOUND, None))?;
    client
        .reset_to_base(&url, annotation.id())
        .await
        .map_err(rpc_failure)
        .map_err(|error| error.wrap(RESET_FAILED))?;
    Ok(())
}

/// PUT /annotations/:typ/:id/reset
async fn reset(
    State(state): State<AppState>,
    Extension(provider): Extension<AnnotationProvider>,
    Extension(client): Extension<TracingStoreClient>,
    Extension(JobsEnabled(jobs_enabled)): Extension<JobsEnabled>,
    user: AuthUser,
    Path((typ, id)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    let id = ObjectId::parse_path(&id)?;
    let access = AccessContext::requester(Some(&user));
    // provideAnnotation ?~> Msg.Annotation.notFound ~> NOT_FOUND.
    let annotation = provider.provide(access, &typ, &id).await.map_err(|error| {
        error
            .wrap(ANNOTATION_NOT_FOUND)
            .into_api_error(StatusCode::NOT_FOUND)
    })?;
    // Owner (global) + Fox.assertTrue(isTeamManagerOrAdminOf(..)): false is
    // Fox.empty, rendered as 404 Msg.notFound. A compound has no task.
    let (owner, task) = match &annotation {
        ProvidedAnnotation::Saved(saved) => (saved.owner_id.clone(), saved.task_id.clone()),
        ProvidedAnnotation::Compound(compound) => (compound.owner_id.to_string(), None),
    };
    let mut connection = state.pool.acquire().await?;
    let allowed =
        annotation_lifecycle::is_manager_or_admin(&mut connection, &user, &owner, task.as_deref())
            .await?;
    drop(connection);
    if !allowed {
        return Err(ApiError::not_found(RESOURCE_NOT_FOUND));
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
        annotation_lists::full_json(&mut connection, &user, &saved.id, jobs_enabled).await?;
    json["messages"] = json!([{ "success": RESET_SUCCESS }]);
    Ok(Json(json))
}
