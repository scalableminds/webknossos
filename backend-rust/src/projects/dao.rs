//! ProjectDAO: the projects queries, plus the task, task type, team, user,
//! annotation and dataset lookups that the project routes run.
use serde_json::Value;
use sqlx::{PgConnection, PgPool, Postgres};

use super::ProjectParameters;
use crate::{
    auth::AuthUser,
    sql::{PushArg, Requester, Sql},
    users,
    util::id::ObjectId,
};

// Build the public contract in PostgreSQL so absent owners/teams remain null,
// matching the Scala service's optional compact owner and team name. The
// owner is only rendered if the requester may read them. Callers append to
// the `WHERE` clause, which already restricts to the requester's read access.
fn public_projects(user: &AuthUser) -> Sql<'_> {
    let mut q = Sql::new(
        r#"SELECT jsonb_build_object(
 'id',p._id,'name',p.name,'team',p._team,'teamName',(SELECT name FROM webknossos.teams_ WHERE _id=p._team),
 'owner',(SELECT jsonb_build_object('id',u._id,'email',m.email,'firstName',m.firstname,'lastName',m.lastname,
    'isAdmin',u.isadmin,'isDatasetManager',u.isdatasetmanager,'isActive',NOT u.isdeactivated,'isAnonymous',false,
    'teams',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t._id,'name',t.name,'isTeamManager',r.isteammanager))
        FROM webknossos.user_team_roles r JOIN webknossos.teams_ t ON t._id=r._team
        WHERE r._user=u._id AND t._organization=u._organization),'[]'::jsonb))
    FROM webknossos.users_ u JOIN webknossos.multiusers_ m ON m._id=u._multiuser
    WHERE u._id=p._owner AND u._organization="#,
    );
    q.push_bind(user.organization_id.as_str())
        .push(" AND (u._id=")
        .push_bind(&user.id)
        .push(" OR ")
        .push_bind(user.is_admin)
        .push(
            r#" OR EXISTS (
      SELECT 1 FROM webknossos.user_team_roles owner_role
      JOIN webknossos.user_team_roles reader_role ON reader_role._team=owner_role._team
      JOIN webknossos.teams_ shared_team ON shared_team._id=owner_role._team
      WHERE owner_role._user=u._id AND reader_role._user="#,
        )
        .push_bind(&user.id)
        .push(" AND reader_role.isTeamManager AND shared_team._organization=")
        .push_bind(user.organization_id.as_str())
        .push(
            r#"
    ))),
 'priority',p.priority,'paused',p.paused,'expectedTime',p.expectedtime,
 'isBlacklistedFromReport',p.isblacklistedfromreport,'created',floor(extract(epoch FROM p.created)*1000)::bigint
) AS value FROM webknossos.projects_ p WHERE "#,
        );
    push_read_access(&mut q, user.into());
    q
}

/// ProjectDAO.readAccessQ for alias `p`: projects of the requester's
/// organization they own, administer, or are a member of the team of.
pub(crate) fn push_read_access<'a>(q: &mut Sql<'a>, requester: Requester<'a>) {
    q.push("(p._organization=")
        .push_arg(requester.organization)
        .push(" AND (p._owner=")
        .push_arg(requester.id)
        .push(" OR ")
        .push_bind(requester.is_admin)
        .push(" OR EXISTS(SELECT 1 FROM webknossos.user_team_roles WHERE _user=")
        .push_arg(requester.id)
        .push(" AND _team=p._team)))");
}

/// The public JSON of one project the user may read.
pub(crate) async fn find_one_json<'e, E: sqlx::Executor<'e, Database = Postgres>>(
    executor: E,
    user: &AuthUser,
    id: &ObjectId,
) -> sqlx::Result<Option<Value>> {
    let mut q = public_projects(user);
    q.push(" AND p._id=").push_bind(id);
    q.build_query_scalar().fetch_optional(executor).await
}

/// The public JSON of every project the user may read, oldest first.
pub(crate) async fn find_all_json(pool: &PgPool, user: &AuthUser) -> sqlx::Result<Vec<Value>> {
    let mut q = public_projects(user);
    q.push(" ORDER BY p.created");
    q.build_query_scalar().fetch_all(pool).await
}

pub(crate) async fn find_one_json_by_name(
    pool: &PgPool,
    user: &AuthUser,
    name: &str,
) -> sqlx::Result<Option<Value>> {
    let mut q = public_projects(user);
    q.push(" AND p.name=").push_bind(name);
    q.build_query_scalar().fetch_optional(pool).await
}

