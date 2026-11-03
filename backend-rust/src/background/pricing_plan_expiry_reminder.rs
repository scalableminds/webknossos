//! Pricing plan expiry reminder: Scala `PricingPlanExpiryReminderService`
//! (`app/models/organization/PricingPlanExpiryReminderService.scala`, an `IntervalScheduler`).
//!
//! Reminds the owner and the admins of an organization by email that its pricing plan is about to
//! expire, once per configured lead time (30, 14 and 7 days before expiry; trials only 7 days).
//! The lead times a reminder was already sent for are recorded in
//! `webknossos.organization_planExpiryReminders`, keyed by the expiry date, so extending the plan
//! re-arms the reminders and restarts do not cause duplicate mails.
//!
//! Every tick (Scala `webKnossos.pricingPlanExpiryReminder.tickerInterval`, 6 h; first run after
//! 5 min; disabled by default) loads the organizations whose plan expires within the largest lead
//! time (`OrganizationDAO.findAllWithPlanExpiringBefore`) and, per organization:
//! - computes the remaining days (`Instant.daysUntil`, rounded up) and the lead times it has
//!   crossed (`crossedLeadTimesDays`);
//! - loads the active owner and admins (`findMultiUsersOfOrganizationOwnerAndAdmins`) and fails
//!   for that organization if there are none;
//! - inserts one row per crossed lead time (`ON CONFLICT DO NOTHING`) BEFORE mailing, so mails
//!   that cannot be delivered are not retried on every tick; only if at least one row is new, it
//!   mails `DefaultMails.pricingPlanExpiryReminderMail` to every recipient.
//!
//! Failures of one organization are logged (Scala `tryAndLog`) and do not stop the others.
//!
//! Cross-instance serialization follows the other background jobs: a tick opens one transaction
//! holding `pg_try_advisory_xact_lock(advisory_lock_key("pricing-plan-expiry-reminder"))` and is
//! skipped while another instance holds it. The per-organization statements run in autocommit on
//! the pool (as in Scala), so a reminder row is committed before its mail is handed to the mailer;
//! a tick therefore uses two pool connections. Play has no such lock; Play and Rust are both
//! protected from double mails by the primary key of the reminder table (`ON CONFLICT DO NOTHING`
//! and the inserted row count), exactly like two Play instances.

mod background_pricing_plan_expiry_reminder_dao;

use std::{collections::HashMap, time::Duration};

use chrono::{DateTime, Utc};
use sqlx::PgPool;

use crate::{
    background::scheduler::{
        Job, JobOutcome, JobSchedule, Scheduler, SchedulerHandle, advisory_lock_key,
        try_advisory_xact_lock,
    },
    config::{ConfigError, Env},
    mail::{MailSender, templates},
    organization::pricing::{PricingPlan, organization_pricing_dao},
};

pub use background_pricing_plan_expiry_reminder_dao::ExpiringOrganization;

/// Job name: log field and advisory lock identity.
pub const JOB_NAME: &str = "pricing-plan-expiry-reminder";
/// Scala `webKnossos.pricingPlanExpiryReminder.tickerInterval` default (application.conf).
pub const DEFAULT_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
/// Scala `PricingPlanExpiryReminderService.tickerInitialDelay`.
pub const DEFAULT_INITIAL_DELAY: Duration = Duration::from_secs(5 * 60);
/// Scala `webKnossos.pricingPlanExpiryReminder.leadTimesDays` default.
pub const DEFAULT_LEAD_TIMES_DAYS: [i32; 3] = [30, 14, 7];
/// Scala `webKnossos.pricingPlanExpiryReminder.trialLeadTimesDays` default.
pub const DEFAULT_TRIAL_LEAD_TIMES_DAYS: [i32; 1] = [7];

const DAY_MILLIS: i64 = 24 * 60 * 60 * 1000;

