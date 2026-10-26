//! TimeSpanDAO: the logged time queries, with the user visibility they depend on.
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::PgPool;

use super::{Filters, TargetUser};
use crate::{
    auth::AuthUser,
    error::ApiResult,
    sql::{PushArg, Requester, Sql},
    util::id::ObjectId,
};

/// UserService.isTeamManagerOrAdminOf(requester, target) as SQL over
/// `users_ u`. Team deletion removes memberships, so joining `teams_` only
/// adds organization scoping.
fn push_manageable<'a>(q: &mut Sql<'a>, requester: Requester<'a>) {
    q.push("((")
        .push_bind(requester.is_admin)
        .push(" AND u._organization = ")
        .push_arg(requester.organization)
        .push(
            ") OR EXISTS(
    SELECT 1 FROM webknossos.user_team_roles target_role
    JOIN webknossos.teams_ team ON team._id = target_role._team AND team._organization = ",
        )
        .push_arg(requester.organization)
        .push(
            "
    JOIN webknossos.user_team_roles manager_role ON manager_role._team = team._id
    WHERE target_role._user = u._id AND manager_role._user = ",
        )
        .push_arg(requester.id)
        .push(" AND manager_role.isTeamManager))");
}

/// Time spans (alias `ts`, annotation `a`, project `p`) within the filters'
/// period, annotation types and states, and projects (all if empty).
fn push_span_filter<'a>(q: &mut Sql<'a>, filters: &'a Filters) {
    q.push("ts.time > 0 AND ts.created >= ")
        .push_bind(filters.start)
        .push(" AND ts.created < ")
        .push_bind(filters.end);
    if !filters.projects.is_empty() {
        q.push(" AND p._id = ANY(")
            .push_bind(&filters.projects)
            .push("::text[])");
    }
    q.push(" AND a.typ::text = ANY(")
        .push_bind(&filters.types)
        .push("::text[]) AND a.state::text = ANY(")
        .push_bind(&filters.states)
        .push("::text[])");
}

/// The user, if visible to the requester through UserDAO.readAccessQ (self or manageable).
pub(super) async fn find_target_user(
    pool: &PgPool,
    requester: &AuthUser,
    id: &ObjectId,
) -> ApiResult<Option<TargetUser>> {
    let mut q = Sql::new("SELECT u._id AS id, ");
    push_manageable(&mut q, requester.into());
    q.push(
        " AS manageable,
             EXISTS(SELECT 1 FROM webknossos.user_team_roles r WHERE r._user = u._id) AS has_teams
           FROM webknossos.users_ u
           WHERE u._id = ",
    )
    .push_bind(id)
    .push(" AND u._organization = ")
    .push_bind(requester.organization_id.as_str())
    .push(" AND (u._id = ")
    .push_bind(&requester.id)
    .push(" OR ");
    push_manageable(&mut q, requester.into());
    q.push(")");
    Ok(q.build_query_as::<TargetUser>()
        .fetch_optional(pool)
        .await?)
}

/// Creation time and duration in milliseconds of all time spans of the user.
pub(super) async fn find_all_created_and_time_for_user(
    pool: &PgPool,
    user_id: &ObjectId,
) -> ApiResult<Vec<(DateTime<Utc>, i64)>> {
    Ok(
        sqlx::query_as("SELECT created, time FROM webknossos.timespans_ WHERE _user = $1")
            .bind(user_id)
            .fetch_all(pool)
            .await?,
    )
}

pub(super) async fn find_all_span_json_for_user(
    pool: &PgPool,
    user_id: &ObjectId,
    filters: &Filters,
) -> ApiResult<Vec<Value>> {
    let mut q = Sql::new(
        r#"SELECT jsonb_build_object(
             'userId', ts._user, 'userEmail', mu.email, 'datasetOrganization', o._id,
             'datasetName', d.name, 'annotationId', a._id, 'annotationState', a.state,
             'taskId', t._id, 'projectName', p.name, 'taskTypeId', tt._id,
             'taskTypeSummary', tt.summary, 'timeSpanId', ts._id,
             'timeSpanCreated', floor(extract(epoch FROM ts.created) * 1000)::bigint,
             'timeSpanTimeMillis', ts.time)
           FROM webknossos.timespans_ ts
           JOIN webknossos.annotations_ a ON ts._annotation = a._id
           JOIN webknossos.users_ u ON ts._user = u._id
           JOIN webknossos.multiUsers_ mu ON u._multiUser = mu._id
           JOIN webknossos.datasets_ d ON a._dataset = d._id
           JOIN webknossos.organizations_ o ON d._organization = o._id
           LEFT JOIN webknossos.tasks_ t ON a._task = t._id
           LEFT JOIN webknossos.projects_ p ON t._project = p._id
           LEFT JOIN webknossos.taskTypes_ tt ON t._taskType = tt._id
           WHERE ts._user = "#,
    );
    q.push_bind(user_id).push(" AND ");
    push_span_filter(&mut q, filters);
    q.push(" ORDER BY ts.created, ts._id");
    Ok(q.build_query_scalar().fetch_all(pool).await?)
}

