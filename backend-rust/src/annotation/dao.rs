//! AnnotationDAO: the annotation lookup and access queries and the writes
//! shared by the annotation handlers (state, shared teams, layers, mutexes).
//!
//! Callers own the connection and transaction; these functions only run SQL
//! and return rows. Mapping a missing row to an error is up to the caller.
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{Executor, PgConnection, PgPool, Postgres};

use super::{access::AnnotationMetadata, duplicate::NewAnnotation};
use crate::{
    auth::AuthUser,
    error::ApiResult,
    sql::{PushArg, Requester, Sql},
    util::id::ObjectId,
};

/// The annotation owner (alias `a`) belongs to the requester's organization.
fn push_owner_in_organization<'a>(q: &mut Sql<'a>, requester: Requester<'a>) {
    q.push(
        "EXISTS(SELECT 1 FROM webknossos.users_ owner WHERE owner._id=a._user AND owner._organization=",
    )
    .push_arg(requester.organization)
    .push(")");
}

/// The requester manages the team of the annotation's (alias `a`) task project.
fn push_manages_task_team<'a>(q: &mut Sql<'a>, requester: Requester<'a>) {
    q.push(
        "EXISTS(SELECT 1 FROM webknossos.tasks_ task JOIN webknossos.projects_ project ON project._id=task._project
      JOIN webknossos.teams_ team ON team._id=project._team AND team._organization=",
    )
    .push_arg(requester.organization)
    .push(" JOIN webknossos.user_team_roles role ON role._team=team._id AND role._user=")
    .push_arg(requester.id)
    .push(" AND role.isteammanager WHERE task._id=a._task AND project._organization=")
    .push_arg(requester.organization)
    .push(")");
}

/// AnnotationDAO.readAccessQ for alias `a`. Dataset access is not part of this grant.
pub(crate) fn push_read_predicate<'a>(q: &mut Sql<'a>, requester: Requester<'a>) {
    q.push("(a.visibility='Public' OR (a.visibility='Internal' AND ");
    push_owner_in_organization(q, requester);
    q.push(") OR (a.visibility='Private' AND (a._user=")
        .push_arg(requester.id)
        .push(" OR (")
        .push_bind(requester.is_admin)
        .push(" AND ");
    push_owner_in_organization(q, requester);
    q.push("))))");
}

/// AnnotationDAO update/delete grants (alias `a`) ignore state, collaboration
/// mode and owner lock. Runtime editing/finishing restrictions additionally
/// check these.
pub(crate) fn push_mutate_predicate<'a>(q: &mut Sql<'a>, requester: Requester<'a>) {
    q.push("(a._user=")
        .push_arg(requester.id)
        .push(" OR (")
        .push_bind(requester.is_admin)
        .push(" AND ");
    push_owner_in_organization(q, requester);
    q.push(") OR ");
    push_manages_task_team(q, requester);
    q.push(")");
}

