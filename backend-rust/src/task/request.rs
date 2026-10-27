//! TaskController.request (`POST /user/tasks/request`): automatic allocation
//! of the next task instance to the requesting user.
//!
//! Flow (Scala order):
//! 1. TaskService.getAllowedTeamsForNextTask: admins may draw from every live
//!    team of their organization; other users from all their teams while they
//!    have fewer than `webKnossos.tasks.maxOpenPerUser` (5) Active Task
//!    annotations outside the teams they manage, otherwise only from the
//!    teams they manage. An empty team list is `task.tooManyOpenOnes` (400),
//!    also for users without any team (Scala parity).
//! 2. UserService.isTeamManagerOrAdminOfOrg (own organization): admin, or
//!    team manager of any team.
//! 3. TaskDAO.assignNext: pick the highest-priority task (findNextTaskQ) and
//!    insert an `Initializing` Task annotation; nothing → `task.unavailable`
//!    (400).
//! 4. AnnotationService.createAnnotationFor + abort on failure
//!    ([`initialize_task_annotation`], duplicate RPC on the 2 h transport).
//! 5. `JsonOk(annotationService.publicWrites(annotation, Some(user)),
//!    Msg.Task.assigned)`.
//!
//! Deviations (see checkpoints/task-request.md):
//! - Concurrency: instead of a SERIALIZABLE INSERT…SELECT with 50 retries,
//!   each attempt is a READ COMMITTED transaction that selects the candidate
//!   with `FOR UPDATE OF t` (waiting, not SKIP LOCKED: skipping a locked task
//!   could hand a concurrent requester a lower-priority task or a spurious
//!   `task.unavailable`), re-checks the complete candidate predicate for the
//!   locked task in a fresh statement snapshot (pending instances, the user's
//!   own previous annotations, paused project, …), and inserts while holding
//!   the row lock. A failed re-check rolls back and retries (at most 50
//!   attempts, like Scala's retry count). In the uncontended case the same
//!   query picks the same task as Scala's.
//! - `maxOpenPerUser` comes from WK_TASKS_MAX_OPEN_PER_USER (MiscConfig, default 5).
//! - Database faults during selection are 500 (crate convention); Scala
//!   wraps every assignNext failure into `task.unavailable`. An empty team
//!   list is `task.unavailable` here as there (Scala: the empty SQL tuple
//!   fails the query).
use axum::{Extension, Json as ResponseJson, Router, extract::State, routing::post};
use serde_json::{Value, json};
use sqlx::PgPool;

use crate::{
    AppState,
    auth::AuthUser,
    error::{ApiError, ApiResult},
    state::JobsEnabled,
    stores::tracing_client::TracingStoreClient,
    system::application_info::MiscState,
    task::assignment::{
        dao::{self, insert_initializing_annotation},
        initialize_task_annotation,
    },
    util::id::ObjectId,
};

/// Msg.Task.tooManyOpenOnes.
pub(crate) const TOO_MANY_OPEN_TASKS: &str = "You already have too many open tasks.";
/// Msg.Task.assigned.
pub(crate) const TASK_ASSIGNED: &str = "You have been assigned a new task.";
/// TaskDAO.assignNext `retryCount = 50`.
const MAX_ATTEMPTS: usize = 50;

pub fn router() -> Router<AppState> {
    Router::new().route("/user/tasks/request", post(request))
}

// ---------------------------------------------------------------------------
// TaskService.getAllowedTeamsForNextTask / isTeamManagerOrAdminOfOrg
// ---------------------------------------------------------------------------

/// TaskService.getAllowedTeamsForNextTask.
pub(crate) async fn allowed_teams_for_next_task(
    pool: &PgPool,
    user: &AuthUser,
    max_open_tasks_per_user: i64,
) -> ApiResult<Vec<ObjectId>> {
    if user.is_admin {
        // teamDAO.findAllIdsByOrganization: an admin reads every live team of
        // the own organization.
        return dao::find_all_team_ids_by_organization(pool, &user.organization_id).await;
    }
    let managed = dao::find_team_ids(pool, &user.id, true).await?;
    let open = dao::count_open_non_admin_tasks(pool, user, &managed).await?;
    let teams = if open < max_open_tasks_per_user {
        dao::find_team_ids(pool, &user.id, false).await?
    } else {
        managed
    };
    if teams.is_empty() {
        return Err(ApiError::bad_request(TOO_MANY_OPEN_TASKS));
    }
    Ok(teams)
}