/// The public JSON of the readable projects that have tasks of the task type.
pub(crate) async fn find_all_json_for_task_type(
    pool: &PgPool,
    user: &AuthUser,
    task_type_id: &ObjectId,
) -> sqlx::Result<Vec<Value>> {
    let mut q = public_projects(user);
    q.push(" AND EXISTS(SELECT 1 FROM webknossos.tasks_ WHERE _project=p._id AND _tasktype=")
        .push_bind(task_type_id)
        .push(") ORDER BY p.created");
    q.build_query_scalar().fetch_all(pool).await
}

/// Summed (pending instances, tracing time) of the tasks per project id.
pub(crate) async fn find_task_status_for_projects(
    pool: &PgPool,
    ids: Vec<&str>,
) -> sqlx::Result<Vec<(String, i64, i64)>> {
    sqlx::query_as(
        "SELECT \
            _project,COALESCE(sum(pendinginstances),0)::bigint,COALESCE(sum(tracingtime),\
            0)::bigint FROM webknossos.tasks_ WHERE _project=ANY($1) GROUP BY _project",
    )
    .bind(ids)
    .fetch_all(pool)
    .await
}

/// Summed (pending instances, tracing time) of the tasks of one project.
pub(crate) async fn find_task_status<'e, E: sqlx::Executor<'e, Database = Postgres>>(
    executor: E,
    project_id: &str,
) -> sqlx::Result<(i64, i64)> {
    sqlx::query_as(
        "SELECT COALESCE(sum(pendinginstances),0)::bigint, \
            COALESCE(sum(tracingtime),0)::bigint FROM webknossos.tasks_ WHERE _project=$1",
    )
    .bind(project_id)
    .fetch_one(executor)
    .await
}

/// The live owner, locked FOR SHARE, if they belong to the organization.
pub(crate) async fn find_owner_for_share(
    connection: &mut PgConnection,
    owner: &ObjectId,
    organization_id: &str,
) -> sqlx::Result<Option<ObjectId>> {
    sqlx::query_scalar(
        "SELECT _id FROM webknossos.users WHERE _id=$1 AND _organization=$2 AND NOT isDeleted FOR SHARE",
    )
    .bind(owner)
    .bind(organization_id)
    .fetch_optional(connection)
    .await
}

/// Takes a transaction-scoped advisory lock on the organization/project name.
pub(crate) async fn lock_name(
    connection: &mut PgConnection,
    organization_id: &str,
    name: &str,
) -> sqlx::Result<()> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("project:{}:{}", organization_id, name))
        .execute(connection)
        .await?;
    Ok(())
}

pub(crate) async fn is_name_taken(
    connection: &mut PgConnection,
    name: &str,
    organization_id: &str,
) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM webknossos.projects_ WHERE name=$1 AND _organization=$2)",
    )
    .bind(name)
    .bind(organization_id)
    .fetch_one(connection)
    .await
}

pub(crate) async fn insert_one(
    connection: &mut PgConnection,
    id: &ObjectId,
    organization_id: &str,
    parameters: &ProjectParameters,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO \
            webknossos.projects(_id,_organization,_team,_owner,name,priority,paused,\
            expectedtime,isblacklistedfromreport) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    )
    .bind(id)
    .bind(organization_id)
    .bind(&parameters.team)
    .bind(&parameters.owner)
    .bind(&parameters.name)
    .bind(i64::from(parameters.priority))
    .bind(parameters.paused.unwrap_or(false))
    .bind(parameters.expected_time)
    .bind(parameters.is_blacklisted_from_report)
    .execute(connection)
    .await?;
    Ok(())
}

pub(crate) async fn update_one(
    connection: &mut PgConnection,
    id: &ObjectId,
    parameters: &ProjectParameters,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE webknossos.projects SET \
            _team=$2,_owner=$3,priority=$4,expectedtime=$5,isblacklistedfromreport=$6 WHERE \
            _id=$1 AND NOT isdeleted",
    )
    .bind(id)
    .bind(&parameters.team)
    .bind(&parameters.owner)
    .bind(i64::from(parameters.priority))
    .bind(parameters.expected_time)
    .bind(parameters.is_blacklisted_from_report)
    .execute(connection)
    .await?;
    Ok(())
}

pub(crate) async fn update_paused(
    connection: &mut PgConnection,
    id: &ObjectId,
    paused: bool,
) -> sqlx::Result<()> {
    sqlx::query("UPDATE webknossos.projects SET paused=$2 WHERE _id=$1 AND NOT isdeleted")
        .bind(id)
        .bind(paused)
        .execute(connection)
        .await?;
    Ok(())
}

/// Adds `delta` to the total instances of the project's live tasks, limited to
/// the tasks the user may access (admins, or members of the project's team).
pub(crate) async fn increase_task_instances(
    connection: &mut PgConnection,
    user: &AuthUser,
    id: &ObjectId,
    delta: i64,
) -> sqlx::Result<()> {
    sqlx::query("UPDATE webknossos.tasks t SET totalinstances=totalinstances+$2 FROM webknossos.projects_ p WHERE t._project=p._id AND p._id=$1 AND NOT t.isdeleted AND ($3 OR EXISTS(SELECT 1 FROM webknossos.user_team_roles WHERE _user=$4 AND _team=p._team))")
        .bind(id).bind(delta).bind(user.is_admin).bind(&user.id).execute(connection).await?;
    Ok(())
}