/// `WK_PRICING_PLAN_EXPIRY_REMINDER_*` settings.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PricingPlanExpiryReminderConfig {
    /// `enabled` is the configured flag; the job only runs if at least one lead time is configured
    /// too (Scala `tickerEnabled`, see [`PricingPlanExpiryReminderConfig::effective_schedule`]).
    pub schedule: JobSchedule,
    pub lead_times_days: Vec<i32>,
    pub trial_lead_times_days: Vec<i32>,
}

impl Default for PricingPlanExpiryReminderConfig {
    /// Scala defaults: disabled, every 6 hours, first run after 5 minutes, [30, 14, 7] / [7] days.
    fn default() -> Self {
        Self {
            schedule: JobSchedule {
                enabled: false,
                interval: DEFAULT_INTERVAL,
                initial_delay: DEFAULT_INITIAL_DELAY,
            },
            lead_times_days: DEFAULT_LEAD_TIMES_DAYS.to_vec(),
            trial_lead_times_days: DEFAULT_TRIAL_LEAD_TIMES_DAYS.to_vec(),
        }
    }
}

impl PricingPlanExpiryReminderConfig {
    /// `leadTimesDays ++ trialLeadTimesDays`.
    fn all_lead_times_days(&self) -> impl Iterator<Item = i32> + '_ {
        self.lead_times_days
            .iter()
            .chain(&self.trial_lead_times_days)
            .copied()
    }

    /// The schedule with Scala's `tickerEnabled`: enabled and at least one lead time configured.
    pub fn effective_schedule(&self) -> JobSchedule {
        JobSchedule {
            enabled: self.schedule.enabled && self.all_lead_times_days().next().is_some(),
            ..self.schedule
        }
    }

    /// `allLeadTimesDays.max`; `None` without lead times.
    fn max_lead_time_days(&self) -> Option<i32> {
        self.all_lead_times_days().max()
    }
}

/// Parses settings from environment values (called by config.rs).
///
/// - `WK_PRICING_PLAN_EXPIRY_REMINDER_ENABLED` (default `false`, as in Scala).
/// - `WK_PRICING_PLAN_EXPIRY_REMINDER_INTERVAL_SECONDS` (> 0, default 21600 = 6 h).
/// - `WK_PRICING_PLAN_EXPIRY_REMINDER_INITIAL_DELAY_SECONDS` (>= 0, default 300).
/// - `WK_PRICING_PLAN_EXPIRY_REMINDER_LEAD_TIMES_DAYS` (comma-separated non-negative days,
///   default `30,14,7`; empty means none).
/// - `WK_PRICING_PLAN_EXPIRY_REMINDER_TRIAL_LEAD_TIMES_DAYS` (same format, default `7`).
pub fn config_from_values(
    values: &HashMap<String, String>,
) -> Result<PricingPlanExpiryReminderConfig, ConfigError> {
    let env = Env::new(values);
    let defaults = PricingPlanExpiryReminderConfig::default();
    Ok(PricingPlanExpiryReminderConfig {
        schedule: JobSchedule::from_env(env, "WK_PRICING_PLAN_EXPIRY_REMINDER", defaults.schedule)?,
        lead_times_days: days_list(
            env,
            "WK_PRICING_PLAN_EXPIRY_REMINDER_LEAD_TIMES_DAYS",
            defaults.lead_times_days,
        )?,
        trial_lead_times_days: days_list(
            env,
            "WK_PRICING_PLAN_EXPIRY_REMINDER_TRIAL_LEAD_TIMES_DAYS",
            defaults.trial_lead_times_days,
        )?,
    })
}

fn days_list(env: Env<'_>, name: &str, default: Vec<i32>) -> Result<Vec<i32>, ConfigError> {
    let Some(raw) = env.get(name) else {
        return Ok(default);
    };
    raw.split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(|part| {
            part.parse::<i32>()
                .ok()
                .filter(|days| *days >= 0)
                .ok_or_else(|| {
                    ConfigError(format!(
                        "{name} must be a comma-separated list of non-negative whole days"
                    ))
                })
        })
        .collect()
}

