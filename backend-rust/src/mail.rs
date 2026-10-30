//! Outgoing application mail (Play `app/mail`: `Mail`, `Mailer` actor,
//! `DefaultMails` + `app/views/mail/*.scala.html`).
//!
//! Play's mail actor is fire-and-forget: request handlers never wait for or
//! fail on delivery. [`MailSender`] keeps that contract with a pluggable
//! [`Mailer`]. With `WK_MAIL_SMTP_HOST` set, [`SmtpMailer`] delivers via SMTP
//! from one background worker (the actor equivalent); otherwise [`LogMailer`]
//! logs that nothing was sent, like Play with an empty `mail.smtp.host`.
//! Bodies carry reset/invite/verification secrets and are never logged.
use std::{fmt, sync::Arc};

mod config;
mod recording;
mod smtp;
pub mod templates;

pub use config::{
    DEFAULT_SENDER, MailConfig, MailSettings, NotificationEmailSettings, SmtpConfig, SmtpTlsMode,
    config_from_values,
};
pub use recording::RecordingMailer;
pub use smtp::SmtpMailer;

/// Scala `mail.Mail` (charset is always UTF-8; `contentType` is unused in Play).
#[derive(Clone, Default, PartialEq, Eq)]
pub struct Mail {
    /// Sender mailbox. Empty means the configured `mail.defaultSender`
    /// (filled in by [`MailSender::send`]); every `DefaultMails` mail uses it.
    pub from: String,
    pub subject: String,
    /// Plain-text body. May contain one-time secrets.
    pub body_text: String,
    /// HTML body (Play renders all `DefaultMails` as HTML only). May contain
    /// one-time secrets.
    pub body_html: String,
    pub recipients: Vec<String>,
    pub cc_recipients: Vec<String>,
    pub bcc_recipients: Vec<String>,
    pub reply_to: Vec<String>,
    pub headers: Vec<(String, String)>,
}

impl fmt::Debug for Mail {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Mail")
            .field("recipient_count", &self.recipients.len())
            .field("subject", &self.subject)
            .field("body_text", &"[redacted]")
            .field("body_html", &"[redacted]")
            .finish_non_exhaustive()
    }
}

/// Fire-and-forget delivery, like Play's `Mailer ! Send(...)`.
pub trait Mailer: Send + Sync + 'static {
    fn send(&self, mail: Mail);
}

/// Shared handle installed as a request extension.
#[derive(Clone)]
pub struct MailSender {
    mailer: Arc<dyn Mailer>,
    settings: Arc<MailSettings>,
    log_to_stdout: bool,
}

impl MailSender {
    /// A sender with Play's default `mail.*` settings.
    pub fn new(mailer: impl Mailer) -> Self {
        Self::with_settings(mailer, MailSettings::default())
    }

    pub fn with_settings(mailer: impl Mailer, settings: MailSettings) -> Self {
        Self {
            mailer: Arc::new(mailer),
            settings: Arc::new(settings),
            log_to_stdout: false,
        }
    }

    /// SMTP delivery when `mail.smtp.host` is set (Play semantics), else the
    /// non-delivering [`LogMailer`].
    pub fn from_config(config: &MailConfig) -> Self {
        let mut sender = if config.smtp_enabled() {
            match SmtpMailer::new(&config.smtp) {
                Ok(mailer) => Self::with_settings(mailer, config.settings.clone()),
                Err(error) => {
                    tracing::error!(%error, "SMTP transport could not be configured; mail will not be delivered");
                    Self::with_settings(LogMailer, config.settings.clone())
                }
            }
        } else {
            Self::with_settings(LogMailer, config.settings.clone())
        };
        sender.log_to_stdout = config.log_to_stdout;
        sender
    }

    pub fn settings(&self) -> &MailSettings {
        &self.settings
    }

    pub fn send(&self, mail: Mail) {
        // Mailer.send: only mails with a non-blank `recipients` entry are handled.
        if mail
            .recipients
            .iter()
            .all(|recipient| recipient.trim().is_empty())
        {
            tracing::debug!(subject = %mail.subject, "Skipping mail without recipient");
            return;
        }
        let mail = self.settings.finalize(mail);
        if self.log_to_stdout {
            // Play logs the whole Mail here; bodies stay redacted in Rust.
            tracing::info!(
                from = %mail.from,
                to = ?mail.recipients,
                cc = ?mail.cc_recipients,
                bcc = ?mail.bcc_recipients,
                reply_to = ?mail.reply_to,
                subject = %mail.subject,
                "Sending mail"
            );
        }
        self.mailer.send(mail);
    }
}

impl Default for MailSender {
    fn default() -> Self {
        Self::new(LogMailer)
    }
}

impl fmt::Debug for MailSender {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("MailSender")
    }
}

/// Non-delivering default (empty SMTP host): records the attempt in the
/// structured log without recipient addresses or bodies.
#[derive(Clone, Copy, Debug, Default)]
pub struct LogMailer;

impl Mailer for LogMailer {
    fn send(&self, mail: Mail) {
        tracing::info!(
            subject = %mail.subject,
            recipient_count = mail.recipients.len(),
            "Mail was not sent as no smtp host is configured."
        );
    }
}
