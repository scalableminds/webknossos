//! Queries of task creation: TaskDAO.insertOne and the task type, project,
//! script, team, dataset, data store and annotation lookups that
//! TaskCreationService runs.
use sqlx::{PgConnection, PgPool};
use webknossos_common::geometry::BoundingBox;

use super::TaskParameters;
use crate::{auth::AuthUser, sql::Sql, util::id::ObjectId};

/// TaskTypeDAO.findOne under the requester's access (team member or admin
/// of the task type's organization): `(tracingType, magRestrictions min, max)`.
pub(crate) async fn find_task_type_facts(
    pool: &PgPool,
    user: &AuthUser,
    id: &ObjectId,
) -> sqlx::Result<Option<(String, Option<i32>, Option<i32>)>> {
    sqlx::query_as(
        "SELECT tt.tracingType::text, tt.settings_magRestrictions_min, tt.settings_magRestrictions_max
         FROM webknossos.taskTypes_ tt
         WHERE tt._id=$1 AND (tt._team IN (SELECT _team FROM webknossos.user_team_roles WHERE _user=$2)
           OR tt._organization=(SELECT _organization FROM webknossos.users_ WHERE _id=$2 AND isAdmin))",
    )
    .bind(id)
    .bind(&user.id)
    .fetch_optional(pool)
    .await
}

/// The name of the data store, if it exists (data stores table).
pub(crate) async fn find_data_store_name(
    pool: &PgPool,
    name: &str,
) -> sqlx::Result<Option<String>> {
    sqlx::query_scalar("SELECT name FROM webknossos.dataStores_ WHERE name=$1")
        .bind(name)
        .fetch_optional(pool)
        .await
}

/// The `(tracingId, typ)` layers of the annotation (annotation layers table).
pub(crate) async fn find_annotation_layers(
    pool: &PgPool,
    annotation_id: &ObjectId,
) -> sqlx::Result<Vec<(String, String)>> {
    sqlx::query_as(
        "SELECT tracingId, typ::text FROM webknossos.annotation_layers WHERE _annotation=$1 ORDER BY tracingId",
    )
    .bind(annotation_id)
    .fetch_all(pool)
    .await
}

/// The owner of the annotation, if the requester may read it (any type/state).
pub(crate) async fn find_readable_annotation_owner(
    pool: &PgPool,
    user: &AuthUser,
    id: &ObjectId,
) -> sqlx::Result<Option<ObjectId>> {
    let mut q = Sql::new("SELECT a._user FROM webknossos.annotations_ a WHERE a._id=");
    q.push_bind(id).push(" AND ");
    crate::annotation::access::push_read_predicate(&mut q, user.into());
    q.build_query_scalar().fetch_optional(pool).await
}

/// `(totalInstances, pendingInstances)` of the task, if the requester may read it.
pub(crate) async fn find_task_instances_with_read_access(
    pool: &PgPool,
    user: &AuthUser,
    id: &ObjectId,
) -> sqlx::Result<Option<(i64, i64)>> {
    sqlx::query_as(
        "SELECT t.totalInstances, t.pendingInstances FROM webknossos.tasks_ t
         WHERE t._id=$1 AND ((SELECT p._team FROM webknossos.projects p WHERE p._id=t._project)
             IN (SELECT _team FROM webknossos.user_team_roles WHERE _user=$2)
           OR (SELECT team._organization FROM webknossos.teams team WHERE team._id=(SELECT p._team FROM webknossos.projects p WHERE p._id=t._project))
             IN (SELECT _organization FROM webknossos.users_ WHERE _id=$2 AND isAdmin))",
    )
    .bind(id)
    .bind(&user.id)
    .fetch_optional(pool)
    .await
}

/// `(id, owner, state)` of the task's non-cancelled Task annotations the
/// requester may read, oldest first.
pub(crate) async fn find_task_annotations(
    pool: &PgPool,
    user: &AuthUser,
    task_id: &ObjectId,
) -> sqlx::Result<Vec<(ObjectId, ObjectId, String)>> {
    let mut q = Sql::new(
        "SELECT a._id, a._user, a.state::text FROM webknossos.annotations_ a
         WHERE a._task=",
    );
    q.push_bind(task_id)
        .push(" AND a.typ='Task' AND a.state<>'Cancelled' AND ");
    crate::annotation::access::push_read_predicate(&mut q, user.into());
    q.push(" ORDER BY a.created, a._id");
    q.build_query_as().fetch_all(pool).await
}

/// ProjectDAO.findOneByNameAndOrganization under the requester's access
/// (project team member, project owner or organization admin): `(id, team)`.
pub(crate) async fn find_project_by_name(
    pool: &PgPool,
    user: &AuthUser,
    name: &str,
) -> sqlx::Result<Option<(ObjectId, ObjectId)>> {
    sqlx::query_as(
        "SELECT p._id, p._team FROM webknossos.projects_ p
         WHERE p.name=$1 AND p._organization=$2
           AND (p._team IN (SELECT _team FROM webknossos.user_team_roles WHERE _user=$3)
             OR p._owner=$3
             OR p._organization=(SELECT _organization FROM webknossos.users_ WHERE _id=$3 AND isAdmin))
         ORDER BY p.created, p._id LIMIT 1",
    )
    .bind(name)
    .bind(&user.organization_id)
    .bind(&user.id)
    .fetch_optional(pool)
    .await
}

/// Whether the script exists and its owner belongs to the user's organization.
pub(crate) async fn is_script_readable(
    pool: &PgPool,
    user: &AuthUser,
    script_id: &ObjectId,
) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM webknossos.scripts_ s
                   JOIN webknossos.users_ owner ON owner._id=s._owner
                   WHERE s._id=$1 AND owner._organization=$2)",
    )
    .bind(script_id)
    .bind(&user.organization_id)
    .fetch_one(pool)
    .await
}

