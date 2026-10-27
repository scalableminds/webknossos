//! UserDAO: the users, multiUsers, user_team_roles and user_experiences queries.
//!
//! Callers own the connection and transaction; these functions only run SQL
//! and return rows. Mapping a missing row to an error is up to the caller.
use std::collections::BTreeMap;

use serde_json::Value;
use sqlx::{PgConnection, PgExecutor, PgPool};

use crate::{
    auth::AuthUser,
    sql::{Arg, PushArg, Requester, Sql},
    util::id::ObjectId,
};

// The public response without account hashes, internal configuration, or tokens. Shared by
// the single-user and the list statement; both provide `team_data` (teams, is_manager,
// managed: requester manages one of the user's teams; all NULL without teams),
// `experience_data` and `paying`.
macro_rules! user_json {
    () => {
        r#"
SELECT jsonb_build_object(
  'id', usr._id, 'email', multi.email, 'firstName', multi.firstName, 'lastName', multi.lastName,
  'isAdmin', usr.isAdmin, 'isOrganizationOwner', usr.isOrganizationOwner,
  'isDatasetManager', usr.isDatasetManager, 'isActive', NOT usr.isDeactivated,
  'teams', COALESCE(team_data.teams, '[]'::jsonb),
  'experiences', COALESCE(experience_data.experiences, '{}'::jsonb),
  'lastActivity', FLOOR(EXTRACT(EPOCH FROM usr.lastActivity) * 1000)::BIGINT,
  'isAnonymous', FALSE, 'isEditable', $3 OR COALESCE(team_data.managed, FALSE) OR team_data.teams IS NULL,
  'organization', usr._organization, 'novelUserExperienceInfos', multi.novelUserExperienceInfos,
  'selectedTheme', multi.selectedTheme, 'created', FLOOR(EXTRACT(EPOCH FROM usr.created) * 1000)::BIGINT,
  'lastTaskTypeId', usr.lastTaskTypeId, 'isSuperUser', multi.isSuperUser,
  'isEmailVerified', multi.isEmailVerified, 'isUnlisted', usr.isUnlisted,
  'isGuest', paying._organization IS NOT NULL AND paying._organization != usr._organization
)
FROM webknossos.users_ AS usr
JOIN webknossos.multiUsers_ AS multi ON multi._id = usr._multiUser
JOIN webknossos.organizations_ AS org ON org._id = usr._organization
"#
    };
}

// One user: per-row lateral aggregates. Binds $1 requester, $2 organization, $3 admin, $4 user.
const USER_DOCUMENT: &str = concat!(
    user_json!(),
    r#"CROSS JOIN LATERAL (
  SELECT jsonb_agg(jsonb_build_object('id', team._id, 'name', team.name,
    'isTeamManager', role.isTeamManager) ORDER BY team.name) AS teams,
    bool_or(role._team IN (SELECT _team FROM webknossos.user_team_roles
      WHERE _user = $1 AND isTeamManager)) AS managed
  FROM webknossos.user_team_roles AS role
  JOIN webknossos.teams_ AS team ON team._id = role._team AND team._organization = $2
  WHERE role._user = usr._id
) AS team_data
CROSS JOIN LATERAL (
  SELECT jsonb_object_agg(domain, value) AS experiences
  FROM webknossos.user_experiences WHERE _user = usr._id
) AS experience_data
LEFT JOIN LATERAL (
  SELECT identity._organization FROM webknossos.users_ AS identity
  JOIN webknossos.organizations_ AS organization ON organization._id = identity._organization
  WHERE identity._multiUser = usr._multiUser AND NOT identity.isDeactivated
    AND organization.pricingPlan IN ('Team', 'Power', 'Custom', 'Team_Trial', 'Power_Trial')
  ORDER BY identity.created ASC LIMIT 1
) AS paying ON TRUE
WHERE usr._id = $4 AND usr._organization = $2
  AND ($3 OR COALESCE(team_data.managed, FALSE) OR usr._id = $1)
"#
);

