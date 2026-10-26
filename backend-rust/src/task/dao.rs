//! TaskDAO: the task queries behind the task administration routes, plus the
//! project, team and experience domain lookups they run.
use serde_json::Value;
use sqlx::{PgConnection, PgPool};

use super::routes::ListParameters;
use crate::{
    auth::AuthUser,
    error::ApiResult,
    sql::{PushArg, Requester, Sql},
    util::id::ObjectId,
};

/// TaskDAO access through the task's project (alias `p`), whose team must be a
/// live team of the requester's organization: admins, plus team members
/// (readAccessQ) or only team managers (`managers_only`, listAccessQ).
fn push_task_access<'a>(q: &mut Sql<'a>, requester: Requester<'a>, managers_only: bool) {
    q.push("p._organization=")
        .push_arg(requester.organization)
        .push(
            " AND EXISTS (SELECT 1 FROM webknossos.teams_ access_team WHERE access_team._id=p._team AND access_team._organization=",
        )
        .push_arg(requester.organization)
        .push(") AND (")
        .push_bind(requester.is_admin)
        .push(" OR EXISTS (SELECT 1 FROM webknossos.user_team_roles WHERE _user=")
        .push_arg(requester.id)
        .push(" AND _team=p._team")
        .push(if managers_only { " AND isteammanager))" } else { "))" });
}

/// Annotation read access (alias `a`), unless `global`.
fn push_annotation_read<'a>(q: &mut Sql<'a>, requester: Requester<'a>, global: bool) {
    if global {
        q.push("TRUE");
    } else {
        crate::annotation::access::push_read_predicate(q, requester);
    }
}

