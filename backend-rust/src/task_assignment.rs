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
use axum::{
    Extension, Json as ResponseJson, Router, extract::State, http::StatusCode, routing::post,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::Value;
use sqlx::{FromRow, PgConnection, PgPool};

use crate::{
    AppState,
    annotation_duplicate::duplicate_in_tracing_store,
    annotation_provider::{
        AnnotationLayer, AnnotationLayerType, FoxFailure, ProviderError, RESOURCE_NOT_FOUND,
        dataset_not_found_for_annotation, dataset_not_usable,
    },
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::{Path, Query},
    id::ObjectId,
    tracingstore_client::{DuplicateAnnotationRequest, TracingStoreClient},
};

/// Msg.Task.unavailable.
pub(crate) const TASK_UNAVAILABLE: &str = "There is currently no task available.";
/// Msg.notAllowed.
pub(crate) const NOT_ALLOWED: &str = "You are not authorized to view or edit this resource.";
/// AnnotationService.createAnnotationFor `?~>` messages.
pub(crate) const BASE_ID_FAILED: &str = "Failed to retrieve annotation base id.";

pub fn router(_jobs_enabled: bool) -> Router<AppState> {
    Router::new().route("/tasks/{id}/assign", post(assign_one))
}

// ---------------------------------------------------------------------------
// Step 1: Initializing annotation (TaskDAO.assignOneTo / assignNext)
// ---------------------------------------------------------------------------

/// Locks the live task row if it still has pending instances
/// (`findNextTaskByIdQ`). Returns false when the task is deleted, unknown or
/// fully assigned. Must run inside the caller's transaction, before
/// [`insert_initializing_annotation`].
pub(crate) async fn lock_task_with_pending_instances(
    connection: &mut PgConnection,
    task_id: &str,
) -> ApiResult<bool> {
    let locked: Option<String> = sqlx::query_scalar(
        "SELECT _id FROM webknossos.tasks WHERE _id=$1 AND NOT isDeleted AND pendingInstances > 0 FOR UPDATE",
    )
    .bind(task_id)
    .fetch_optional(&mut *connection)
    .await?;
    Ok(locked.is_some())
}

/// The INSERT of TaskDAO.assignOneTo/assignNext for an already locked task
/// (see [`lock_task_with_pending_instances`]): a new `Initializing` Task
/// annotation owned by `user_id` with the placeholder dataset
/// `SELECT _id FROM datasets_ LIMIT 1` (replaced by updateInitialized),
/// description/name `''`, Internal, tags `{}`, tracingTime 0,
/// created = modified = now. The insert trigger decrements
/// `pendingInstances`. Returns `None` (→ `task.unavailable`) when no live
/// dataset exists at all, as Scala's `FROM task, dataset` yields no row.
pub(crate) async fn insert_initializing_annotation(
    connection: &mut PgConnection,
    task_id: &str,
    user_id: &str,
) -> ApiResult<Option<ObjectId>> {
    let annotation_id = ObjectId::new();
    let inserted = sqlx::query(
        "WITH dataset AS (SELECT _id FROM webknossos.datasets_ LIMIT 1)
         INSERT INTO webknossos.annotations(_id,_dataset,_task,_user,description,visibility,name,state,tags,tracingTime,typ,created,modified,isDeleted)
         SELECT $1,dataset._id,$2,$3,'','Internal','','Initializing','{}',0,'Task',$4,$4,FALSE FROM dataset",
    )
    .bind(annotation_id.as_str())
    .bind(task_id)
    .bind(user_id)
    .bind(now_millis())
    .execute(&mut *connection)
    .await?
    .rows_affected();
    Ok((inserted == 1).then_some(annotation_id))
}

/// TaskDAO.assignOneTo: in one transaction, lock the task if it has pending
/// instances and insert the Initializing annotation for `user_id`. `None`
/// means `?~> Msg.Task.unavailable` (400) in the caller. Does no permission,
/// team or experience checks (manual assignment allows repeated assignment
/// of the same task to the same user, like Scala).
pub(crate) async fn assign_one_to(
    pool: &PgPool,
    task_id: &str,
    user_id: &str,
) -> ApiResult<Option<ObjectId>> {
    let mut tx = pool.begin().await?;
    if !lock_task_with_pending_instances(&mut tx, task_id).await? {
        return Ok(None);
    }
    let Some(annotation_id) = insert_initializing_annotation(&mut tx, task_id, user_id).await?
    else {
        return Ok(None);
    };
    tx.commit().await?;
    Ok(Some(annotation_id))
}

// ---------------------------------------------------------------------------
// Step 2: AnnotationService.createAnnotationFor
// ---------------------------------------------------------------------------

/// The TracingBase fields copied into the new Task annotation.
#[derive(Debug, FromRow)]
struct AnnotationBase {
    id: String,
    dataset_id: String,
    owner_id: String,
    description: String,
    visibility: String,
    name: String,
    tags: Vec<String>,
    tracing_time: Option<i64>,
    collaboration_mode: String,
}

fn failure(message: impl Into<String>) -> ProviderError {
    ProviderError::Failure(FoxFailure {
        message: message.into(),
        chain: Vec::new(),
        status: None,
    })
}

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
    assignee_id: &str,
    task_id: &str,
    initializing_annotation_id: &ObjectId,
) -> Result<(), ProviderError> {
    let base: Option<AnnotationBase> = sqlx::query_as(&format!(
        "SELECT a._id AS id,a._dataset AS dataset_id,a._user AS owner_id,a.description,
           a.visibility::text AS visibility,a.name,a.tags,a.tracingTime AS tracing_time,
           a.collaborationMode::text AS collaboration_mode
         FROM webknossos.annotations_ a
         WHERE a._task=$4 AND a.typ='TracingBase' AND a.state<>'Cancelled' AND {}
         LIMIT 1",
        crate::annotation_access::READ_PREDICATE
    ))
    .bind(&context_user.id)
    .bind(&context_user.organization_id)
    .bind(context_user.is_admin)
    .bind(task_id)
    .fetch_optional(pool)
    .await?;
    let base = base.ok_or_else(|| failure(BASE_ID_FAILED))?;

    let is_usable: Option<bool> = sqlx::query_scalar(&format!(
        "SELECT d.isUsable FROM webknossos.datasets_ d WHERE d._id=$3 AND {}",
        crate::dataset_access::READ_PREDICATE
    ))
    .bind(&context_user.id)
    .bind(None::<&str>)
    .bind(&base.dataset_id)
    .fetch_optional(pool)
    .await?;
    match is_usable {
        None => {
            return Err(failure(dataset_not_found_for_annotation(
                &base.dataset_id,
                &base.id,
            )));
        }
        Some(false) => return Err(failure(dataset_not_usable(&base.dataset_id))),
        Some(true) => {}
    }

    tracing::info!(
        annotation = %initializing_annotation_id,
        base = %base.id,
        task = task_id,
        "task assignment: creating annotation from base"
    );
    let request = DuplicateAnnotationRequest {
        source_annotation_id: ObjectId::parse(&base.id)?,
        new_annotation_id: initializing_annotation_id.clone(),
        owner_id: ObjectId::parse(&base.owner_id)?,
        requesting_user_id: ObjectId::parse(assignee_id)?,
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

fn layer_type(typ: AnnotationLayerType) -> &'static str {
    match typ {
        AnnotationLayerType::Skeleton => "Skeleton",
        AnnotationLayerType::Volume => "Volume",
    }
}

/// AnnotationDAO.updateInitialized for `annotationBase.copy(_id, _user =
/// assignee, layers, state = Active, typ = Task, created = modified = now)`:
/// one transaction updating the row and replacing its layers (statistics
/// `{}`). Only a live `Initializing` row is updated (see module docs).
async fn update_initialized(
    pool: &PgPool,
    annotation_id: &ObjectId,
    assignee_id: &str,
    base: &AnnotationBase,
    layers: &[AnnotationLayer],
) -> Result<(), ProviderError> {
    let now = now_millis();
    let mut tx = pool.begin().await?;
    let updated = sqlx::query(
        "UPDATE webknossos.annotations SET _dataset=$2,_user=$3,description=$4,
           visibility=$5::webknossos.ANNOTATION_VISIBILITY,name=$6,state='Active',tags=$7,
           tracingTime=$8,typ='Task',
           collaborationMode=$9::webknossos.ANNOTATION_COLLABORATION_MODE,
           created=$10,modified=$10,isDeleted=FALSE
         WHERE _id=$1 AND state='Initializing' AND NOT isDeleted",
    )
    .bind(annotation_id.as_str())
    .bind(&base.dataset_id)
    .bind(assignee_id)
    .bind(&base.description)
    .bind(&base.visibility)
    .bind(&base.name)
    .bind(&base.tags)
    .bind(base.tracing_time)
    .bind(&base.collaboration_mode)
    .bind(now)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if updated != 1 {
        tracing::warn!(annotation = %annotation_id, "initializing task annotation vanished");
        return Err(failure(RESOURCE_NOT_FOUND));
    }
    sqlx::query("DELETE FROM webknossos.annotation_layers WHERE _annotation=$1")
        .bind(annotation_id.as_str())
        .execute(&mut *tx)
        .await?;
    for layer in layers {
        sqlx::query(
            "INSERT INTO webknossos.annotation_layers(_annotation,tracingId,typ,name,statistics)
             VALUES($1,$2,$3::webknossos.ANNOTATION_LAYER_TYPE,$4,'{}'::jsonb)",
        )
        .bind(annotation_id.as_str())
        .bind(&layer.tracing_id)
        .bind(layer_type(layer.typ))
        .bind(&layer.name)
        .execute(&mut *tx)
        .await?;
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
    sqlx::query("DELETE FROM webknossos.annotation_layers WHERE _annotation=$1 AND EXISTS (SELECT 1 FROM webknossos.annotations WHERE _id=$1 AND state='Initializing')")
        .bind(annotation_id.as_str())
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM webknossos.annotations WHERE _id=$1 AND state='Initializing'")
        .bind(annotation_id.as_str())
        .execute(&mut *tx)
        .await?;
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
    assignee_id: &str,
    task_id: &str,
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

/// Instant.now (millisecond precision).
fn now_millis() -> DateTime<Utc> {
    DateTime::from_timestamp_millis(Utc::now().timestamp_millis()).unwrap_or_else(Utc::now)
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
    ApiError::not_found(RESOURCE_NOT_FOUND)
}

/// `userService.isTeamManagerOrAdminOf(requester, project._team)`: the team
/// is read globally (missing → adminNotAllowed, replaced by the route's
/// `?~> notAllowed`); allowed for its team managers and admins of its
/// organization.
async fn manages_team(pool: &PgPool, requester: &AuthUser, team_id: &str) -> ApiResult<bool> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM webknossos.teams_ t WHERE t._id=$1 AND (
           ($3 AND t._organization=$4)
           OR EXISTS (SELECT 1 FROM webknossos.user_team_roles r WHERE r._team=t._id AND r._user=$2 AND r.isTeamManager)))",
    )
    .bind(team_id)
    .bind(&requester.id)
    .bind(requester.is_admin)
    .bind(&requester.organization_id)
    .fetch_one(pool)
    .await?)
}

