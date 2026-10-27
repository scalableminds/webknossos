//! CreditTransactionDAO: the credit transaction queries. Functions returning the raw
//! `sqlx::Error` let the caller map the balance trigger's failure.
use chrono::{DateTime, Utc};
use sqlx::{PgConnection, PgPool};

use crate::{sql::Sql, util::id::ObjectId};

#[derive(sqlx::FromRow, Clone)]
pub(crate) struct CreditTransaction {
    pub(crate) id: ObjectId,
    pub(crate) organization: String,
    pub(crate) related_transaction: Option<ObjectId>,
    pub(crate) paid_job: Option<ObjectId>,
    pub(crate) milli_credit_delta: i32,
    pub(crate) comment: String,
    pub(crate) transaction_state: String,
    pub(crate) credit_state: String,
    pub(crate) expiration_date: Option<DateTime<Utc>>,
    pub(crate) created_at: DateTime<Utc>,
    pub(crate) updated_at: DateTime<Utc>,
}

/// CreditTransactionDAO.listAccessQ for the requesting `user`.
fn push_list_access<'a>(q: &mut Sql<'a>, user: &'a ObjectId) {
    q.push(
        "(_organization IN (SELECT _organization FROM webknossos.users_ \
         WHERE (isAdmin OR isDatasetManager) AND _id = ",
    )
    .push_bind(user)
    .push(
        ")
  OR _organization IN (SELECT _organization FROM webknossos.teams_ WHERE _id IN \
         (SELECT _team FROM webknossos.user_team_roles WHERE isTeamManager AND _user = ",
    )
    .push_bind(user)
    .push(")))");
}

pub(crate) async fn insert_add_credits(
    connection: &mut PgConnection,
    id: ObjectId,
    organization_id: &str,
    milli_credits: i32,
    comment: String,
    expiration: Option<DateTime<Utc>>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO webknossos.credit_transactions
          (_id, _organization, milli_credit_delta, _related_transaction, comment, _paid_job,
           transaction_state, credit_state, expiration_date, created_at, updated_at, is_deleted)
          VALUES ($1, $2, $3, NULL, $4, NULL, 'Complete', 'AddCredits', $5, NOW(), NOW(), FALSE)"#,
    )
    .bind(id)
    .bind(organization_id)
    .bind(milli_credits)
    .bind(comment)
    .bind(expiration)
    .execute(connection)
    .await?;
    Ok(())
}

/// Locks and returns `(organization, paid job, transaction state, credit state, milli credit delta)`.
pub(crate) async fn find_one_for_update(
    connection: &mut PgConnection,
    id: &ObjectId,
) -> sqlx::Result<Option<(String, Option<ObjectId>, String, String, i32)>> {
    sqlx::query_as(
        r#"SELECT _organization, _paid_job, transaction_state::text, credit_state::text, milli_credit_delta
          FROM webknossos.credit_transactions WHERE _id = $1 AND NOT is_deleted FOR UPDATE"#,
    )
    .bind(id)
    .fetch_optional(connection)
    .await
}

pub(crate) async fn insert_refund(
    connection: &mut PgConnection,
    id: ObjectId,
    organization_id: &str,
    related_transaction: &ObjectId,
    milli_credit_delta: i32,
    comment: String,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO webknossos.credit_transactions
          (_id, _organization, _related_transaction, milli_credit_delta, comment, transaction_state, credit_state)
          VALUES ($1, $2, $3, $4, $5, 'Complete', 'Refunding')"#,
    )
    .bind(id)
    .bind(organization_id)
    .bind(related_transaction)
    .bind(milli_credit_delta)
    .bind(comment)
    .execute(connection)
    .await?;
    Ok(())
}

pub(crate) async fn mark_refunded(
    connection: &mut PgConnection,
    id: &ObjectId,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"UPDATE webknossos.credit_transactions
          SET transaction_state = 'Complete', credit_state = 'Refunded', updated_at = NOW()
          WHERE _id = $1"#,
    )
    .bind(id)
    .execute(connection)
    .await?;
    Ok(())
}

/// The organizations that have expired pending grants.
pub(crate) async fn find_organizations_with_expired_grants(
    pool: &PgPool,
) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT DISTINCT _organization FROM webknossos.credit_transactions
          WHERE expiration_date <= NOW() AND credit_state = 'Pending' AND milli_credit_delta > 0
          ORDER BY _organization"#,
    )
    .fetch_all(pool)
    .await
}