/// The public JSON of one task. Unless `global`, only if the requester may
/// read the task, its base annotation and dataset.
pub(crate) async fn find_one_json(
    connection: &mut PgConnection,
    user: Option<&AuthUser>,
    id: &ObjectId,
    global: bool,
) -> ApiResult<Option<Value>> {
    let requester = Requester::from(user);
    let mut q = Sql::new(
        r#"SELECT jsonb_build_object(
      'id',t._id,'projectId',p._id,'projectName',p.name,'team',team.name,
      'type',("#,
    );
    q.push(crate::task::types::dao::PUBLIC_TASK_TYPE).push(
        r#" WHERE tt._id=t._tasktype),
      'datasetName',d.name,'datasetId',d._id,
      'neededExperience',jsonb_build_object('domain',t.neededexperience_domain,'value',t.neededexperience_value),
      'created',floor(extract(epoch FROM t.created)*1000)::bigint,
      'status',jsonb_build_object('pending',t.pendinginstances,'active',active.count,'finished',t.totalinstances-t.pendinginstances-active.count),
      'script',(SELECT jsonb_build_object('id',s.id,'name',s.name,'gist',s.gist,'owner',s.owner) FROM ("#,
    );
    // Script lookup is request-scoped; ScriptService.compactWrites uses global
    // access for its owner. A missing/deleted script is serialized as null.
    q.push(crate::scripts::dao::SELECT_LIVE_SCRIPTS);
    if !global {
        q.push(" AND u._organization = ")
            .push_arg(requester.organization);
    }
    q.push(
        r#" AND s._id=t._script) s),
      'tracingTime',t.tracingtime,'creationInfo',t.creationinfo,
      'boundingBox',CASE WHEN t.boundingbox IS NULL THEN NULL ELSE jsonb_build_object('topLeft',jsonb_build_array((t.boundingbox).x::int,(t.boundingbox).y::int,(t.boundingbox).z::int),'width',(t.boundingbox).width::int,'height',(t.boundingbox).height::int,'depth',(t.boundingbox).depth::int) END,
      'editPosition',jsonb_build_array((t.editposition).x::int,(t.editposition).y::int,(t.editposition).z::int),
      'editRotation',jsonb_build_array((t.editrotation).x,(t.editrotation).y,(t.editrotation).z))
      FROM webknossos.tasks_ t JOIN webknossos.projects_ p ON p._id=t._project
      JOIN webknossos.teams_ team ON team._id=p._team
      JOIN LATERAL (SELECT a._dataset FROM webknossos.annotations_ a WHERE a._task=t._id AND a.typ='TracingBase' AND a.state<>'Cancelled' AND "#,
    );
    // The alias a is deliberately reused for the base annotation and active count.
    push_annotation_read(&mut q, requester, global);
    q.push(" LIMIT 1) base ON true JOIN webknossos.datasets_ d ON d._id=base._dataset");
    if !global {
        q.push(" AND ");
        crate::dataset::access::push_read_predicate(&mut q, requester.id, None);
    }
    q.push(
        " CROSS JOIN LATERAL (SELECT count(*) AS count FROM webknossos.annotations_ a WHERE a._task=t._id AND a.typ='Task' AND a.state='Active' AND ",
    );
    push_annotation_read(&mut q, requester, global);
    q.push(") active WHERE t._id=").push_bind(id);
    if !global {
        q.push(" AND (");
        push_task_access(&mut q, requester, false);
        q.push(")");
    }
    Ok(q.build_query_scalar().fetch_optional(connection).await?)
}

/// TaskDAO.listAccessQ ids matching the filters, at most 1000.
pub(crate) async fn find_all_ids(
    connection: &mut PgConnection,
    user: &AuthUser,
    parameters: &ListParameters,
) -> ApiResult<Vec<ObjectId>> {
    let order = if parameters.random == Some(true) {
        " ORDER BY RANDOM()"
    } else {
        ""
    };
    let mut q = Sql::new(
        "SELECT t._id FROM webknossos.tasks_ t JOIN webknossos.projects_ p ON p._id=t._project WHERE ",
    );
    push_task_access(&mut q, user.into(), true);
    if let Some(project) = &parameters.project {
        q.push(" AND t._project=").push_bind(project);
    }
    if let Some(task_type) = &parameters.task_type {
        q.push(" AND t._tasktype=").push_bind(task_type);
    }
    if let Some(ids) = &parameters.ids {
        q.push(" AND t._id=ANY(").push_bind(ids).push(")");
    }
    if let Some(owner) = &parameters.user {
        q.push(
            " AND EXISTS (
          SELECT 1 FROM webknossos.annotations_ a JOIN webknossos.users_ u ON u._id=a._user
          WHERE a._task=t._id AND a.typ='Task' AND a.state<>'Cancelled' AND u._id=",
        )
        .push_bind(owner)
        .push(")");
    }
    q.push(order).push(" LIMIT 1000");
    Ok(q.build_query_scalar().fetch_all(connection).await?)
}

/// The team of the project, if the user may read the project (owner, admin or team member).
pub(crate) async fn find_project_team_with_read_access(
    connection: &mut PgConnection,
    user: &AuthUser,
    project_id: &ObjectId,
) -> ApiResult<Option<ObjectId>> {
    Ok(sqlx::query_scalar(
        "SELECT p._team FROM webknossos.projects_ p WHERE p._id=$4 AND \
            p._organization=$2 AND (p._owner=$1 OR $3 OR EXISTS(SELECT 1 FROM \
            webknossos.user_team_roles WHERE _user=$1 AND _team=p._team))",
    )
    .bind(&user.id)
    .bind(&user.organization_id)
    .bind(user.is_admin)
    .bind(project_id)
    .fetch_optional(connection)
    .await?)
}

/// Whether the user may manage the team (admin or team manager).
pub(crate) async fn can_manage_team(
    connection: &mut PgConnection,
    user: &AuthUser,
    team: &ObjectId,
) -> ApiResult<bool> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM webknossos.teams_ t WHERE t._id=$1 AND \
            t._organization=$2 AND ($3 OR EXISTS(SELECT 1 FROM webknossos.user_team_roles r \
            WHERE r._team=t._id AND r._user=$4 AND r.isteammanager)))",
    )
    .bind(team)
    .bind(&user.organization_id)
    .bind(user.is_admin)
    .bind(&user.id)
    .fetch_one(connection)
    .await?)
}

/// A page of the ids of the project's tasks the user may list, newest first.
pub(crate) async fn find_ids_for_project(
    connection: &mut PgConnection,
    user: &AuthUser,
    project_id: &ObjectId,
    limit: i32,
    page: i32,
) -> ApiResult<Vec<ObjectId>> {
    let mut q = Sql::new(
        "SELECT t._id FROM webknossos.tasks_ t JOIN webknossos.projects_ p ON p._id=t._project WHERE ",
    );
    push_task_access(&mut q, user.into(), true);
    q.push(" AND p._id=")
        .push_bind(project_id)
        .push(" ORDER BY t._id DESC LIMIT ")
        .push_bind(i64::from(limit))
        .push(" OFFSET ")
        .push_bind(i64::from(page) * i64::from(limit));
    Ok(q.build_query_scalar().fetch_all(connection).await?)
}

pub(crate) async fn count_for_project(
    connection: &mut PgConnection,
    project_id: &ObjectId,
) -> ApiResult<i64> {
    Ok(
        sqlx::query_scalar("SELECT count(*) FROM webknossos.tasks_ WHERE _project=$1")
            .bind(project_id)
            .fetch_one(connection)
            .await?,
    )
}