/// UserService.isTeamManagerOrAdminOfOrg(user, user._organization).
async fn is_team_manager_or_admin(pool: &PgPool, user: &AuthUser) -> ApiResult<bool> {
    if user.is_admin {
        return Ok(true);
    }
    dao::is_team_manager(pool, &user.id).await
}

// ---------------------------------------------------------------------------
// TaskDAO.assignNext
// ---------------------------------------------------------------------------

/// One allocation attempt in its own transaction. `Ok(None)`: no task;
/// `Ok(Some(None))`: the locked candidate no longer qualifies (retry);
/// `Ok(Some(Some(..)))`: committed Initializing annotation.
async fn try_assign_next(
    pool: &PgPool,
    user_id: &ObjectId,
    team_ids: &[ObjectId],
    is_team_manager_or_admin: bool,
) -> ApiResult<Option<Option<(ObjectId, ObjectId)>>> {
    let mut tx = pool.begin().await?;
    let candidate =
        dao::find_next_task_for_update(&mut tx, user_id, team_ids, is_team_manager_or_admin)
            .await?;
    let Some(task_id) = candidate else {
        return Ok(None);
    };
    if !dao::is_next_task_candidate(
        &mut tx,
        user_id,
        team_ids,
        is_team_manager_or_admin,
        &task_id,
    )
    .await?
    {
        return Ok(Some(None));
    }
    let Some(annotation_id) = insert_initializing_annotation(&mut tx, &task_id, user_id).await?
    else {
        // No live dataset at all: Scala's `FROM task, dataset` is empty.
        return Ok(None);
    };
    tx.commit().await?;
    Ok(Some(Some((task_id, annotation_id))))
}

/// TaskDAO.assignNext: `(taskId, initializingAnnotationId)` or `None`
/// (→ `task.unavailable`).
pub(crate) async fn assign_next(
    pool: &PgPool,
    user_id: &ObjectId,
    team_ids: &[ObjectId],
    is_team_manager_or_admin: bool,
) -> ApiResult<Option<(ObjectId, ObjectId)>> {
    for attempt in 1..=MAX_ATTEMPTS {
        match try_assign_next(pool, user_id, team_ids, is_team_manager_or_admin).await? {
            None => return Ok(None),
            Some(Some(assigned)) => return Ok(Some(assigned)),
            Some(None) => {
                tracing::debug!(
                    attempt,
                    user = %user_id,
                    "task request: candidate taken, retrying"
                );
            }
        }
    }
    tracing::warn!(user = %user_id, "task request: retries exhausted");
    Ok(None)
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

async fn request(
    State(state): State<AppState>,
    Extension(tracing_store): Extension<TracingStoreClient>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
    State(misc): State<MiscState>,
    user: AuthUser,
) -> ApiResult<ResponseJson<Value>> {
    let pool = &state.pool;
    let teams =
        allowed_teams_for_next_task(pool, &user, misc.config().max_open_tasks_per_user).await?;
    let is_manager = is_team_manager_or_admin(pool, &user).await?;
    let (task_id, annotation_id) = assign_next(pool, &user.id, &teams, is_manager)
        .await?
        .ok_or_else(|| ApiError::bad_request(crate::msg::task::UNAVAILABLE))?;
    tracing::info!(task = %task_id, annotation = %annotation_id, user = %user.id, "task request: assigned");
    initialize_task_annotation(
        pool,
        &tracing_store,
        &user,
        &user.id,
        &task_id,
        &annotation_id,
    )
    .await?;
    let mut connection = pool.acquire().await?;
    let mut json =
        crate::annotation::lists::full_json(&mut connection, &user, &annotation_id, jobs_enabled)
            .await?;
    json["messages"] = json!([{ "success": TASK_ASSIGNED }]);
    Ok(ResponseJson(json))
}
