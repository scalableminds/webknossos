//! AnnotationController cancellation and collaboration mode, resolved through
//! the real annotation provider (including temporary compound annotations).
use crate::annotation::dao;
use crate::response::Messages;
use axum::{
    Extension, Json, Router,
    extract::State,
    http::StatusCode,
    routing::{delete, patch},
};
use serde::Deserialize;
use sqlx::{PgConnection, Postgres, Transaction};

use crate::{
    AppState,
    annotation::provider::{
        AccessContext, AnnotationIdentifier, AnnotationProvider, AnnotationType,
        ProvidedAnnotation, ProviderError,
    },
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::{Path, Query},
    util::id::ObjectId,
};

pub const CANCEL_SUCCESS: &str = "Task annotation was successfully cancelled.";
pub const COLLABORATION_TYPES_ONLY: &str =
    "Changing the collaboration mode is only allowed for explorational and task annotations.";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/annotations/{typ}/{id}", delete(cancel))
        .route("/annotations/{id}", delete(cancel_without_type))
        .route(
            "/annotations/{typ}/{id}/collaborationMode",
            patch(collaboration_mode),
        )
}

/// False `Fox.assertTrue` and a missing globally read owner yield Fox.Empty.
async fn assert_manager(
    connection: &mut PgConnection,
    user: &AuthUser,
    owner: &ObjectId,
    task: Option<&ObjectId>,
) -> ApiResult<()> {
    if is_manager_or_admin(connection, user, owner, task).await? {
        Ok(())
    } else {
        Err(ApiError::not_found(crate::msg::NOT_FOUND))
    }
}

/// Shared UserService.isTeamManagerOrAdminOf grant, retaining its live-owner
/// and task/project prerequisites even for organization administrators.
pub(crate) async fn is_manager_or_admin(
    connection: &mut PgConnection,
    user: &AuthUser,
    owner: &ObjectId,
    task: Option<&ObjectId>,
) -> ApiResult<bool> {
    let organization = dao::find_user_organization_for_share(connection, owner).await?;
    let organization = organization.ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    let admin = user.is_admin && user.organization_id == organization;
    let manager = if let Some(task) = task {
        // Scala globally resolves a live task and project even for admins.
        let context = dao::find_task_project_context_for_update(connection, task).await?;
        let (team, project_organization) =
            context.ok_or_else(|| ApiError::bad_request(crate::msg::team::ADMIN_NOT_ALLOWED))?;
        project_organization == user.organization_id
            && dao::is_team_manager(connection, user, &team).await?
    } else {
        false
    };
    Ok(admin || manager)
}

async fn cancel(
    State(state): State<AppState>,
    Extension(provider): Extension<AnnotationProvider>,
    user: AuthUser,
    Path((typ, id)): Path<(String, String)>,
) -> ApiResult<Json<Messages>> {
    cancel_typed(&state, &provider, &user, &typ, &ObjectId::parse_path(&id)?).await
}