// The organization's users: each aggregate is computed once for the organization and hash
// joined, instead of per user (3.4x faster on 300 users). Its generic plan is good, so it
// stays a cached prepared statement. Binds $1 requester, $2 organization, $3 admin,
// $4 superuser, $5..$7 the optional filters.
const USER_LIST: &str = concat!(
    r#"
WITH member AS MATERIALIZED (
  SELECT role._user, role._team, role.isTeamManager, team.name
  FROM webknossos.user_team_roles AS role
  JOIN webknossos.teams_ AS team ON team._id = role._team AND team._organization = $2
), team_data AS (
  SELECT _user,
    jsonb_agg(jsonb_build_object('id', _team, 'name', name, 'isTeamManager', isTeamManager)
      ORDER BY name) AS teams,
    bool_or(isTeamManager) AS is_manager,
    bool_or(_team IN (SELECT _team FROM member WHERE _user = $1 AND isTeamManager)) AS managed
  FROM member GROUP BY _user
), experience_data AS (
  SELECT _user, jsonb_object_agg(domain, value) AS experiences
  FROM webknossos.user_experiences
  WHERE _user IN (SELECT _id FROM webknossos.users_ WHERE _organization = $2)
  GROUP BY _user
), paying AS (
  SELECT DISTINCT ON (identity._multiUser) identity._multiUser, identity._organization
  FROM webknossos.users_ AS identity
  JOIN webknossos.organizations_ AS organization ON organization._id = identity._organization
  WHERE NOT identity.isDeactivated
    AND organization.pricingPlan IN ('Team', 'Power', 'Custom', 'Team_Trial', 'Power_Trial')
    AND identity._multiUser IN (SELECT _multiUser FROM webknossos.users_ WHERE _organization = $2)
  ORDER BY identity._multiUser, identity.created
)"#,
    user_json!(),
    r#"LEFT JOIN team_data ON team_data._user = usr._id
LEFT JOIN experience_data ON experience_data._user = usr._id
LEFT JOIN paying ON paying._multiUser = usr._multiUser
WHERE usr._organization = $2 AND ($3 OR COALESCE(team_data.managed, FALSE) OR usr._id = $1)
  AND (NOT usr.isUnlisted OR $4)
  AND ($5::BOOLEAN IS NULL OR ($3 OR COALESCE(team_data.managed, FALSE)) = $5)
  AND ($6::BOOLEAN IS NULL OR (usr.isAdmin OR COALESCE(team_data.is_manager, FALSE)) = $6)
  AND ($7::BOOLEAN IS NULL OR usr.isAdmin = $7)
ORDER BY LOWER(multi.lastName), usr._id
"#
);

/// UserDAO.readAccessQ (also its update access) for a `users_` row aliased
/// `usr`: members of teams the requester manages, users of the organization
/// the requester administers, and the requester themself.
pub(crate) fn push_read_access<'a>(q: &mut Sql<'a>, requester: Arg<'a>) {
    q.push(
        "(usr._id IN (SELECT _user FROM webknossos.user_team_roles WHERE _team IN (
    SELECT _team FROM webknossos.user_team_roles WHERE _user = ",
    )
    .push_arg(requester)
    .push(
        " AND isTeamManager))
  OR usr._organization IN (SELECT _organization FROM webknossos.users_ WHERE _id = ",
    )
    .push_arg(requester)
    .push(" AND isAdmin) OR usr._id = ")
    .push_arg(requester)
    .push(")");
}

#[derive(sqlx::FromRow)]
pub(crate) struct Target {
    pub organization: String,
    pub multi_user: ObjectId,
    pub is_admin: bool,
    pub is_dataset_manager: bool,
    pub is_deactivated: bool,
    pub is_organization_owner: bool,
    pub last_task_type_id: Option<ObjectId>,
    pub email: String,
    pub first_name: String,
    pub last_name: String,
}

#[derive(sqlx::FromRow)]
pub(crate) struct OldMembership {
    pub team: ObjectId,
    pub is_team_manager: bool,
    pub team_exists: bool,
    pub manageable: bool,
}

/// Whether the requester manages the team (alias `team`): team manager of it,
/// or admin of its organization (UserService.isTeamManagerOrAdminOf(user, team)).
fn push_team_manageable<'a>(q: &mut Sql<'a>, requester: Requester<'a>) {
    q.push(
        "(EXISTS (SELECT 1 FROM webknossos.user_team_roles AS r WHERE r._team = team._id AND r._user = ",
    )
    .push_arg(requester.id)
    .push(" AND r.isTeamManager) OR (")
    .push_bind(requester.is_admin)
    .push(" AND team._organization = ")
    .push_arg(requester.organization)
    .push("))");
}

