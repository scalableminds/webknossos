//! AnnotationController cancellation and collaboration mode, resolved through
//! the real annotation provider (including temporary compound annotations).
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
    task: Option<&str>,
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
    task: Option<&str>,
) -> ApiResult<bool> {
    let organization: Option<String> =
        sqlx::query_scalar("SELECT _organization FROM webknossos.users_ WHERE _id=$1 FOR SHARE")
            .bind(owner)
            .fetch_optional(&mut *connection)
            .await?;
    let organization = organization.ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    let admin = user.is_admin && user.organization_id == organization;
    let manager = if let Some(task) = task {
        // Scala globally resolves a live task and project even for admins.
        let context: Option<(String, String)> = sqlx::query_as(
            "SELECT p._team,p._organization FROM webknossos.tasks_ t
             JOIN webknossos.projects_ p ON p._id=t._project WHERE t._id=$1 FOR NO KEY UPDATE OF t FOR SHARE OF p",
        )
        .bind(task)
        .fetch_optional(&mut *connection)
        .await?;
        let (team, project_organization) =
            context.ok_or_else(|| ApiError::bad_request(crate::msg::team::ADMIN_NOT_ALLOWED))?;
        project_organization == user.organization_id
            && sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS(SELECT 1 FROM webknossos.user_team_roles role
             JOIN webknossos.teams_ team ON team._id=role._team AND team._organization=$2
             WHERE role._user=$1 AND role._team=$3 AND role.isTeamManager)",
            )
            .bind(&user.id)
            .bind(&user.organization_id)
            .bind(team)
            .fetch_one(&mut *connection)
            .await?
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
            crate::annotation::access::lock_readable(&mut transaction, user, provided.id())
                .await?
                .ok_or_else(|| ProviderError::NotFound.into_api_error(StatusCode::NOT_FOUND))?,
        )
    } else {
        None
    };
    let owner = saved.as_ref().map_or(provided.owner_id(), |a| &a.owner_id);
    let task = saved.as_ref().and_then(|a| a.task_id.as_deref());
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
                    annotation.task_id.as_deref().expect("checked task"),
                )
                .await?,
            );
        }
        if !crate::annotation::access::lock_update_access(&mut transaction, user, &annotation.id)
            .await?
        {
            return Err(ApiError::bad_request(
                crate::msg::annotation::ASSERT_UPDATE_ACCESS_FAILED,
            ));
        }
        sqlx::query("UPDATE webknossos.annotations SET state='Cancelled' WHERE _id=$1")
            .bind(&annotation.id)
            .execute(&mut *transaction)
            .await?;
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
    task: &str,
) -> ApiResult<[AnnotationIdentifier; 3]> {
    let context: Option<(String, String)> =
        sqlx::query_as("SELECT _project,_tasktype FROM webknossos.tasks_ WHERE _id=$1 FOR SHARE")
            .bind(task)
            .fetch_optional(&mut **transaction)
            .await?;
    let (project, task_type) = context.ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    Ok([
        AnnotationIdentifier::parse("CompoundTask", &ObjectId::parse(task)?)
            .map_err(ApiError::from)?,
        AnnotationIdentifier::parse("CompoundProject", &ObjectId::parse(&project)?)
            .map_err(ApiError::from)?,
        AnnotationIdentifier::parse("CompoundTaskType", &ObjectId::parse(&task_type)?)
            .map_err(ApiError::from)?,
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
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("annotation-reservations:{id}"))
        .execute(&mut *transaction)
        .await?;
    let annotation =
        crate::annotation::access::lock_readable(&mut transaction, &user, provided.id())
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
    if !crate::annotation::access::lock_update_access(&mut transaction, &user, &annotation.id)
        .await?
    {
        return Err(ApiError::bad_request(
            crate::msg::annotation::NO_UPDATE_ACCESS,
        ));
    }
    sqlx::query("UPDATE webknossos.annotations SET collaborationMode=$2::webknossos.ANNOTATION_COLLABORATION_MODE WHERE _id=$1")
        .bind(&annotation.id).bind(&mode).execute(&mut *transaction).await?;
    if annotation.collaboration_mode == "Concurrent" && mode != "Concurrent" {
        sqlx::query("DELETE FROM webknossos.annotation_reserved_ids WHERE _annotation=$1")
            .bind(&annotation.id)
            .execute(&mut *transaction)
            .await?;
    }
    transaction.commit().await?;
    Ok(StatusCode::OK)
}