/// Scala `crossedLeadTimesDays`: the configured lead times that the remaining time has already
/// fallen below, ascending. Once the plan has expired, no reminder is due any more (the app shows
/// an expired-plan banner instead); the query already excludes expired plans, but it uses the
/// database clock, which may differ from ours.
pub fn crossed_lead_times_days(days_remaining: i64, lead_times_days: &[i32]) -> Vec<i32> {
    if days_remaining <= 0 {
        return Vec::new();
    }
    let mut crossed: Vec<i32> = lead_times_days
        .iter()
        .copied()
        .filter(|days| i64::from(*days) >= days_remaining)
        .collect();
    crossed.sort_unstable();
    crossed
}

/// Scala `leadTimesDaysFor`: trials run for a short time only, so they get their own lead times.
pub(crate) fn lead_times_days_for<'a>(
    pricing_plan: PricingPlan,
    lead_times_days: &'a [i32],
    trial_lead_times_days: &'a [i32],
) -> &'a [i32] {
    if pricing_plan.is_trial() {
        trial_lead_times_days
    } else {
        lead_times_days
    }
}

/// Scala `Instant.daysUntil`: whole days from `now` until `then`, rounded up.
pub fn days_until(now: DateTime<Utc>, then: DateTime<Utc>) -> i64 {
    let millis = then.timestamp_millis() - now.timestamp_millis();
    -(-millis).div_euclid(DAY_MILLIS)
}

/// Scala `Formatter.formatDateOnly` (`d MMMM yyyy`, English, JVM default time zone).
pub fn format_date_only(instant: DateTime<Utc>) -> String {
    instant
        .with_timezone(&chrono::Local)
        .format("%-d %B %Y")
        .to_string()
}

/// The reminder service: lead times, mailer and the link/reply-to settings of the mail.
#[derive(Clone, Debug)]
pub struct PricingPlanExpiryReminder {
    config: PricingPlanExpiryReminderConfig,
    mailer: MailSender,
    /// `http.uri`; the mail links to `{uri}/organization/overview`.
    public_uri: String,
    /// `mail.supportEmail`, the reply-to address.
    support_email: String,
}

impl PricingPlanExpiryReminder {
    pub fn new(
        config: PricingPlanExpiryReminderConfig,
        mailer: MailSender,
        public_uri: String,
        support_email: String,
    ) -> Self {
        Self {
            config,
            mailer,
            public_uri,
            support_email,
        }
    }

    /// One tick at the current time.
    pub async fn tick(&self, pool: &PgPool) -> Result<JobOutcome, sqlx::Error> {
        self.tick_at(pool, Utc::now()).await
    }

    /// One tick at `now`: advisory lock (skip if held elsewhere), find organizations whose plan
    /// expires within the largest lead time, remind each one if due, commit.
    pub async fn tick_at(
        &self,
        pool: &PgPool,
        now: DateTime<Utc>,
    ) -> Result<JobOutcome, sqlx::Error> {
        let Some(max_lead_time_days) = self.config.max_lead_time_days() else {
            return Ok(JobOutcome::Completed("No lead times configured.".into()));
        };
        let mut lock = pool.begin().await?;
        if !try_advisory_xact_lock(&mut lock, advisory_lock_key(JOB_NAME)).await? {
            lock.rollback().await?;
            return Ok(JobOutcome::SkippedLocked);
        }
        let threshold = now
            .checked_add_signed(chrono::Duration::days(i64::from(max_lead_time_days)))
            .unwrap_or(DateTime::<Utc>::MAX_UTC);
        let organizations =
            background_pricing_plan_expiry_reminder_dao::find_all_with_plan_expiring_before(
                &mut lock, threshold,
            )
            .await?;
        let mut reminded = 0;
        for organization in &organizations {
            match self.remind_if_due(pool, organization, now).await {
                Ok(true) => reminded += 1,
                Ok(false) => {}
                Err(error) => tracing::warn!(
                    organization = %organization.id,
                    %error,
                    "Could not send pricing plan expiry reminder for organization {}: {error}",
                    organization.id
                ),
            }
        }
        lock.commit().await?;
        Ok(JobOutcome::Completed(format!(
            "Checked {} organizations with expiring plans, reminded {reminded}.",
            organizations.len()
        )))
    }

