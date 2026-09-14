use chrono::{DateTime, Utc};
use sqlx::PgPool;

use crate::models::{MultiUserRow, UserRow};

// Note: Postgres folds the schema's unquoted mixed-case column names
// (e.g. `passwordInfo_password`) to lowercase, so every query below references them
// lowercase and aliases them to the snake_case names used by the Rust structs.

pub async fn find_multiuser_by_email(
    pool: &PgPool,
    email: &str,
) -> Result<Option<MultiUserRow>, sqlx::Error> {
    sqlx::query_as::<_, MultiUserRow>(
        r#"
        SELECT
            _id,
            email,
            passwordinfo_password AS password_hash,
            passwordinfo_hasher::text AS password_hasher,
            firstname AS first_name,
            lastname AS last_name
        FROM webknossos.multiusers
        WHERE email = $1
          AND NOT isdeleted
        "#,
    )
    .bind(email)
    .fetch_optional(pool)
    .await
}

pub async fn find_multiuser_by_id(
    pool: &PgPool,
    multiuser_id: &str,
) -> Result<Option<MultiUserRow>, sqlx::Error> {
    sqlx::query_as::<_, MultiUserRow>(
        r#"
        SELECT
            _id,
            email,
            passwordinfo_password AS password_hash,
            passwordinfo_hasher::text AS password_hasher,
            firstname AS first_name,
            lastname AS last_name
        FROM webknossos.multiusers
        WHERE _id = $1
          AND NOT isdeleted
        "#,
    )
    .bind(multiuser_id)
    .fetch_optional(pool)
    .await
}

/// A `multiUser` can have one org-scoped `users` row per organization; the PoC just
/// picks the earliest-created one rather than modeling organization selection.
pub async fn find_user_for_multiuser(
    pool: &PgPool,
    multiuser_id: &str,
) -> Result<Option<UserRow>, sqlx::Error> {
    sqlx::query_as::<_, UserRow>(
        r#"
        SELECT
            _id,
            _multiuser,
            _organization,
            isadmin AS is_admin,
            isdeactivated AS is_deactivated
        FROM webknossos.users
        WHERE _multiuser = $1
          AND NOT isdeleted
        ORDER BY created ASC
        LIMIT 1
        "#,
    )
    .bind(multiuser_id)
    .fetch_optional(pool)
    .await
}

pub async fn find_user_by_id(
    pool: &PgPool,
    user_id: &str,
) -> Result<Option<UserRow>, sqlx::Error> {
    sqlx::query_as::<_, UserRow>(
        r#"
        SELECT
            _id,
            _multiuser,
            _organization,
            isadmin AS is_admin,
            isdeactivated AS is_deactivated
        FROM webknossos.users
        WHERE _id = $1
          AND NOT isdeleted
        "#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
}

pub async fn insert_token(
    pool: &PgPool,
    token_id: &str,
    value: &str,
    user_id: &str,
    expiration: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO webknossos.tokens
            (_id, value, _user, lastuseddatetime, expirationdatetime, tokentype, created, isdeleted)
        VALUES
            ($1, $2, $3, now(), $4, 'Authentication', now(), false)
        "#,
    )
    .bind(token_id)
    .bind(value)
    .bind(user_id)
    .bind(expiration)
    .execute(pool)
    .await?;
    Ok(())
}

/// Returns the token's `_user` id if the token exists, isn't soft-deleted, and hasn't
/// expired yet.
pub async fn find_valid_token_user(
    pool: &PgPool,
    value: &str,
) -> Result<Option<String>, sqlx::Error> {
    let row: Option<(String,)> = sqlx::query_as(
        r#"
        SELECT _user
        FROM webknossos.tokens
        WHERE value = $1
          AND NOT isdeleted
          AND expirationdatetime > now()
        "#,
    )
    .bind(value)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(user_id,)| user_id))
}
