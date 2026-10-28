//! Queries behind the pricing routes: plan lookups, plan updates and the active user count.
use chrono::{DateTime, Utc};
use sqlx::{PgConnection, PgPool};

use super::{PlanUpdate, PricingPlan};
use crate::util::id::ObjectId;

/// A row of `organization_plan_updates`: organization, description, pricing plan, AI plan,
/// AI plan changed, paid until, paid until changed, included users, included users changed,
/// included storage, included storage changed, created.
pub(super) type PlanUpdateRow = (
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    bool,
    Option<DateTime<Utc>>,
    bool,
    Option<i32>,
    bool,
    Option<i64>,
    bool,
    DateTime<Utc>,
);

/// Pricing plan, AI plan, paid until, included users, included storage and creation time of an organization.
pub(super) type OrganizationPlanRow = (
    String,
    Option<String>,
    Option<DateTime<Utc>>,
    Option<i32>,
    Option<i64>,
    DateTime<Utc>,
);

/// userDAO.countAllForOrganization: active, listed users that do not count
/// towards another (earlier joined) paying organization.
const COUNT_USERS_FOR_ORGANIZATION: &str = r#"SELECT COUNT(*) FROM webknossos.users_ AS u
   LEFT JOIN (
     SELECT DISTINCT ON (_multiUser) _multiUser, _organization FROM webknossos.users
     WHERE NOT isDeactivated AND _organization IN (
       SELECT _id FROM webknossos.organizations
       WHERE pricingPlan IN ('Team', 'Power', 'Custom', 'Team_Trial', 'Power_Trial'))
     ORDER BY _multiUser, created ASC
   ) AS paying ON paying._multiUser = u._multiUser
   WHERE u._organization = $1 AND NOT u.isDeactivated AND NOT u.isUnlisted
     AND (paying._organization IS NULL OR paying._organization = $1)"#;

/// Returns `(is organization owner, email, first name, last name)` of the user.
pub(super) async fn find_owner_flag_and_contact(
    pool: &PgPool,
    user_id: &ObjectId,
) -> sqlx::Result<Option<(bool, String, String, String)>> {
    sqlx::query_as(
        r#"SELECT u.isOrganizationOwner, m.email, m.firstName, m.lastName
               FROM webknossos.users_ u JOIN webknossos.multiUsers_ m ON m._id = u._multiUser
               WHERE u._id = $1"#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
}

/// Returns `(name, pricing plan, AI plan)` of the organization.
pub(super) async fn find_name_and_plans(
    pool: &PgPool,
    organization_id: &str,
) -> sqlx::Result<Option<(String, String, Option<String>)>> {
    sqlx::query_as(
        "SELECT name, pricingPlan::text, aiPlan::text FROM \
                    webknossos.organizations_ WHERE _id = $1",
    )
    .bind(organization_id)
    .fetch_optional(pool)
    .await
}

/// Returns `(pricing plan, included users, paid until)` of the organization.
pub(super) async fn find_plan_limits(
    pool: &PgPool,
    organization_id: &str,
) -> sqlx::Result<Option<(String, Option<i32>, Option<DateTime<Utc>>)>> {
    sqlx::query_as(
        "SELECT pricingPlan::text, includedUsers, paidUntil FROM \
                    webknossos.organizations_ WHERE _id = $1",
    )
    .bind(organization_id)
    .fetch_optional(pool)
    .await
}

pub(super) async fn count_all_users_for_organization(
    pool: &PgPool,
    organization_id: &str,
) -> sqlx::Result<i64> {
    sqlx::query_scalar(COUNT_USERS_FOR_ORGANIZATION)
        .bind(organization_id)
        .fetch_one(pool)
        .await
}

/// Locks and returns `(name, pricing plan)` of the live organization.
pub(super) async fn find_name_and_pricing_plan_for_update(
    connection: &mut PgConnection,
    organization_id: &str,
) -> sqlx::Result<Option<(String, String)>> {
    sqlx::query_as(
        "SELECT name, pricingPlan::text FROM webknossos.organizations WHERE _id = $1 \
                AND NOT isDeleted FOR UPDATE",
    )
    .bind(organization_id)
    .fetch_optional(connection)
    .await
}

pub(super) async fn insert_plan_update(
    connection: &mut PgConnection,
    update: &PlanUpdate,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO webknossos.organization_plan_updates(
             _organization, description, pricingPlan, aiPlan, aiPlanChanged,
             paidUntil, paidUntilChanged, includedUsers, includedUsersChanged,
             includedStorage, includedStorageChanged, created)
           VALUES($1, $2, $3::webknossos.PRICING_PLANS, $4::webknossos.AI_PLANS, $5,
             $6, $7, $8, $9, $10, $11, $12)"#,
    )
    .bind(&update.organization_id)
    .bind(&update.description)
    .bind(update.pricing_plan.map(PricingPlan::as_str))
    .bind(update.ai_plan.value().copied())
    .bind(update.ai_plan.changed())
    .bind(update.paid_until.value())
    .bind(update.paid_until.changed())
    .bind(update.included_users.value())
    .bind(update.included_users.changed())
    .bind(update.included_storage.value())
    .bind(update.included_storage.changed())
    .bind(update.created)
    .execute(connection)
    .await?;
    Ok(())
}

