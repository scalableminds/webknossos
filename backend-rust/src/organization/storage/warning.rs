//! Storage warning emails: Scala `StorageWarningService`
//! (`app/models/storage/StorageWarningService.scala`).
//!
//! Warns the owner and the admins of an organization by email when its used storage crosses one
//! of the configured thresholds (by default 90% and 100% of the included storage). Checked after
//! each organization storage scan and after each dataset storage refresh (uploads), see
//! [`super::run_scan`] and [`super::refresh_for_dataset`]. Organizations with unlimited storage
//! (`includedStorage IS NULL`) never get warnings.
//!
//! The thresholds a warning was already sent for are recorded in
//! `webknossos.organization_notifiedEmailThresholds` (type `StorageWarning`), so each one is only
//! announced once. Once the usage drops clearly below a threshold again (by
//! [`REARM_MARGIN_PERCENT`] points, e.g. after deleting data or upgrading the storage), it is
//! re-armed. The margin prevents a new mail on every scan while the usage hovers around a
//! threshold.
//!
//! A failing warning is logged and never fails the scan or upload it belongs to (Scala
//! `UsedStorageService.sendStorageWarningEmailIfThresholdCrossed`).

use std::collections::HashMap;

use sqlx::PgPool;

use crate::{
    config::{ConfigError, Env},
    mail::{MailSender, templates},
    organization::{
        organization_dao::{self, EmailThresholdType},
        pricing::organization_pricing_dao,
    },
};

/// Usage must drop this many percentage points below a threshold before a warning for it is sent
/// again.
pub const REARM_MARGIN_PERCENT: f64 = 5.0;
/// Scala `webKnossos.storageWarningEmails.thresholdsPercent` default.
pub const DEFAULT_THRESHOLDS_PERCENT: [i32; 2] = [90, 100];

/// `WK_STORAGE_WARNING_EMAILS_*` settings (Scala `webKnossos.storageWarningEmails.*`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StorageWarningEmailsConfig {
    pub enabled: bool,
    pub thresholds_percent: Vec<i32>,
}

impl Default for StorageWarningEmailsConfig {
    /// Scala defaults: enabled, 90% and 100%.
    fn default() -> Self {
        Self {
            enabled: true,
            thresholds_percent: DEFAULT_THRESHOLDS_PERCENT.to_vec(),
        }
    }
}

/// Parses settings from environment values (called by config.rs).
///
/// - `WK_STORAGE_WARNING_EMAILS_ENABLED` (default `true`, as in Scala).
/// - `WK_STORAGE_WARNING_EMAILS_THRESHOLDS_PERCENT` (comma-separated non-negative whole
///   percentages, default `90,100`; empty means none, which disables the warnings).
pub fn config_from_values(
    values: &HashMap<String, String>,
) -> Result<StorageWarningEmailsConfig, ConfigError> {
    const THRESHOLDS: &str = "WK_STORAGE_WARNING_EMAILS_THRESHOLDS_PERCENT";
    let env = Env::new(values);
    let defaults = StorageWarningEmailsConfig::default();
    let thresholds_percent = match env.get(THRESHOLDS) {
        None => defaults.thresholds_percent,
        Some(raw) => raw
            .split(',')
            .map(str::trim)
            .filter(|part| !part.is_empty())
            .map(|part| {
                part.parse::<i32>()
                    .ok()
                    .filter(|percent| *percent >= 0)
                    .ok_or_else(|| {
                        ConfigError(format!(
                            "{THRESHOLDS} must be a comma-separated list of non-negative whole \
                             percentages"
                        ))
                    })
            })
            .collect::<Result<_, _>>()?,
    };
    Ok(StorageWarningEmailsConfig {
        enabled: env.bool_or("WK_STORAGE_WARNING_EMAILS_ENABLED", defaults.enabled)?,
        thresholds_percent,
    })
}

/// Scala `StorageWarningService.usagePercent`. An included storage of zero bytes means no storage
/// at all, so any usage counts as exceeded (infinite).
pub fn usage_percent(used_storage_bytes: i64, included_storage_bytes: i64) -> f64 {
    if included_storage_bytes <= 0 {
        if used_storage_bytes > 0 {
            f64::INFINITY
        } else {
            0.0
        }
    } else {
        used_storage_bytes as f64 * 100.0 / included_storage_bytes as f64
    }
}

/// Scala `StorageWarningService.isExceeded`: the included storage is used up.
pub fn is_exceeded(usage_percent: f64) -> bool {
    usage_percent >= 100.0
}

/// Scala `StorageWarningService.crossedThresholdsPercent`: the thresholds the usage has reached,
/// ascending.
pub fn crossed_thresholds_percent(usage_percent: f64, thresholds_percent: &[i32]) -> Vec<i32> {
    let mut crossed: Vec<i32> = thresholds_percent
        .iter()
        .copied()
        .filter(|threshold| usage_percent >= f64::from(*threshold))
        .collect();
    crossed.sort_unstable();
    crossed
}

