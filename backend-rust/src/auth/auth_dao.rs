//! Auth DAOs: the tokens, multiUsers, users and webauthnCredentials queries
//! behind request authentication and the token lifecycle routes.
//!
//! Callers own the connection and transaction; these functions only run SQL
//! and return rows. Mapping a missing row to an error is up to the caller.
use sqlx::{PgConnection, PgPool};

use crate::{
    auth::{AuthUser, routes::KeyDescriptor},
    util::id::ObjectId,
};

/// Authenticate and touch the token in one statement. Invalid or revoked tokens are
/// never touched, and overlapping requests cannot move lastUsedDateTime backwards.
/// Like Silhouette's BearerTokenAuthenticatorService.touch, only tokens with an idle
/// timeout are written: tokens without one are read-only, so concurrent requests with
/// the same token neither lock its row nor create a new row version per request.
pub(crate) async fn find_one_and_touch_for_authentication(
    pool: &PgPool,
    token: &str,
) -> sqlx::Result<Option<AuthUser>> {
    sqlx::query_as::<_, AuthUser>(
        r#"
        WITH matched AS (
          SELECT token._id AS token_id, token.idleTimeout IS NOT NULL AS has_idle_timeout,
            usr._id AS id, usr._organization AS organization_id,
            usr.isAdmin AS is_admin, usr.isDatasetManager AS is_dataset_manager,
            multi.isSuperUser AS is_superuser
          FROM webknossos.tokens AS token
          JOIN webknossos.users AS usr ON usr._id = token._user
          JOIN webknossos.multiUsers AS multi ON multi._id = usr._multiUser
          JOIN webknossos.organizations AS org ON org._id = usr._organization
          WHERE token.value = $1
            AND NOT token.isDeleted
            AND token.tokenType IN ('Authentication', 'DataStore', 'Job')
            AND token.expirationDateTime > statement_timestamp()
            AND (token.idleTimeout IS NULL OR (
              token.idleTimeout > 0 AND
              EXTRACT(EPOCH FROM (statement_timestamp() - token.lastUsedDateTime)) * 1000
                < token.idleTimeout
            ))
            AND NOT usr.isDeleted AND NOT usr.isDeactivated
            AND NOT multi.isDeleted AND NOT org.isDeleted
            AND (usr.loggedOutEverywhereTime IS NULL
              OR token.created > usr.loggedOutEverywhereTime)
            AND (SELECT COUNT(*) FROM webknossos.tokens AS matching
              WHERE matching.value = $1 AND NOT matching.isDeleted) = 1
        ), touched AS (
          UPDATE webknossos.tokens AS token
          SET lastUsedDateTime = GREATEST(token.lastUsedDateTime, statement_timestamp())
          FROM matched
          WHERE token._id = matched.token_id AND matched.has_idle_timeout
        )
        SELECT id, organization_id, is_admin, is_dataset_manager, is_superuser FROM matched
        "#,
    )
    .bind(token)
    .fetch_optional(pool)
    .await
}

/// WebknossosBearerTokenAuthenticatorService.userForToken is a read-only
/// lookup accepting every token type usable for authentication
/// (findOneUsableForAuthentication), i.e. all but ResetPassword. It does not
/// touch lastUsedDateTime. Account-revocation checks match the Rust
/// authentication boundary (deactivated users are rejected).
pub(crate) async fn find_user_for_service_token(
    pool: &PgPool,
    token: &str,
) -> sqlx::Result<Option<AuthUser>> {
    sqlx::query_as(
        r#"SELECT u._id AS id,u._organization AS organization_id,u.isAdmin AS is_admin,u.isDatasetManager AS is_dataset_manager,m.isSuperUser AS is_superuser
        FROM webknossos.tokens_ token JOIN webknossos.users_ u ON u._id=token._user
        JOIN webknossos.multiUsers_ m ON m._id=u._multiUser JOIN webknossos.organizations_ organization ON organization._id=u._organization
        WHERE token.value=$1 AND token.tokenType<>'ResetPassword'
        AND token.expirationDateTime>statement_timestamp() AND NOT u.isDeactivated
        AND (token.idleTimeout IS NULL OR (token.idleTimeout>0 AND extract(epoch FROM (statement_timestamp()-token.lastUsedDateTime))*1000<token.idleTimeout))
        AND (u.loggedOutEverywhereTime IS NULL OR token.created>u.loggedOutEverywhereTime)
        AND (SELECT count(*) FROM webknossos.tokens_ duplicate WHERE duplicate.value=$1)=1"#,
    )
    .bind(token)
    .fetch_optional(pool)
    .await
}