/// `userService.isTeamManagerOrAdminOf(requester, assignee)`: the requester
/// manages one of the assignee's teams (raw memberships), or is an admin of
/// the assignee's organization.
async fn manages_user(
    pool: &PgPool,
    requester: &AuthUser,
    assignee_id: &str,
    assignee_organization: &str,
) -> ApiResult<bool> {
    if requester.is_admin && requester.organization_id == assignee_organization {
        return Ok(true);
    }
    Ok(sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM webknossos.user_team_roles member
           JOIN webknossos.user_team_roles manager ON manager._team=member._team
           WHERE member._user=$1 AND manager._user=$2 AND manager.isTeamManager)",
    )
    .bind(assignee_id)
    .bind(&requester.id)
    .fetch_one(pool)
    .await?)
}

async fn assign_one(
    State(state): State<AppState>,
    Extension(tracing_store): Extension<TracingStoreClient>,
    user: AuthUser,
    Path(id): Path<String>,
    Query(query): Query<AssignQuery>,
) -> ApiResult<ResponseJson<Value>> {
    let assignee_id = query
        .user_id
        .ok_or_else(|| ApiError::bad_request("Missing parameter: userId"))?;
    let assignee_id = ObjectId::parse(&assignee_id)?.to_string();
    let task_id = ObjectId::parse_path(&id)?.to_string();
    let pool = &state.pool;

    // userService.findOneCached(userId): UserDAO.readAccessQ, Empty → 404.
    let assignee_organization: String = sqlx::query_scalar(&format!(
        "SELECT usr._organization FROM webknossos.users_ usr WHERE usr._id=$2 AND {}",
        crate::users::READ_ACCESS_PREDICATE
    ))
    .bind(&user.id)
    .bind(&assignee_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(not_found)?;

    // taskDAO.findOne(id): TaskDAO.readAccessQ, Empty → 404.
    let project_id: String = sqlx::query_scalar(
        "SELECT t._project FROM webknossos.tasks_ t WHERE t._id=$1 AND (
           (SELECT p._team FROM webknossos.projects p WHERE p._id=t._project)
             IN (SELECT _team FROM webknossos.user_team_roles WHERE _user=$2)
           OR (SELECT team._organization FROM webknossos.teams team WHERE team._id=(SELECT p._team FROM webknossos.projects p WHERE p._id=t._project))
             IN (SELECT _organization FROM webknossos.users_ WHERE _id=$2 AND isAdmin))",
    )
    .bind(&task_id)
    .bind(&user.id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(not_found)?;

    // projectDAO.findOne(task._project): ProjectDAO.readAccessQ, Empty → 404.
    let team_id: String = sqlx::query_scalar(
        "SELECT p._team FROM webknossos.projects_ p WHERE p._id=$1 AND (
           p._team IN (SELECT _team FROM webknossos.user_team_roles WHERE _user=$2)
           OR p._owner=$2
           OR p._organization=(SELECT _organization FROM webknossos.users_ WHERE _id=$2 AND isAdmin))",
    )
    .bind(&project_id)
    .bind(&user.id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(not_found)?;

    // Fox.assertTrue(..) ?~> Msg.notAllowed (no status: 400).
    if !manages_team(pool, &user, &team_id).await? {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, NOT_ALLOWED));
    }
    if !manages_user(pool, &user, &assignee_id, &assignee_organization).await? {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, NOT_ALLOWED));
    }

    let annotation_id = assign_one_to(pool, &task_id, &assignee_id)
        .await?
        .ok_or_else(|| ApiError::bad_request(TASK_UNAVAILABLE))?;
    initialize_task_annotation(
        pool,
        &tracing_store,
        &user,
        &assignee_id,
        &task_id,
        &annotation_id,
    )
    .await?;

    // taskService.publicWrites(taskUpdated)(GlobalAccessContext); plain `Ok`.
    let mut connection = pool.acquire().await?;
    Ok(ResponseJson(
        crate::tasks::public_json(&mut connection, &user, &task_id, true).await?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layer_types_match_schema_enum() {
        assert_eq!(layer_type(AnnotationLayerType::Skeleton), "Skeleton");
        assert_eq!(layer_type(AnnotationLayerType::Volume), "Volume");
    }
}
