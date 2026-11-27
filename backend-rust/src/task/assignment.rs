//! TaskController.assignOne (`POST /tasks/:id/assign?userId=`) and the
//! reusable task-instance creation flow shared with automatic task allocation
//! (`POST /user/tasks/request`, TaskController.request):
//!
//! 1. [`assign_one_to`] / [`insert_initializing_annotation`] (TaskDAO.assignOneTo
//!    / assignNext): insert an `Initializing` Task annotation for the user; the
//!    schema trigger `onInsertAnnotation` decrements `pendingInstances`.
//! 2. [`create_annotation_for`] (AnnotationService.createAnnotationFor): find
//!    the task's TracingBase, check its dataset, duplicate it in the tracing
//!    store and turn the Initializing row into an Active Task annotation
//!    (AnnotationDAO.updateInitialized).
//! 3. [`abort_initializing_annotation`]
//!    (AnnotationService.abortInitializedAnnotationOnFailure): on any failure of
//!    step 2 the Initializing row and its layers are deleted; the trigger
//!    `onDeleteAnnotation` gives the pending instance back.
//!
//! [`initialize_task_annotation`] combines 2 and 3 exactly like both Scala
//! controller actions (`createAnnotationFor(..).shiftBox` +
//! `abortInitializedAnnotationOnFailure` + `insertedAnnotationBox.toFox`).
//!
//! Deviations from Scala (documented in checkpoints/task-assignment.md):
//! - The Initializing insert locks the live task row `FOR UPDATE` and re-checks
//!   `pendingInstances > 0` in a READ COMMITTED transaction instead of running
//!   a SERIALIZABLE statement with up to 50 retries. Concurrent assignments of
//!   the last instance therefore serialize on the row lock and the loser gets
//!   `task.unavailable` deterministically; no instance is ever over-assigned.
//! - updateInitialized only updates a row that is still live and
//!   `Initializing` (Scala updates by id only, which would resurrect a row
//!   soft-deleted by a concurrent task deletion and double-decrement the
//!   pending count). A vanished row is a failure and triggers the abort.
//! - The response task JSON is serialized without re-running the requester's
//!   task read query (Scala re-reads `taskDAO.findOne(id)` in the requester
//!   context, which was already checked at the start of the action).
//! - No compound-annotation cache invalidation: Scala's assignOne does not
//!   clear it either (the new annotation is Active, compound caches expire
//!   after 60 minutes as in Scala).
pub(crate) mod task_assignment_dao;

use axum::{Json as ResponseJson, Router, extract::State, http::StatusCode, routing::post};
use serde::Deserialize;
use serde_json::Value;
use sqlx::PgPool;

use crate::{
    AppState,
    annotation::duplicate::duplicate_in_tracing_store,
    annotation::provider::{AnnotationLayer, ProviderError},
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::{Path, Query},
    stores::tracing_client::{DuplicateAnnotationRequest, TracingStoreClient},
    users::notification_emails::NotificationEmailService,
    util::id::ObjectId,
    util::instant::now_millis,
};

/// AnnotationService.createAnnotationFor `?~>` messages.
pub(crate) const BASE_ID_FAILED: &str = "Failed to retrieve annotation base id.";

pub fn router() -> Router<AppState> {
    Router::new().route("/tasks/{id}/assign", post(assign_one))
}

// ---------------------------------------------------------------------------
// Step 1: Initializing annotation (TaskDAO.assignOneTo / assignNext)
// ---------------------------------------------------------------------------

/// TaskDAO.assignOneTo: in one transaction, lock the task if it has pending
/// instances and insert the Initializing annotation for `user_id`. `None`
/// means `?~> Msg.Task.unavailable` (400) in the caller. Does no permission,
/// team or experience checks (manual assignment allows repeated assignment
/// of the same task to the same user, like Scala).
pub(crate) async fn assign_one_to(
    pool: &PgPool,
    task_id: &ObjectId,
    user_id: &ObjectId,
) -> ApiResult<Option<ObjectId>> {
    let mut tx = pool.begin().await?;
    if !task_assignment_dao::lock_task_with_pending_instances(&mut tx, task_id).await? {
        return Ok(None);
    }
    let Some(annotation_id) =
        task_assignment_dao::insert_initializing_annotation(&mut tx, task_id, user_id).await?
    else {
        return Ok(None);
    };
    tx.commit().await?;
    Ok(Some(annotation_id))
}

// ---------------------------------------------------------------------------
// Step 2: AnnotationService.createAnnotationFor
// ---------------------------------------------------------------------------

