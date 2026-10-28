//! Transactional executor for time-interaction plans (TW2).
//!
//! Applies an [`InteractionPlan`] from [`crate::time::interaction`] to
//! PostgreSQL, the database half of Scala `TimeSpanService.flushToDb` /
//! `updateTimeSpanInDb` plus the over-limit mail of `signalOverTime`. There
//! are no HTTP routes here; annotation info/finish/finishAll and the
//! tracingstore update report call this library.
//!
//! Order of one call (single user, single annotation, client timestamps in
//! epoch milliseconds, never sorted):
//! 1. `TimeInteractionState::lock_user` BEFORE the transaction begins;
//! 2. plan against the cached span (empty input: no lock-dependent work);
//! 3. one transaction: lock affected annotation rows, then their task rows,
//!    each sorted by id `FOR NO KEY UPDATE` (stable order, compatible with
//!    the annotation state trigger that updates `tasks.pendingInstances`);
//!    insert new spans (Scala flush order, explicit time 0 /
//!    numberOfUpdates 0); then per close: absolute span update, global
//!    annotation `tracingTime += delta`, annotation reload under the caller's
//!    access context (missing/deleted/unreadable fails the call), global task
//!    `tracingTime += delta`;
//! 4. after commit only: publish the cache snapshot, then best-effort
//!    over-limit mail. Any error drops the guard: no cache change, no mail.
//!
//! Intentional improvements over Scala (documented, not parity claims): the
//! whole accounting plan is atomic (Scala runs each statement separately and
//! leaves partial accounting on failure), the cache is published after commit
//! (Scala updates it before flushing), per-user calls are serialized, and the
//! over-limit crossing is computed from row-locked values so concurrent writers
//! cannot both observe the crossing. SQL `BIGINT` overflow of annotation/task
//! totals rolls everything back, as in Scala it fails the request.
//!
//! Error mapping (Scala observable behavior → [`ApiError`]):
//! - planner `DurationOutOfRange`: Scala throws `IllegalArgumentException`
//!   from `FiniteDuration` outside any Fox → Play error handler 500. Mapped to
//!   500 `Internal server error.`.
//! - planner `TimestampNotStorable`: Scala reaches the SQL insert/update which
//!   fails as a Fox `Failure` → 400. Mapped to 400.
//! - `InvalidPause`/`NewSpanIdCount`: configuration/executor invariants → 500.
//! - annotation reload `Empty` (missing, deleted, unreadable) → Play's 404
//!   [`RESOURCE_NOT_FOUND`].
//! - SQL errors use the crate-wide `From<sqlx::Error>` mapping (Scala
//!   reports DAO failures as 400 with internal `FAILED: ...` chains; the Rust
//!   mapping deliberately does not expose SQL details).
//!
//! Over-limit mail: built here (the shared `mail::templates` module is
//! crate-private to `mail.rs`) with Scala's exact subject and recipient and a
//! plain-text rendition of `notifyAdminTimeLimit` carrying the same link, and
//! handed to the shared [`MailSender`] (fire-and-forget like Play's mail
//! actor). The default `LogMailer` does not deliver SMTP mail; that transport
//! gap is crate-wide and not specific to this writer.

mod time_interaction_writer_dao;

use chrono::{DateTime, Utc};
use sqlx::{PgPool, Postgres, Transaction};

use crate::{
    annotation::provider::AccessContext,
    error::{ApiError, ApiResult},
    mail::{Mail, MailSender, templates},
    time::interaction::{
        InteractionPlan, SpanRef, SpanSnapshot, TimeInteractionConfig, TimeInteractionError,
        TimeInteractionState, UserActivityGuard, is_potential_contributor,
    },
    util::id::ObjectId,
};

/// 400 message for timestamps the database cannot store.
pub const TIMESTAMP_NOT_STORABLE: &str = "Interaction timestamp is out of the storable range.";

