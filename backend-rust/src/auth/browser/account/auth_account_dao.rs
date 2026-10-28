//! Account DAOs: the tokens, users, multiUsers and emailVerificationKeys
//! queries behind password reset/change, identity switching and email verification.
//!
//! Callers own the connection and transaction; these functions only run SQL
//! and return rows. Mapping a missing row to an error is up to the caller.
use sqlx::{PgConnection, PgPool};

use crate::{auth::AuthUser, util::id::ObjectId};

/// Soft-deletes the bearer token (including already deleted rows, as the Scala DAO does).
pub(crate) async fn delete_token_by_value_for_user(
    connection: &mut PgConnection,
    token: &str,
    user_id: &ObjectId,
) -> sqlx::Result<()> {
    sqlx::query("UPDATE webknossos.tokens SET isDeleted = TRUE WHERE value = $1 AND _user = $2")
        .bind(token)
        .bind(user_id)
        .execute(connection)
        .await?;
    Ok(())
}

/// userService.userFromMultiUserEmail: the user id, email and full name of the account.
pub(crate) async fn find_identity_by_email(
    connection: &mut PgConnection,
    email: &str,
) -> sqlx::Result<Option<(Option<ObjectId>, String, String)>> {
    sqlx::query_as(
        r#"SELECT COALESCE(
             (SELECT u._id FROM webknossos.users_ u JOIN webknossos.organizations_ o ON o._id = u._organization
               WHERE u._id = m._lastLoggedInIdentity AND u._multiUser = m._id AND NOT u.isDeactivated),
             (SELECT u._id FROM webknossos.users_ u JOIN webknossos.organizations_ o ON o._id = u._organization
               WHERE u._multiUser = m._id AND NOT u.isDeactivated ORDER BY u.created, u._id LIMIT 1)),
           m.email, m.firstName || ' ' || m.lastName
         FROM webknossos.multiUsers_ m WHERE m.email = $1"#,
    )
    .bind(email)
    .fetch_optional(connection)
    .await
}

pub(crate) async fn delete_reset_password_tokens_for_user(
    connection: &mut PgConnection,
    user_id: &ObjectId,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE webknossos.tokens SET isDeleted = TRUE WHERE _user = $1 AND tokenType = 'ResetPassword' AND NOT isDeleted",
    )
    .bind(user_id)
    .execute(connection)
    .await?;
    Ok(())
}

pub(crate) async fn insert_reset_password_token(
    connection: &mut PgConnection,
    value: &str,
    user_id: &ObjectId,
    expiry_ms: i64,
    idle_ms: i64,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO webknossos.tokens
                 (_id, value, _user, lastUsedDateTime, expirationDateTime, idleTimeout, tokenType, created)
               VALUES ($1, $2, $3, statement_timestamp(),
                 statement_timestamp() + $4::bigint * INTERVAL '1 millisecond', $5,
                 'ResetPassword', statement_timestamp())"#,
    )
    .bind(ObjectId::new())
    .bind(value)
    .bind(user_id)
    .bind(expiry_ms)
    .bind(idle_ms)
    .execute(connection)
    .await?;
    Ok(())
}

/// userForResetPasswordToken: only reset-password tokens may set a password
/// without the old one. Returns the user id, the account id and the user's
/// deactivation flag.
pub(crate) async fn find_user_for_reset_password_token(
    connection: &mut PgConnection,
    token: &str,
) -> sqlx::Result<Option<(ObjectId, ObjectId, bool)>> {
    sqlx::query_as(
        r#"SELECT u._id, u._multiUser, u.isDeactivated FROM webknossos.tokens t
           JOIN webknossos.users_ u ON u._id = t._user
           JOIN webknossos.multiUsers_ m ON m._id = u._multiUser
           WHERE t.value = $1 AND t.tokenType = 'ResetPassword' AND NOT t.isDeleted
             AND t.expirationDateTime > statement_timestamp()
             AND (t.idleTimeout IS NULL OR (t.idleTimeout > 0 AND
               EXTRACT(EPOCH FROM (statement_timestamp() - t.lastUsedDateTime)) * 1000 < t.idleTimeout))
             AND (u.loggedOutEverywhereTime IS NULL OR t.created > u.loggedOutEverywhereTime)
             AND (SELECT COUNT(*) FROM webknossos.tokens d WHERE d.value = $1 AND NOT d.isDeleted) = 1
           FOR UPDATE OF t"#,
    )
    .bind(token)
    .fetch_optional(connection)
    .await
}

