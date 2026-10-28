//! Onboarding DAOs: the multiUsers, users, organizations, invites, teams and
//! folders queries behind registration, organization creation and joining.
//!
//! Callers own the connection and transaction; these functions only run SQL
//! and return rows. Mapping a missing row to an error is up to the caller.
use sqlx::{PgConnection, PgPool};

use crate::{sql::Sql, util::id::ObjectId};

#[derive(sqlx::FromRow)]
pub(crate) struct OrganizationRow {
    pub id: String,
    pub name: String,
    pub enable_auto_verify: bool,
    pub new_user_mailing_list: String,
}

pub(crate) const ORGANIZATION_COLUMNS: &str = "_id AS id, name, enableAutoVerify AS enable_auto_verify, newUserMailingList AS new_user_mailing_list";

#[derive(sqlx::FromRow)]
pub(crate) struct InviteRow {
    pub id: ObjectId,
    pub organization_id: String,
    pub auto_activate: bool,
    pub is_admin: bool,
    pub is_dataset_manager: bool,
}

/// Deleted accounts still own their address (UNIQUE across all rows).
pub(crate) async fn multi_user_email_exists(
    connection: &mut PgConnection,
    email: &str,
) -> sqlx::Result<bool> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM webknossos.multiUsers WHERE email = $1)")
        .bind(email)
        .fetch_one(connection)
        .await
}

pub(crate) async fn find_one_organization(
    connection: &mut PgConnection,
    id: &str,
) -> sqlx::Result<Option<OrganizationRow>> {
    let mut q = Sql::new("SELECT ");
    q.push(ORGANIZATION_COLUMNS)
        .push(" FROM webknossos.organizations_ WHERE _id = ")
        .push_bind(id);
    q.build_query_as().fetch_optional(connection).await
}

/// Up to two organizations, enough to tell whether there is exactly one.
pub(crate) async fn find_first_two_organizations(
    connection: &mut PgConnection,
) -> sqlx::Result<Vec<OrganizationRow>> {
    sqlx::query_as(&format!(
        "SELECT {ORGANIZATION_COLUMNS} FROM webknossos.organizations_ ORDER BY _id LIMIT 2"
    ))
    .fetch_all(connection)
    .await
}

/// Locks the organization row so concurrent additions cannot exceed the limit.
pub(crate) async fn find_included_users_for_update(
    connection: &mut PgConnection,
    organization_id: &str,
) -> sqlx::Result<Option<Option<i32>>> {
    sqlx::query_scalar(
        "SELECT includedUsers FROM webknossos.organizations_ WHERE _id = $1 FOR UPDATE",
    )
    .bind(organization_id)
    .fetch_optional(connection)
    .await
}

pub(crate) async fn count_users_towards_limit(
    connection: &mut PgConnection,
    organization_id: &str,
) -> sqlx::Result<i64> {
    sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM webknossos.users_ AS u
           LEFT JOIN (
             SELECT DISTINCT ON (_multiUser) _multiUser, _organization FROM webknossos.users
             WHERE NOT isDeactivated AND _organization IN (
               SELECT _id FROM webknossos.organizations
               WHERE pricingPlan IN ('Team', 'Power', 'Custom', 'Team_Trial', 'Power_Trial'))
             ORDER BY _multiUser, created ASC
           ) AS paying ON paying._multiUser = u._multiUser
           WHERE u._organization = $1 AND NOT u.isDeactivated AND NOT u.isUnlisted
             AND (paying._organization IS NULL OR paying._organization = $1)"#,
    )
    .bind(organization_id)
    .fetch_one(connection)
    .await
}

pub(crate) async fn find_all_invite_team_roles(
    connection: &mut PgConnection,
    invite_id: &ObjectId,
) -> sqlx::Result<Vec<(ObjectId, bool)>> {
    sqlx::query_as(
        "SELECT _team, isTeamManager FROM webknossos.invite_team_roles WHERE _invite = $1 ORDER BY _team",
    )
    .bind(invite_id)
    .fetch_all(connection)
    .await
}

/// The first team of the organization (the organization team).
pub(crate) async fn find_one_organization_team(
    connection: &mut PgConnection,
    organization_id: &str,
) -> sqlx::Result<Option<ObjectId>> {
    sqlx::query_scalar(
        "SELECT _id FROM webknossos.organizationTeams WHERE _organization = $1 LIMIT 1",
    )
    .bind(organization_id)
    .fetch_optional(connection)
    .await
}