impl From<TimeInteractionError> for ApiError {
    fn from(error: TimeInteractionError) -> Self {
        match error {
            TimeInteractionError::TimestampNotStorable { .. } => {
                ApiError::bad_request(TIMESTAMP_NOT_STORABLE)
            }
            TimeInteractionError::DurationOutOfRange { .. } => {
                tracing::warn!(%error, "Time tracking rejected interaction timestamps");
                ApiError::internal()
            }
            TimeInteractionError::InvalidPause { .. }
            | TimeInteractionError::NewSpanIdCount { .. } => {
                tracing::error!(%error, "Time tracking invariant violated");
                ApiError::internal()
            }
        }
    }
}

/// Destination of over-limit mails (`conf.Http.uri` is the link base).
#[derive(Clone, Debug)]
pub struct OverLimitNotifier {
    mailer: MailSender,
    public_uri: String,
}

impl OverLimitNotifier {
    pub fn new(mailer: MailSender, public_uri: impl Into<String>) -> Self {
        let public_uri = public_uri.into();
        // Play's configured URI has no trailing slash; `url::Url` adds one.
        let public_uri = public_uri.trim_end_matches('/').to_owned();
        Self { mailer, public_uri }
    }
}

/// Scala `DefaultMails.overLimitMail` (+ `notifyAdminTimeLimit` template).
pub fn over_limit_mail(
    owner_first_name: &str,
    owner_last_name: &str,
    project_name: &str,
    task_id: &ObjectId,
    annotation_id: &ObjectId,
    project_owner_email: &str,
    public_uri: &str,
) -> Mail {
    // MultiUser.abbreviatedName: (firstName.take(1) + lastName).toLowerCase.replace(" ", "_")
    let abbreviated = format!(
        "{}{owner_last_name}",
        owner_first_name
            .chars()
            .next()
            .map(String::from)
            .unwrap_or_default()
    )
    .to_lowercase()
    .replace(' ', "_");
    let full_name = format!("{owner_first_name} {owner_last_name}");
    templates::over_limit(
        &full_name,
        &abbreviated,
        project_name,
        task_id.as_str(),
        annotation_id.as_str(),
        public_uri,
        project_owner_email,
    )
}

/// A task annotation whose accounting changed; the threshold is evaluated
/// after commit against the in-transaction (row-locked) total.
#[derive(Clone, Debug, PartialEq, Eq)]
struct OverLimitCandidate {
    annotation_id: ObjectId,
    owner_id: ObjectId,
    task_id: ObjectId,
    tracing_time_after: i64,
    delta_millis: i64,
}

/// Result of [`apply_interactions`] inside a still-open transaction. Pass it
/// to [`PendingInteraction::publish_after_commit`] only after the caller's
/// transaction committed; dropping it (rollback path) publishes nothing.
#[must_use = "publish after commit, or drop on rollback"]
#[derive(Debug)]
pub struct PendingInteraction {
    snapshot: SpanSnapshot,
    candidates: Vec<OverLimitCandidate>,
}

impl PendingInteraction {
    /// The span that becomes the user's cached activity on publish.
    pub fn snapshot(&self) -> &SpanSnapshot {
        &self.snapshot
    }

    /// Publish the cache value, then send over-limit mails (best effort:
    /// lookup failures are logged and swallowed like Scala's `.shiftBox`).
    pub async fn publish_after_commit(
        self,
        guard: UserActivityGuard,
        pool: &PgPool,
        notifier: &OverLimitNotifier,
    ) {
        guard.publish(self.snapshot);
        for candidate in self.candidates {
            match over_limit_mail_for(pool, &candidate, &notifier.public_uri).await {
                Ok(Some(mail)) => notifier.mailer.send(mail),
                Ok(None) => {}
                Err(_) => tracing::warn!(
                    annotation = %candidate.annotation_id,
                    "Time limit notification lookup failed"
                ),
            }
        }
    }
}