pub(crate) async fn update_password(
    connection: &mut PgConnection,
    multi_user_id: &ObjectId,
    password_hash: &str,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE webknossos.multiUsers SET passwordInfo_hasher = 'SCrypt', passwordInfo_password = $2 WHERE _id = $1",
    )
    .bind(multi_user_id)
    .bind(password_hash)
    .execute(connection)
    .await?;
    Ok(())
}

pub(crate) async fn delete_tokens_by_value(
    connection: &mut PgConnection,
    token: &str,
) -> sqlx::Result<()> {
    sqlx::query("UPDATE webknossos.tokens SET isDeleted = TRUE WHERE value = $1")
        .bind(token)
        .execute(connection)
        .await?;
    Ok(())
}

/// Locks the user's account and returns its id, password hasher, password
/// hash, email and full name.
pub(crate) async fn find_password_info_of_user_for_update(
    connection: &mut PgConnection,
    user_id: &ObjectId,
) -> sqlx::Result<Option<(ObjectId, String, String, String, String)>> {
    sqlx::query_as(
        r#"SELECT m._id, m.passwordInfo_hasher::text, m.passwordInfo_password, m.email,
                 m.firstName || ' ' || m.lastName
               FROM webknossos.multiUsers_ m JOIN webknossos.users_ u ON u._multiUser = m._id
               WHERE u._id = $1 FOR UPDATE OF m"#,
    )
    .bind(user_id)
    .fetch_optional(connection)
    .await
}

pub(crate) async fn find_multi_user_id_of_user_for_update(
    connection: &mut PgConnection,
    user_id: &ObjectId,
) -> sqlx::Result<Option<ObjectId>> {
    sqlx::query_scalar(
        "SELECT m._id FROM webknossos.multiUsers_ m JOIN webknossos.users_ u ON u._multiUser = m._id WHERE u._id = $1 FOR UPDATE OF m",
    )
    .bind(user_id)
    .fetch_optional(connection)
    .await
}

/// OrganizationDAO read access: the account's organizations, or superuser.
pub(crate) async fn is_organization_accessible(
    connection: &mut PgConnection,
    organization_id: &str,
    multi_user_id: &ObjectId,
    is_superuser: bool,
) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        r#"SELECT EXISTS(SELECT 1 FROM webknossos.organizations_ o WHERE o._id = $1
             AND ($3 OR o._id IN (SELECT _organization FROM webknossos.users_ WHERE _multiUser = $2)))"#,
    )
    .bind(organization_id)
    .bind(multi_user_id)
    .bind(is_superuser)
    .fetch_one(connection)
    .await
}

pub(crate) async fn find_one_user_of_multi_user_in_organization(
    connection: &mut PgConnection,
    multi_user_id: &ObjectId,
    organization_id: &str,
) -> sqlx::Result<Option<(ObjectId, bool)>> {
    sqlx::query_as(
        "SELECT _id, isDeactivated FROM webknossos.users_ WHERE _multiUser = $1 AND _organization = $2",
    )
    .bind(multi_user_id)
    .bind(organization_id)
    .fetch_optional(connection)
    .await
}

pub(crate) async fn workflow_exists_in_organization(
    pool: &PgPool,
    organization_id: &str,
    hash: &str,
) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM webknossos.voxelytics_workflows WHERE \
                    _organization = $1 AND hash = $2)",
    )
    .bind(organization_id)
    .bind(hash)
    .fetch_one(pool)
    .await
}

pub(crate) async fn find_organization_id_of_dataset(
    pool: &PgPool,
    dataset_id: &ObjectId,
) -> sqlx::Result<Option<String>> {
    sqlx::query_scalar(
        "SELECT o._id FROM webknossos.datasets_ d JOIN webknossos.organizations_ o ON o._id = d._organization WHERE d._id = $1",
    )
    .bind(dataset_id)
    .fetch_optional(pool)
    .await
}