/// Annotation list ownership/sharing grant (alias `a`). Shared annotations
/// also require dataset read access; callers must add that predicate
/// themselves. Team grants are scoped to live teams of the requester's organization.
pub(crate) fn push_owned_or_shared_predicate<'a>(q: &mut Sql<'a>, requester: Requester<'a>) {
    q.push("(a._user=")
        .push_arg(requester.id)
        .push(
            " OR (a.visibility IN ('Public','Internal') AND (
      EXISTS(SELECT 1 FROM webknossos.annotation_sharedTeams shared JOIN webknossos.teams_ team ON team._id=shared._team AND team._organization=",
        )
        .push_arg(requester.organization)
        .push(
            " JOIN webknossos.user_team_roles role ON role._team=team._id WHERE shared._annotation=a._id AND role._user=",
        )
        .push_arg(requester.id)
        .push(
            ") OR
      EXISTS(SELECT 1 FROM webknossos.annotation_contributors contributor WHERE contributor._annotation=a._id AND contributor._user=",
        )
        .push_arg(requester.id)
        .push("))))");
}

/// The live annotation `id` as [`AnnotationMetadata`] for `requester`;
/// callers append further conditions.
fn select<'a>(requester: Requester<'a>, id: &'a ObjectId) -> Sql<'a> {
    let mut q = Sql::new(
        r#"SELECT a._id AS id,a._dataset AS dataset_id,a._task AS task_id,a._user AS owner_id,
    (SELECT _organization FROM webknossos.users_ WHERE _id=a._user) AS owner_organization,
    a.name,a.description,a.visibility::text,a.state::text,a.typ::text AS annotation_type,
    a.collaborationMode::text AS collaboration_mode,a.isLockedByOwner AS is_locked_by_owner,
    a.tags,a.tracingTime AS tracing_time,a.created,a.modified,
    "#,
    );
    push_manages_task_team(&mut q, requester);
    q.push(
        r#" AS requester_manages_task_team,
    (a._task IS NULL OR EXISTS(SELECT 1 FROM webknossos.tasks_ task JOIN webknossos.projects_ project ON project._id=task._project WHERE task._id=a._task)) AS task_context_available,
    EXISTS(SELECT 1 FROM webknossos.annotation_mutexes mutex WHERE mutex._annotation=a._id AND mutex._user="#,
    )
    .push_arg(requester.id)
    .push(
        " AND mutex.expiry>statement_timestamp()) AS requester_has_mutex
    FROM webknossos.annotations a WHERE NOT a.isDeleted AND a._id=",
    )
    .push_bind(id);
    q
}

/// AnnotationDAO.findOne under the requester's (or the global) access
/// context; `None` when the annotation is missing, deleted or unreadable.
pub(crate) async fn find_one<'e, E: Executor<'e, Database = Postgres>>(
    executor: E,
    requester: Requester<'_>,
    id: &ObjectId,
    global: bool,
) -> ApiResult<Option<AnnotationMetadata>> {
    let mut q = select(requester, id);
    if !global {
        q.push(" AND ");
        push_read_predicate(&mut q, requester);
    }
    Ok(q.build_query_as().fetch_optional(executor).await?)
}

/// The live annotation, held through a mutation. FOR SHARE conflicts with
/// soft deletion and owner changes, unlike FOR KEY SHARE. `None` unless the
/// user may mutate it.
pub(crate) async fn find_one_for_mutation(
    connection: &mut PgConnection,
    user: &AuthUser,
    id: &ObjectId,
) -> ApiResult<Option<AnnotationMetadata>> {
    let mut q = select(user.into(), id);
    q.push(" AND ");
    push_mutate_predicate(&mut q, user.into());
    q.push(" FOR SHARE OF a");
    Ok(q.build_query_as().fetch_optional(connection).await?)
}

/// Readable live annotation metadata (AnnotationDAO read access), row-locked
/// FOR NO KEY UPDATE so runtime restrictions re-checked inside the
/// transaction stay valid until commit (conflicts with soft deletion, owner,
/// state and lock changes). `None` when missing, deleted or unreadable.
pub(crate) async fn lock_readable(
    connection: &mut PgConnection,
    user: &AuthUser,
    id: &ObjectId,
) -> ApiResult<Option<AnnotationMetadata>> {
    let mut q = select(user.into(), id);
    q.push(" AND ");
    push_read_predicate(&mut q, user.into());
    q.push(" FOR NO KEY UPDATE OF a");
    Ok(q.build_query_as().fetch_optional(connection).await?)
}

/// AnnotationDAO.assertUpdateAccess on the live row (owner, owner-organization
/// admin or task project-team manager; state, lock and collaboration mode are
/// ignored), row-locked FOR NO KEY UPDATE through the connection.
pub(crate) async fn lock_update_access(
    connection: &mut PgConnection,
    user: &AuthUser,
    id: &ObjectId,
) -> ApiResult<bool> {
    let mut q =
        Sql::new("SELECT a._id FROM webknossos.annotations a WHERE NOT a.isDeleted AND a._id=");
    q.push_bind(id).push(" AND ");
    push_mutate_predicate(&mut q, user.into());
    q.push(" FOR NO KEY UPDATE OF a");
    let found: Option<ObjectId> = q.build_query_scalar().fetch_optional(connection).await?;
    Ok(found.is_some())
}

/// Transaction-scoped advisory lock on the hash of `key`.
pub(crate) async fn advisory_xact_lock(
    connection: &mut PgConnection,
    key: &str,
) -> sqlx::Result<()> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(key)
        .execute(connection)
        .await?;
    Ok(())
}

/// AnnotationDAO.insertOne: the annotation row.
pub(crate) async fn insert_one(
    connection: &mut PgConnection,
    annotation: &NewAnnotation<'_>,
) -> ApiResult<()> {
    sqlx::query(
        "INSERT INTO webknossos.annotations(_id,_dataset,_task,_user,description,visibility,name,state,tags,tracingTime,typ,collaborationMode,created,modified,isDeleted)
         VALUES($1,$2,$3,$4,$5,$6::webknossos.ANNOTATION_VISIBILITY,$7,'Active','{}',NULL,$8::webknossos.ANNOTATION_TYPE,$9::webknossos.ANNOTATION_COLLABORATION_MODE,$10,$10,false)",
    )
    .bind(annotation.id)
    .bind(annotation.dataset_id)
    .bind(annotation.task_id)
    .bind(annotation.owner_id)
    .bind(annotation.description)
    .bind(annotation.visibility)
    .bind(annotation.name)
    .bind(annotation.annotation_type)
    .bind(annotation.collaboration_mode)
    .bind(annotation.created)
    .execute(connection)
    .await?;
    Ok(())
}

/// The annotation row of a merged annotation. Annotation defaults: no task,
/// empty name and description, Internal, Active, no tags, no tracing time, OwnerOnly.
pub(crate) async fn insert_one_merged(
    connection: &mut PgConnection,
    id: &ObjectId,
    dataset_id: &ObjectId,
    user_id: &ObjectId,
    created: DateTime<Utc>,
) -> ApiResult<()> {
    sqlx::query(
        "INSERT INTO webknossos.annotations(_id,_dataset,_task,_user,description,visibility,name,state,tags,tracingTime,typ,collaborationMode,created,modified,isDeleted)
         VALUES($1,$2,NULL,$3,'','Internal','','Active','{}',NULL,'Explorational','OwnerOnly',$4,$4,false)",
    )
    .bind(id)
    .bind(dataset_id)
    .bind(user_id)
    .bind(created)
    .execute(connection)
    .await?;
    Ok(())
}

/// An annotation layer with unknown (`{}`) statistics.
pub(crate) async fn insert_layer(
    connection: &mut PgConnection,
    annotation_id: &ObjectId,
    tracing_id: &str,
    typ: &str,
    name: &str,
) -> ApiResult<()> {
    sqlx::query(
        "INSERT INTO webknossos.annotation_layers(_annotation,tracingId,typ,name,statistics)
             VALUES($1,$2,$3::webknossos.ANNOTATION_LAYER_TYPE,$4,'{}'::jsonb)",
    )
    .bind(annotation_id)
    .bind(tracing_id)
    .bind(typ)
    .bind(name)
    .execute(connection)
    .await?;
    Ok(())
}

pub(crate) async fn update_state_active(
    connection: &mut PgConnection,
    id: &ObjectId,
) -> sqlx::Result<()> {
    sqlx::query("UPDATE webknossos.annotations SET state='Active' WHERE _id=$1")
        .bind(id)
        .execute(connection)
        .await?;
    Ok(())
}

pub(crate) async fn update_state_cancelled(
    connection: &mut PgConnection,
    id: &ObjectId,
) -> ApiResult<()> {
    sqlx::query("UPDATE webknossos.annotations SET state='Cancelled' WHERE _id=$1")
        .bind(id)
        .execute(connection)
        .await?;
    Ok(())
}

pub(crate) async fn update_state_finished(
    connection: &mut PgConnection,
    id: &ObjectId,
    modified: DateTime<Utc>,
) -> sqlx::Result<()> {
    sqlx::query("UPDATE webknossos.annotations SET modified=$2,state='Finished' WHERE _id=$1")
        .bind(id)
        .bind(modified)
        .execute(connection)
        .await?;
    Ok(())
}

pub(crate) async fn update_collaboration_mode(
    connection: &mut PgConnection,
    id: &ObjectId,
    mode: &str,
) -> ApiResult<()> {
    sqlx::query("UPDATE webknossos.annotations SET collaborationMode=$2::webknossos.ANNOTATION_COLLABORATION_MODE WHERE _id=$1")
        .bind(id).bind(mode).execute(connection).await?;
    Ok(())
}

pub(crate) async fn delete_reserved_ids(
    connection: &mut PgConnection,
    id: &ObjectId,
) -> ApiResult<()> {
    sqlx::query("DELETE FROM webknossos.annotation_reserved_ids WHERE _annotation=$1")
        .bind(id)
        .execute(connection)
        .await?;
    Ok(())
}

pub(crate) async fn update_user(
    connection: &mut PgConnection,
    id: &ObjectId,
    user_id: &ObjectId,
) -> ApiResult<()> {
    sqlx::query("UPDATE webknossos.annotations SET _user=$2 WHERE _id=$1")
        .bind(id)
        .bind(user_id)
        .execute(connection)
        .await?;
    Ok(())
}

pub(crate) async fn update_name(
    connection: &mut PgConnection,
    id: &ObjectId,
    name: &str,
) -> ApiResult<()> {
    sqlx::query("UPDATE webknossos.annotations SET name=$1 WHERE _id=$2")
        .bind(name)
        .bind(id)
        .execute(connection)
        .await?;
    Ok(())
}

pub(crate) async fn update_visibility(
    connection: &mut PgConnection,
    id: &ObjectId,
    visibility: &str,
) -> ApiResult<()> {
    sqlx::query("UPDATE webknossos.annotations SET visibility=$1::webknossos.ANNOTATION_VISIBILITY WHERE _id=$2")
        .bind(visibility)
        .bind(id)
        .execute(connection)
        .await?;
    Ok(())
}

pub(crate) async fn update_tags(
    connection: &mut PgConnection,
    id: &ObjectId,
    tags: &[String],
) -> ApiResult<()> {
    sqlx::query("UPDATE webknossos.annotations SET tags=$1 WHERE _id=$2")
        .bind(tags)
        .bind(id)
        .execute(connection)
        .await?;
    Ok(())
}

/// No modified timestamp change, like AnnotationDAO.updateLockedState.
pub(crate) async fn update_locked_state(
    connection: &mut PgConnection,
    id: &ObjectId,
    is_locked_by_owner: bool,
) -> ApiResult<()> {
    sqlx::query("UPDATE webknossos.annotations SET isLockedByOwner=$1 WHERE _id=$2")
        .bind(is_locked_by_owner)
        .bind(id)
        .execute(connection)
        .await?;
    Ok(())
}

pub(crate) async fn upsert_view_configuration(
    connection: &mut PgConnection,
    annotation_id: &ObjectId,
    user_id: &ObjectId,
    view_configuration: Value,
) -> ApiResult<()> {
    sqlx::query(
        "INSERT INTO webknossos.user_annotationViewConfigurations(_annotation,_user,viewConfiguration) VALUES($1,$2,$3)
             ON CONFLICT (_user,_annotation) DO UPDATE SET viewConfiguration=EXCLUDED.viewConfiguration",
    )
    .bind(annotation_id)
    .bind(user_id)
    .bind(sqlx::types::Json(view_configuration))
    .execute(connection)
    .await?;
    Ok(())
}

/// TeamDAO read access (member, or admin of the team's organization),
/// scoped to live teams of the requester's organization like the rest of
/// the crate; TeamService.publicWrites also needs the live organization.
fn push_readable_team<'a>(q: &mut Sql<'a>, requester: Requester<'a>) {
    q.push("team._organization=")
        .push_arg(requester.organization)
        .push(" AND (")
        .push_bind(requester.is_admin)
        .push(
            " OR EXISTS(SELECT 1 FROM webknossos.user_team_roles role WHERE role._team=team._id AND role._user=",
        )
        .push_arg(requester.id)
        .push(
            "))
    AND EXISTS(SELECT 1 FROM webknossos.organizations_ organization WHERE organization._id=team._organization)",
        );
}

