//! OrganizationDAO: the organization queries.
use serde_json::Value;
use sqlx::{PgConnection, PgPool, Postgres};

use crate::{error::ApiResult, sql::Sql, util::id::ObjectId};

/// OrganizationService.publicWrites for alias `o`; callers append the
/// `WHERE` clause. It includes milliCreditBalance for members of the
/// requesting identity's organization, and the credit DAO returns zero to
/// members lacking billing (credit-read) access. Administrator fields only
/// for administrators of the requesting organization.
fn select_public<'a>(
    requesting_organization: Option<&'a str>,
    is_admin: bool,
    credit_access: bool,
) -> Sql<'a> {
    let mut q = Sql::new(
        r#"SELECT jsonb_build_object(
 'id',o._id,'name',o.name,'additionalInformation',o.additionalinformation,'enableAutoVerify',o.enableautoverify,
 'pricingPlan',o.pricingplan,'aiPlan',o.aiplan,'paidUntil',floor(extract(epoch FROM o.paiduntil)*1000)::bigint,
 'includedUsers',o.includedusers,'includedStorageBytes',o.includedstorage,
 'usedStorageBytes',(SELECT COALESCE(sum(usedstoragebytes),0)::bigint FROM (
    SELECT usedstoragebytes FROM webknossos.organization_usedstorage_mags WHERE _organization=o._id
    UNION ALL SELECT usedstoragebytes FROM webknossos.organization_usedstorage_attachments WHERE _organization=o._id
 ) storage),
 'ownerName',(SELECT m.firstname || ' ' || m.lastname FROM webknossos.users_ u
    JOIN webknossos.multiusers_ m ON m._id=u._multiuser WHERE u._organization=o._id AND u.isorganizationowner AND NOT u.isdeactivated LIMIT 1),
 'milliCreditBalance',CASE WHEN o._id="#,
    );
    q.push_bind(requesting_organization)
        .push(
            r#" THEN (SELECT COALESCE(sum(milli_credit_delta),0)::bigint
    FROM webknossos.credit_transactions_ WHERE _organization=o._id AND "#,
        )
        .push_bind(credit_access)
        .push(") ELSE NULL END\n) || CASE WHEN o._id=")
        .push_bind(requesting_organization)
        .push(" AND ")
        .push_bind(is_admin)
        .push(
            r#" THEN jsonb_build_object(
 'newUserMailingList',o.newusermailinglist,
 'lastTermsOfServiceAcceptanceTime',floor(extract(epoch FROM o.lasttermsofserviceacceptancetime)*1000)::bigint,
 'lastTermsOfServiceAcceptanceVersion',o.lasttermsofserviceacceptanceversion
) ELSE '{}'::jsonb END FROM webknossos.organizations_ o "#,
        );
    q
}

/// The public JSON of one organization (see `select_public`).
pub(crate) async fn find_one_public_json<'e, E: sqlx::Executor<'e, Database = Postgres>>(
    executor: E,
    id: &str,
    requesting_organization: Option<&str>,
    is_admin: bool,
    credit_access: bool,
) -> ApiResult<Option<Value>> {
    let mut q = select_public(requesting_organization, is_admin, credit_access);
    q.push("WHERE o._id=").push_bind(id);
    Ok(q.build_query_scalar().fetch_optional(executor).await?)
}

/// Id and name of the organizations the user's account belongs to; superusers see all.
pub(crate) async fn find_all_compact_for_user(
    pool: &PgPool,
    user_id: &ObjectId,
    is_superuser: bool,
) -> ApiResult<Vec<Value>> {
    Ok(sqlx::query_scalar("SELECT jsonb_build_object('id',o._id,'name',o.name) FROM webknossos.organizations_ o WHERE ($2 OR o._id IN (SELECT _organization FROM webknossos.users_ WHERE _multiuser=(SELECT _multiuser FROM webknossos.users_ WHERE _id=$1))) ORDER BY o._id")
        .bind(user_id)
        .bind(is_superuser)
        .fetch_all(pool)
        .await?)
}

