//! Browser authentication DAOs: the users, multiUsers and emailVerificationKeys
//! queries behind cookie authentication, password login and email verification.
//!
//! Callers own the connection and transaction; these functions only run SQL
//! and return rows. Mapping a missing row to an error is up to the caller.
use chrono::{DateTime, Utc};
use sqlx::{PgConnection, PgPool};

use crate::{error::ApiResult, util::id::ObjectId};

#[derive(sqlx::FromRow)]
pub(crate) struct CookieUserRow {
    pub id: ObjectId,
    pub organization_id: String,
    pub is_admin: bool,
    pub is_dataset_manager: bool,
    pub is_superuser: bool,
    pub logged_out_everywhere: Option<DateTime<Utc>>,
    pub active: bool,
}

#[derive(sqlx::FromRow)]
pub(crate) struct LoginCandidate {
    pub user_id: Option<ObjectId>,
    pub hasher: String,
    pub password_hash: String,
}

/// The user a signed cookie names, with the account-level data needed to validate it.
pub(crate) async fn find_one_for_cookie(
    pool: &PgPool,
    user_id: &str,
) -> ApiResult<Option<CookieUserRow>> {
    Ok(sqlx::query_as::<_, CookieUserRow>(
        r#"SELECT u._id AS id, u._organization AS organization_id, u.isAdmin AS is_admin,
                 u.isDatasetManager AS is_dataset_manager, m.isSuperUser AS is_superuser,
                 u.loggedOutEverywhereTime AS logged_out_everywhere,
                 (NOT u.isDeactivated AND NOT m.isDeleted AND NOT o.isDeleted) AS active
               FROM webknossos.users_ u
               JOIN webknossos.multiUsers m ON m._id = u._multiUser
               JOIN webknossos.organizations o ON o._id = u._organization
               WHERE u._id = $1"#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?)
}

/// The logout-everywhere cutoff of an active user; `None` if the user is missing or inactive.
pub(crate) async fn find_logged_out_everywhere_time_of_active_user(
    connection: &mut PgConnection,
    user_id: &ObjectId,
) -> ApiResult<Option<(Option<DateTime<Utc>>,)>> {
    Ok(sqlx::query_as(
        r#"SELECT u.loggedOutEverywhereTime FROM webknossos.users u
           JOIN webknossos.multiUsers m ON m._id = u._multiUser
           JOIN webknossos.organizations o ON o._id = u._organization
           WHERE u._id = $1 AND NOT u.isDeleted AND NOT u.isDeactivated
             AND NOT m.isDeleted AND NOT o.isDeleted"#,
    )
    .bind(user_id)
    .fetch_optional(connection)
    .await?)
}

pub(crate) async fn find_one_multi_user_name_and_email(
    connection: &mut PgConnection,
    multi_user_id: &ObjectId,
) -> ApiResult<Option<(String, String, String)>> {
    Ok(sqlx::query_as(
        "SELECT email, firstName, lastName FROM webknossos.multiUsers_ WHERE _id = $1",
    )
    .bind(multi_user_id)
    .fetch_optional(connection)
    .await?)
}

pub(crate) async fn insert_email_verification_key(
    connection: &mut PgConnection,
    key: &str,
    email: &str,
    multi_user_id: &ObjectId,
    expiry_ms: Option<i64>,
) -> ApiResult<()> {
    sqlx::query(
        r#"INSERT INTO webknossos.emailVerificationKeys(_id, key, email, _multiUser, validUntil, isUsed)
           VALUES($1, $2, $3, $4,
             CASE WHEN $5::bigint IS NULL THEN NULL
               ELSE statement_timestamp() + $5::bigint * INTERVAL '1 millisecond' END,
             FALSE)"#,
    )
    .bind(ObjectId::new())
    .bind(key)
    .bind(email)
    .bind(multi_user_id)
    .bind(expiry_ms)
    .execute(connection)
    .await?;
    Ok(())
}

/// userFromMultiUserEmail: the last logged-in identity if still active,
/// otherwise the first active identity of the account.
pub(crate) async fn find_login_candidate_by_email(
    pool: &PgPool,
    email: &str,
) -> ApiResult<Option<LoginCandidate>> {
    Ok(sqlx::query_as::<_, LoginCandidate>(
        r#"SELECT COALESCE(
             (SELECT u._id FROM webknossos.users_ u JOIN webknossos.organizations_ o ON o._id = u._organization
               WHERE u._id = m._lastLoggedInIdentity AND u._multiUser = m._id AND NOT u.isDeactivated),
             (SELECT u._id FROM webknossos.users_ u JOIN webknossos.organizations_ o ON o._id = u._organization
               WHERE u._multiUser = m._id AND NOT u.isDeactivated ORDER BY u.created, u._id LIMIT 1)
           ) AS user_id,
           m.passwordInfo_hasher::text AS hasher, m.passwordInfo_password AS password_hash
         FROM webknossos.multiUsers_ m WHERE m.email = $1"#,
    )
    .bind(email)
    .fetch_optional(pool)
    .await?)
}

/// Locks the account row and returns its id, the user's deactivation flag, the
/// account's email-verified flag and whether it is still within the verification grace period.
pub(crate) async fn find_login_state_for_update(
    connection: &mut PgConnection,
    user_id: &ObjectId,
    grace_period_ms: i64,
) -> ApiResult<Option<(ObjectId, bool, bool, bool)>> {
    Ok(sqlx::query_as(
        r#"SELECT m._id, u.isDeactivated, m.isEmailVerified,
             m.emailChangeDate + $2::bigint * INTERVAL '1 millisecond' > statement_timestamp()
           FROM webknossos.users_ u JOIN webknossos.multiUsers_ m ON m._id = u._multiUser
           JOIN webknossos.organizations_ o ON o._id = u._organization
           WHERE u._id = $1 FOR UPDATE OF m"#,
    )
    .bind(user_id)
    .bind(grace_period_ms)
    .fetch_optional(connection)
    .await?)
}

pub(crate) async fn update_last_logged_in_identity(
    connection: &mut PgConnection,
    multi_user_id: &ObjectId,
    user_id: &ObjectId,
) -> ApiResult<()> {
    sqlx::query("UPDATE webknossos.multiUsers SET _lastLoggedInIdentity = $2 WHERE _id = $1")
        .bind(multi_user_id)
        .bind(user_id)
        .execute(connection)
        .await?;
    Ok(())
}
