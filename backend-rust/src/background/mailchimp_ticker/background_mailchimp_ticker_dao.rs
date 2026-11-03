//! MultiUserDAO queries behind the Mailchimp activity ticker.
use chrono::{DateTime, Utc};
use sqlx::PgConnection;

use super::TaggingCandidate;

/// The multi-users `MailchimpTicker.tagUserByActivity` would tag at `now`: registered between 22
/// (inclusive) and 21 days ago, with at least one non-deactivated user
/// (`hasAtLeastOneActiveUser`), and the latest `lastActivity` of those users (`lastActivity`).
pub(super) async fn find_tagging_candidates(
    connection: &mut PgConnection,
    registered_before: DateTime<Utc>,
    registered_not_before: DateTime<Utc>,
) -> sqlx::Result<Vec<TaggingCandidate>> {
    sqlx::query_as(
        "SELECT m._id AS multi_user_id, m.email, MAX(u.lastActivity) AS last_activity \
         FROM webknossos.multiUsers_ m \
         JOIN webknossos.users_ u ON u._multiUser = m._id \
         WHERE NOT u.isDeactivated AND m.created < $1 AND m.created >= $2 \
         GROUP BY m._id, m.email \
         ORDER BY m._id",
    )
    .bind(registered_before)
    .bind(registered_not_before)
    .fetch_all(connection)
    .await
}