/// The teams the annotation is shared with that the user can read, as
/// TeamService.publicWrites renders them.
pub(crate) async fn find_shared_teams_json(
    pool: &PgPool,
    user: &AuthUser,
    annotation_id: &ObjectId,
) -> ApiResult<Vec<Value>> {
    let mut q = Sql::new(
        "SELECT jsonb_build_object('id',team._id,'name',team.name,'organization',team._organization,'isOrganizationTeam',team.isOrganizationTeam)
         FROM webknossos.teams_ team
         WHERE team._id IN (SELECT shared._team FROM webknossos.annotation_sharedTeams shared WHERE shared._annotation=",
    );
    q.push_bind(annotation_id).push(") AND ");
    push_readable_team(&mut q, user.into());
    q.push(" ORDER BY team._id");
    Ok(q.build_query_scalar().fetch_all(pool).await?)
}

/// How many of the teams exist and are readable by the user; locks them FOR
/// SHARE, which keeps them live (soft deletion is an UPDATE) until commit.
pub(crate) async fn count_readable_teams_for_share(
    connection: &mut PgConnection,
    user: &AuthUser,
    team_ids: &[&ObjectId],
) -> ApiResult<i64> {
    let mut q = Sql::new(
        "SELECT count(*) FROM (SELECT team._id FROM webknossos.teams team
         WHERE NOT team.isDeleted AND team._id=ANY(",
    );
    q.push_bind(team_ids).push(") AND ");
    push_readable_team(&mut q, user.into());
    q.push(" ORDER BY team._id FOR SHARE OF team) locked");
    Ok(q.build_query_scalar().fetch_one(connection).await?)
}

/// teamDAO.findSharedTeamsForAnnotation under the requester's access
/// context: the previously shared teams the requester can read.
pub(crate) async fn find_shared_team_ids(
    connection: &mut PgConnection,
    user: &AuthUser,
    annotation_id: &ObjectId,
) -> ApiResult<Vec<ObjectId>> {
    let mut q = Sql::new(
        "SELECT team._id FROM webknossos.teams_ team
         WHERE team._id IN (SELECT shared._team FROM webknossos.annotation_sharedTeams shared WHERE shared._annotation=",
    );
    q.push_bind(annotation_id).push(") AND ");
    push_readable_team(&mut q, user.into());
    Ok(q.build_query_scalar().fetch_all(connection).await?)
}

pub(crate) async fn delete_shared_teams(
    connection: &mut PgConnection,
    annotation_id: &ObjectId,
) -> ApiResult<()> {
    sqlx::query("DELETE FROM webknossos.annotation_sharedTeams WHERE _annotation=$1")
        .bind(annotation_id)
        .execute(connection)
        .await?;
    Ok(())
}

/// Inserts the shared teams; the raw sqlx error is returned so the caller can
/// map a unique violation.
pub(crate) async fn insert_shared_teams(
    connection: &mut PgConnection,
    annotation_id: &ObjectId,
    team_ids: &[ObjectId],
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO webknossos.annotation_sharedTeams(_annotation,_team) SELECT $1,team FROM unnest($2::text[]) team",
    )
    .bind(annotation_id)
    .bind(team_ids)
    .execute(connection)
    .await?;
    Ok(())
}

/// The id of the live owner's organization; locks the user row FOR SHARE.
pub(crate) async fn find_user_organization_for_share(
    connection: &mut PgConnection,
    user_id: &ObjectId,
) -> ApiResult<Option<String>> {
    Ok(
        sqlx::query_scalar("SELECT _organization FROM webknossos.users_ WHERE _id=$1 FOR SHARE")
            .bind(user_id)
            .fetch_optional(connection)
            .await?,
    )
}

/// A live task's project team and organization, resolved globally even for
/// admins; locks the task and its project.
pub(crate) async fn find_task_project_context_for_update(
    connection: &mut PgConnection,
    task_id: &ObjectId,
) -> ApiResult<Option<(ObjectId, String)>> {
    Ok(sqlx::query_as(
        "SELECT p._team,p._organization FROM webknossos.tasks_ t
             JOIN webknossos.projects_ p ON p._id=t._project WHERE t._id=$1 FOR NO KEY UPDATE OF t FOR SHARE OF p",
    )
    .bind(task_id)
    .fetch_optional(connection)
    .await?)
}

/// Whether the user manages the live team of their organization.
pub(crate) async fn is_team_manager(
    connection: &mut PgConnection,
    user: &AuthUser,
    team_id: &ObjectId,
) -> ApiResult<bool> {
    Ok(sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM webknossos.user_team_roles role
             JOIN webknossos.teams_ team ON team._id=role._team AND team._organization=$2
             WHERE role._user=$1 AND role._team=$3 AND role.isTeamManager)",
    )
    .bind(&user.id)
    .bind(&user.organization_id)
    .bind(team_id)
    .fetch_one(connection)
    .await?)
}

