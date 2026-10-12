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
use sqlx::{PgConnection, PgPool};

use crate::{
    AppState, annotation_lists,
    application_info::MiscState,
    auth::AuthUser,
    error::{ApiError, ApiResult},
    id::ObjectId,
    task_assignment::{
        TASK_UNAVAILABLE, initialize_task_annotation, insert_initializing_annotation,
    },
    tracingstore_client::TracingStoreClient,
};

/// Msg.Task.tooManyOpenOnes.
pub(crate) const TOO_MANY_OPEN_TASKS: &str = "You already have too many open tasks.";
/// Msg.Task.assigned.
pub(crate) const TASK_ASSIGNED: &str = "You have been assigned a new task.";
/// TaskDAO.assignNext `retryCount = 50`.
const MAX_ATTEMPTS: usize = 50;

pub fn router(jobs_enabled: bool) -> Router<AppState> {
    Router::new()
        .route("/user/tasks/request", post(request))
        .layer(Extension(JobsEnabled(jobs_enabled)))
}

#[derive(Clone, Copy)]
struct JobsEnabled(bool);

// ---------------------------------------------------------------------------
// TaskService.getAllowedTeamsForNextTask / isTeamManagerOrAdminOfOrg
// ---------------------------------------------------------------------------

/// `userService.teamIdsFor` / `teamManagerTeamIdsFor` (raw memberships).
async fn team_ids(pool: &PgPool, user_id: &str, managed_only: bool) -> ApiResult<Vec<String>> {
    Ok(sqlx::query_scalar(
        "SELECT _team FROM webknossos.user_team_roles WHERE _user=$1 AND (NOT $2 OR isTeamManager)",
    )
    .bind(user_id)
    .bind(managed_only)
    .fetch_all(pool)
    .await?)
}

/// AnnotationDAO.countActiveAnnotationsFor(user, Task, teamManagerTeamIds) in
/// the user's access context.
async fn count_open_non_admin_tasks(
    pool: &PgPool,
    user: &AuthUser,
    managed_team_ids: &[String],
) -> ApiResult<i64> {
    Ok(sqlx::query_scalar(&format!(
        "SELECT COUNT(*) FROM webknossos.annotations_ a
         JOIN webknossos.tasks_ t ON a._task=t._id
         JOIN webknossos.projects_ p ON t._project=p._id
         WHERE a._user=$1 AND a.typ='Task' AND a.state='Active' AND {}
           AND NOT (p._team = ANY($4::text[]))",
        crate::annotation_access::READ_PREDICATE
    ))
    .bind(&user.id)
    .bind(&user.organization_id)
    .bind(user.is_admin)
    .bind(managed_team_ids)
    .fetch_one(pool)
    .await?)
}

/// TaskService.getAllowedTeamsForNextTask.
pub(crate) async fn allowed_teams_for_next_task(
    pool: &PgPool,
    user: &AuthUser,
    max_open_tasks_per_user: i64,
) -> ApiResult<Vec<String>> {
    if user.is_admin {
        // teamDAO.findAllIdsByOrganization: an admin reads every live team of
        // the own organization.
        return Ok(
            sqlx::query_scalar("SELECT _id FROM webknossos.teams_ WHERE _organization=$1")
                .bind(&user.organization_id)
                .fetch_all(pool)
                .await?,
        );
    }
    let managed = team_ids(pool, &user.id, true).await?;
    let open = count_open_non_admin_tasks(pool, user, &managed).await?;
    let teams = if open < max_open_tasks_per_user {
        team_ids(pool, &user.id, false).await?
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
    Ok(sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM webknossos.user_team_roles WHERE _user=$1 AND isTeamManager)",
    )
    .bind(&user.id)
    .fetch_one(pool)
    .await?)
}

// ---------------------------------------------------------------------------
// TaskDAO.assignNext
// ---------------------------------------------------------------------------

