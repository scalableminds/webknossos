//! Mail settings and SMTP configuration (`mail.*`).
use std::{collections::HashMap, fmt};

use crate::config::{ConfigError, Env};
use lettre::message::Mailbox;

use super::{Mail, smtp::SMTPS_PORT, templates};

pub const DEFAULT_SENDER: &str = "WEBKNOSSOS <no-reply@webknossos.org>";

/// Settings `DefaultMails` reads from `mail.*` (sender and footer).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MailSettings {
    /// `mail.defaultSender`.
    pub default_sender: String,
    /// `mail.additionalFooter`: inserted into the HTML footer unescaped.
    pub additional_footer: String,
    /// `mail.notificationEmails.*`.
    pub notification_emails: NotificationEmailSettings,
}

impl Default for MailSettings {
    fn default() -> Self {
        Self {
            default_sender: DEFAULT_SENDER.into(),
            additional_footer: String::new(),
            notification_emails: NotificationEmailSettings::default(),
        }
    }
}

/// `mail.notificationEmails`: which notification emails
/// (crate::users::notification_emails) are sent. Both default to enabled.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NotificationEmailSettings {
    /// `accessChanges`: someone else shares an annotation or dataset with the
    /// user's teams, transfers an annotation to them, or changes their team
    /// memberships or roles.
    pub access_changes: bool,
    /// `manualTaskAssignments`: a team manager or admin assigns a task to them.
    pub manual_task_assignments: bool,
}

impl Default for NotificationEmailSettings {
    fn default() -> Self {
        Self {
            access_changes: true,
            manual_task_assignments: true,
        }
    }
}

impl MailSettings {
    /// Applies the configured sender and footer to a template-built mail.
    pub fn finalize(&self, mut mail: Mail) -> Mail {
        if mail.from.trim().is_empty() {
            mail.from = self.default_sender.clone();
        }
        if mail.body_html.contains(templates::FOOTER_SLOT) {
            mail.body_html =
                mail.body_html
                    .replacen(templates::FOOTER_SLOT, &self.additional_footer, 1);
        }
        mail
    }
}

/// SMTP settings (`mail.smtp.*`). Debug output omits the credentials.
#[derive(Clone, PartialEq, Eq)]
pub struct SmtpConfig {
    /// Empty disables delivery (Play default).
    pub host: String,
    pub port: u16,
    /// Secure the connection; see [`SmtpConfig::tls_mode`].
    pub tls: bool,
    pub auth: bool,
    pub user: String,
    pub pass: String,
}

impl Default for SmtpConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            port: 465,
            tls: true,
            auth: true,
            user: String::new(),
            pass: String::new(),
        }
    }
}

/// How the SMTP connection is secured.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SmtpTlsMode {
    /// `tls = false`: plaintext.
    None,
    /// javamail `mail.smtp.starttls.enable`: STARTTLS when the server offers
    /// it, plaintext otherwise.
    StartTlsIfOffered,
    /// TLS from the first byte. Deviation: javamail only does STARTTLS, which
    /// cannot work on the implicit-TLS port 465 (Play's default port).
    Implicit,
}

impl SmtpConfig {
    pub fn tls_mode(&self) -> SmtpTlsMode {
        match (self.tls, self.port) {
            (false, _) => SmtpTlsMode::None,
            (true, SMTPS_PORT) => SmtpTlsMode::Implicit,
            (true, _) => SmtpTlsMode::StartTlsIfOffered,
        }
    }
}

impl fmt::Debug for SmtpConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SmtpConfig")
            .field("host", &self.host)
            .field("port", &self.port)
            .field("tls", &self.tls)
            .field("auth", &self.auth)
            .field("user_configured", &!self.user.is_empty())
            .field("password_configured", &!self.pass.is_empty())
            .finish()
    }
}