/// The live team (read globally): its organization and whether the user
/// manages it.
pub(crate) async fn find_team_with_manager_flag(
    pool: &PgPool,
    user: &AuthUser,
    team_id: &ObjectId,
) -> ApiResult<Option<(String, bool)>> {
    Ok(sqlx::query_as(
        "SELECT team._organization,EXISTS(SELECT 1 FROM webknossos.user_team_roles role
               WHERE role._team=team._id AND role._user=$2 AND role.isTeamManager)
             FROM webknossos.teams_ team WHERE team._id=$1",
    )
    .bind(team_id)
    .bind(&user.id)
    .fetch_optional(pool)
    .await?)
}

/// A live task's project and task type; locks the task row FOR SHARE.
pub(crate) async fn find_task_parents_for_share(
    connection: &mut PgConnection,
    task_id: &ObjectId,
) -> ApiResult<Option<(ObjectId, ObjectId)>> {
    Ok(
        sqlx::query_as("SELECT _project,_tasktype FROM webknossos.tasks_ WHERE _id=$1 FOR SHARE")
            .bind(task_id)
            .fetch_optional(connection)
            .await?,
    )
}

/// Inserts or renews the mutex of the annotation; `None` when another
/// session holds an unexpired one.
pub(crate) async fn upsert_mutex(
    connection: &mut PgConnection,
    annotation_id: &ObjectId,
    user_id: &ObjectId,
    session: &str,
    expiry_micros: i64,
) -> ApiResult<Option<(ObjectId, String)>> {
    Ok(sqlx::query_as(
        "INSERT INTO webknossos.annotation_mutexes(_annotation,_user,sessionId,expiry)
         VALUES($1,$2,$3,statement_timestamp()+($4::bigint * interval '1 microsecond'))
         ON CONFLICT (_annotation) DO UPDATE SET _user=EXCLUDED._user,
           sessionId=EXCLUDED.sessionId,expiry=EXCLUDED.expiry
         WHERE (webknossos.annotation_mutexes._user=EXCLUDED._user AND
                webknossos.annotation_mutexes.sessionId=EXCLUDED.sessionId)
            OR webknossos.annotation_mutexes.expiry<statement_timestamp()
         RETURNING _user,sessionId",
    )
    .bind(annotation_id)
    .bind(user_id)
    .bind(session)
    .bind(expiry_micros)
    .fetch_optional(connection)
    .await?)
}