/// organizationDAO.updatePlan: only the provided fields are written.
pub(super) async fn update_plan(
    connection: &mut PgConnection,
    update: &PlanUpdate,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"UPDATE webknossos.organizations SET
             pricingPlan = COALESCE($2::webknossos.PRICING_PLANS, pricingPlan),
             aiPlan = CASE WHEN $4 THEN $3::webknossos.AI_PLANS ELSE aiPlan END,
             paidUntil = CASE WHEN $6 THEN $5 ELSE paidUntil END,
             includedUsers = CASE WHEN $8 THEN $7 ELSE includedUsers END,
             includedStorage = CASE WHEN $10 THEN $9 ELSE includedStorage END
           WHERE _id = $1"#,
    )
    .bind(&update.organization_id)
    .bind(update.pricing_plan.map(PricingPlan::as_str))
    .bind(update.ai_plan.value().copied())
    .bind(update.ai_plan.changed())
    .bind(update.paid_until.value())
    .bind(update.paid_until.changed())
    .bind(update.included_users.value())
    .bind(update.included_users.changed())
    .bind(update.included_storage.value())
    .bind(update.included_storage.changed())
    .execute(connection)
    .await?;
    Ok(())
}

/// Returns `(email, first name, last name)` of the active owner and admins of the organization.
pub(super) async fn find_owner_and_admin_contacts(
    pool: &PgPool,
    organization_id: &str,
) -> Result<Vec<(String, String, String)>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT m.email, m.firstName, m.lastName FROM webknossos.users_ u
           JOIN webknossos.multiUsers_ m ON u._multiUser = m._id
           WHERE (u.isOrganizationOwner OR u.isAdmin) AND NOT u.isDeactivated
             AND u._organization = $1
           ORDER BY u.created, u._id"#,
    )
    .bind(organization_id)
    .fetch_all(pool)
    .await
}

pub(super) async fn find_all_plan_updates(
    pool: &PgPool,
    organization_id: &str,
) -> sqlx::Result<Vec<PlanUpdateRow>> {
    sqlx::query_as(
        r#"SELECT _organization, description, pricingPlan::text, aiPlan::text, aiPlanChanged,
             paidUntil, paidUntilChanged, includedUsers, includedUsersChanged,
             includedStorage, includedStorageChanged, created
           FROM webknossos.organization_plan_updates
           WHERE _organization = $1
           ORDER BY created"#,
    )
    .bind(organization_id)
    .fetch_all(pool)
    .await
}

pub(super) async fn find_plan_row(
    pool: &PgPool,
    organization_id: &str,
) -> sqlx::Result<Option<OrganizationPlanRow>> {
    sqlx::query_as(
        "SELECT pricingPlan::text, aiPlan::text, paidUntil, includedUsers, \
                    includedStorage, created FROM webknossos.organizations_ WHERE _id = $1",
    )
    .bind(organization_id)
    .fetch_optional(pool)
    .await
}