/// Scala `StorageWarningService.rearmedThresholdsPercent`: the thresholds the usage is clearly
/// below (by [`REARM_MARGIN_PERCENT`]), ascending.
pub fn rearmed_thresholds_percent(usage_percent: f64, thresholds_percent: &[i32]) -> Vec<i32> {
    let mut rearmed: Vec<i32> = thresholds_percent
        .iter()
        .copied()
        .filter(|threshold| usage_percent < f64::from(*threshold) - REARM_MARGIN_PERCENT)
        .collect();
    rearmed.sort_unstable();
    rearmed
}

/// The warning service: settings, mailer and the link/reply-to settings of the mail.
#[derive(Clone, Debug)]
pub struct StorageWarnings {
    config: StorageWarningEmailsConfig,
    mailer: MailSender,
    /// `http.uri`; the mail links to `{uri}/organization/overview`.
    public_uri: String,
    /// `mail.supportEmail`, the reply-to address.
    support_email: String,
}

impl Default for StorageWarnings {
    /// Default settings with the default (logging) mailer, as used by tests.
    fn default() -> Self {
        Self::new(
            StorageWarningEmailsConfig::default(),
            MailSender::default(),
            "http://localhost:9000".into(),
            String::new(),
        )
    }
}

impl StorageWarnings {
    pub fn new(
        config: StorageWarningEmailsConfig,
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

    /// Scala `UsedStorageService.sendStorageWarningEmailIfThresholdCrossed`: a failed warning is
    /// logged and must not fail the storage scan or upload it belongs to.
    pub(crate) async fn send_if_threshold_crossed(&self, pool: &PgPool, organization_id: &str) {
        if let Err(error) = self
            .try_send_if_threshold_crossed(pool, organization_id)
            .await
        {
            tracing::warn!(
                organization = %organization_id,
                %error,
                "Could not send storage warning email for organization with id {organization_id}: {error}"
            );
        }
    }

    /// Scala `StorageWarningService.sendWarningEmailIfThresholdCrossed`. Returns whether mails
    /// were sent.
    pub(crate) async fn try_send_if_threshold_crossed(
        &self,
        pool: &PgPool,
        organization_id: &str,
    ) -> Result<bool, WarningError> {
        if !self.config.enabled || self.config.thresholds_percent.is_empty() {
            return Ok(false);
        }
        let (organization_name, included_storage_bytes) =
            organization_dao::find_name_and_included_storage(pool, organization_id)
                .await?
                .ok_or(WarningError::OrganizationNotFound)?;
        // Unlimited storage, nothing to warn about.
        let Some(included_storage_bytes) = included_storage_bytes else {
            return Ok(false);
        };
        let used_storage_bytes =
            organization_dao::find_used_storage_bytes(pool, organization_id).await?;
        let percent = usage_percent(used_storage_bytes, included_storage_bytes);
        organization_dao::delete_notified_email_thresholds(
            pool,
            organization_id,
            EmailThresholdType::StorageWarning,
            &rearmed_thresholds_percent(percent, &self.config.thresholds_percent),
        )
        .await?;
        let crossed = crossed_thresholds_percent(percent, &self.config.thresholds_percent);
        if crossed.is_empty() {
            return Ok(false);
        }
        // Resolved before recording, so that a failed lookup does not suppress the warning until
        // it is re-armed.
        let recipients =
            organization_pricing_dao::find_owner_and_admin_contacts(pool, organization_id).await?;
        if recipients.is_empty() {
            return Err(WarningError::NoRecipients);
        }
        // Recorded before sending, so that mails that cannot be delivered are not retried on every
        // scan. The count tells how many of the thresholds were not recorded before; if none, the
        // mails were already sent.
        let newly_recorded = organization_dao::insert_notified_email_thresholds(
            pool,
            organization_id,
            EmailThresholdType::StorageWarning,
            &crossed,
        )
        .await?;
        if newly_recorded == 0 {
            return Ok(false);
        }
        tracing::info!(
            organization = %organization_id,
            recipients = recipients.len(),
            "Warning the owner and admins ({}) of organization {organization_id} that it uses \
             {used_storage_bytes} of {included_storage_bytes} included storage bytes...",
            recipients.len(),
        );
        for (email, first_name, last_name) in &recipients {
            self.mailer.send(templates::storage_warning(
                &format!("{first_name} {last_name}"),
                email,
                &organization_name,
                used_storage_bytes,
                included_storage_bytes,
                percent,
                is_exceeded(percent),
                &self.public_uri,
                &self.support_email,
            ));
        }
        Ok(true)
    }
}

/// Failure of one warning check, logged by [`StorageWarnings::send_if_threshold_crossed`].
#[derive(Debug)]
pub(crate) enum WarningError {
    OrganizationNotFound,
    NoRecipients,
    Database(sqlx::Error),
}

impl From<sqlx::Error> for WarningError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error)
    }
}

impl std::fmt::Display for WarningError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::OrganizationNotFound => f.write_str("Organization not found"),
            Self::NoRecipients => {
                f.write_str("Organization has neither an owner nor an admin to notify")
            }
            Self::Database(error) => write!(f, "{error}"),
        }
    }
}

#[cfg(test)]
mod organization_warning_tests;