/// The team's organization and whether the user manages it. `None` if the
/// team does not exist.
pub(crate) async fn find_team_organization_and_manager(
    pool: &PgPool,
    user: &AuthUser,
    team_id: &ObjectId,
) -> sqlx::Result<Option<(String, bool)>> {
    sqlx::query_as(
        "SELECT t._organization, EXISTS (SELECT 1 FROM webknossos.user_team_roles r
               WHERE r._user=$2 AND r._team=t._id AND r.isTeamManager)
             FROM webknossos.teams_ t WHERE t._id=$1",
    )
    .bind(team_id)
    .bind(&user.id)
    .fetch_optional(pool)
    .await
}

/// TaskDAO.insertOne. `domain` is the trimmed needed-experience domain and
/// `bounding_box` the non-empty task box.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn insert_one(
    connection: &mut PgConnection,
    task_id: &ObjectId,
    project_id: &ObjectId,
    task_type_id: &ObjectId,
    params: &TaskParameters,
    domain: &str,
    bounding_box: Option<BoundingBox>,
    created: chrono::DateTime<chrono::Utc>,
) -> sqlx::Result<()> {
    let bbox = bounding_box;
    sqlx::query(
        "INSERT INTO webknossos.tasks(_id,_project,_script,_taskType,neededExperience_domain,neededExperience_value,
               totalInstances,pendingInstances,tracingTime,boundingBox,editPosition,editRotation,creationInfo,created,isDeleted)
             VALUES($1,$2,$3,$4,$5,$6,$7,$7,NULL,
               CASE WHEN $8::float8 IS NULL THEN NULL ELSE ROW($8,$9,$10,$11,$12,$13)::webknossos.BOUNDING_BOX END,
               ROW($14,$15,$16)::webknossos.VECTOR3,ROW($17,$18,$19)::webknossos.VECTOR3,$20,$21,false)",
    )
    .bind(task_id)
    .bind(project_id)
    .bind(&params.script_id)
    .bind(task_type_id)
    .bind(domain)
    .bind(params.needed_experience.value)
    .bind(i64::from(params.pending_instances))
    .bind(bbox.map(|b| f64::from(b.top_left.x)))
    .bind(bbox.map(|b| f64::from(b.top_left.y)))
    .bind(bbox.map(|b| f64::from(b.top_left.z)))
    .bind(bbox.map(|b| f64::from(b.width)))
    .bind(bbox.map(|b| f64::from(b.height)))
    .bind(bbox.map(|b| f64::from(b.depth)))
    .bind(f64::from(params.edit_position[0]))
    .bind(f64::from(params.edit_position[1]))
    .bind(f64::from(params.edit_position[2]))
    .bind(params.edit_rotation[0])
    .bind(params.edit_rotation[1])
    .bind(params.edit_rotation[2])
    .bind(&params.creation_info)
    .bind(created)
    .execute(connection)
    .await?;
    Ok(())
}

/// insertExperienceToListing.
pub(crate) async fn insert_experience_domain(
    connection: &mut PgConnection,
    domain: &str,
    organization_id: &str,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO webknossos.experienceDomains(domain,_organization) VALUES($1,$2) ON CONFLICT DO NOTHING",
    )
    .bind(domain)
    .bind(organization_id)
    .execute(connection)
    .await?;
    Ok(())
}

/// The teams allowed on the dataset, directly or through its folders (cumulative).
pub(crate) async fn find_dataset_allowed_team_ids(
    pool: &PgPool,
    dataset_id: &ObjectId,
) -> sqlx::Result<Vec<ObjectId>> {
    sqlx::query_scalar(
        "SELECT _team FROM webknossos.dataset_allowedTeams WHERE _dataset=$1
         UNION
         SELECT DISTINCT at._team FROM webknossos.folder_allowedTeams at
           JOIN webknossos.folder_paths fp ON at._folder=fp._ancestor
           JOIN webknossos.datasets_ d ON fp._descendant=d._folder
           WHERE d._id=$1",
    )
    .bind(dataset_id)
    .fetch_all(pool)
    .await
}

/// Whether the team has active non-admin members outside the dataset's allowed teams.
pub(crate) async fn has_members_outside_teams(
    pool: &PgPool,
    team: &ObjectId,
    dataset_teams: &[ObjectId],
) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM webknossos.users_ u
                   JOIN webknossos.user_team_roles tr ON u._id=tr._user
                   WHERE NOT u.isAdmin AND NOT u.isDeactivated AND tr._team=$1
                     AND u._id NOT IN (SELECT _user FROM webknossos.user_team_roles WHERE _team = ANY($2)))",
    )
    .bind(team)
    .bind(dataset_teams)
    .fetch_one(pool)
    .await
}

/// The name of the team, if the user is a member or admin of its organization.
pub(crate) async fn find_team_name_with_read_access(
    pool: &PgPool,
    user: &AuthUser,
    team: &ObjectId,
) -> sqlx::Result<Option<String>> {
    sqlx::query_scalar(
        "SELECT t.name FROM webknossos.teams_ t WHERE t._id=$1
               AND (t._id IN (SELECT _team FROM webknossos.user_team_roles WHERE _user=$2)
                 OR t._organization IN (SELECT _organization FROM webknossos.users_ WHERE _id=$2 AND isAdmin))",
    )
    .bind(team)
    .bind(&user.id)
    .fetch_optional(pool)
    .await
}
