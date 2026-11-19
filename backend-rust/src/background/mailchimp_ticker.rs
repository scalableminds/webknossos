//! Mailchimp activity ticker: Scala `mail.MailchimpTicker` (an `IntervalScheduler`, interval and
//! initial delay one hour). Each tick looks at every multi-user registered 21 to 22 days ago that
//! has at least one active (non-deactivated) user. Unless Mailchimp already lists one of the two
//! activity tags for it, it is tagged `was_inactive_in_weeks_two_and_three` when its last activity
//! is more than 14 days old and `was_active_in_weeks_two_or_three` otherwise.
//!
//! Scala loads all multi-users and checks the window and activity per user in Scala; Rust selects
//! the same set in one query. Failures for one multi-user are logged and do not stop the others.
//! The ticker only runs with a configured Mailchimp host (Play's ticker is a no-op without one).
//!
//! Cross-instance serialization follows `housekeeping.rs`: the run holds one transaction with
//! `pg_try_advisory_xact_lock(advisory_lock_key("mailchimp-ticker"))` and skips if another
//! instance holds it. The tag requests are awaited one by one inside the run.

use chrono::{DateTime, TimeDelta, Utc};
use sqlx::PgPool;

use crate::{
    background::scheduler::{
        Job, JobOutcome, JobSchedule, Scheduler, SchedulerHandle, advisory_lock_key,
        try_advisory_xact_lock,
    },
    mailchimp::{MailchimpClient, MailchimpConfig, MailchimpTag},
    util::id::ObjectId,
};

mod background_mailchimp_ticker_dao;

/// Job name: log field and advisory lock identity.
pub const JOB_NAME: &str = "mailchimp-ticker";

/// One multi-user in the tagging window.
#[derive(Clone, Debug, sqlx::FromRow)]
pub struct TaggingCandidate {
    pub multi_user_id: ObjectId,
    pub email: String,
    pub last_activity: DateTime<Utc>,
}

/// The activity tag for a candidate whose last activity was at `last_activity`.
pub fn activity_tag(last_activity: DateTime<Utc>, now: DateTime<Utc>) -> MailchimpTag {
    if last_activity + TimeDelta::days(14) < now {
        MailchimpTag::WasInactiveInWeeksTwoAndThree
    } else {
        MailchimpTag::WasActiveInWeeksTwoOrThree
    }
}

/// One tick at the current time.
pub async fn run(pool: &PgPool, client: &MailchimpClient) -> Result<JobOutcome, sqlx::Error> {
    run_at(pool, client, Utc::now()).await
}

/// One tick at `now`: advisory lock (skip if held elsewhere), load the candidates, tag those not
/// tagged yet, commit.
pub async fn run_at(
    pool: &PgPool,
    client: &MailchimpClient,
    now: DateTime<Utc>,
) -> Result<JobOutcome, sqlx::Error> {
    if !client.is_enabled() {
        return Ok(JobOutcome::Completed("Mailchimp is not configured.".into()));
    }
    tracing::info!("Checking if any users need mailchimp tagging...");
    let mut transaction = pool.begin().await?;
    if !try_advisory_xact_lock(&mut transaction, advisory_lock_key(JOB_NAME)).await? {
        transaction.rollback().await?;
        return Ok(JobOutcome::SkippedLocked);
    }
    let candidates = background_mailchimp_ticker_dao::find_tagging_candidates(
        &mut transaction,
        now - TimeDelta::days(21),
        now - TimeDelta::days(22),
    )
    .await?;
    let mut tagged = 0;
    for candidate in &candidates {
        match tag_by_activity(client, candidate, now).await {
            Ok(true) => tagged += 1,
            Ok(false) => {}
            Err(error) => tracing::info!(
                multi_user = %candidate.multi_user_id,
                %error,
                "Failed to tag multiuser by activity"
            ),
        }
    }
    transaction.commit().await?;
    Ok(JobOutcome::Completed(format!(
        "Checked {} multiusers for Mailchimp activity tagging, tagged {tagged}.",
        candidates.len()
    )))
}

/// `tagUserByActivity` for a candidate in the window; returns whether it was tagged now.
async fn tag_by_activity(
    client: &MailchimpClient,
    candidate: &TaggingCandidate,
    now: DateTime<Utc>,
) -> Result<bool, crate::mailchimp::MailchimpError> {
    let previous = client.tags_for_email(&candidate.email).await?;
    if previous.contains(&MailchimpTag::WasInactiveInWeeksTwoAndThree)
        || previous.contains(&MailchimpTag::WasActiveInWeeksTwoOrThree)
    {
        return Ok(false);
    }
    let tag = activity_tag(candidate.last_activity, now);
    tracing::info!(multi_user = %candidate.multi_user_id, tag = %tag, "Tagging multiuser");
    client.tag_email(&candidate.email, tag).await?;
    Ok(true)
}

/// Scheduler with the ticker job registered (also when disabled, so that is logged). Without a
/// Mailchimp host the job is disabled.
pub fn scheduler(pool: PgPool, config: &MailchimpConfig) -> Scheduler {
    let client = MailchimpClient::new(config);
    let schedule = JobSchedule {
        enabled: config.ticker.enabled && client.is_enabled(),
        ..config.ticker
    };
    let mut scheduler = Scheduler::new();
    scheduler.add(Job::new(JOB_NAME, schedule, move || {
        let (pool, client) = (pool.clone(), client.clone());
        async move { Ok(run(&pool, &client).await?) }
    }));
    scheduler
}

/// Starts the ticker on the current runtime. Call [`SchedulerHandle::shutdown`] before closing
/// the pool.
pub fn spawn(pool: PgPool, config: &MailchimpConfig) -> SchedulerHandle {
    scheduler(pool, config).spawn()
}

#[cfg(test)]
mod background_mailchimp_ticker_tests;