async fn cancel_without_type(
    State(state): State<AppState>,
    Extension(provider): Extension<AnnotationProvider>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<Json<Messages>> {
    let id = ObjectId::parse_path(&id)?;
    let saved = provider
        .provide_saved(AccessContext::requester(Some(&user)), &id)
        .await
        .map_err(|e| e.into_api_error(StatusCode::NOT_FOUND))?;
    // provideAnnotation(id,user) infers Task when _task is present, otherwise
    // Explorational, then cancelWithoutType invokes the typed action again.
    let inferred = if saved.task_id.is_some() {
        "Task"
    } else {
        "Explorational"
    };
    cancel_typed(&state, &provider, &user, inferred, &id).await
}

async fn cancel_typed(
    state: &AppState,
    provider: &AnnotationProvider,
    user: &AuthUser,
    typ: &str,
    id: &ObjectId,
) -> ApiResult<Json<Messages>> {
    let provided = provider
        .provide(AccessContext::requester(Some(user)), typ, id)
        .await
        .map_err(|e| e.into_api_error(StatusCode::NOT_FOUND))?;
    let mut transaction = state.pool.begin().await?;
    let saved = if matches!(provided, ProvidedAnnotation::Saved(_)) {
        Some(
            crate::annotation::dao::lock_readable(&mut transaction, user, provided.id())
                .await?
                .ok_or_else(|| ProviderError::NotFound.into_api_error(StatusCode::NOT_FOUND))?,
        )
    } else {
        None
    };
    let owner = saved.as_ref().map_or(provided.owner_id(), |a| &a.owner_id);
    let task = saved.as_ref().and_then(|a| a.task_id.as_ref());
    assert_manager(&mut transaction, user, owner, task).await?;
    let mut invalidate = None;
    let task_annotation = saved
        .as_ref()
        .filter(|a| a.annotation_type == "Task" && a.task_id.is_some());
    let message = if let Some(annotation) = task_annotation {
        if annotation.state == "Finished" {
            // clearCompoundCache globally requires a live task and removes
            // all three parent keys; capture the parents before committing.
            invalidate = Some(
                task_cache_keys(
                    &mut transaction,
                    annotation.task_id.as_ref().expect("checked task"),
                )
                .await?,
            );
        }
        if !crate::annotation::dao::lock_update_access(&mut transaction, user, &annotation.id)
            .await?
        {
            return Err(ApiError::bad_request(
                crate::msg::annotation::ASSERT_UPDATE_ACCESS_FAILED,
            ));
        }
        dao::update_state_cancelled(&mut transaction, &annotation.id).await?;
        CANCEL_SUCCESS
    } else {
        crate::msg::annotation::FINISHED
    };
    transaction.commit().await?;
    if let Some(keys) = invalidate {
        for key in keys {
            provider.remove_from_cache(&key);
        }
    }
    Ok(Messages::success(message))
}

pub(crate) async fn task_cache_keys(
    transaction: &mut Transaction<'_, Postgres>,
    task: &ObjectId,
) -> ApiResult<[AnnotationIdentifier; 3]> {
    let context = dao::find_task_parents_for_share(transaction, task).await?;
    let (project, task_type) = context.ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    Ok([
        AnnotationIdentifier {
            annotation_type: AnnotationType::CompoundTask,
            identifier: task.clone(),
        },
        AnnotationIdentifier {
            annotation_type: AnnotationType::CompoundProject,
            identifier: project,
        },
        AnnotationIdentifier {
            annotation_type: AnnotationType::CompoundTaskType,
            identifier: task_type,
        },
    ])
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CollaborationQuery {
    collaboration_mode: Option<String>,
}

async fn collaboration_mode(
    State(state): State<AppState>,
    Extension(provider): Extension<AnnotationProvider>,
    user: AuthUser,
    Path((typ, id)): Path<(String, String)>,
    Query(query): Query<CollaborationQuery>,
) -> ApiResult<StatusCode> {
    let id = ObjectId::parse_path(&id)?;
    let mode = query.collaboration_mode.ok_or_else(|| {
        ApiError::bad_request(crate::msg::request::missing_parameter("collaborationMode"))
    })?;
    let provided = provider
        .provide(AccessContext::requester(Some(&user)), &typ, &id)
        .await
        .map_err(ApiError::from)?;
    if !matches!(
        provided.annotation_type(),
        Some(AnnotationType::Task | AnnotationType::Explorational)
    ) {
        return Err(ApiError::bad_request(COLLABORATION_TYPES_ONLY));
    }
    if *provided.owner_id() != user.id {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    if !matches!(mode.as_str(), "OwnerOnly" | "Exclusive" | "Concurrent") {
        return Err(ApiError::not_found(crate::msg::NOT_FOUND));
    }
    let mut transaction = state.pool.begin().await?;
    // Shared key for future reserve/release endpoints, replacing Scala's
    // per-annotation semaphore with a transaction-scoped database mutex.
    dao::advisory_xact_lock(&mut transaction, &format!("annotation-reservations:{id}")).await?;
    let annotation = crate::annotation::dao::lock_readable(&mut transaction, &user, provided.id())
        .await?
        .ok_or_else(|| ApiError::bad_request(crate::msg::annotation::NO_UPDATE_ACCESS))?;
    if !matches!(
        annotation.annotation_type.as_str(),
        "Task" | "Explorational"
    ) {
        return Err(ApiError::bad_request(COLLABORATION_TYPES_ONLY));
    }
    if annotation.owner_id != user.id {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    if !crate::annotation::dao::lock_update_access(&mut transaction, &user, &annotation.id).await? {
        return Err(ApiError::bad_request(
            crate::msg::annotation::NO_UPDATE_ACCESS,
        ));
    }
    dao::update_collaboration_mode(&mut transaction, &annotation.id, &mode).await?;
    if annotation.collaboration_mode == "Concurrent" && mode != "Concurrent" {
        dao::delete_reserved_ids(&mut transaction, &annotation.id).await?;
    }
    transaction.commit().await?;
    Ok(StatusCode::OK)
}