/// One user as the public JSON document, if the requester may see them.
pub(crate) async fn find_one_document(
    pool: &PgPool,
    requester: &AuthUser,
    id: &ObjectId,
) -> sqlx::Result<Option<Value>> {
    sqlx::query_scalar(USER_DOCUMENT)
        .bind(&requester.id)
        .bind(&requester.organization_id)
        .bind(requester.is_admin)
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub(crate) async fn find_all_documents(
    pool: &PgPool,
    requester: &AuthUser,
    is_editable: Option<bool>,
    is_team_manager_or_admin: Option<bool>,
    is_admin: Option<bool>,
) -> sqlx::Result<Vec<Value>> {
    sqlx::query_scalar(USER_LIST)
        .bind(&requester.id)
        .bind(&requester.organization_id)
        .bind(requester.is_admin)
        .bind(requester.is_superuser)
        .bind(is_editable)
        .bind(is_team_manager_or_admin)
        .bind(is_admin)
        .fetch_all(pool)
        .await
}

/// UserDAO.updateLastActivity. `GREATEST` keeps concurrent fire-and-forget
/// updates from moving the timestamp backwards.
pub(crate) async fn update_last_activity(
    executor: impl PgExecutor<'_>,
    user_id: &ObjectId,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE webknossos.users SET lastActivity = GREATEST(lastActivity, \
         statement_timestamp()) WHERE _id = $1 AND NOT isDeleted",
    )
    .bind(user_id)
    .execute(executor)
    .await?;
    Ok(())
}

/// Sets the user's last task type if the requester may edit them; returns the number of rows updated.
pub(crate) async fn update_last_task_type_if_editable(
    pool: &PgPool,
    id: &ObjectId,
    last_task_type_id: &Option<ObjectId>,
    requester: &AuthUser,
) -> sqlx::Result<u64> {
    let result = sqlx::query(
        r#"
        UPDATE webknossos.users AS target SET lastTaskTypeId = $2
        WHERE target._id = $1 AND NOT target.isDeleted AND target._organization = $4
          AND (target._id = $3 OR $5 OR NOT EXISTS (
            SELECT 1 FROM webknossos.user_team_roles AS role
            JOIN webknossos.teams_ AS team ON team._id = role._team AND team._organization = $4
            WHERE role._user = target._id
          ) OR EXISTS (
            SELECT 1 FROM webknossos.user_team_roles AS target_role
            JOIN webknossos.teams_ AS team ON team._id = target_role._team AND team._organization = $4
            JOIN webknossos.user_team_roles AS requester_role ON requester_role._team = team._id
            WHERE target_role._user = target._id AND requester_role._user = $3 AND requester_role.isTeamManager
          ))
        "#,
    )
    .bind(id)
    .bind(last_task_type_id)
    .bind(&requester.id)
    .bind(&requester.organization_id)
    .bind(requester.is_admin)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

pub(crate) async fn update_novel_user_experience_infos(
    pool: &PgPool,
    user_id: &ObjectId,
    infos: Value,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE webknossos.multiUsers AS multi SET novelUserExperienceInfos = $2 FROM \
         webknossos.users_ AS usr WHERE usr._id = $1 AND usr._multiUser = multi._id \
         AND NOT multi.isDeleted",
    )
    .bind(user_id)
    .bind(infos)
    .execute(pool)
    .await?;
    Ok(())
}

pub(crate) async fn update_selected_theme(
    pool: &PgPool,
    user_id: &ObjectId,
    theme: &str,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE webknossos.multiUsers AS multi SET selectedTheme = \
         $2::webknossos.THEME FROM webknossos.users_ AS usr WHERE usr._id = $1 AND \
         usr._multiUser = multi._id AND NOT multi.isDeleted",
    )
    .bind(user_id)
    .bind(theme)
    .execute(pool)
    .await?;
    Ok(())
}

/// The organization of the user, if the requester has read access to them.
pub(crate) async fn find_organization_id_if_readable(
    connection: &mut PgConnection,
    id: &ObjectId,
    requester: &AuthUser,
) -> sqlx::Result<Option<String>> {
    let mut q = Sql::new("SELECT usr._organization FROM webknossos.users_ AS usr WHERE usr._id = ");
    q.push_bind(id).push(" AND ");
    push_read_access(&mut q, (&requester.id).into());
    q.build_query_scalar().fetch_optional(connection).await
}

/// Admin/owner counts and the user limit are organization-wide invariants.
pub(crate) async fn lock_organization(
    connection: &mut PgConnection,
    organization_id: &str,
) -> sqlx::Result<()> {
    sqlx::query("SELECT _id FROM webknossos.organizations WHERE _id = $1 FOR UPDATE")
        .bind(organization_id)
        .execute(connection)
        .await?;
    Ok(())
}

