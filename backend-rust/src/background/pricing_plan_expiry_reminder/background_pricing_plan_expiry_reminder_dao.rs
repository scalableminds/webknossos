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
    /// Truncated to milliseconds like Play's `Instant`.
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

/// `OrganizationDAO.deleteNotifiedPlanExpiryThresholdsNotCrossedAnyMore`: re-arms the plan
/// expiry reminders of all organizations whose expiry date is further away again than the
/// reminder's lead time, e.g. because the plan was extended or made unlimited. This is the
/// complement of [`super::crossed_lead_times_days`]:
/// `ceil(days_remaining) > lead_time <=> paidUntil > now + lead_time`. Checking the current expiry
/// date (instead of hooking into plan updates) also covers dates changed by other means, e.g. by
/// the Play backend.
pub(super) async fn rearm_thresholds_not_crossed_any_more(
    executor: impl PgExecutor<'_>,
    now: DateTime<Utc>,
) -> Result<u64, sqlx::Error> {
    sqlx::query(
        "DELETE FROM webknossos.organization_notifiedEmailThresholds t \
         USING webknossos.organizations o \
         WHERE t._organization = o._id \
         AND t.emailThresholdType = 'PlanExpiry' \
         AND (o.paidUntil IS NULL OR o.paidUntil > $1 + t.threshold * INTERVAL '1 day')",
    )
    .bind(now)
    .execute(executor)
    .await
    .map(|result| result.rows_affected())
}