/// The project id of the task, if the user may read it (member of the project
/// team or admin of the organization).
pub(crate) async fn find_project_id_with_read_access(
    connection: &mut PgConnection,
    user: &AuthUser,
    id: &ObjectId,
) -> ApiResult<Option<ObjectId>> {
    Ok(sqlx::query_scalar(
        "SELECT t._project FROM webknossos.tasks_ t JOIN webknossos.projects_ p ON \
            p._id=t._project WHERE t._id=$4 AND p._organization=$2 AND ($3 OR EXISTS(SELECT 1 \
            FROM webknossos.user_team_roles WHERE _user=$1 AND _team=p._team))",
    )
    .bind(&user.id)
    .bind(&user.organization_id)
    .bind(user.is_admin)
    .bind(id)
    .fetch_optional(connection)
    .await?)
}

/// Locks the live project of the organization (FOR SHARE) and returns its team.
pub(crate) async fn lock_project_team_for_share(
    connection: &mut PgConnection,
    project_id: &ObjectId,
    organization_id: &str,
) -> ApiResult<Option<ObjectId>> {
    Ok(sqlx::query_scalar(
        "SELECT _team FROM webknossos.projects WHERE _id=$1 AND _organization=$2 AND NOT \
            isdeleted FOR SHARE",
    )
    .bind(project_id)
    .bind(organization_id)
    .fetch_optional(connection)
    .await?)
}

/// Locks the live task of the project (FOR UPDATE) and returns
/// `(totalinstances, pendinginstances)`.
pub(crate) async fn lock_instances(
    connection: &mut PgConnection,
    id: &ObjectId,
    project_id: &ObjectId,
) -> ApiResult<Option<(i64, i64)>> {
    Ok(sqlx::query_as(
        "SELECT totalinstances,pendinginstances FROM webknossos.tasks WHERE _id=$1 AND \
            _project=$2 AND NOT isdeleted FOR UPDATE",
    )
    .bind(id)
    .bind(project_id)
    .fetch_optional(connection)
    .await?)
}

pub(crate) async fn update_total_instances(
    connection: &mut PgConnection,
    id: &ObjectId,
    total_instances: i64,
) -> ApiResult<()> {
    sqlx::query("UPDATE webknossos.tasks SET totalinstances=$2 WHERE _id=$1")
        .bind(id)
        .bind(total_instances)
        .execute(connection)
        .await?;
    Ok(())
}

pub(crate) async fn delete_one(connection: &mut PgConnection, id: &ObjectId) -> ApiResult<()> {
    sqlx::query("UPDATE webknossos.tasks SET isdeleted=true WHERE _id=$1")
        .bind(id)
        .execute(connection)
        .await?;
    Ok(())
}

/// Soft-deletes the annotations of the task.
pub(crate) async fn delete_annotations(
    connection: &mut PgConnection,
    id: &ObjectId,
) -> ApiResult<()> {
    sqlx::query("UPDATE webknossos.annotations SET isdeleted=true WHERE _task=$1")
        .bind(id)
        .execute(connection)
        .await?;
    Ok(())
}

pub(crate) async fn find_experience_domains(
    pool: &PgPool,
    organization_id: &str,
) -> ApiResult<Vec<String>> {
    Ok(
        sqlx::query_scalar(
            "SELECT domain FROM webknossos.experiencedomains WHERE _organization=$1",
        )
        .bind(organization_id)
        .fetch_all(pool)
        .await?,
    )
}

/// The highest-priority task the user could be assigned (matching experience,
/// pending instances, unpaused project, no earlier annotation by the user).
pub(crate) async fn find_next_task_id_for_peek(
    pool: &PgPool,
    user: &AuthUser,
    is_team_manager_or_admin: bool,
) -> ApiResult<Option<ObjectId>> {
    Ok(sqlx::query_scalar(
        r#"SELECT t._id FROM webknossos.tasks_ t
        JOIN webknossos.user_experiences e ON e.domain=t.neededexperience_domain AND e._user=$1 AND e.value>=t.neededexperience_value
        JOIN webknossos.projects_ p ON p._id=t._project
        JOIN webknossos.teams_ team ON team._id=p._team AND team._organization=$3
        WHERE p._organization=$3 AND t.pendinginstances>0 AND NOT p.paused AND p._team IN (SELECT _team FROM webknossos.user_team_roles WHERE _user=$1)
        AND NOT EXISTS (SELECT 1 FROM webknossos.annotations_ a WHERE a._task=t._id AND a._user=$1 AND a.typ='Task' AND NOT ($2 AND a.state='Cancelled'))
        ORDER BY p.priority DESC LIMIT 1"#,
    )
    .bind(&user.id)
    .bind(is_team_manager_or_admin)
    .bind(&user.organization_id)
    .fetch_optional(pool)
    .await?)
}