/// AnnotationService.createAnnotationFor(assignee, taskId, initializingId)
/// with DB reads in `context_user`'s access context (the requester for
/// assignOne, the assignee itself for request):
/// - `findBaseIdForTask`: live, non-Cancelled TracingBase of the task readable
///   by `context_user` (AnnotationDAO.readAccessQ) `?~> Failed to retrieve
///   annotation base id.` (400);
/// - dataset readable by `context_user` `?~> notFoundForAnnotation` (400) and
///   usable `?~> notUsable` (400);
/// - first tracing store + duplicateAnnotation RPC (source = base, new id =
///   the Initializing id, owner = base owner, requester = assignee, version
///   None, isFromTask false, no box); failures keep their message/status;
/// - [`update_initialized`] (transactional).
///
/// Writes nothing besides the final update; on error the caller must abort
/// (see [`initialize_task_annotation`]).
pub(crate) async fn create_annotation_for(
    pool: &PgPool,
    tracing_store: &TracingStoreClient,
    context_user: &AuthUser,
    assignee_id: &ObjectId,
    task_id: &ObjectId,
    initializing_annotation_id: &ObjectId,
) -> Result<(), ProviderError> {
    let base = task_assignment_dao::find_annotation_base(pool, context_user, task_id).await?;
    let base = base.ok_or_else(|| ProviderError::failure(BASE_ID_FAILED))?;

    let is_usable =
        task_assignment_dao::find_dataset_is_usable(pool, context_user, &base.dataset_id).await?;
    match is_usable {
        None => {
            return Err(ProviderError::failure(
                crate::msg::dataset::not_found_for_annotation(&base.dataset_id, &base.id),
            ));
        }
        Some(false) => {
            return Err(ProviderError::failure(crate::msg::dataset::not_usable(
                &base.dataset_id,
            )));
        }
        Some(true) => {}
    }

    tracing::info!(
        annotation = %initializing_annotation_id,
        base = %base.id,
        task = %task_id,
        "task assignment: creating annotation from base"
    );
    let request = DuplicateAnnotationRequest {
        source_annotation_id: base.id.clone(),
        new_annotation_id: initializing_annotation_id.clone(),
        owner_id: base.owner_id.clone(),
        requesting_user_id: assignee_id.clone(),
        version: None,
        // isFromTask is for duplicating a task annotation, not for assignment.
        is_from_task: false,
        dataset_bounding_box: None,
    };
    let layers = duplicate_in_tracing_store(pool, tracing_store, &request).await?;
    update_initialized(
        pool,
        initializing_annotation_id,
        assignee_id,
        &base,
        &layers,
    )
    .await?;
    Ok(())
}

/// AnnotationDAO.updateInitialized for `annotationBase.copy(_id, _user =
/// assignee, layers, state = Active, typ = Task, created = modified = now)`:
/// one transaction updating the row and replacing its layers (statistics
/// `{}`). Only a live `Initializing` row is updated (see module docs).
async fn update_initialized(
    pool: &PgPool,
    annotation_id: &ObjectId,
    assignee_id: &ObjectId,
    base: &task_assignment_dao::AnnotationBase,
    layers: &[AnnotationLayer],
) -> Result<(), ProviderError> {
    let now = now_millis();
    let mut tx = pool.begin().await?;
    let updated = task_assignment_dao::update_initialized_annotation(
        &mut tx,
        annotation_id,
        assignee_id,
        base,
        now,
    )
    .await?;
    if updated != 1 {
        tracing::warn!(annotation = %annotation_id, "initializing task annotation vanished");
        return Err(ProviderError::failure(crate::msg::NOT_FOUND));
    }
    task_assignment_dao::delete_annotation_layers(&mut tx, annotation_id).await?;
    for layer in layers {
        task_assignment_dao::insert_annotation_layer(&mut tx, annotation_id, layer).await?;
    }
    tx.commit().await?;
    tracing::info!(annotation = %annotation_id, "initialized task annotation, state is now Active");
    Ok(())
}

// ---------------------------------------------------------------------------
// Step 3: abort + combined flow
// ---------------------------------------------------------------------------

/// AnnotationDAO.abortInitializingAnnotation: delete the layers and the row
/// if it is still `Initializing`, in one transaction. The delete trigger
/// restores `pendingInstances` (for a live row).
pub(crate) async fn abort_initializing_annotation(
    pool: &PgPool,
    annotation_id: &ObjectId,
) -> ApiResult<()> {
    let mut tx = pool.begin().await?;
    task_assignment_dao::delete_initializing_annotation_layers(&mut tx, annotation_id).await?;
    task_assignment_dao::delete_initializing_annotation(&mut tx, annotation_id).await?;
    tx.commit().await?;
    tracing::info!(annotation = %annotation_id, "aborted initializing task annotation");
    Ok(())
}