/// The holder (user, session) of the annotation's mutex; locks it FOR UPDATE.
pub(crate) async fn find_mutex_holder_for_update(
    connection: &mut PgConnection,
    annotation_id: &ObjectId,
) -> ApiResult<(ObjectId, String)> {
    Ok(sqlx::query_as(
        "SELECT _user,sessionId FROM webknossos.annotation_mutexes WHERE \
                _annotation=$1 FOR UPDATE",
    )
    .bind(annotation_id)
    .fetch_one(connection)
    .await?)
}

pub(crate) async fn delete_mutex(
    connection: &mut PgConnection,
    annotation_id: &ObjectId,
    user_id: &ObjectId,
    session: &str,
) -> sqlx::Result<()> {
    sqlx::query(
        "DELETE FROM webknossos.annotation_mutexes WHERE _annotation=$1 AND _user=$2 \
                AND sessionId=$3",
    )
    .bind(annotation_id)
    .bind(user_id)
    .bind(session)
    .execute(connection)
    .await?;
    Ok(())
}

/// Whether the user is readable by the requester (UserDAO.findOne under the
/// requester's access context: self, team-managed members, or users of an
/// organization the requester administrates).
pub(crate) async fn is_user_readable<'e, E: Executor<'e, Database = Postgres>>(
    executor: E,
    requester: &AuthUser,
    target: &ObjectId,
) -> ApiResult<bool> {
    let mut q = Sql::new("SELECT EXISTS(SELECT 1 FROM webknossos.users_ AS usr WHERE usr._id=");
    q.push_bind(target).push(" AND ");
    crate::users::push_read_access(&mut q, (&requester.id).into());
    q.push(")");
    Ok(q.build_query_scalar().fetch_one(executor).await?)
}