pub(crate) async fn is_team_manager_in_organization(
    pool: &PgPool,
    user_id: &ObjectId,
    organization_id: &str,
) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        r#"SELECT EXISTS (
              SELECT 1 FROM webknossos.user_team_roles AS role
              JOIN webknossos.teams_ AS team ON team._id = role._team
              WHERE role._user = $1 AND role.isTeamManager AND team._organization = $2
            )"#,
    )
    .bind(user_id)
    .bind(organization_id)
    .fetch_one(pool)
    .await
}

pub(crate) async fn can_manage_team(
    pool: &PgPool,
    team_id: &ObjectId,
    organization_id: &str,
    is_admin: bool,
    user_id: &ObjectId,
) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        r#"SELECT EXISTS (
              SELECT 1 FROM webknossos.teams_ AS team
              WHERE team._id = $1 AND team._organization = $2
                AND ($3 OR EXISTS (
                  SELECT 1 FROM webknossos.user_team_roles AS role
                  WHERE role._team = team._id AND role._user = $4 AND role.isTeamManager
                ))
            )"#,
    )
    .bind(team_id)
    .bind(organization_id)
    .bind(is_admin)
    .bind(user_id)
    .fetch_one(pool)
    .await
}

/// Locks the account's multiUsers row (serializes token issuance and revocation).
pub(crate) async fn lock_multi_user_of_active_user(
    connection: &mut PgConnection,
    user_id: &ObjectId,
) -> sqlx::Result<Option<ObjectId>> {
    sqlx::query_scalar(
        "SELECT multi._id FROM webknossos.multiUsers AS multi JOIN webknossos.users AS usr ON usr._multiUser = multi._id WHERE usr._id = $1 AND NOT usr.isDeleted AND NOT usr.isDeactivated AND NOT multi.isDeleted FOR UPDATE OF multi",
    )
    .bind(user_id)
    .fetch_optional(connection)
    .await
}

pub(crate) async fn lock_user(
    connection: &mut PgConnection,
    user_id: &ObjectId,
) -> sqlx::Result<()> {
    sqlx::query("SELECT _id FROM webknossos.users WHERE _id = $1 FOR UPDATE")
        .bind(user_id)
        .fetch_one(connection)
        .await?;
    Ok(())
}

/// Whether the token is still usable by the user for authentication or DataStore access.
pub(crate) async fn is_token_valid_for_user(
    connection: &mut PgConnection,
    token: &str,
    user_id: &ObjectId,
) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        r#"SELECT EXISTS (
          SELECT 1 FROM webknossos.tokens AS token
          JOIN webknossos.users AS usr ON usr._id = token._user
          JOIN webknossos.organizations AS org ON org._id = usr._organization
          WHERE token.value = $1 AND usr._id = $2
            AND NOT token.isDeleted AND NOT usr.isDeleted AND NOT usr.isDeactivated
            AND NOT org.isDeleted AND token.tokenType IN ('Authentication', 'DataStore')
            AND token.expirationDateTime > statement_timestamp()
            AND (token.idleTimeout IS NULL OR (token.idleTimeout > 0 AND
              EXTRACT(EPOCH FROM (statement_timestamp() - token.lastUsedDateTime)) * 1000 < token.idleTimeout))
            AND (usr.loggedOutEverywhereTime IS NULL OR token.created > usr.loggedOutEverywhereTime)
            AND (SELECT COUNT(*) FROM webknossos.tokens WHERE value = $1 AND NOT isDeleted) = 1
        )"#,
    )
    .bind(token)
    .bind(user_id)
    .fetch_one(connection)
    .await
}

pub(crate) async fn insert_token(
    connection: &mut PgConnection,
    user_id: &ObjectId,
    value: &str,
    expiry_ms: i64,
    idle_ms: Option<i64>,
    token_type: &str,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO webknossos.tokens
          (_id, value, _user, lastUsedDateTime, expirationDateTime, idleTimeout, tokenType, created)
          VALUES ($1, $2, $3, statement_timestamp(),
            statement_timestamp() + $4::bigint * INTERVAL '1 millisecond', $5,
            $6::webknossos.TOKEN_TYPES, statement_timestamp())"#,
    )
    .bind(ObjectId::new())
    .bind(value)
    .bind(user_id)
    .bind(expiry_ms)
    .bind(idle_ms)
    .bind(token_type)
    .execute(connection)
    .await?;
    Ok(())
}

