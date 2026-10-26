//! Queries of task assignment: the manual assignOne flow and the automatic
//! allocation of TaskController.request (TaskDAO.assignOneTo / assignNext and
//! the annotation rows they create), plus the user, team and project
//! access lookups both run.
use sqlx::{FromRow, PgConnection, PgPool};

use crate::{
    annotation::provider::AnnotationLayer,
    auth::AuthUser,
    error::ApiResult,
    sql::Sql,
    util::{id::ObjectId, instant::now_millis},
};

/// Locks the live task row if it still has pending instances
/// (`findNextTaskByIdQ`). Returns false when the task is deleted, unknown or
/// fully assigned. Must run inside the caller's transaction, before
/// [`insert_initializing_annotation`].
pub(crate) async fn lock_task_with_pending_instances(
    connection: &mut PgConnection,
    task_id: &ObjectId,
) -> ApiResult<bool> {
    let locked: Option<ObjectId> = sqlx::query_scalar(
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
    task_id: &ObjectId,
    user_id: &ObjectId,
) -> ApiResult<Option<ObjectId>> {
    let annotation_id = ObjectId::new();
    let inserted = sqlx::query(
        "WITH dataset AS (SELECT _id FROM webknossos.datasets_ LIMIT 1)
         INSERT INTO webknossos.annotations(_id,_dataset,_task,_user,description,visibility,name,state,tags,tracingTime,typ,created,modified,isDeleted)
         SELECT $1,dataset._id,$2,$3,'','Internal','','Initializing','{}',0,'Task',$4,$4,FALSE FROM dataset",
    )
    .bind(&annotation_id)
    .bind(task_id)
    .bind(user_id)
    .bind(now_millis())
    .execute(&mut *connection)
    .await?
    .rows_affected();
    Ok((inserted == 1).then_some(annotation_id))
}

/// The TracingBase fields copied into the new Task annotation.
#[derive(Debug, FromRow)]
pub(crate) struct AnnotationBase {
    pub id: ObjectId,
    pub dataset_id: ObjectId,
    pub owner_id: ObjectId,
    pub description: String,
    pub visibility: String,
    pub name: String,
    pub tags: Vec<String>,
    pub tracing_time: Option<i64>,
    pub collaboration_mode: String,
}

/// `findBaseIdForTask`: the live, non-Cancelled TracingBase of the task
/// readable by `context_user` (AnnotationDAO.readAccessQ).
pub(crate) async fn find_annotation_base(
    pool: &PgPool,
    context_user: &AuthUser,
    task_id: &ObjectId,
) -> ApiResult<Option<AnnotationBase>> {
    let mut q = Sql::new(
        "SELECT a._id AS id,a._dataset AS dataset_id,a._user AS owner_id,a.description,
           a.visibility::text AS visibility,a.name,a.tags,a.tracingTime AS tracing_time,
           a.collaborationMode::text AS collaboration_mode
         FROM webknossos.annotations_ a
         WHERE a._task=",
    );
    q.push_bind(task_id)
        .push(" AND a.typ='TracingBase' AND a.state<>'Cancelled' AND ");
    crate::annotation::access::push_read_predicate(&mut q, context_user.into());
    q.push(" LIMIT 1");
    Ok(q.build_query_as().fetch_optional(pool).await?)
}

/// `isUsable` of the dataset, if `context_user` may read it.
pub(crate) async fn find_dataset_is_usable(
    pool: &PgPool,
    context_user: &AuthUser,
    dataset_id: &ObjectId,
) -> ApiResult<Option<bool>> {
    let mut q = Sql::new("SELECT d.isUsable FROM webknossos.datasets_ d WHERE d._id=");
    q.push_bind(dataset_id).push(" AND ");
    crate::dataset::access::push_read_predicate(&mut q, (&context_user.id).into(), None);
    Ok(q.build_query_scalar().fetch_optional(pool).await?)
}

/// AnnotationDAO.updateInitialized, annotation row: only a live
/// `Initializing` row is updated. Returns the number of updated rows.
pub(crate) async fn update_initialized_annotation(
    connection: &mut PgConnection,
    annotation_id: &ObjectId,
    assignee_id: &ObjectId,
    base: &AnnotationBase,
    now: chrono::DateTime<chrono::Utc>,
) -> ApiResult<u64> {
    Ok(sqlx::query(
        "UPDATE webknossos.annotations SET _dataset=$2,_user=$3,description=$4,
           visibility=$5::webknossos.ANNOTATION_VISIBILITY,name=$6,state='Active',tags=$7,
           tracingTime=$8,typ='Task',
           collaborationMode=$9::webknossos.ANNOTATION_COLLABORATION_MODE,
           created=$10,modified=$10,isDeleted=FALSE
         WHERE _id=$1 AND state='Initializing' AND NOT isDeleted",
    )
    .bind(annotation_id)
    .bind(&base.dataset_id)
    .bind(assignee_id)
    .bind(&base.description)
    .bind(&base.visibility)
    .bind(&base.name)
    .bind(&base.tags)
    .bind(base.tracing_time)
    .bind(&base.collaboration_mode)
    .bind(now)
    .execute(connection)
    .await?
    .rows_affected())
}

pub(crate) async fn delete_annotation_layers(
    connection: &mut PgConnection,
    annotation_id: &ObjectId,
) -> ApiResult<()> {
    sqlx::query("DELETE FROM webknossos.annotation_layers WHERE _annotation=$1")
        .bind(annotation_id)
        .execute(connection)
        .await?;
    Ok(())
}

pub(crate) async fn insert_annotation_layer(
    connection: &mut PgConnection,
    annotation_id: &ObjectId,
    layer: &AnnotationLayer,
) -> ApiResult<()> {
    sqlx::query(
        "INSERT INTO webknossos.annotation_layers(_annotation,tracingId,typ,name,statistics)
             VALUES($1,$2,$3::webknossos.ANNOTATION_LAYER_TYPE,$4,'{}'::jsonb)",
    )
    .bind(annotation_id)
    .bind(&layer.tracing_id)
    .bind(layer.typ.as_str())
    .bind(&layer.name)
    .execute(connection)
    .await?;
    Ok(())
}

/// AnnotationDAO.abortInitializingAnnotation, layers: only while the annotation is `Initializing`.
pub(crate) async fn delete_initializing_annotation_layers(
    connection: &mut PgConnection,
    annotation_id: &ObjectId,
) -> ApiResult<()> {
    sqlx::query("DELETE FROM webknossos.annotation_layers WHERE _annotation=$1 AND EXISTS (SELECT 1 FROM webknossos.annotations WHERE _id=$1 AND state='Initializing')")
        .bind(annotation_id)
        .execute(connection)
        .await?;
    Ok(())
}

/// AnnotationDAO.abortInitializingAnnotation, row: only while it is `Initializing`.
pub(crate) async fn delete_initializing_annotation(
    connection: &mut PgConnection,
    annotation_id: &ObjectId,
) -> ApiResult<()> {
    sqlx::query("DELETE FROM webknossos.annotations WHERE _id=$1 AND state='Initializing'")
        .bind(annotation_id)
        .execute(connection)
        .await?;
    Ok(())
}

/// `userService.isTeamManagerOrAdminOf(requester, project._team)`: the team
/// is read globally; allowed for its team managers and admins of its
/// organization.
pub(crate) async fn manages_team(
    pool: &PgPool,
    requester: &AuthUser,
    team_id: &ObjectId,
) -> ApiResult<bool> {
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

/// Whether the requester manages one of the assignee's teams (raw memberships).
pub(crate) async fn manages_user_through_team(
    pool: &PgPool,
    requester: &AuthUser,
    assignee_id: &ObjectId,
) -> ApiResult<bool> {
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

/// UserDAO.readAccessQ lookup: the assignee's organization and whether they
/// are deactivated.
pub(crate) async fn find_assignee(
    pool: &PgPool,
    user: &AuthUser,
    assignee_id: &ObjectId,
) -> ApiResult<Option<(String, bool)>> {
    let mut q = Sql::new(
        "SELECT usr._organization, usr.isDeactivated FROM webknossos.users_ usr WHERE usr._id=",
    );
    q.push_bind(assignee_id).push(" AND ");
    crate::users::push_read_access(&mut q, (&user.id).into());
    Ok(q.build_query_as().fetch_optional(pool).await?)
}

/// TaskDAO.readAccessQ lookup: the project id of the task.
pub(crate) async fn find_task_project_id(
    pool: &PgPool,
    user: &AuthUser,
    task_id: &ObjectId,
) -> ApiResult<Option<ObjectId>> {
    Ok(sqlx::query_scalar(
        "SELECT t._project FROM webknossos.tasks_ t WHERE t._id=$1 AND (
           (SELECT p._team FROM webknossos.projects p WHERE p._id=t._project)
             IN (SELECT _team FROM webknossos.user_team_roles WHERE _user=$2)
           OR (SELECT team._organization FROM webknossos.teams team WHERE team._id=(SELECT p._team FROM webknossos.projects p WHERE p._id=t._project))
             IN (SELECT _organization FROM webknossos.users_ WHERE _id=$2 AND isAdmin))",
    )
    .bind(task_id)
    .bind(&user.id)
    .fetch_optional(pool)
    .await?)
}

/// ProjectDAO.readAccessQ lookup: the team id of the project.
pub(crate) async fn find_project_team_id(
    pool: &PgPool,
    user: &AuthUser,
    project_id: &ObjectId,
) -> ApiResult<Option<ObjectId>> {
    Ok(sqlx::query_scalar(
        "SELECT p._team FROM webknossos.projects_ p WHERE p._id=$1 AND (
           p._team IN (SELECT _team FROM webknossos.user_team_roles WHERE _user=$2)
           OR p._owner=$2
           OR p._organization=(SELECT _organization FROM webknossos.users_ WHERE _id=$2 AND isAdmin))",
    )
    .bind(project_id)
    .bind(&user.id)
    .fetch_optional(pool)
    .await?)
}

// ---------------------------------------------------------------------------
// TaskController.request: TaskService.getAllowedTeamsForNextTask and TaskDAO.assignNext
// ---------------------------------------------------------------------------

/// `userService.teamIdsFor` / `teamManagerTeamIdsFor` (raw memberships).
pub(crate) async fn find_team_ids(
    pool: &PgPool,
    user_id: &ObjectId,
    managed_only: bool,
) -> ApiResult<Vec<ObjectId>> {
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
pub(crate) async fn count_open_non_admin_tasks(
    pool: &PgPool,
    user: &AuthUser,
    managed_team_ids: &[ObjectId],
) -> ApiResult<i64> {
    let mut q = Sql::new(
        "SELECT COUNT(*) FROM webknossos.annotations_ a
         JOIN webknossos.tasks_ t ON a._task=t._id
         JOIN webknossos.projects_ p ON t._project=p._id
         WHERE a._user=",
    );
    q.push_bind(&user.id)
        .push(" AND a.typ='Task' AND a.state='Active' AND ");
    crate::annotation::access::push_read_predicate(&mut q, user.into());
    q.push(" AND NOT (p._team = ANY(")
        .push_bind(managed_team_ids)
        .push("::text[]))");
    Ok(q.build_query_scalar().fetch_one(pool).await?)
}

/// teamDAO.findAllIdsByOrganization: every live team of the organization.
pub(crate) async fn find_all_team_ids_by_organization(
    pool: &PgPool,
    organization_id: &str,
) -> ApiResult<Vec<ObjectId>> {
    Ok(
        sqlx::query_scalar("SELECT _id FROM webknossos.teams_ WHERE _organization=$1")
            .bind(organization_id)
            .fetch_all(pool)
            .await?,
    )
}

/// Whether the user is a team manager of any team.
pub(crate) async fn is_team_manager(pool: &PgPool, user_id: &ObjectId) -> ApiResult<bool> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM webknossos.user_team_roles WHERE _user=$1 AND isTeamManager)",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?)
}