/// Locks the user and their account.
pub(crate) async fn find_one_target_for_update(
    connection: &mut PgConnection,
    id: &ObjectId,
) -> sqlx::Result<Option<Target>> {
    sqlx::query_as(
        r#"SELECT u._organization AS organization, u._multiUser AS multi_user,
             u.isAdmin AS is_admin, u.isDatasetManager AS is_dataset_manager,
             u.isDeactivated AS is_deactivated, u.isOrganizationOwner AS is_organization_owner,
             u.lastTaskTypeId AS last_task_type_id, m.email, m.firstName AS first_name,
             m.lastName AS last_name
           FROM webknossos.users AS u JOIN webknossos.multiUsers AS m ON m._id = u._multiUser
           WHERE u._id = $1 AND NOT u.isDeleted AND NOT m.isDeleted
           FOR UPDATE OF u, m"#,
    )
    .bind(id)
    .fetch_optional(connection)
    .await
}

/// The user's team memberships, with whether the requester can manage each team.
pub(crate) async fn find_all_memberships_for_user(
    connection: &mut PgConnection,
    requester: &AuthUser,
    id: &ObjectId,
) -> sqlx::Result<Vec<OldMembership>> {
    let mut q = Sql::new(
        "SELECT role._team AS team, role.isTeamManager AS is_team_manager,
             team._id IS NOT NULL AS team_exists, COALESCE(",
    );
    push_team_manageable(&mut q, requester.into());
    q.push(
        ", FALSE) AS manageable
           FROM webknossos.user_team_roles AS role
           LEFT JOIN webknossos.teams_ AS team ON team._id = role._team
           WHERE role._user = ",
    )
    .push_bind(id)
    .push(" ORDER BY role._team");
    q.build_query_as().fetch_all(connection).await
}

pub(crate) async fn find_all_experiences_for_user(
    connection: &mut PgConnection,
    id: &ObjectId,
) -> sqlx::Result<BTreeMap<String, i32>> {
    Ok(sqlx::query_as::<_, (String, i32)>(
        "SELECT domain, value FROM webknossos.user_experiences WHERE _user = $1",
    )
    .bind(id)
    .fetch_all(connection)
    .await?
    .into_iter()
    .collect())
}

pub(crate) async fn shares_managed_team(
    connection: &mut PgConnection,
    id: &ObjectId,
    requester_id: &ObjectId,
) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        r#"SELECT EXISTS (SELECT 1 FROM webknossos.user_team_roles AS target_role
             JOIN webknossos.user_team_roles AS requester_role ON requester_role._team = target_role._team
             WHERE target_role._user = $1 AND requester_role._user = $2 AND requester_role.isTeamManager)"#,
    )
    .bind(id)
    .bind(requester_id)
    .fetch_one(connection)
    .await
}

pub(crate) async fn is_team_manager_in_organization(
    connection: &mut PgConnection,
    user_id: &ObjectId,
    organization_id: &str,
) -> sqlx::Result<bool> {
    sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS (SELECT 1 FROM webknossos.user_team_roles AS role
                         JOIN webknossos.teams_ AS team ON team._id = role._team
                         WHERE role._user = $1 AND role.isTeamManager AND team._organization = $2)"#,
    )
    .bind(user_id)
    .bind(organization_id)
    .fetch_one(connection)
    .await
}

/// The password hasher and hash of the account.
pub(crate) async fn find_password_info(
    connection: &mut PgConnection,
    multi_user_id: &ObjectId,
) -> sqlx::Result<(String, String)> {
    sqlx::query_as(
        "SELECT passwordInfo_hasher::text, passwordInfo_password FROM webknossos.multiUsers WHERE _id = $1",
    )
    .bind(multi_user_id)
    .fetch_one(connection)
    .await
}

pub(crate) async fn multi_user_email_exists(
    connection: &mut PgConnection,
    email: &str,
) -> sqlx::Result<bool> {
    sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM webknossos.multiUsers_ WHERE email = $1)")
        .bind(email)
        .fetch_one(connection)
        .await
}

/// The ids of the user's active task annotations.
pub(crate) async fn find_active_task_ids_for_user(
    connection: &mut PgConnection,
    id: &ObjectId,
) -> sqlx::Result<Vec<String>> {
    sqlx::query_scalar(
        "SELECT _task FROM webknossos.annotations_ WHERE _user = $1 AND typ = 'Task' AND state = 'Active' AND _task IS NOT NULL ORDER BY created, _id",
    )
    .bind(id)
    .fetch_all(connection)
    .await
}

pub(crate) async fn count_admins(
    connection: &mut PgConnection,
    organization_id: &str,
) -> sqlx::Result<i64> {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM webknossos.users_ WHERE _organization = $1 AND isAdmin AND NOT isUnlisted",
    )
    .bind(organization_id)
    .fetch_one(connection)
    .await
}