    /// Scala `remindIfDue` + `remind`. Returns whether mails were sent.
    async fn remind_if_due(
        &self,
        pool: &PgPool,
        organization: &ExpiringOrganization,
        now: DateTime<Utc>,
    ) -> Result<bool, ReminderError> {
        let pricing_plan =
            PricingPlan::parse(&organization.pricing_plan).ok_or(ReminderError::UnknownPlan)?;
        let days_remaining = days_until(now, organization.paid_until);
        let lead_times_days = lead_times_days_for(
            pricing_plan,
            &self.config.lead_times_days,
            &self.config.trial_lead_times_days,
        );
        let due_lead_times_days = crossed_lead_times_days(days_remaining, lead_times_days);
        if due_lead_times_days.is_empty() {
            return Ok(false);
        }
        let recipients =
            organization_pricing_dao::find_owner_and_admin_contacts(pool, &organization.id).await?;
        if recipients.is_empty() {
            return Err(ReminderError::NoRecipients);
        }
        // Recorded before sending, so that mails that cannot be delivered are not retried on every
        // tick. The count tells how many of the lead times were not recorded before; if none, the
        // mails were already sent.
        let newly_recorded =
            background_pricing_plan_expiry_reminder_dao::insert_plan_expiry_reminders(
                pool,
                &organization.id,
                organization.paid_until,
                &due_lead_times_days,
            )
            .await?;
        if newly_recorded == 0 {
            return Ok(false);
        }
        let pricing_plan_label = pricing_plan.label();
        tracing::info!(
            organization = %organization.id,
            recipients = recipients.len(),
            "Reminding the owner and admins ({}) of organization {} that its {} plan expires in {days_remaining} days...",
            recipients.len(),
            organization.id,
            pricing_plan.as_str(),
        );
        let expiry_date = format_date_only(organization.paid_until);
        for (email, first_name, last_name) in &recipients {
            self.mailer.send(templates::pricing_plan_expiry_reminder(
                &format!("{first_name} {last_name}"),
                email,
                &organization.name,
                pricing_plan_label,
                &expiry_date,
                days_remaining,
                &self.public_uri,
                &self.support_email,
            ));
        }
        Ok(true)
    }
}

/// Per-organization failure, logged like Scala's `tryAndLog`.
#[derive(Debug)]
enum ReminderError {
    UnknownPlan,
    NoRecipients,
    Database(sqlx::Error),
}

impl From<sqlx::Error> for ReminderError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error)
    }
}

impl std::fmt::Display for ReminderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnknownPlan => f.write_str("Unknown pricing plan"),
            Self::NoRecipients => {
                f.write_str("Organization has neither an owner nor an admin to notify")
            }
            Self::Database(error) => write!(f, "{error}"),
        }
    }
}

/// Scheduler with the reminder job registered (also when disabled, so that is logged).
pub fn scheduler(pool: PgPool, reminder: PricingPlanExpiryReminder) -> Scheduler {
    let mut scheduler = Scheduler::new();
    let schedule = reminder.config.effective_schedule();
    scheduler.add(Job::new(JOB_NAME, schedule, move || {
        let pool = pool.clone();
        let reminder = reminder.clone();
        async move { Ok(reminder.tick(&pool).await?) }
    }));
    scheduler
}

/// Starts the reminder on the current runtime. `mailer` should be the application's
/// [`MailSender`] (`AppState::mailer`), `public_uri` and `support_email` come from
/// `config.misc`. Call [`SchedulerHandle::shutdown`] before closing the pool.
pub fn spawn(
    pool: PgPool,
    config: &PricingPlanExpiryReminderConfig,
    mailer: MailSender,
    public_uri: String,
    support_email: String,
) -> SchedulerHandle {
    let reminder =
        PricingPlanExpiryReminder::new(config.clone(), mailer, public_uri, support_email);
    scheduler(pool, reminder).spawn()
}

#[cfg(test)]
mod background_pricing_plan_expiry_reminder_tests;