/// The task column that [`delete_tasks`] matches against.
#[derive(Clone, Copy)]
pub(crate) enum TaskParent {
    Project,
    TaskType,
}

impl TaskParent {
    fn column(self) -> &'static str {
        match self {
            Self::Project => "_project",
            Self::TaskType => "_tasktype",
        }
    }
}

/// Soft-deletes the tasks (and their annotations) whose `parent` column is `id`.
pub(crate) async fn delete_tasks(
    connection: &mut PgConnection,
    parent: TaskParent,
    id: &ObjectId,
) -> sqlx::Result<()> {
    let column = parent.column();
    Sql::new(
        "UPDATE webknossos.annotations SET isdeleted=true WHERE _task IN (SELECT _id FROM webknossos.tasks WHERE ",
    )
    .push(column)
    .push("=")
    .push_bind(id)
    .push(")")
    .build()
    .execute(&mut *connection)
    .await?;
    Sql::new("UPDATE webknossos.tasks SET isdeleted=true WHERE ")
        .push(column)
        .push("=")
        .push_bind(id)
        .build()
        .execute(connection)
        .await?;
    Ok(())
}

/// The stored owner, independent of whether the requester may see them.
pub(crate) async fn find_owner(
    connection: &mut PgConnection,
    id: &ObjectId,
) -> sqlx::Result<ObjectId> {
    sqlx::query_scalar("SELECT _owner FROM webknossos.projects WHERE _id=$1")
        .bind(id)
        .fetch_one(connection)
        .await
}

/// Soft-deletes the project and suffixes its name.
pub(crate) async fn delete_one(connection: &mut PgConnection, id: &ObjectId) -> sqlx::Result<()> {
    sqlx::query("UPDATE webknossos.projects SET isdeleted=true,name=name || '.deleted.at.' || floor(extract(epoch FROM clock_timestamp())*1000)::bigint::text WHERE _id=$1 AND NOT isdeleted")
        .bind(id).execute(connection).await?;
    Ok(())
}

/// Locks the live project of the organization (FOR UPDATE) and returns its team.
pub(crate) async fn lock_one(
    connection: &mut PgConnection,
    id: &ObjectId,
    organization: &str,
) -> sqlx::Result<Option<ObjectId>> {
    sqlx::query_scalar(
        "SELECT _team FROM webknossos.projects WHERE _id=$1 AND _organization=$2 AND NOT \
            isdeleted FOR UPDATE",
    )
    .bind(id)
    .bind(organization)
    .fetch_optional(connection)
    .await
}

/// Whether the user may manage the live team of the organization (admin or
/// team manager). Takes a FOR SHARE lock on the team.
pub(crate) async fn can_manage_team(
    connection: &mut PgConnection,
    user: &AuthUser,
    team: &ObjectId,
) -> sqlx::Result<bool> {
    // SHARE conflicts with soft deletion (KEY SHARE would not). Hold the live
    // referenced team until the project/task type mutation commits.
    let team: Option<ObjectId> = sqlx::query_scalar(
        "SELECT t._id FROM webknossos.teams t WHERE t._id=$1 AND t._organization=$2 AND \
            NOT t.isDeleted AND ($3 OR EXISTS(SELECT 1 FROM webknossos.user_team_roles WHERE \
            _team=t._id AND _user=$4 AND isteammanager)) FOR SHARE OF t",
    )
    .bind(team)
    .bind(&user.organization_id)
    .bind(user.is_admin)
    .bind(&user.id)
    .fetch_optional(connection)
    .await?;
    Ok(team.is_some())
}

/// Whether the user may read the task type (task types table).
pub(crate) async fn is_task_type_readable(
    pool: &PgPool,
    user: &AuthUser,
    task_type_id: &ObjectId,
) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM webknossos.tasktypes_ t WHERE t._id=$1 AND \
            t._organization=$2 AND ($3 OR EXISTS(SELECT 1 FROM webknossos.user_team_roles WHERE \
            _user=$4 AND _team=t._team)))",
    )
    .bind(task_type_id)
    .bind(&user.organization_id)
    .bind(user.is_admin)
    .bind(&user.id)
    .fetch_one(pool)
    .await
}