pub(crate) async fn find_organization_id_of_annotation(
    pool: &PgPool,
    annotation_id: &ObjectId,
) -> sqlx::Result<Option<String>> {
    sqlx::query_scalar(
        r#"SELECT o._id FROM webknossos.annotations_ a JOIN webknossos.users_ u ON u._id = a._user
                   JOIN webknossos.organizations_ o ON o._id = u._organization WHERE a._id = $1"#,
    )
    .bind(annotation_id)
    .fetch_optional(pool)
    .await
}

pub(crate) async fn find_organization_id_of_workflow(
    pool: &PgPool,
    hash: &str,
) -> sqlx::Result<Option<String>> {
    sqlx::query_scalar(
        r#"SELECT o._id FROM webknossos.voxelytics_workflows w
                   JOIN webknossos.organizations_ o ON o._id = w._organization
                   WHERE w.hash = $1 ORDER BY w._organization LIMIT 1"#,
    )
    .bind(hash)
    .fetch_optional(pool)
    .await
}

/// The identities of the user's account, without superuser rights.
pub(crate) async fn find_all_identities_of_account(
    pool: &PgPool,
    user_id: &ObjectId,
) -> sqlx::Result<Vec<AuthUser>> {
    sqlx::query_as(
        r#"SELECT u._id AS id, u._organization AS organization_id, u.isAdmin AS is_admin,
                 u.isDatasetManager AS is_dataset_manager, FALSE AS is_superuser
               FROM webknossos.users_ u JOIN webknossos.organizations_ o ON o._id = u._organization
               WHERE u._multiUser = (SELECT _multiUser FROM webknossos.users_ WHERE _id = $1)
               ORDER BY u.created, u._id"#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
}

/// Locks the key row; returns its id, email, account id, used flag and
/// whether it is expired.
pub(crate) async fn find_email_verification_key_for_update(
    connection: &mut PgConnection,
    key: &str,
) -> sqlx::Result<Option<(ObjectId, String, ObjectId, bool, bool)>> {
    sqlx::query_as(
        r#"SELECT _id, email, _multiUser, isUsed,
             validUntil IS NOT NULL AND validUntil <= statement_timestamp()
           FROM webknossos.emailVerificationKeys WHERE key = $1 ORDER BY _id LIMIT 1 FOR UPDATE"#,
    )
    .bind(key)
    .fetch_optional(connection)
    .await
}

/// Locks the account; returns its email and email-verified flag.
pub(crate) async fn find_email_and_verified_for_update(
    connection: &mut PgConnection,
    multi_user_id: &ObjectId,
) -> sqlx::Result<Option<(String, bool)>> {
    sqlx::query_as(
        "SELECT email, isEmailVerified FROM webknossos.multiUsers_ WHERE _id = $1 FOR UPDATE",
    )
    .bind(multi_user_id)
    .fetch_optional(connection)
    .await
}

pub(crate) async fn update_email_verified(
    connection: &mut PgConnection,
    multi_user_id: &ObjectId,
) -> sqlx::Result<()> {
    sqlx::query("UPDATE webknossos.multiUsers SET isEmailVerified = TRUE WHERE _id = $1")
        .bind(multi_user_id)
        .execute(connection)
        .await?;
    Ok(())
}

pub(crate) async fn update_email_verification_key_used(
    connection: &mut PgConnection,
    key_id: &ObjectId,
) -> sqlx::Result<()> {
    sqlx::query("UPDATE webknossos.emailVerificationKeys SET isUsed = TRUE WHERE _id = $1")
        .bind(key_id)
        .execute(connection)
        .await?;
    Ok(())
}

pub(crate) async fn find_multi_user_id_of_user(
    connection: &mut PgConnection,
    user_id: &ObjectId,
) -> sqlx::Result<ObjectId> {
    sqlx::query_scalar("SELECT _multiUser FROM webknossos.users_ WHERE _id = $1")
        .bind(user_id)
        .fetch_one(connection)
        .await
}
