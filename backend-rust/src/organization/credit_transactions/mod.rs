//! CreditTransactionController: superuser credit grants, refunds and expiry
//! revocation, plus the admin credit transaction list (with paid job JSON).
//!
//! Every credit mutation runs in a SERIALIZABLE transaction (as in Scala) so the
//! `enforce_non_negative_balance` trigger sees a consistent organization balance;
//! the refunded/revoked rows are additionally locked with `FOR UPDATE`.
pub(crate) mod dao;

use dao::CreditTransaction;

use crate::{
    AppState,
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::{Path, Query},
    util::id::{ObjectId, PathObjectId},
};
use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    routing::{get, patch, post},
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{Acquire, PgConnection, PgPool};
use webknossos_common::java_format::java_double;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/maintenance/revokeExpiredCredits", get(revoke_expired))
        .route("/creditTransactions/addCredits", post(add_credits))
        .route("/creditTransactions/{transaction_id}", patch(refund))
        .route("/creditTransactions", get(list))
}

/// Play `?~>` failures without explicit status render as 400.
fn require_superuser(user: &AuthUser, message: &str) -> ApiResult<()> {
    if user.is_superuser {
        Ok(())
    } else {
        Err(ApiError::bad_request(message))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddCreditsQuery {
    organization_id: String,
    credit_amount: i32,
    money_spent: String,
    currency: String,
    comment: Option<String>,
    expires_at: Option<String>,
}

// Query extraction precedes authentication: Play binds route parameters first.
async fn add_credits(
    State(state): State<AppState>,
    Query(query): Query<AddCreditsQuery>,
    user: AuthUser,
) -> ApiResult<StatusCode> {
    require_superuser(&user, "Only super users can add credits to an organization")?;
    let exists = crate::organization::dao::exists(&state.pool, &query.organization_id).await?;
    if !exists {
        return Err(ApiError::bad_request(crate::msg::organization::not_found(
            &query.organization_id,
        )));
    }
    let money_spent = JavaDecimal::parse(&query.money_spent).ok_or_else(|| {
        ApiError::bad_request(format!(
            "moneySpent {} is not a valid decimal",
            query.money_spent
        ))
    })?;
    if money_spent.is_negative() {
        return Err(ApiError::bad_request(
            crate::msg::credit_transaction::MONEY_SPENT_NOT_POSITIVE,
        ));
    }
    if query.credit_amount <= 0 {
        return Err(ApiError::bad_request(
            crate::msg::credit_transaction::CREDIT_AMOUNT_NOT_POSITIVE,
        ));
    }
    let comment = query.comment.unwrap_or_else(|| {
        format!(
            "Adding {} credits for {} {}.",
            query.credit_amount,
            money_spent.to_java_string(),
            query.currency
        )
    });
    // Instant.fromString(...).toFox without message: an unparsable date is an empty Fox (404).
    let expiration = match query.expires_at.as_deref() {
        Some(text) => {
            Some(parse_instant(text).ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?)
        }
        None => None,
    };
    if expiration.is_some_and(|date| date < Utc::now()) {
        return Err(ApiError::bad_request(
            crate::msg::credit_transaction::EXPIRATION_NOT_IN_FUTURE,
        ));
    }
    // Scala multiplies with Int overflow; refuse amounts whose milli credits do not fit.
    let milli_credits = query.credit_amount.checked_mul(1000).ok_or_else(|| {
        ApiError::bad_request(crate::msg::credit_transaction::CREDIT_AMOUNT_TOO_LARGE)
    })?;
    let mut transaction = crate::db::begin_serializable(&state.pool).await?;
    dao::insert_add_credits(
        &mut transaction,
        ObjectId::new(),
        &query.organization_id,
        milli_credits,
        comment,
        expiration,
    )
    .await
    .map_err(balance_error)?;
    transaction.commit().await?;
    Ok(StatusCode::OK)
}

/// Instant.fromString: ISO-8601 first, then epoch milliseconds.
fn parse_instant(text: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(text)
        .ok()
        .map(|date| date.with_timezone(&Utc))
        .or_else(|| {
            text.parse::<i64>()
                .ok()
                .and_then(DateTime::from_timestamp_millis)
        })
}

/// The balance trigger raises an ASSERT failure (P0004); Play reports the failed
/// statement as a 400. Keep the database detail out of the response.
pub(crate) fn balance_error(error: sqlx::Error) -> ApiError {
    if let sqlx::Error::Database(database) = &error
        && database.code().as_deref() == Some("P0004")
    {
        return ApiError::bad_request(crate::msg::credit_transaction::NEGATIVE_BALANCE);
    }
    error.into()
}

/// java.math.BigDecimal(String) and its toString, for the default comment.
struct JavaDecimal {
    negative: bool,
    /// Unscaled absolute value digits without leading zeros ("0" for zero).
    digits: String,
    scale: i64,
}

impl JavaDecimal {
    fn parse(text: &str) -> Option<Self> {
        let (negative, rest) = match text.as_bytes().first()? {
            b'-' => (true, &text[1..]),
            b'+' => (false, &text[1..]),
            _ => (false, text),
        };
        let (mantissa, exponent) = match rest.find(['e', 'E']) {
            Some(index) => {
                let exponent = &rest[index + 1..];
                let unsigned = exponent.strip_prefix(['+', '-']).unwrap_or(exponent);
                if unsigned.is_empty()
                    || unsigned.len() > 10
                    || !unsigned.bytes().all(|b| b.is_ascii_digit())
                {
                    return None;
                }
                (&rest[..index], exponent.parse::<i64>().ok()?)
            }
            None => (rest, 0),
        };
        let (integer, fraction) = mantissa.split_once('.').unwrap_or((mantissa, ""));
        if integer.is_empty() && fraction.is_empty()
            || !integer
                .bytes()
                .chain(fraction.bytes())
                .all(|b| b.is_ascii_digit())
        {
            return None;
        }
        let scale = fraction.len() as i64 - exponent;
        if scale.abs() > i64::from(i32::MAX) {
            return None;
        }
        let all = format!("{integer}{fraction}");
        let trimmed = all.trim_start_matches('0');
        let digits = if trimmed.is_empty() { "0" } else { trimmed };
        Some(Self {
            negative,
            digits: digits.to_owned(),
            scale,
        })
    }

    fn is_zero(&self) -> bool {
        self.digits == "0"
    }

    fn is_negative(&self) -> bool {
        self.negative && !self.is_zero()
    }

    fn to_java_string(&self) -> String {
        let sign = if self.is_negative() { "-" } else { "" };
        let length = self.digits.len() as i64;
        let adjusted = length - 1 - self.scale;
        let body = if self.scale == 0 {
            self.digits.clone()
        } else if self.scale > 0 && adjusted >= -6 {
            if length > self.scale {
                let split = (length - self.scale) as usize;
                format!("{}.{}", &self.digits[..split], &self.digits[split..])
            } else {
                format!(
                    "0.{}{}",
                    "0".repeat((self.scale - length) as usize),
                    self.digits
                )
            }
        } else {
            let (first, rest) = self.digits.split_at(1);
            let dot = if rest.is_empty() { "" } else { "." };
            let plus = if adjusted >= 0 { "+" } else { "" };
            format!("{first}{dot}{rest}E{plus}{adjusted}")
        };
        format!("{sign}{body}")
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RefundQuery {
    organization_id: String,
}

async fn refund(
    State(state): State<AppState>,
    Query(query): Query<RefundQuery>,
    Path(transaction_id): Path<PathObjectId>,
    user: AuthUser,
) -> ApiResult<StatusCode> {
    require_superuser(&user, "Only super users can manually refund credits")?;
    let id = &*transaction_id;
    let mut transaction = crate::db::begin_serializable(&state.pool).await?;
    let row = dao::find_one_for_update(&mut transaction, id).await?;
    let (organization, paid_job, transaction_state, credit_state, delta) =
        row.ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    if organization != query.organization_id {
        return Err(ApiError::bad_request(
            crate::msg::credit_transaction::WRONG_ORGANIZATION,
        ));
    }
    if transaction_state != "Pending" {
        return Err(ApiError::bad_request(
            crate::msg::credit_transaction::REFUND_ONLY_PENDING,
        ));
    }
    // Scala's guarded INSERT/UPDATE affect no row (or fail) for these; it reports this text.
    if credit_state != "Pending" || delta > 0 {
        return Err(ApiError::bad_request(format!(
            "Failed to refund transaction {id} properly."
        )));
    }
    let comment = match paid_job {
        Some(job) => format!("Refund for failed job {job}."),
        None => format!("Refund for transaction {id}."),
    };
    dao::insert_refund(
        &mut transaction,
        ObjectId::new(),
        &organization,
        id,
        -delta,
        comment,
    )
    .await
    .map_err(balance_error)?;
    dao::mark_refunded(&mut transaction, id)
        .await
        .map_err(balance_error)?;
    transaction.commit().await?;
    Ok(StatusCode::OK)
}

async fn revoke_expired(State(state): State<AppState>, user: AuthUser) -> ApiResult<StatusCode> {
    require_superuser(
        &user,
        "Only super users can manually revoke expired credits",
    )?;
    revoke_expired_credits(&state.pool).await?;
    Ok(StatusCode::OK)
}

/// An expired grant whose revocation failed (rolled back to its savepoint).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct FailedRevocation {
    pub transaction_id: ObjectId,
    pub organization_id: String,
}

/// CreditTransactionDAO.runRevokeExpiredCredits, shared by the superuser route and the credit
/// ticker: one SERIALIZABLE transaction per organization with expired pending grants. A failing
/// grant is skipped (savepoint) and reported; any other error aborts the run like Scala's Fox.
pub(crate) async fn revoke_expired_credits(
    pool: &PgPool,
) -> Result<Vec<FailedRevocation>, sqlx::Error> {
    let organizations = dao::find_organizations_with_expired_grants(pool).await?;
    let mut failed = Vec::new();
    for organization in organizations {
        let mut transaction = crate::db::begin_serializable(pool).await?;
        let grants = dao::find_expired_grants_for_update(&mut transaction, &organization).await?;
        for (grant_id, created_at, delta) in grants {
            // A savepoint keeps one failed revocation (e.g. the balance trigger)
            // from aborting the organization's other revocations.
            let mut savepoint = transaction.begin().await?;
            match revoke_grant(&mut savepoint, &organization, &grant_id, created_at, delta).await {
                Ok(()) => savepoint.commit().await?,
                Err(error) => {
                    savepoint.rollback().await?;
                    tracing::error!(
                        organization = %organization,
                        transaction = %grant_id,
                        %error,
                        "Failed to revoke some expired credits for organization {organization}"
                    );
                    failed.push(FailedRevocation {
                        transaction_id: grant_id,
                        organization_id: organization.clone(),
                    });
                }
            }
        }
        transaction.commit().await?;
    }
    if !failed.is_empty() {
        notify_failed_revocations(&failed);
    }
    Ok(failed)
}

/// Scala's `slackNotificationService.warn(title, body)`, sent with the process-wide service
/// (the credit ticker has no request context); the same text is also logged as a warning.
pub(crate) fn notify_failed_revocations(failed: &[FailedRevocation]) {
    let title = "Failed to revoke some expired credits for organizations";
    let body = failed_revocations_slack_body(failed);
    tracing::warn!(slack_title = title, slack_body = %body, "{title}");
    crate::slack::global().warn(title, &body);
}

/// Body of the Scala Slack warning for failed revocations.
pub(crate) fn failed_revocations_slack_body(failed: &[FailedRevocation]) -> String {
    failed
        .iter()
        .map(|failure| {
            format!(
                "Failed to revoke credits for transaction {} for organization {}.",
                failure.transaction_id, failure.organization_id
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

async fn revoke_grant(
    connection: &mut PgConnection,
    organization: &str,
    grant_id: &ObjectId,
    created_at: DateTime<Utc>,
    delta: i32,
) -> Result<(), sqlx::Error> {
    let available = dao::sum_available_since(connection, organization, created_at).await?;
    if available <= 0 {
        dao::mark_spent(connection, grant_id).await?;
        return Ok(());
    }
    let available = i32::try_from(available)
        .map_err(|_| sqlx::Error::Protocol("revocable credits exceed INT range".into()))?;
    let state = if available == delta {
        "Revoked"
    } else {
        "PartiallyRevoked"
    };
    dao::update_credit_state(connection, grant_id, state).await?;
    // Scala formats the grant month in the JVM's default time zone.
    let month = created_at.with_timezone(&chrono::Local).format("%Y-%m");
    dao::insert_revocation(
        connection,
        ObjectId::new(),
        organization,
        grant_id,
        -available,
        format!("Revoked unused complimentary credits ({month})"),
    )
    .await?;
    Ok(())
}

async fn list(State(state): State<AppState>, user: AuthUser) -> ApiResult<Json<Vec<Value>>> {
    if !(user.is_superuser || user.is_admin) {
        return Err(ApiError::bad_request(
            crate::msg::organization::LIST_CREDIT_TRANSACTIONS_ONLY_ADMIN,
        ));
    }
    let transactions = dao::find_all_for_user(&state.pool, &user.id).await?;
    let mut connection = state.pool.acquire().await?;
    let mut result = Vec::new();
    for transaction in compact_free_credits_for_display(transactions)
        .into_iter()
        .filter(|transaction| transaction.milli_credit_delta != 0)
    {
        let paid_job = match &transaction.paid_job {
            Some(job) => paid_job_json(&mut connection, &user, job).await?,
            None => Value::Null,
        };
        result.push(json!({
            "id": transaction.id,
            "organization_id": transaction.organization,
            "relatedTransaction": transaction.related_transaction,
            "paidJob": paid_job,
            "creditChange": transaction.milli_credit_delta,
            "comment": transaction.comment,
            "transactionState": transaction.transaction_state,
            "creditState": transaction.credit_state,
            "expirationDate": transaction.expiration_date.map(|date| date.timestamp_millis()),
            "createdAt": transaction.created_at.timestamp_millis(),
            "updatedAt": transaction.updated_at.timestamp_millis(),
        }));
    }
    Ok(Json(result))
}

/// CreditTransactionService.compactFreeCreditsForDisplay: replace each revoked
/// grant and its revocation by one net entry (net-zero entries are filtered later).
fn compact_free_credits_for_display(
    transactions: Vec<CreditTransaction>,
) -> Vec<CreditTransaction> {
    use std::collections::HashMap;
    let revocation_by_grant: HashMap<ObjectId, CreditTransaction> = transactions
        .iter()
        .filter(|t| t.credit_state == "Revoking")
        .filter_map(|t| {
            t.related_transaction
                .clone()
                .map(|grant| (grant, t.clone()))
        })
        .collect();
    let revocation_ids: std::collections::HashSet<&ObjectId> =
        revocation_by_grant.values().map(|t| &t.id).collect();
    transactions
        .iter()
        .filter(|t| !revocation_ids.contains(&t.id))
        .map(|t| match revocation_by_grant.get(&t.id) {
            Some(revocation) => {
                let net = t.milli_credit_delta + revocation.milli_credit_delta;
                CreditTransaction {
                    milli_credit_delta: net,
                    comment: format!(
                        "{}: {} used",
                        t.comment,
                        java_double(f64::from(net) / 1000.0)
                    ),
                    ..t.clone()
                }
            }
            None => t.clone(),
        })
        .collect()
}

/// JobDAO.findOne (user read access) + JobService.publicWrites.
async fn paid_job_json(
    connection: &mut PgConnection,
    user: &AuthUser,
    job_id: &ObjectId,
) -> ApiResult<Value> {
    let job = crate::job::routes::find_job(connection, &user.id, job_id)
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
    crate::job::routes::public_writes(connection, &user.id, &job).await
}

#[cfg(test)]
mod tests;
