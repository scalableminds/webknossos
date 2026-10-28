//! OIDC DAOs: the users and multiUsers queries behind single sign-on.
//!
//! Callers own the connection and transaction; these functions only run SQL
//! and return rows. Mapping a missing row to an error is up to the caller.
use sqlx::PgPool;

use crate::util::id::ObjectId;

/// The account of a user: email, first name and last name.
pub(crate) async fn find_multi_user_name_of_user(
    pool: &PgPool,
    user_id: &ObjectId,
) -> sqlx::Result<Option<(String, String, String)>> {
    sqlx::query_as(
        r#"SELECT m.email, m.firstName, m.lastName FROM webknossos.users_ u
           JOIN webknossos.multiUsers_ m ON m._id = u._multiUser WHERE u._id = $1"#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
}

/// userService.userFromMultiUserEmail (exact email match, like Play here).
pub(crate) async fn find_user_id_by_multi_user_email(
    pool: &PgPool,
    email: &str,
) -> sqlx::Result<Option<ObjectId>> {
    let user_id: Option<Option<ObjectId>> = sqlx::query_scalar(
        r#"SELECT COALESCE(
             (SELECT u._id FROM webknossos.users_ u JOIN webknossos.organizations_ o ON o._id = u._organization
               WHERE u._id = m._lastLoggedInIdentity AND u._multiUser = m._id AND NOT u.isDeactivated),
             (SELECT u._id FROM webknossos.users_ u JOIN webknossos.organizations_ o ON o._id = u._organization
               WHERE u._multiUser = m._id AND NOT u.isDeactivated ORDER BY u.created, u._id LIMIT 1)
           ) FROM webknossos.multiUsers_ m WHERE m.email = $1"#,
    )
    .bind(email)
    .fetch_optional(pool)
    .await?;
    Ok(user_id.flatten())
}