/// The public JSON of the organizations the user's account belongs to; superusers see all.
pub(crate) async fn find_all_public_json_for_user(
    pool: &PgPool,
    user_id: &ObjectId,
    is_superuser: bool,
) -> ApiResult<Vec<Value>> {
    // Scala deliberately calls publicWrites without requestingUser here,
    // so list responses never include administrator fields or balances.
    let mut q = select_public(None, false, false);
    q.push(" WHERE (")
        .push_bind(is_superuser)
        .push(
            " OR o._id IN (SELECT _organization FROM webknossos.users_ WHERE _multiuser=\
             (SELECT _multiuser FROM webknossos.users_ WHERE _id=",
        )
        .push_bind(user_id)
        .push("))) ORDER BY o._id");
    Ok(q.build_query_scalar().fetch_all(pool).await?)
}

/// At most two organization ids, enough to tell whether there is exactly one.
pub(crate) async fn find_up_to_two_ids(pool: &PgPool) -> ApiResult<Vec<String>> {
    Ok(
        sqlx::query_scalar("SELECT _id FROM webknossos.organizations_ LIMIT 2")
            .fetch_all(pool)
            .await?,
    )
}

/// The organization an unexpired invite token belongs to.
pub(crate) async fn find_organization_id_by_invite_token(
    pool: &PgPool,
    token: String,
) -> ApiResult<Option<String>> {
    Ok(sqlx::query_scalar(
        "SELECT _organization FROM webknossos.invites_ WHERE tokenvalue=$1 AND \
            expirationdatetime>statement_timestamp() LIMIT 1",
    )
    .bind(token)
    .fetch_optional(pool)
    .await?)
}

pub(crate) async fn is_empty(pool: &PgPool) -> ApiResult<bool> {
    Ok(
        sqlx::query_scalar("SELECT NOT EXISTS(SELECT 1 FROM webknossos.organizations_)")
            .fetch_one(pool)
            .await?,
    )
}

/// Whether the organization is visible to the user: they or their account belong to it, or they are superuser.
pub(crate) async fn is_accessible(
    connection: &mut PgConnection,
    id: &str,
    user_id: &ObjectId,
    is_superuser: bool,
) -> ApiResult<bool> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM webknossos.organizations_ o WHERE o._id=$1 AND ($3 \
            OR o._id IN(SELECT _organization FROM webknossos.users_ WHERE _multiuser=(SELECT \
            _multiuser FROM webknossos.users_ WHERE _id=$2))))",
    )
    .bind(id)
    .bind(user_id)
    .bind(is_superuser)
    .fetch_one(connection)
    .await?)
}

/// Like `is_accessible`, but only for live organizations (reads the base table).
pub(crate) async fn is_accessible_not_deleted(
    connection: &mut PgConnection,
    id: &str,
    user_id: &ObjectId,
    is_superuser: bool,
) -> ApiResult<bool> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM webknossos.organizations o WHERE o._id=$1 AND NOT o.isDeleted AND ($3 OR o._id IN(SELECT _organization FROM webknossos.users_ WHERE _multiuser=(SELECT _multiuser FROM webknossos.users_ WHERE _id=$2))))",
    )
    .bind(id)
    .bind(user_id)
    .bind(is_superuser)
    .fetch_one(connection)
    .await?)
}

/// Returns the number of updated rows.
pub(crate) async fn update_name_and_new_user_mailing_list(
    connection: &mut PgConnection,
    id: &str,
    name: String,
    new_user_mailing_list: String,
) -> ApiResult<u64> {
    let updated = sqlx::query(
        "UPDATE webknossos.organizations SET name=$2,newusermailinglist=$3 WHERE _id=$1 \
            AND NOT isdeleted",
    )
    .bind(id)
    .bind(name)
    .bind(new_user_mailing_list)
    .execute(connection)
    .await?;
    Ok(updated.rows_affected())
}

/// Returns the number of deleted rows.
pub(crate) async fn mark_deleted(connection: &mut PgConnection, id: &str) -> ApiResult<u64> {
    let deleted = sqlx::query(
        "UPDATE webknossos.organizations SET isDeleted = TRUE WHERE _id = $1 AND NOT isDeleted",
    )
    .bind(id)
    .execute(connection)
    .await?;
    Ok(deleted.rows_affected())
}

