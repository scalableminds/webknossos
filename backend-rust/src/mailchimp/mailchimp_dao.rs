//! MultiUserDAO lookups for the Mailchimp client.
use sqlx::PgExecutor;

use crate::util::id::ObjectId;

/// `multiUserDAO.findOne(user._multiUser)`: the email address of a user's (non-deleted)
/// multi-user.
pub(crate) async fn find_email_of_user(
    executor: impl PgExecutor<'_>,
    user_id: &ObjectId,
) -> sqlx::Result<Option<String>> {
    sqlx::query_scalar(
        "SELECT m.email FROM webknossos.users u \
         JOIN webknossos.multiUsers_ m ON m._id = u._multiUser WHERE u._id = $1",
    )
    .bind(user_id)
    .fetch_optional(executor)
    .await
}