pub(crate) async fn count_owners(
    connection: &mut PgConnection,
    organization_id: &str,
) -> sqlx::Result<i64> {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM webknossos.users_ WHERE _organization = $1 AND isOrganizationOwner AND NOT isUnlisted",
    )
    .bind(organization_id)
    .fetch_one(connection)
    .await
}

pub(crate) async fn update_email(
    connection: &mut PgConnection,
    multi_user_id: &ObjectId,
    email: &str,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE webknossos.multiUsers SET email = $2, isEmailVerified = FALSE, \
         emailChangeDate = NOW() WHERE _id = $1",
    )
    .bind(multi_user_id)
    .bind(email)
    .execute(connection)
    .await?;
    Ok(())
}

pub(crate) async fn update_user_flags(
    connection: &mut PgConnection,
    id: &ObjectId,
    is_admin: bool,
    is_dataset_manager: bool,
    is_deactivated: bool,
    last_task_type_id: &Option<ObjectId>,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE webknossos.users SET isAdmin = $2, isDatasetManager = $3, \
         isDeactivated = $4, lastTaskTypeId = $5 WHERE _id = $1",
    )
    .bind(id)
    .bind(is_admin)
    .bind(is_dataset_manager)
    .bind(is_deactivated)
    .bind(last_task_type_id)
    .execute(connection)
    .await?;
    Ok(())
}

pub(crate) async fn update_names(
    connection: &mut PgConnection,
    multi_user_id: &ObjectId,
    first_name: &str,
    last_name: &str,
) -> sqlx::Result<()> {
    sqlx::query("UPDATE webknossos.multiUsers SET firstName = $2, lastName = $3 WHERE _id = $1")
        .bind(multi_user_id)
        .bind(first_name)
        .bind(last_name)
        .execute(connection)
        .await?;
    Ok(())
}

/// Re-selects from teams_ so deleted teams are never (re)assigned.
pub(crate) async fn insert_team_membership_if_team_exists(
    connection: &mut PgConnection,
    id: &ObjectId,
    team: &ObjectId,
    is_team_manager: &bool,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO webknossos.user_team_roles (_user, _team, isTeamManager) SELECT \
         $1, t._id, $3 FROM webknossos.teams_ AS t WHERE t._id = $2",
    )
    .bind(id)
    .bind(team)
    .bind(is_team_manager)
    .execute(connection)
    .await?;
    Ok(())
}

/// Whether the requester still has read (update) access to the user.
pub(crate) async fn is_readable(
    connection: &mut PgConnection,
    id: &ObjectId,
    requester: &AuthUser,
) -> sqlx::Result<bool> {
    let mut q = Sql::new("SELECT EXISTS (SELECT 1 FROM webknossos.users_ AS usr WHERE usr._id = ");
    q.push_bind(id).push(" AND ");
    push_read_access(&mut q, (&requester.id).into());
    q.push(")");
    q.build_query_scalar().fetch_one(connection).await
}

pub(crate) async fn delete_experiences_for_user(
    connection: &mut PgConnection,
    id: &ObjectId,
) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM webknossos.user_experiences WHERE _user = $1")
        .bind(id)
        .execute(connection)
        .await?;
    Ok(())
}

pub(crate) async fn insert_experience(
    connection: &mut PgConnection,
    id: &ObjectId,
    domain: &str,
    value: &i32,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO webknossos.user_experiences (_user, domain, value) VALUES ($1, $2, $3)",
    )
    .bind(id)
    .bind(domain)
    .bind(value)
    .execute(connection)
    .await?;
    Ok(())
}

pub(crate) async fn insert_experience_domain(
    connection: &mut PgConnection,
    domain: &str,
    organization_id: &str,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO webknossos.experienceDomains (domain, _organization) VALUES ($1, \
         $2) ON CONFLICT DO NOTHING",
    )
    .bind(domain)
    .bind(organization_id)
    .execute(connection)
    .await?;
    Ok(())
}

/// The team's name, organization and whether the requester manages it; locks the team row.
pub(crate) async fn find_one_team_for_share(
    connection: &mut PgConnection,
    requester: &AuthUser,
    team_id: &ObjectId,
) -> sqlx::Result<Option<(String, String, bool)>> {
    let mut q = Sql::new("SELECT team.name, team._organization, ");
    push_team_manageable(&mut q, requester.into());
    q.push(" FROM webknossos.teams_ AS team WHERE team._id = ")
        .push_bind(team_id)
        .push(" FOR SHARE OF team");
    q.build_query_as().fetch_optional(connection).await
}