async fn over_limit_mail_for(
    pool: &PgPool,
    candidate: &OverLimitCandidate,
    public_uri: &str,
) -> Result<Option<Mail>, sqlx::Error> {
    let row = time_interaction_writer_dao::find_over_limit_row(
        pool,
        &candidate.owner_id,
        &candidate.task_id,
    )
    .await?;
    let Some(row) = row else { return Ok(None) };
    let Some(limit) = row.expected_time else {
        return Ok(None);
    };
    let time = candidate.tracing_time_after;
    // Scala Long arithmetic: `annotationTime - time.toMillis` wraps.
    if time >= limit && time.wrapping_sub(candidate.delta_millis) < limit {
        Ok(Some(over_limit_mail(
            &row.owner_first_name,
            &row.owner_last_name,
            &row.project_name,
            &candidate.task_id,
            &candidate.annotation_id,
            &row.project_owner_email,
            public_uri,
        )))
    } else {
        Ok(None)
    }
}

fn timestamp(millis: i64) -> ApiResult<DateTime<Utc>> {
    DateTime::from_timestamp_millis(millis)
        .ok_or_else(|| TimeInteractionError::TimestampNotStorable { millis }.into())
}

/// Plan against `guard`'s cached span and apply the plan inside the caller's
/// transaction. The guard must have been acquired BEFORE `transaction` began.
/// `Ok(None)` for empty `timestamps` (no SQL). On `Err` the caller must roll
/// back (drop) the transaction; the cache stays untouched.
pub async fn apply_interactions(
    transaction: &mut Transaction<'_, Postgres>,
    guard: &UserActivityGuard,
    config: &TimeInteractionConfig,
    access: AccessContext<'_>,
    annotation_id: &ObjectId,
    timestamps: &[i64],
) -> ApiResult<Option<PendingInteraction>> {
    let Some(plan) = guard.plan(config, annotation_id, timestamps)? else {
        tracing::warn!("Timetracking called with empty timestamps list.");
        return Ok(None);
    };
    let new_span_ids: Vec<ObjectId> = (0..plan.new_span_count())
        .map(|_| ObjectId::new())
        .collect();
    let snapshot = plan.next_cached_snapshot(&new_span_ids)?;
    let candidates =
        execute_plan(transaction, guard.user_id(), access, &plan, &new_span_ids).await?;
    Ok(Some(PendingInteraction {
        snapshot,
        candidates,
    }))
}

async fn lock_accounting_rows(
    transaction: &mut Transaction<'_, Postgres>,
    plan: &InteractionPlan,
) -> ApiResult<()> {
    let mut annotations: Vec<&ObjectId> = plan
        .closes
        .iter()
        .filter_map(|close| close.after.annotation_id.as_ref())
        .collect();
    annotations.sort_unstable();
    annotations.dedup();
    if annotations.is_empty() {
        return Ok(());
    }
    let tasks =
        time_interaction_writer_dao::find_task_ids_for_update(transaction, &annotations).await?;
    let mut tasks: Vec<ObjectId> = tasks.into_iter().flatten().collect();
    tasks.sort_unstable();
    tasks.dedup();
    if !tasks.is_empty() {
        time_interaction_writer_dao::lock_tasks(transaction, &tasks).await?;
    }
    Ok(())
}