/// datasetDAO.findOne under AuthorizedAccessContext(user): whether the user
/// can read the dataset (no sharing token).
pub(crate) async fn is_dataset_readable_by(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
    user_id: &ObjectId,
) -> ApiResult<bool> {
    let mut q = Sql::new("SELECT EXISTS(SELECT 1 FROM webknossos.datasets_ d WHERE d._id=");
    q.push_bind(dataset_id).push(" AND ");
    crate::dataset::access::push_read_predicate(&mut q, user_id.into(), None);
    q.push(")");
    Ok(q.build_query_scalar().fetch_one(connection).await?)
}

/// The dataset's name, organization and trimmed datastore name (global read
/// access, live datasets).
pub(crate) async fn find_dataset_with_organization(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
) -> ApiResult<Option<(String, String, String)>> {
    Ok(sqlx::query_as(
        "SELECT d.name,o._id,trim(d._dataStore) FROM webknossos.datasets_ d
         JOIN webknossos.organizations_ o ON o._id=d._organization WHERE d._id=$1",
    )
    .bind(dataset_id)
    .fetch_optional(connection)
    .await?)
}

/// The first tracing store as `{name, url}`.
pub(crate) async fn find_first_tracing_store_json(
    connection: &mut PgConnection,
) -> ApiResult<Option<Value>> {
    Ok(sqlx::query_scalar(
        "SELECT jsonb_build_object('name',store.name,'url',store.publicUrl) FROM webknossos.tracingStores_ store LIMIT 1",
    )
    .fetch_optional(connection)
    .await?)
}

/// The MultiUser id of the user (global lookup of a live user); the raw sqlx
/// error is returned because the callers inspect it.
pub(crate) async fn find_multi_user_id(
    pool: &PgPool,
    user_id: &ObjectId,
) -> sqlx::Result<Option<ObjectId>> {
    sqlx::query_scalar("SELECT _multiUser FROM webknossos.users_ WHERE _id=$1")
        .bind(user_id)
        .fetch_optional(pool)
        .await
}