/// Only returns usable tokens. Unlike the legacy DAO's unfiltered lookup,
/// this excludes expired, idle-expired and account-revoked credentials.
pub(crate) async fn find_one_usable_authentication_token(
    connection: &mut PgConnection,
    user_id: &ObjectId,
) -> sqlx::Result<Option<String>> {
    sqlx::query_scalar(
        r#"SELECT token.value FROM webknossos.tokens AS token
          JOIN webknossos.users AS usr ON usr._id = token._user
          WHERE token._user = $1 AND token.tokenType = 'Authentication' AND NOT token.isDeleted
            AND token.expirationDateTime > statement_timestamp()
            AND (token.idleTimeout IS NULL OR (token.idleTimeout > 0 AND
              EXTRACT(EPOCH FROM (statement_timestamp() - token.lastUsedDateTime)) * 1000 < token.idleTimeout))
            AND (usr.loggedOutEverywhereTime IS NULL OR token.created > usr.loggedOutEverywhereTime)
            AND (SELECT COUNT(*) FROM webknossos.tokens AS matching WHERE matching.value = token.value AND NOT matching.isDeleted) = 1
          ORDER BY token.created, token._id LIMIT 1"#,
    )
    .bind(user_id)
    .fetch_optional(connection)
    .await
}

pub(crate) async fn delete_authentication_tokens_for_user(
    connection: &mut PgConnection,
    user_id: &ObjectId,
) -> sqlx::Result<()> {
    sqlx::query("UPDATE webknossos.tokens SET isDeleted = TRUE WHERE _user = $1 AND tokenType = 'Authentication' AND NOT isDeleted")
        .bind(user_id)
        .execute(connection)
        .await?;
    Ok(())
}

/// Soft-deletes the user's oldest authentication token; returns the number of rows deleted.
pub(crate) async fn delete_oldest_authentication_token(
    connection: &mut PgConnection,
    user_id: &ObjectId,
) -> sqlx::Result<u64> {
    Ok(sqlx::query(
        "UPDATE webknossos.tokens SET isDeleted = TRUE WHERE _id = (SELECT _id FROM webknossos.tokens WHERE _user = $1 AND tokenType = 'Authentication' AND NOT isDeleted ORDER BY created, _id LIMIT 1)",
    )
    .bind(user_id)
    .execute(connection)
    .await?
    .rows_affected())
}

pub(crate) async fn delete_token_for_user(
    connection: &mut PgConnection,
    token: &str,
    user_id: &ObjectId,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE webknossos.tokens SET isDeleted = TRUE WHERE value = $1 AND _user = $2 AND NOT isDeleted",
    )
    .bind(token)
    .bind(user_id)
    .execute(connection)
    .await?;
    Ok(())
}

pub(crate) async fn update_logged_out_everywhere_time(
    connection: &mut PgConnection,
    multi_user_id: &ObjectId,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE webknossos.users SET loggedOutEverywhereTime = GREATEST(loggedOutEverywhereTime, statement_timestamp()) WHERE _multiUser = $1",
    )
    .bind(multi_user_id)
    .execute(connection)
    .await?;
    Ok(())
}

pub(crate) async fn delete_datastore_tokens_for_multi_user(
    connection: &mut PgConnection,
    multi_user_id: &ObjectId,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE webknossos.tokens SET isDeleted = TRUE WHERE tokenType = 'DataStore' AND NOT isDeleted AND _user IN (SELECT _id FROM webknossos.users WHERE _multiUser = $1)",
    )
    .bind(multi_user_id)
    .execute(connection)
    .await?;
    Ok(())
}

pub(crate) async fn find_all_webauthn_credentials(
    connection: &mut PgConnection,
    multi_user_id: &ObjectId,
) -> sqlx::Result<Vec<KeyDescriptor>> {
    sqlx::query_as::<_, KeyDescriptor>(
        "SELECT _id AS id, name FROM webknossos.webauthnCredentials WHERE _multiUser = $1 AND NOT isDeleted ORDER BY _id",
    )
    .bind(multi_user_id)
    .fetch_all(connection)
    .await
}

pub(crate) async fn delete_webauthn_credential(
    connection: &mut PgConnection,
    id: &ObjectId,
    multi_user_id: &ObjectId,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE webknossos.webauthnCredentials SET isDeleted = TRUE WHERE _id = $1 AND _multiUser = $2 AND NOT isDeleted",
    )
    .bind(id)
    .bind(multi_user_id)
    .execute(connection)
    .await?;
    Ok(())
}