/// TaskDAO.findNextTaskQ predicate. Binds: $1 user, $2 allowed team ids,
/// $3 isTeamManagerOrAdmin. The experience join yields at most one row per
/// task (user_experiences PK is (_user, domain)); the LEFT JOIN … IS NULL of
/// the user's previous Task annotations is written as NOT EXISTS.
const NEXT_TASK_FROM_WHERE: &str = "FROM webknossos.tasks t
     JOIN webknossos.user_experiences ux
       ON ux._user=$1 AND t.neededExperience_domain=ux.domain AND t.neededExperience_value<=ux.value
     JOIN webknossos.projects p ON t._project=p._id AND NOT p.isDeleted
     WHERE NOT t.isDeleted
       AND t.pendingInstances > 0
       AND p._team = ANY($2::text[])
       AND NOT EXISTS (
         SELECT 1 FROM webknossos.annotations_ a
         WHERE a._task=t._id AND a._user=$1 AND a.typ='Task'
           AND NOT ($3 AND a.state='Cancelled'))
       AND NOT p.paused";

/// One allocation attempt in its own transaction. `Ok(None)`: no task;
/// `Ok(Some(None))`: the locked candidate no longer qualifies (retry);
/// `Ok(Some(Some(..)))`: committed Initializing annotation.
async fn try_assign_next(
    pool: &PgPool,
    user_id: &str,
    team_ids: &[String],
    is_team_manager_or_admin: bool,
) -> ApiResult<Option<Option<(String, ObjectId)>>> {
    let mut tx = pool.begin().await?;
    let candidate: Option<String> = sqlx::query_scalar(&format!(
        "SELECT t._id {NEXT_TASK_FROM_WHERE} ORDER BY p.priority DESC LIMIT 1 FOR UPDATE OF t"
    ))
    .bind(user_id)
    .bind(team_ids)
    .bind(is_team_manager_or_admin)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(task_id) = candidate else {
        return Ok(None);
    };
    if !still_qualifies(
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

/// Re-evaluates the full candidate predicate for the locked task in a fresh
/// READ COMMITTED statement snapshot (sees transactions committed while the
/// lock was awaited, e.g. a concurrent request of the same user).
async fn still_qualifies(
    connection: &mut PgConnection,
    user_id: &str,
    team_ids: &[String],
    is_team_manager_or_admin: bool,
    task_id: &str,
) -> ApiResult<bool> {
    Ok(sqlx::query_scalar(&format!(
        "SELECT EXISTS (SELECT 1 {NEXT_TASK_FROM_WHERE} AND t._id=$4)"
    ))
    .bind(user_id)
    .bind(team_ids)
    .bind(is_team_manager_or_admin)
    .bind(task_id)
    .fetch_one(&mut *connection)
    .await?)
}

/// TaskDAO.assignNext: `(taskId, initializingAnnotationId)` or `None`
/// (→ `task.unavailable`).
pub(crate) async fn assign_next(
    pool: &PgPool,
    user_id: &str,
    team_ids: &[String],
    is_team_manager_or_admin: bool,
) -> ApiResult<Option<(String, ObjectId)>> {
    for attempt in 1..=MAX_ATTEMPTS {
        match try_assign_next(pool, user_id, team_ids, is_team_manager_or_admin).await? {
            None => return Ok(None),
            Some(Some(assigned)) => return Ok(Some(assigned)),
            Some(None) => {
                tracing::debug!(
                    attempt,
                    user = user_id,
                    "task request: candidate taken, retrying"
                );
            }
        }
    }
    tracing::warn!(user = user_id, "task request: retries exhausted");
    Ok(None)
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

async fn request(
    State(state): State<AppState>,
    Extension(tracing_store): Extension<TracingStoreClient>,
    Extension(JobsEnabled(jobs_enabled)): Extension<JobsEnabled>,
    Extension(misc): Extension<MiscState>,
    user: AuthUser,
) -> ApiResult<ResponseJson<Value>> {
    let pool = &state.pool;
    let teams =
        allowed_teams_for_next_task(pool, &user, misc.config().max_open_tasks_per_user).await?;
    let is_manager = is_team_manager_or_admin(pool, &user).await?;
    let (task_id, annotation_id) = assign_next(pool, &user.id, &teams, is_manager)
        .await?
        .ok_or_else(|| ApiError::bad_request(TASK_UNAVAILABLE))?;
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
        annotation_lists::full_json(&mut connection, &user, annotation_id.as_str(), jobs_enabled)
            .await?;
    json["messages"] = json!([{ "success": TASK_ASSIGNED }]);
    Ok(ResponseJson(json))
}