/// The users with active task annotations in the project, as JSON.
pub(crate) async fn find_active_users_json(
    pool: &PgPool,
    id: ObjectId,
) -> sqlx::Result<Vec<Value>> {
    sqlx::query_scalar("SELECT \
            jsonb_build_object('email',m.email,'firstName',m.firstname,'lastName',m.lastname,'activeTasks',count(a._id)) FROM webknossos.annotations_ a JOIN webknossos.tasks_ t ON t._id=a._task JOIN webknossos.users_ u ON u._id=a._user JOIN webknossos.multiusers_ m ON m._id=u._multiuser WHERE t._project=$1 AND a.state='Active' AND a.typ='Task' GROUP BY m.email,m.firstname,m.lastname")
        .bind(id).fetch_all(pool).await
}

/// ProjectDAO.findOne with the requester's read access; returns the team.
pub(crate) async fn find_team_with_read_access(
    connection: &mut PgConnection,
    user: &AuthUser,
    id: &ObjectId,
) -> sqlx::Result<Option<ObjectId>> {
    let mut q = Sql::new("SELECT p._team FROM webknossos.projects_ p WHERE ");
    push_read_access(&mut q, user.into());
    q.push(" AND p._id=").push_bind(id);
    q.build_query_scalar().fetch_optional(connection).await
}

/// UserDAO.findOne with the requester's read access, locked FOR SHARE.
pub(crate) async fn find_user_for_share(
    connection: &mut PgConnection,
    user: &AuthUser,
    user_id: &ObjectId,
) -> sqlx::Result<Option<ObjectId>> {
    let mut q = Sql::new("SELECT usr._id FROM webknossos.users_ AS usr WHERE usr._id = ");
    q.push_bind(user_id).push(" AND ");
    users::push_read_access(&mut q, (&user.id).into());
    q.push(" FOR SHARE OF usr");
    q.build_query_scalar().fetch_optional(connection).await
}

/// The ids of the project's active task annotations.
pub(crate) async fn find_active_task_annotation_ids(
    connection: &mut PgConnection,
    id: &ObjectId,
) -> sqlx::Result<Vec<ObjectId>> {
    sqlx::query_scalar(
        "SELECT a._id FROM webknossos.annotations_ a JOIN webknossos.tasks_ t ON \
            a._task=t._id JOIN webknossos.projects_ p ON t._project=p._id JOIN \
            webknossos.users_ u ON a._user=u._id WHERE p._id=$1 AND a.state='Active' AND \
            a.typ='Task' ORDER BY a._id",
    )
    .bind(id)
    .fetch_all(connection)
    .await
}

/// The annotation's dataset and whether the user may mutate it, locked FOR
/// UPDATE; `None` unless the user may read it.
pub(crate) async fn find_annotation_for_transfer(
    connection: &mut PgConnection,
    user: &AuthUser,
    annotation: &ObjectId,
) -> sqlx::Result<Option<(ObjectId, bool)>> {
    // AnnotationService.transferAnnotationToUser, under the requester's context.
    let mut q = Sql::new("SELECT a._dataset, ");
    crate::annotation::access::push_mutate_predicate(&mut q, user.into());
    q.push(" FROM webknossos.annotations a WHERE a._id=")
        .push_bind(annotation)
        .push(" AND NOT a.isDeleted AND ");
    crate::annotation::access::push_read_predicate(&mut q, user.into());
    q.push(" FOR UPDATE OF a");
    q.build_query_as().fetch_optional(connection).await
}

pub(crate) async fn is_dataset_readable(
    connection: &mut PgConnection,
    dataset: &ObjectId,
    user_id: &ObjectId,
) -> sqlx::Result<bool> {
    let mut q = Sql::new("SELECT EXISTS (SELECT 1 FROM webknossos.datasets_ d WHERE d._id = ");
    q.push_bind(dataset).push(" AND ");
    crate::dataset::access::push_read_predicate(&mut q, user_id.into(), None);
    q.push(")");
    q.build_query_scalar().fetch_one(connection).await
}

pub(crate) async fn update_annotation_user(
    connection: &mut PgConnection,
    annotation: &ObjectId,
    new_user: &ObjectId,
) -> sqlx::Result<()> {
    sqlx::query("UPDATE webknossos.annotations SET _user=$2 WHERE _id=$1")
        .bind(annotation)
        .bind(new_user)
        .execute(connection)
        .await?;
    Ok(())
}

/// Whether the user may read the annotation (Play re-reads it after a transfer).
pub(crate) async fn is_annotation_readable(
    connection: &mut PgConnection,
    user: &AuthUser,
    annotation: &ObjectId,
) -> sqlx::Result<bool> {
    let mut q = Sql::new("SELECT EXISTS (SELECT 1 FROM webknossos.annotations_ a WHERE a._id=");
    q.push_bind(annotation).push(" AND ");
    crate::annotation::access::push_read_predicate(&mut q, user.into());
    q.push(")");
    q.build_query_scalar().fetch_one(connection).await
}
