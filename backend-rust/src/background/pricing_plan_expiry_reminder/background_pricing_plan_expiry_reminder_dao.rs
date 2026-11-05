//! OrganizationDAO queries behind the pricing plan expiry reminder.
use chrono::{DateTime, Utc};
use sqlx::{PgConnection, PgExecutor};

/// The organization fields the reminder needs.
#[derive(Clone, Debug, PartialEq, Eq, sqlx::FromRow)]
pub struct ExpiringOrganization {
    pub id: String,
    pub name: String,
    /// `webknossos.PRICING_PLANS` as text.
    pub pricing_plan: String,
    /// Truncated to milliseconds like Play's `Instant`, so both key reminder rows identically.
    pub paid_until: DateTime<Utc>,
}

/// `OrganizationDAO.findAllWithPlanExpiringBefore`: non-deleted organizations with a paid-until
/// date in `(NOW(), expiry_threshold]`, except the Personal plan, ordered by expiry.
pub(super) async fn find_all_with_plan_expiring_before(
    connection: &mut PgConnection,
    expiry_threshold: DateTime<Utc>,
) -> Result<Vec<ExpiringOrganization>, sqlx::Error> {
    sqlx::query_as(
        "SELECT _id AS id, name, pricingPlan::text AS pricing_plan, \
         DATE_TRUNC('milliseconds', paidUntil) AS paid_until \
         FROM webknossos.organizations_ \
         WHERE paidUntil IS NOT NULL \
         AND paidUntil > NOW() \
         AND paidUntil <= $1 \
         AND pricingPlan NOT IN ('Personal', 'Open_Source') \
         ORDER BY paidUntil",
    )
    .bind(expiry_threshold)
    .fetch_all(connection)
    .await
}

/// `OrganizationDAO.insertPlanExpiryReminders`: records that the organization was reminded about
/// `paid_until` for the given lead times. Rows that are already present are skipped, so the
/// returned count is the number of lead times that were not recorded before.
pub(super) async fn insert_plan_expiry_reminders(
    executor: impl PgExecutor<'_>,
    organization_id: &str,
    paid_until: DateTime<Utc>,
    lead_times_days: &[i32],
) -> Result<u64, sqlx::Error> {
    if lead_times_days.is_empty() {
        return Ok(0);
    }
    sqlx::query(
        "INSERT INTO webknossos.organization_planExpiryReminders\
         (_organization, paidUntil, leadTimeDays) \
         SELECT $1, $2, UNNEST($3::INT[]) \
         ON CONFLICT DO NOTHING",
    )
    .bind(organization_id)
    .bind(paid_until)
    .bind(lead_times_days)
    .execute(executor)
    .await
    .map(|result| result.rows_affected())
}