pub(crate) async fn delete_team_memberships_for_user(
    connection: &mut PgConnection,
    user_id: &ObjectId,
) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM webknossos.user_team_roles WHERE _user = $1")
        .bind(user_id)
        .execute(connection)
        .await?;
    Ok(())
}

pub(crate) async fn insert_team_membership(
    connection: &mut PgConnection,
    user_id: &ObjectId,
    team_id: &ObjectId,
    is_team_manager: bool,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO webknossos.user_team_roles(_user, _team, isTeamManager) VALUES($1, $2, $3)",
    )
    .bind(user_id)
    .bind(team_id)
    .bind(is_team_manager)
    .execute(connection)
    .await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn insert_multi_user(
    connection: &mut PgConnection,
    id: &ObjectId,
    email: &str,
    hasher: &str,
    password_hash: &str,
    first_name: &str,
    last_name: &str,
    is_email_verified: bool,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO webknossos.multiUsers(_id, email, passwordInfo_hasher, passwordInfo_password,
             firstName, lastName, isSuperUser, isEmailVerified)
           VALUES($1, $2, $3::webknossos.USER_PASSWORDINFO_HASHERS, $4, $5, $6, FALSE, $7)"#,
    )
    .bind(id)
    .bind(email)
    .bind(hasher)
    .bind(password_hash)
    .bind(first_name)
    .bind(last_name)
    .bind(is_email_verified)
    .execute(connection)
    .await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn insert_user(
    connection: &mut PgConnection,
    id: &ObjectId,
    multi_user_id: &ObjectId,
    organization_id: &str,
    is_deactivated: bool,
    is_admin: bool,
    is_organization_owner: bool,
    is_dataset_manager: bool,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO webknossos.users(_id, _multiUser, _organization, lastActivity, userConfiguration,
             isDeactivated, isAdmin, isOrganizationOwner, isDatasetManager, isUnlisted, created)
           VALUES($1, $2, $3, statement_timestamp(), '{}'::jsonb, $4, $5, $6, $7, FALSE, statement_timestamp())"#,
    )
    .bind(id)
    .bind(multi_user_id)
    .bind(organization_id)
    .bind(is_deactivated)
    .bind(is_admin)
    .bind(is_organization_owner)
    .bind(is_dataset_manager)
    .execute(connection)
    .await?;
    Ok(())
}

/// Inserts a new identity copying the original's account-level fields
/// (configuration, logout cutoff). Returns the number of rows inserted.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn insert_user_copying_original(
    connection: &mut PgConnection,
    new_user_id: &ObjectId,
    original_user_id: &ObjectId,
    organization_id: &str,
    is_deactivated: bool,
    is_admin: bool,
    is_organization_owner: bool,
    is_dataset_manager: bool,
    is_unlisted: bool,
) -> sqlx::Result<u64> {
    Ok(sqlx::query(
        r#"INSERT INTO webknossos.users(_id, _multiUser, _organization, lastActivity, userConfiguration,
             isDeactivated, isAdmin, isOrganizationOwner, isDatasetManager, isUnlisted,
             loggedOutEverywhereTime, created, lastTaskTypeId, isDeleted)
           SELECT $1, _multiUser, $3, statement_timestamp(), userConfiguration, $4, $5, $6, $7, $8,
             loggedOutEverywhereTime, statement_timestamp(), NULL, FALSE
           FROM webknossos.users_ WHERE _id = $2"#,
    )
    .bind(new_user_id)
    .bind(original_user_id)
    .bind(organization_id)
    .bind(is_deactivated)
    .bind(is_admin)
    .bind(is_organization_owner)
    .bind(is_dataset_manager)
    .bind(is_unlisted)
    .execute(connection)
    .await?
    .rows_affected())
}

/// Mailing list fallback of organizationService.newUserMailRecipient: the owner's email.
pub(crate) async fn find_organization_owner_email(
    connection: &mut PgConnection,
    organization_id: &str,
) -> sqlx::Result<Option<String>> {
    sqlx::query_scalar(
        r#"SELECT m.email FROM webknossos.users_ u JOIN webknossos.multiUsers_ m ON u._multiUser = m._id
           WHERE u.isOrganizationOwner AND NOT u.isDeactivated AND u._organization = $1 LIMIT 1"#,
    )
    .bind(organization_id)
    .fetch_optional(connection)
    .await
}