/// `createAnnotationFor(..).shiftBox`, `abortInitializedAnnotationOnFailure`
/// and `insertedAnnotationBox.toFox`: on success the annotation
/// `initializing_annotation_id` is an Active Task annotation of the assignee;
/// on failure it is deleted and the createAnnotationFor error is returned
/// (rendered like Play: Fox failure 400, ParamFailure status kept). If the
/// abort itself fails, its error is returned instead (Scala's for-comprehension
/// stops at the abort).
pub(crate) async fn initialize_task_annotation(
    pool: &PgPool,
    tracing_store: &TracingStoreClient,
    context_user: &AuthUser,
    assignee_id: &ObjectId,
    task_id: &ObjectId,
    initializing_annotation_id: &ObjectId,
) -> ApiResult<()> {
    match create_annotation_for(
        pool,
        tracing_store,
        context_user,
        assignee_id,
        task_id,
        initializing_annotation_id,
    )
    .await
    {
        Ok(()) => Ok(()),
        Err(error) => {
            abort_initializing_annotation(pool, initializing_annotation_id).await?;
            Err(error.into())
        }
    }
}

// ---------------------------------------------------------------------------
// Route: TaskController.assignOne
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct AssignQuery {
    #[serde(rename = "userId")]
    user_id: Option<String>,
}

fn not_found() -> ApiError {
    ApiError::not_found(crate::msg::NOT_FOUND)
}

/// `userService.isTeamManagerOrAdminOf(requester, assignee)`: the requester
/// manages one of the assignee's teams (raw memberships), or is an admin of
/// the assignee's organization.
async fn manages_user(
    pool: &PgPool,
    requester: &AuthUser,
    assignee_id: &ObjectId,
    assignee_organization: &str,
) -> ApiResult<bool> {
    if requester.is_admin && requester.organization_id == assignee_organization {
        return Ok(true);
    }
    Ok(task_assignment_dao::manages_user_through_team(pool, requester, assignee_id).await?)
}

async fn assign_one(
    State(state): State<AppState>,
    State(tracing_store): State<TracingStoreClient>,
    State(notification_emails): State<NotificationEmailService>,
    user: AuthUser,
    Path(id): Path<String>,
    Query(query): Query<AssignQuery>,
) -> ApiResult<ResponseJson<Value>> {
    let assignee_id = query
        .user_id
        .ok_or_else(|| ApiError::bad_request(crate::msg::request::missing_parameter("userId")))?;
    let assignee_id = ObjectId::parse(&assignee_id)?;
    let task_id = ObjectId::parse_path(&id)?;
    let pool = &state.pool;

    // userService.findOneCached(userId): UserDAO.readAccessQ, Empty → 404.
    let (assignee_organization, assignee_is_deactivated) =
        task_assignment_dao::find_assignee(pool, &user, &assignee_id)
            .await?
            .ok_or_else(not_found)?;

    // taskDAO.findOne(id): TaskDAO.readAccessQ, Empty → 404.
    let project_id = task_assignment_dao::find_task_project_id(pool, &user, &task_id)
        .await?
        .ok_or_else(not_found)?;

    // projectDAO.findOne(task._project): ProjectDAO.readAccessQ, Empty → 404.
    let team_id = task_assignment_dao::find_project_team_id(pool, &user, &project_id)
        .await?
        .ok_or_else(not_found)?;

    // Fox.assertTrue(..) ?~> Msg.notAllowed (no status: 400).
    if !task_assignment_dao::manages_team(pool, &user, &team_id).await? {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            crate::msg::NOT_ALLOWED,
        ));
    }
    if !manages_user(pool, &user, &assignee_id, &assignee_organization).await? {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            crate::msg::NOT_ALLOWED,
        ));
    }

    let annotation_id = assign_one_to(pool, &task_id, &assignee_id)
        .await?
        .ok_or_else(|| ApiError::bad_request(crate::msg::task::UNAVAILABLE))?;
    initialize_task_annotation(
        pool,
        &tracing_store,
        &user,
        &assignee_id,
        &task_id,
        &annotation_id,
    )
    .await?;
    notification_emails.send_task_assigned_email(
        pool,
        &task_id,
        &annotation_id,
        &assignee_id,
        assignee_is_deactivated,
        &user.id,
    );

    // taskService.publicWrites(taskUpdated)(GlobalAccessContext); plain `Ok`.
    let mut connection = pool.acquire().await?;
    Ok(ResponseJson(
        crate::task::routes::public_json(&mut connection, &user, &task_id, true).await?,
    ))
}

#[cfg(test)]
mod task_assignment_tests;