async fn execute_plan(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: &ObjectId,
    access: AccessContext<'_>,
    plan: &InteractionPlan,
    new_span_ids: &[ObjectId],
) -> ApiResult<Vec<OverLimitCandidate>> {
    lock_accounting_rows(transaction, plan).await?;

    for insert in &plan.inserts {
        let id = SpanRef::New(insert.ordinal).resolve(new_span_ids)?;
        time_interaction_writer_dao::insert_one(
            transaction,
            &id,
            user_id,
            &insert.state.annotation_id,
            insert.state.time_millis,
            timestamp(insert.state.last_update_millis)?,
            insert.state.number_of_updates,
            timestamp(insert.state.created_millis)?,
        )
        .await?;
    }

    let mut candidates = Vec::new();
    for close in &plan.closes {
        let span_id = close.span.resolve(new_span_ids)?;
        time_interaction_writer_dao::update_one(
            transaction,
            &span_id,
            user_id,
            &close.after.annotation_id,
            close.after.time_millis,
            timestamp(close.after.last_update_millis)?,
            close.after.number_of_updates,
        )
        .await?;

        // Legacy span without annotation: nothing else to credit.
        let Some(annotation_id) = &close.after.annotation_id else {
            continue;
        };
        time_interaction_writer_dao::add_tracing_time_to_annotation(
            transaction,
            annotation_id,
            close.delta_millis,
        )
        .await?;
        let annotation = crate::annotation::access::find_optional(
            &mut **transaction,
            access.requester,
            annotation_id,
            access.global,
        )
        .await?
        .ok_or_else(|| ApiError::not_found(crate::msg::NOT_FOUND))?;
        if let Some(task_id) = annotation.task_id {
            time_interaction_writer_dao::add_tracing_time_to_task(
                transaction,
                &task_id,
                close.delta_millis,
            )
            .await?;
            if let Some(tracing_time_after) = annotation.tracing_time {
                candidates.push(OverLimitCandidate {
                    annotation_id: annotation.id,
                    owner_id: annotation.owner_id,
                    task_id,
                    tracing_time_after,
                    delta_millis: close.delta_millis,
                });
            }
        }
    }
    Ok(candidates)
}

/// Shared writer handle: one per assembled application (clones share the
/// process-local cache).
#[derive(Clone)]
pub struct TimeInteractionWriter {
    state: TimeInteractionState,
    config: TimeInteractionConfig,
    notifier: OverLimitNotifier,
}

impl TimeInteractionWriter {
    pub fn new(
        state: TimeInteractionState,
        config: TimeInteractionConfig,
        notifier: OverLimitNotifier,
    ) -> Self {
        Self {
            state,
            config,
            notifier,
        }
    }

    pub fn state(&self) -> &TimeInteractionState {
        &self.state
    }

    pub fn config(&self) -> &TimeInteractionConfig {
        &self.config
    }

    pub fn notifier(&self) -> &OverLimitNotifier {
        &self.notifier
    }

    /// Scala `logUserInteraction` (no contributor gate) in its own
    /// transaction. `access` is the context used to reload credited
    /// annotations (Scala `DBAccessContext`: the requester, or global for
    /// tracingstore reports).
    pub async fn log_user_interaction(
        &self,
        pool: &PgPool,
        access: AccessContext<'_>,
        user_id: &ObjectId,
        annotation_id: &ObjectId,
        timestamps: &[i64],
    ) -> ApiResult<()> {
        if timestamps.is_empty() {
            tracing::warn!("Timetracking called with empty timestamps list.");
            return Ok(());
        }
        let guard = self.state.lock_user(user_id).await;
        let mut transaction = pool.begin().await?;
        let pending = apply_interactions(
            &mut transaction,
            &guard,
            &self.config,
            access,
            annotation_id,
            timestamps,
        )
        .await?;
        let Some(pending) = pending else {
            return Ok(());
        };
        transaction.commit().await?;
        pending
            .publish_after_commit(guard, pool, &self.notifier)
            .await;
        Ok(())
    }

    /// Scala `logUserInteractionIfTheyArePotentialContributor`: a no-op
    /// (no lock, no transaction) unless the user owns the annotation or its
    /// collaboration mode is `Exclusive`/`Concurrent`.
    #[allow(clippy::too_many_arguments)]
    pub async fn log_user_interaction_if_potential_contributor(
        &self,
        pool: &PgPool,
        access: AccessContext<'_>,
        user_id: &ObjectId,
        annotation_id: &ObjectId,
        annotation_owner_id: &ObjectId,
        collaboration_mode: &str,
        timestamp: i64,
    ) -> ApiResult<()> {
        if !is_potential_contributor(user_id, annotation_owner_id, collaboration_mode) {
            return Ok(());
        }
        self.log_user_interaction(pool, access, user_id, annotation_id, &[timestamp])
            .await
    }
}

#[cfg(test)]
mod tests;