/// Locked for single use. Expired invites are excluded, as in the DAO query.
pub(crate) async fn find_one_invite_by_token_for_update(
    connection: &mut PgConnection,
    token: &str,
) -> sqlx::Result<Option<InviteRow>> {
    sqlx::query_as(
        r#"SELECT _id AS id, _organization AS organization_id, autoActivate AS auto_activate,
             isAdmin AS is_admin, isDatasetManager AS is_dataset_manager
           FROM webknossos.invites_ WHERE tokenValue = $1 AND expirationDateTime > statement_timestamp()
           ORDER BY created LIMIT 1 FOR UPDATE"#,
    )
    .bind(token)
    .fetch_optional(connection)
    .await
}

pub(crate) async fn delete_invite(
    connection: &mut PgConnection,
    invite_id: &ObjectId,
) -> sqlx::Result<()> {
    sqlx::query("UPDATE webknossos.invites SET isDeleted = TRUE WHERE _id = $1")
        .bind(invite_id)
        .execute(connection)
        .await?;
    Ok(())
}

/// Ids of deleted organizations stay reserved (primary key).
pub(crate) async fn organization_id_exists(
    connection: &mut PgConnection,
    id: &str,
) -> sqlx::Result<bool> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM webknossos.organizations WHERE _id = $1)")
        .bind(id)
        .fetch_one(connection)
        .await
}

pub(crate) async fn insert_root_folder(
    connection: &mut PgConnection,
    id: &ObjectId,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO webknossos.folders(_id, name, metadata) VALUES($1, 'Datasets', '[]'::jsonb)",
    )
    .bind(id)
    .execute(connection)
    .await?;
    Ok(())
}

pub(crate) async fn insert_root_folder_path(
    connection: &mut PgConnection,
    folder_id: &ObjectId,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO webknossos.folder_paths(_ancestor, _descendant, depth) VALUES($1, $1, 0)",
    )
    .bind(folder_id)
    .execute(connection)
    .await?;
    Ok(())
}

pub(crate) async fn insert_organization(
    connection: &mut PgConnection,
    id: &str,
    name: &str,
    root_folder_id: &ObjectId,
    pricing_plan: &str,
    included_users: Option<i32>,
    included_storage: Option<i64>,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO webknossos.organizations(_id, additionalInformation, logoUrl, name, _rootFolder,
             newUserMailingList, enableAutoVerify, pricingPlan, aiPlan, paidUntil, includedUsers,
             includedStorage, lastTermsOfServiceAcceptanceTime, lastTermsOfServiceAcceptanceVersion,
             created, isDeleted)
           VALUES($1, '', '', $2, $3, '', FALSE, $4::webknossos.PRICING_PLANS, NULL, NULL, $5, $6,
             NULL, 0, statement_timestamp(), FALSE)"#,
    )
    .bind(id)
    .bind(name)
    .bind(root_folder_id)
    .bind(pricing_plan)
    .bind(included_users)
    .bind(included_storage)
    .execute(connection)
    .await?;
    Ok(())
}

pub(crate) async fn insert_organization_team(
    connection: &mut PgConnection,
    id: &ObjectId,
    organization_id: &str,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO webknossos.teams(_id, _organization, name, created, isOrganizationTeam, isDeleted) VALUES($1, $2, 'Default', statement_timestamp(), TRUE, FALSE)",
    )
    .bind(id)
    .bind(organization_id)
    .execute(connection)
    .await?;
    Ok(())
}

pub(crate) async fn find_all_data_store_urls(pool: &PgPool) -> sqlx::Result<Vec<String>> {
    sqlx::query_scalar("SELECT url FROM webknossos.dataStores_ ORDER BY name")
        .fetch_all(pool)
        .await
}

pub(crate) async fn has_no_organizations(connection: &mut PgConnection) -> sqlx::Result<bool> {
    sqlx::query_scalar("SELECT NOT EXISTS(SELECT 1 FROM webknossos.organizations_)")
        .fetch_one(connection)
        .await
}

pub(crate) async fn update_terms_of_service_acceptance(
    connection: &mut PgConnection,
    organization_id: &str,
    version: i32,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE webknossos.organizations SET lastTermsOfServiceAcceptanceTime = statement_timestamp(), lastTermsOfServiceAcceptanceVersion = $2 WHERE _id = $1",
    )
    .bind(organization_id)
    .bind(version)
    .execute(connection)
    .await?;
    Ok(())
}

pub(crate) async fn user_exists(
    connection: &mut PgConnection,
    id: &ObjectId,
) -> sqlx::Result<bool> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM webknossos.users_ WHERE _id = $1)")
        .bind(id)
        .fetch_one(connection)
        .await
}