/// Play `mail.*` configuration (Mailchimp and `supportEmail` live elsewhere).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MailConfig {
    /// `mail.logToStdout`: log each outgoing mail's addresses and subject.
    pub log_to_stdout: bool,
    pub smtp: SmtpConfig,
    pub settings: MailSettings,
}

impl MailConfig {
    /// Play sends only when `mail.smtp.host` is non-empty.
    pub fn smtp_enabled(&self) -> bool {
        !self.smtp.host.is_empty()
    }
}

/// Parses mail settings from environment values (called by config.rs).
///
/// | Variable | Play key | Default |
/// |---|---|---|
/// | `WK_MAIL_LOG_TO_STDOUT` | `mail.logToStdout` | `false` |
/// | `WK_MAIL_SMTP_HOST` | `mail.smtp.host` | empty (no delivery) |
/// | `WK_MAIL_SMTP_PORT` | `mail.smtp.port` | `465` |
/// | `WK_MAIL_SMTP_TLS` | `mail.smtp.tls` | `true` |
/// | `WK_MAIL_SMTP_AUTH` | `mail.smtp.auth` | `true` |
/// | `WK_MAIL_SMTP_USER` | `mail.smtp.user` | empty |
/// | `WK_MAIL_SMTP_PASS` | `mail.smtp.pass` | empty |
/// | `WK_MAIL_DEFAULT_SENDER` | `mail.defaultSender` | `WEBKNOSSOS <no-reply@webknossos.org>` |
/// | `WK_MAIL_ADDITIONAL_FOOTER` | `mail.additionalFooter` | empty |
/// | `WK_MAIL_NOTIFICATION_EMAILS_ACCESS_CHANGES` | `mail.notificationEmails.accessChanges` | `true` |
/// | `WK_MAIL_NOTIFICATION_EMAILS_MANUAL_TASK_ASSIGNMENTS` | `mail.notificationEmails.manualTaskAssignments` | `true` |
pub fn config_from_values(values: &HashMap<String, String>) -> Result<MailConfig, ConfigError> {
    let env = Env::new(values);
    let port = match env.unsigned("WK_MAIL_SMTP_PORT") {
        Ok(None) => 465,
        Ok(Some(port @ 1..=65535)) => port as u16,
        _ => {
            return Err(ConfigError(
                "WK_MAIL_SMTP_PORT must be a port number between 1 and 65535".into(),
            ));
        }
    };
    let host = env.text("WK_MAIL_SMTP_HOST", "").trim().to_owned();
    if host.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(ConfigError(
            "WK_MAIL_SMTP_HOST must not contain whitespace".into(),
        ));
    }
    let config = MailConfig {
        log_to_stdout: env.bool_or("WK_MAIL_LOG_TO_STDOUT", false)?,
        smtp: SmtpConfig {
            host,
            port,
            tls: env.bool_or("WK_MAIL_SMTP_TLS", true)?,
            auth: env.bool_or("WK_MAIL_SMTP_AUTH", true)?,
            user: env.text("WK_MAIL_SMTP_USER", ""),
            pass: env.text("WK_MAIL_SMTP_PASS", ""),
        },
        settings: MailSettings {
            default_sender: env.text("WK_MAIL_DEFAULT_SENDER", DEFAULT_SENDER),
            additional_footer: env.text("WK_MAIL_ADDITIONAL_FOOTER", ""),
            notification_emails: NotificationEmailSettings {
                access_changes: env.bool_or("WK_MAIL_NOTIFICATION_EMAILS_ACCESS_CHANGES", true)?,
                manual_task_assignments: env
                    .bool_or("WK_MAIL_NOTIFICATION_EMAILS_MANUAL_TASK_ASSIGNMENTS", true)?,
            },
        },
    };
    if config.smtp_enabled() {
        // Play would warn and send without From, which every server rejects.
        config
            .settings
            .default_sender
            .parse::<Mailbox>()
            .map_err(|_| {
                ConfigError("WK_MAIL_DEFAULT_SENDER must be a mailbox like `Name <address>`".into())
            })?;
    }
    Ok(config)
}