/// Locks and returns `(id, created at, milli credit delta)` of the organization's expired pending grants.
pub(crate) async fn find_expired_grants_for_update(
    connection: &mut PgConnection,
    organization_id: &str,
) -> Result<Vec<(ObjectId, DateTime<Utc>, i32)>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT _id, created_at, milli_credit_delta FROM webknossos.credit_transactions
              WHERE NOT is_deleted AND _organization = $1 AND expiration_date <= NOW()
                AND credit_state = 'Pending' AND milli_credit_delta > 0
              ORDER BY created_at DESC FOR UPDATE"#,
    )
    .bind(organization_id)
    .fetch_all(connection)
    .await
}

/// Spent credits since the grant, refunds and other expired grants (base table, as in Scala).
pub(crate) async fn sum_available_since(
    connection: &mut PgConnection,
    organization_id: &str,
    created_at: DateTime<Utc>,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT COALESCE(SUM(milli_credit_delta), 0)::bigint FROM webknossos.credit_transactions
          WHERE _organization = $1 AND created_at >= $2 AND (
            milli_credit_delta < 0
            OR (milli_credit_delta > 0 AND _related_transaction IS NOT NULL AND credit_state = 'Refunding')
            OR (milli_credit_delta > 0 AND expiration_date <= NOW()))"#,
    )
    .bind(organization_id)
    .bind(created_at)
    .fetch_one(connection)
    .await
}

pub(crate) async fn mark_spent(
    connection: &mut PgConnection,
    id: &ObjectId,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE webknossos.credit_transactions SET credit_state = 'Spent', updated_at = NOW() WHERE _id = $1",
    )
    .bind(id)
    .execute(connection)
    .await?;
    Ok(())
}

pub(crate) async fn update_credit_state(
    connection: &mut PgConnection,
    id: &ObjectId,
    credit_state: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE webknossos.credit_transactions SET credit_state = $2::webknossos.credit_state, updated_at = NOW() WHERE _id = $1",
    )
    .bind(id)
    .bind(credit_state)
    .execute(connection)
    .await?;
    Ok(())
}

pub(crate) async fn insert_revocation(
    connection: &mut PgConnection,
    id: ObjectId,
    organization_id: &str,
    grant_id: &ObjectId,
    milli_credit_delta: i32,
    comment: String,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO webknossos.credit_transactions
          (_id, _organization, _related_transaction, milli_credit_delta, comment, _paid_job,
           transaction_state, credit_state, expiration_date, created_at, updated_at, is_deleted)
          VALUES ($1, $2, $3, $4, $5, NULL, 'Complete', 'Revoking', NULL, NOW(), NOW(), FALSE)"#,
    )
    .bind(id)
    .bind(organization_id)
    .bind(grant_id)
    .bind(milli_credit_delta)
    .bind(comment)
    .execute(connection)
    .await?;
    Ok(())
}

/// The transactions the user may list.
pub(crate) async fn find_all_for_user(
    pool: &PgPool,
    user_id: &ObjectId,
) -> sqlx::Result<Vec<CreditTransaction>> {
    // Scala has no ORDER BY; creation order is the deterministic equivalent.
    let mut q = Sql::new(
        r#"SELECT _id AS id, _organization AS organization, _related_transaction AS related_transaction,
          _paid_job AS paid_job, milli_credit_delta, comment, transaction_state::text AS transaction_state,
          credit_state::text AS credit_state, expiration_date, created_at, updated_at
          FROM webknossos.credit_transactions_ WHERE "#,
    );
    push_list_access(&mut q, user_id);
    q.push(" ORDER BY created_at, _id");
    q.build_query_as().fetch_all(pool).await
}

/// CreditTransactionDAO.handOutMonthlyFreeCredits (`jobs.monthlyFreeMilliCredits`), shared by
/// organization creation and the credit ticker. The SQL function grants every organization
/// without a grant expiring next month, so repeated calls within one month are no-ops.
pub(crate) async fn hand_out_monthly_free_credits(
    connection: &mut sqlx::PgConnection,
    free_milli_credits: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT webknossos.hand_out_monthly_free_credits($1::INT)")
        .bind(free_milli_credits)
        .execute(connection)
        .await?;
    Ok(())
}