/// Serialize joins of one account (assertNotInOrgaYet + insert).
pub(crate) async fn find_multi_user_of_user_for_update(
    connection: &mut PgConnection,
    user_id: &ObjectId,
) -> sqlx::Result<Option<(ObjectId, String, String, String, bool)>> {
    sqlx::query_as(
        r#"SELECT m._id, m.email, m.firstName, m.lastName, m.isSuperUser
           FROM webknossos.multiUsers_ m JOIN webknossos.users_ u ON u._multiUser = m._id
           WHERE u._id = $1 FOR UPDATE OF m"#,
    )
    .bind(user_id)
    .fetch_optional(connection)
    .await
}

pub(crate) async fn multi_user_has_user_in_organization(
    connection: &mut PgConnection,
    multi_user_id: &ObjectId,
    organization_id: &str,
) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM webknossos.users_ WHERE _multiUser = $1 AND _organization = $2)",
    )
    .bind(multi_user_id)
    .bind(organization_id)
    .fetch_one(connection)
    .await
}

/// The first active identity of the account in an organization on a paid plan.
pub(crate) async fn find_paying_organization_of_multi_user(
    connection: &mut PgConnection,
    multi_user_id: &ObjectId,
) -> sqlx::Result<Option<String>> {
    sqlx::query_scalar(
        r#"SELECT _organization FROM webknossos.users_ WHERE _multiUser = $1 AND NOT isDeactivated
           AND _organization IN (SELECT _id FROM webknossos.organizations
             WHERE pricingPlan IN ('Team', 'Power', 'Custom', 'Team_Trial', 'Power_Trial'))
           ORDER BY created ASC LIMIT 1"#,
    )
    .bind(multi_user_id)
    .fetch_optional(connection)
    .await
}

/// The organization name and the full name of the user's account.
pub(crate) async fn find_organization_name_and_sender_name(
    connection: &mut PgConnection,
    user_id: &ObjectId,
) -> sqlx::Result<(String, String)> {
    sqlx::query_as(
        r#"SELECT o.name, m.firstName || ' ' || m.lastName FROM webknossos.users_ u
           JOIN webknossos.multiUsers_ m ON m._id = u._multiUser
           JOIN webknossos.organizations_ o ON o._id = u._organization WHERE u._id = $1"#,
    )
    .bind(user_id)
    .fetch_one(connection)
    .await
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn insert_invite(
    connection: &mut PgConnection,
    id: &ObjectId,
    token: &str,
    organization_id: &str,
    auto_activate: bool,
    is_admin: bool,
    is_dataset_manager: bool,
    expiry_ms: i64,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO webknossos.invites(_id, tokenValue, _organization, autoActivate, isAdmin,
                 isDatasetManager, expirationDateTime, created, isDeleted)
               VALUES($1, $2, $3, $4, $5, $6,
                 statement_timestamp() + $7::bigint * INTERVAL '1 millisecond', statement_timestamp(), FALSE)"#,
    )
    .bind(id)
    .bind(token)
    .bind(organization_id)
    .bind(auto_activate)
    .bind(is_admin)
    .bind(is_dataset_manager)
    .bind(expiry_ms)
    .execute(connection)
    .await?;
    Ok(())
}

pub(crate) async fn insert_invite_team_role(
    connection: &mut PgConnection,
    invite_id: &ObjectId,
    team_id: &ObjectId,
    is_team_manager: bool,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO webknossos.invite_team_roles(_invite, _team, isTeamManager) VALUES($1, $2, $3)",
    )
    .bind(invite_id)
    .bind(team_id)
    .bind(is_team_manager)
    .execute(connection)
    .await?;
    Ok(())
}

pub(crate) async fn find_multi_user_id_by_email_for_update(
    connection: &mut PgConnection,
    email: &str,
) -> sqlx::Result<Option<ObjectId>> {
    sqlx::query_scalar("SELECT _id FROM webknossos.multiUsers_ WHERE email = $1 FOR UPDATE")
        .bind(email)
        .fetch_optional(connection)
        .await
}

/// The oldest active identity of the account.
pub(crate) async fn find_first_active_user_of_multi_user(
    connection: &mut PgConnection,
    multi_user_id: &ObjectId,
) -> sqlx::Result<Option<ObjectId>> {
    sqlx::query_scalar(
        "SELECT _id FROM webknossos.users_ WHERE _multiUser = $1 AND NOT isDeactivated ORDER BY created, _id LIMIT 1",
    )
    .bind(multi_user_id)
    .fetch_optional(connection)
    .await
}