/// Soft-deletes all users of the organization.
pub(crate) async fn mark_users_deleted(
    connection: &mut PgConnection,
    organization_id: &str,
) -> ApiResult<()> {
    sqlx::query("UPDATE webknossos.users SET isDeleted = TRUE WHERE _organization = $1")
        .bind(organization_id)
        .execute(connection)
        .await?;
    Ok(())
}

/// Clears the last logged-in identity of accounts that point at a user of the organization.
pub(crate) async fn clear_last_logged_in_identities(
    connection: &mut PgConnection,
    organization_id: &str,
) -> ApiResult<()> {
    sqlx::query(
        "UPDATE webknossos.multiUsers SET _lastLoggedInIdentity = NULL WHERE _lastLoggedInIdentity IN (SELECT _id FROM webknossos.users WHERE _organization = $1)",
    )
    .bind(organization_id)
    .execute(connection)
    .await?;
    Ok(())
}

pub(crate) async fn mark_token_deleted(
    connection: &mut PgConnection,
    token: &str,
) -> ApiResult<()> {
    sqlx::query("UPDATE webknossos.tokens SET isDeleted = TRUE WHERE value = $1")
        .bind(token)
        .execute(connection)
        .await?;
    Ok(())
}

/// Locks and returns the account (multiUser) with the email.
pub(crate) async fn find_multi_user_id_by_email_for_update(
    connection: &mut PgConnection,
    email: &str,
) -> ApiResult<Option<ObjectId>> {
    Ok(
        sqlx::query_scalar("SELECT _id FROM webknossos.multiUsers_ WHERE email = $1 FOR UPDATE")
            .bind(email)
            .fetch_optional(connection)
            .await?,
    )
}

/// userDAO.findFirstByMultiUser
pub(crate) async fn find_first_user_id_by_multi_user(
    connection: &mut PgConnection,
    multi_user_id: &ObjectId,
) -> ApiResult<Option<ObjectId>> {
    Ok(sqlx::query_scalar(
        "SELECT _id FROM webknossos.users_ WHERE _multiUser = $1 AND NOT isDeactivated ORDER BY created, _id LIMIT 1",
    )
    .bind(multi_user_id)
    .fetch_optional(connection)
    .await?)
}

pub(crate) async fn find_last_terms_of_service_acceptance_version(
    pool: &PgPool,
    id: &str,
) -> ApiResult<Option<i32>> {
    Ok(sqlx::query_scalar(
        "SELECT lastTermsOfServiceAcceptanceVersion FROM webknossos.organizations_ WHERE _id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?)
}

pub(crate) async fn update_terms_of_service_acceptance(
    pool: &PgPool,
    id: &str,
    version: i32,
) -> ApiResult<()> {
    sqlx::query(
        r#"UPDATE webknossos.organizations
           SET lastTermsOfServiceAcceptanceTime = statement_timestamp(),
               lastTermsOfServiceAcceptanceVersion = $2
           WHERE _id = $1 AND NOT isDeleted"#,
    )
    .bind(id)
    .bind(version)
    .execute(pool)
    .await?;
    Ok(())
}

/// Whether the user is an organization owner; missing users count as no.
pub(crate) async fn is_organization_owner(pool: &PgPool, user_id: &ObjectId) -> ApiResult<bool> {
    Ok(
        sqlx::query_scalar("SELECT isOrganizationOwner FROM webknossos.users_ WHERE _id = $1")
            .bind(user_id)
            .fetch_optional(pool)
            .await?
            .unwrap_or(false),
    )
}

pub(crate) async fn exists(pool: &PgPool, id: &str) -> ApiResult<bool> {
    Ok(
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM webknossos.organizations_ WHERE _id=$1)")
            .bind(id)
            .fetch_one(pool)
            .await?,
    )
}

/// The name of the organization, if it exists.
pub(crate) async fn find_name(pool: &PgPool, id: &str) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT name FROM webknossos.organizations_ WHERE _id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}