/// TaskDAO.findNextTaskQ `FROM … WHERE` for the user, the allowed team ids
/// and isTeamManagerOrAdmin. The experience join yields at most one row per
/// task (user_experiences PK is (_user, domain)); the LEFT JOIN … IS NULL of
/// the user's previous Task annotations is written as NOT EXISTS.
fn push_next_task_from_where<'a>(
    q: &mut Sql<'a>,
    user_id: &'a ObjectId,
    team_ids: &'a [ObjectId],
    is_team_manager_or_admin: bool,
) {
    q.push(
        "FROM webknossos.tasks t
     JOIN webknossos.user_experiences ux
       ON ux._user=",
    )
    .push_bind(user_id)
    .push(
        " AND t.neededExperience_domain=ux.domain AND t.neededExperience_value<=ux.value
     JOIN webknossos.projects p ON t._project=p._id AND NOT p.isDeleted
     WHERE NOT t.isDeleted
       AND t.pendingInstances > 0
       AND p._team = ANY(",
    )
    .push_bind(team_ids)
    .push(
        "::text[])
       AND NOT EXISTS (
         SELECT 1 FROM webknossos.annotations_ a
         WHERE a._task=t._id AND a._user=",
    )
    .push_bind(user_id)
    .push(" AND a.typ='Task' AND NOT (")
    .push_bind(is_team_manager_or_admin)
    .push(" AND a.state='Cancelled')) AND NOT p.paused");
}

/// The highest-priority task the user may be assigned, locked FOR UPDATE.
pub(crate) async fn find_next_task_for_update(
    connection: &mut PgConnection,
    user_id: &ObjectId,
    team_ids: &[ObjectId],
    is_team_manager_or_admin: bool,
) -> ApiResult<Option<ObjectId>> {
    let mut q = Sql::new("SELECT t._id ");
    push_next_task_from_where(&mut q, user_id, team_ids, is_team_manager_or_admin);
    q.push(" ORDER BY p.priority DESC LIMIT 1 FOR UPDATE OF t");
    Ok(q.build_query_scalar().fetch_optional(connection).await?)
}

/// Re-evaluates the full candidate predicate for the locked task in a fresh
/// READ COMMITTED statement snapshot (sees transactions committed while the
/// lock was awaited, e.g. a concurrent request of the same user).
pub(crate) async fn is_next_task_candidate(
    connection: &mut PgConnection,
    user_id: &ObjectId,
    team_ids: &[ObjectId],
    is_team_manager_or_admin: bool,
    task_id: &ObjectId,
) -> ApiResult<bool> {
    let mut q = Sql::new("SELECT EXISTS (SELECT 1 ");
    push_next_task_from_where(&mut q, user_id, team_ids, is_team_manager_or_admin);
    q.push(" AND t._id=").push_bind(task_id).push(")");
    Ok(q.build_query_scalar().fetch_one(&mut *connection).await?)
}