pub(super) async fn find_all_summed_by_annotation_json_for_user(
    pool: &PgPool,
    user_id: &ObjectId,
    filters: &Filters,
) -> ApiResult<Vec<Value>> {
    let mut q = Sql::new(
        "WITH timeSummedPerAnnotation AS (
             SELECT a._id AS _annotation, t._id AS _task, p.name AS projectName, SUM(ts.time) AS timeSummed
             FROM webknossos.timespans_ ts
             JOIN webknossos.annotations_ a ON ts._annotation = a._id
             LEFT JOIN webknossos.tasks_ t ON a._task = t._id
             LEFT JOIN webknossos.projects_ p ON t._project = p._id
             WHERE ts._user = ",
    );
    q.push_bind(user_id).push(" AND ");
    push_span_filter(&mut q, filters);
    q.push(
        r#" GROUP BY a._id, t._id, p.name
           )
           SELECT jsonb_build_object('annotation', ti._annotation, 'task', ti._task,
             'projectName', ti.projectName, 'timeMillis', ti.timeSummed::bigint,
             'annotationLayerStats', jsonb_object_agg(al.tracingId, al.statistics))
           FROM timeSummedPerAnnotation ti
           JOIN webknossos.annotation_layers al ON al._annotation = ti._annotation
           GROUP BY ti._annotation, ti._task, ti.projectName, ti.timeSummed
           ORDER BY ti._annotation"#,
    );
    Ok(q.build_query_scalar().fetch_all(pool).await?)
}

/// UserDAO.findAll (or findAllByTeams: active members of the given teams)
/// plus findAdminsByOrg, all under UserDAO.listAccessQ.
pub(super) async fn find_all_listable_user_ids(
    pool: &PgPool,
    requester: &AuthUser,
    teams: &[ObjectId],
) -> ApiResult<Vec<ObjectId>> {
    let mut q = Sql::new(
        "WITH listable AS (
             SELECT u._id, u.isAdmin, u.isDeactivated FROM webknossos.users_ u
             WHERE u._organization = ",
    );
    q.push_bind(requester.organization_id.as_str())
        .push(" AND (u._id = ")
        .push_bind(&requester.id)
        .push(" OR ");
    push_manageable(&mut q, requester.into());
    q.push(") AND (NOT u.isUnlisted OR ")
        .push_bind(requester.is_superuser)
        .push("))");
    // All listable users, or the active members of the given teams.
    if teams.is_empty() {
        q.push(" SELECT _id FROM listable");
    } else {
        q.push(
            " SELECT l._id FROM listable l JOIN webknossos.user_team_roles r ON r._user = l._id
             WHERE r._team = ANY(",
        )
        .push_bind(teams)
        .push("::text[]) AND NOT l.isDeactivated");
    }
    q.push(" UNION SELECT _id FROM listable WHERE isAdmin AND NOT isDeactivated");
    Ok(q.build_query_scalar().fetch_all(pool).await?)
}

/// The tracked time and annotation count per user, within the filters.
pub(super) async fn find_all_overview_json(
    pool: &PgPool,
    users: &[ObjectId],
    filters: &Filters,
) -> ApiResult<Vec<Value>> {
    let mut q = Sql::new(
        "SELECT jsonb_build_object(
             'user', jsonb_build_object('id', u._id, 'firstName', mu.firstName,
               'lastName', mu.lastName, 'email', mu.email),
             'timeMillis', SUM(ts.time)::bigint, 'annotationCount', COUNT(DISTINCT a._id))
           FROM webknossos.timespans_ ts
           JOIN webknossos.annotations_ a ON ts._annotation = a._id
           JOIN webknossos.users_ u ON ts._user = u._id
           JOIN webknossos.multiUsers_ mu ON u._multiUser = mu._id
           LEFT JOIN webknossos.tasks_ t ON a._task = t._id
           LEFT JOIN webknossos.projects_ p ON t._project = p._id
           WHERE u._id = ANY(",
    );
    q.push_bind(users).push("::text[]) AND ");
    push_span_filter(&mut q, filters);
    q.push(
        " GROUP BY u._id, mu.firstName, mu.lastName, mu.email
           ORDER BY u._id",
    );
    Ok(q.build_query_scalar().fetch_all(pool).await?)
}
