//! Outgoing application mail (Play `app/mail`: `Mail`, `Mailer` actor,
//! `DefaultMails` + `app/views/mail/*.scala.html`).
//!
//! Play's mail actor is fire-and-forget: request handlers never wait for or
//! fail on delivery. [`MailSender`] keeps that contract with a pluggable
//! [`Mailer`]. With `WK_MAIL_SMTP_HOST` set, [`SmtpMailer`] delivers via SMTP
//! from one background worker (the actor equivalent); otherwise [`LogMailer`]
//! logs that nothing was sent, like Play with an empty `mail.smtp.host`.
//! Bodies carry reset/invite/verification secrets and are never logged.
use std::{
    collections::HashMap,
    fmt,
    sync::{Arc, Mutex},
};

use lettre::{
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
    message::{
        Mailbox, MultiPart, SinglePart,
        header::{HeaderName, HeaderValue},
    },
    transport::smtp::{
        authentication::Credentials,
        client::{Tls, TlsParameters},
    },
};
use tokio::sync::mpsc;

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

pub const DEFAULT_SENDER: &str = "WEBKNOSSOS <no-reply@webknossos.org>";

/// Settings `DefaultMails` reads from `mail.*` (sender and footer).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MailSettings {
    /// `mail.defaultSender`.
    pub default_sender: String,
    /// `mail.additionalFooter`: inserted into the HTML footer unescaped.
    pub additional_footer: String,
}

impl Default for MailSettings {
    fn default() -> Self {
        Self {
            default_sender: DEFAULT_SENDER.into(),
            additional_footer: String::new(),
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
pub fn config_from_values(values: &HashMap<String, String>) -> Result<MailConfig, String> {
    let text = |name: &str, default: &str| {
        values
            .get(name)
            .cloned()
            .unwrap_or_else(|| default.to_owned())
    };
    let boolean = |name: &str, default: bool| -> Result<bool, String> {
        match values.get(name).map(|value| value.trim()) {
            None => Ok(default),
            Some(value) => value
                .parse()
                .map_err(|_| format!("{name} must be true or false")),
        }
    };
    let port = match values.get("WK_MAIL_SMTP_PORT").map(|value| value.trim()) {
        None => 465,
        Some(value) => match value.parse::<u16>() {
            Ok(port) if port > 0 => port,
            _ => return Err("WK_MAIL_SMTP_PORT must be a port number between 1 and 65535".into()),
        },
    };
    let host = text("WK_MAIL_SMTP_HOST", "").trim().to_owned();
    if host.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("WK_MAIL_SMTP_HOST must not contain whitespace".into());
    }
    let config = MailConfig {
        log_to_stdout: boolean("WK_MAIL_LOG_TO_STDOUT", false)?,
        smtp: SmtpConfig {
            host,
            port,
            tls: boolean("WK_MAIL_SMTP_TLS", true)?,
            auth: boolean("WK_MAIL_SMTP_AUTH", true)?,
            user: text("WK_MAIL_SMTP_USER", ""),
            pass: text("WK_MAIL_SMTP_PASS", ""),
        },
        settings: MailSettings {
            default_sender: text("WK_MAIL_DEFAULT_SENDER", DEFAULT_SENDER),
            additional_footer: text("WK_MAIL_ADDITIONAL_FOOTER", ""),
        },
    };
    if config.smtp_enabled() {
        // Play would warn and send without From, which every server rejects.
        config
            .settings
            .default_sender
            .parse::<Mailbox>()
            .map_err(|_| "WK_MAIL_DEFAULT_SENDER must be a mailbox like `Name <address>`")?;
    }
    Ok(config)
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

/// In-memory mailer for tests and local inspection.
#[derive(Clone, Default)]
pub struct RecordingMailer(Arc<Mutex<Vec<Mail>>>);

impl RecordingMailer {
    pub fn messages(&self) -> Vec<Mail> {
        self.0.lock().map(|m| m.clone()).unwrap_or_default()
    }

    pub fn take(&self) -> Vec<Mail> {
        self.0
            .lock()
            .map(|mut m| std::mem::take(&mut *m))
            .unwrap_or_default()
    }
}

impl Mailer for RecordingMailer {
    fn send(&self, mail: Mail) {
        if let Ok(mut messages) = self.0.lock() {
            messages.push(mail);
        }
    }
}

/// Maximum number of mails waiting for the SMTP worker; further mails are
/// dropped with an error log instead of blocking or growing without bound.
pub const SMTP_QUEUE_CAPACITY: usize = 1024;

/// Implicit-TLS SMTP port (RFC 8314); with `tls` enabled it connects via TLS
/// directly instead of STARTTLS.
pub const SMTPS_PORT: u16 = 465;

/// SMTP delivery through one background worker task, which sends queued mails
/// one after another like Play's `Mailer` actor. Failures are logged and the
/// mail is dropped (no retries, like Play).
pub struct SmtpMailer {
    transport: AsyncSmtpTransport<Tokio1Executor>,
    queue: Mutex<Option<mpsc::Sender<Mail>>>,
}

impl SmtpMailer {
    pub fn new(config: &SmtpConfig) -> Result<Self, String> {
        let parameters = || {
            TlsParameters::new(config.host.clone())
                .map_err(|error| format!("invalid SMTP TLS parameters: {error}"))
        };
        let tls = match config.tls_mode() {
            SmtpTlsMode::None => Tls::None,
            SmtpTlsMode::StartTlsIfOffered => Tls::Opportunistic(parameters()?),
            SmtpTlsMode::Implicit => Tls::Wrapper(parameters()?),
        };
        let mut builder = AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&config.host)
            .port(config.port)
            .tls(tls);
        if config.auth {
            if config.user.is_empty() {
                tracing::warn!(
                    "WK_MAIL_SMTP_AUTH is set without WK_MAIL_SMTP_USER; sending without authentication"
                );
            } else {
                builder =
                    builder.credentials(Credentials::new(config.user.clone(), config.pass.clone()));
            }
        }
        Ok(Self {
            transport: builder.build(),
            queue: Mutex::new(None),
        })
    }

    /// The worker starts lazily inside the caller's Tokio runtime and is
    /// restarted if that runtime went away (e.g. between tests).
    fn queue(&self) -> Option<mpsc::Sender<Mail>> {
        let mut queue = self.queue.lock().ok()?;
        if let Some(sender) = queue.as_ref().filter(|sender| !sender.is_closed()) {
            return Some(sender.clone());
        }
        let runtime = tokio::runtime::Handle::try_current().ok()?;
        let (sender, mut receiver) = mpsc::channel::<Mail>(SMTP_QUEUE_CAPACITY);
        let transport = self.transport.clone();
        runtime.spawn(async move {
            while let Some(mail) = receiver.recv().await {
                deliver(&transport, mail).await;
            }
        });
        *queue = Some(sender.clone());
        Some(sender)
    }
}

impl Mailer for SmtpMailer {
    fn send(&self, mail: Mail) {
        let Some(queue) = self.queue() else {
            tracing::error!(subject = %mail.subject, "Mail not sent: no async runtime for the SMTP worker");
            return;
        };
        if let Err(error) = queue.try_send(mail) {
            let mail = match error {
                mpsc::error::TrySendError::Full(mail) | mpsc::error::TrySendError::Closed(mail) => {
                    mail
                }
            };
            tracing::error!(subject = %mail.subject, "Mail not sent: SMTP queue is full or closed");
        }
    }
}

/// Builds the MIME message like Mailer.createEmail / setAddress. Invalid
/// addresses are skipped with a warning (address not logged).
pub fn build_message(mail: &Mail) -> Result<Message, String> {
    fn mailboxes<'a>(
        field: &'static str,
        values: &'a [String],
    ) -> impl Iterator<Item = Mailbox> + 'a {
        values
            .iter()
            .filter_map(move |value| match value.parse::<Mailbox>() {
                Ok(mailbox) => Some(mailbox),
                Err(error) => {
                    tracing::warn!(field, %error, "Failed to set email address");
                    None
                }
            })
    }
    let mut builder = Message::builder();
    for mailbox in mailboxes("from", std::slice::from_ref(&mail.from)) {
        builder = builder.from(mailbox);
    }
    for mailbox in mailboxes("replyTo", &mail.reply_to) {
        builder = builder.reply_to(mailbox);
    }
    for mailbox in mailboxes("to", &mail.recipients) {
        builder = builder.to(mailbox);
    }
    for mailbox in mailboxes("cc", &mail.cc_recipients) {
        builder = builder.cc(mailbox);
    }
    for mailbox in mailboxes("bcc", &mail.bcc_recipients) {
        builder = builder.bcc(mailbox);
    }
    builder = builder.subject(mail.subject.clone());
    for (name, value) in &mail.headers {
        let name = HeaderName::new_from_ascii(name.clone())
            .map_err(|_| "invalid custom mail header name".to_owned())?;
        builder = builder.raw_header(HeaderValue::new(name, value.clone()));
    }
    let built = if mail.body_html.is_empty() {
        builder.singlepart(SinglePart::plain(mail.body_text.clone()))
    } else if mail.body_text.is_empty() {
        builder.singlepart(SinglePart::html(mail.body_html.clone()))
    } else {
        builder.multipart(MultiPart::alternative_plain_html(
            mail.body_text.clone(),
            mail.body_html.clone(),
        ))
    };
    built.map_err(|error| error.to_string())
}

async fn deliver(transport: &AsyncSmtpTransport<Tokio1Executor>, mail: Mail) {
    let message = match build_message(&mail) {
        Ok(message) => message,
        Err(error) => {
            tracing::error!(subject = %mail.subject, %error, "Sending mail failed: invalid message");
            return;
        }
    };
    match transport.send(message).await {
        Ok(_) => tracing::debug!(subject = %mail.subject, "Mail sent"),
        Err(error) => tracing::error!(
            subject = %mail.subject,
            recipient_count = mail.recipients.len(),
            %error,
            "Sending mail failed"
        ),
    }
}

/// Play's `DefaultMails` with the Twirl templates in `app/views/mail`. Each
/// HTML body is byte-identical to Play's rendering (see tests/mail.rs and the
/// checkpoint smtp-mail.md). `from` stays empty and the additional footer is a
/// slot; [`MailSender::send`] fills both from the configured [`MailSettings`].
pub mod templates {
    use super::Mail;

    /// Placeholder for `mail.additionalFooter`. Interpolated values are
    /// HTML-escaped, so they can never contain this marker.
    pub(super) const FOOTER_SLOT: &str = "<!--wk:additionalFooter-->";

    /// Twirl `HtmlFormat.escape`.
    pub fn escape_html(text: &str) -> String {
        let mut escaped = String::with_capacity(text.len());
        for c in text.chars() {
            match c {
                '<' => escaped.push_str("&lt;"),
                '>' => escaped.push_str("&gt;"),
                '"' => escaped.push_str("&quot;"),
                '\'' => escaped.push_str("&#x27;"),
                '&' => escaped.push_str("&amp;"),
                c => escaped.push(c),
            }
        }
        escaped
    }

    fn e(text: &str) -> String {
        escape_html(text)
    }

    /// The whole template file: one newline (after the signature line), the
    /// `emailBaseTemplate` call, then whatever follows its closing brace.
    fn page(content: &str, trailing: &str) -> String {
        format!("\n{BASE_PREFIX}{content}{BASE_MIDDLE}{FOOTER_SLOT}{BASE_SUFFIX}{trailing}")
    }

    /// `emailButton.scala.html`.
    fn button(label: &str, url: &str) -> String {
        let (label, url) = (e(label), e(url));
        format!(
            r##"
<div style="text-align: center;">
  <a href="{url}" style="
      color: #fff;
      padding: 4px 15px;
      margin: 10px;
      height: 32px;
      background: #5660ff;
      border: 1px solid #808cff;
      text-align: center;
      font-weight: 400;
      font-size: 14px;
      line-height: 2.1;
      text-decoration: none;
      border-radius: 4px;
      display: inline-block;
    ">
    {label}
  </a>
</div>
"##
        )
    }

    /// `emailImage.scala.html`.
    fn image(src: &str, alt: &str, width: u32, height: u32) -> String {
        let (src, alt) = (e(src), e(alt));
        format!(
            r##"
<div style="text-align: center;">
  <img src="{src}"
    alt="{alt}"
    style="width: {width}px; height: {height}px; margin-top: 10px;" />
</div>
"##
        )
    }

    fn html_mail(recipient: &str, subject: String, body_html: String) -> Mail {
        Mail {
            subject,
            body_html,
            recipients: vec![recipient.to_owned()],
            ..Mail::default()
        }
    }

    /// Trailing space at the end of several template source lines.
    const SP: &str = " ";

    /// DefaultMails.registerAdminNotifierMail (`notifyAdminNewUser`).
    #[allow(clippy::too_many_arguments)]
    pub fn register_admin_notifier(
        name: &str,
        email: &str,
        uri: &str,
        organization_name: &str,
        organization_id: &str,
        auto_activate: bool,
        recipient: &str,
    ) -> Mail {
        let subject = format!(
            "WEBKNOSSOS | A new user ({name}, {email}) registered on {uri} for {organization_name} ({organization_id})"
        );
        let (username, uri) = (e(name), e(uri));
        let activation = if auto_activate {
            format!(
                r##"
    As this user joined via invite link, they are automatically activated. To manage their permissions and assign them to a team within your organization, visit  <a href="{uri}/users">{uri}/users</a>.
    "##
            )
        } else {
            format!(
                r##"
    Please, remember to activate and verify new user accounts and assign them to a team within your organization. Visit  <a href="{uri}/users">{uri}/users</a> to activate the account.
    "##
            )
        };
        let content = format!(
            r##"
  <p>Hi,</p>

  <p>A new user - {username} - just registered a WEBKNOSSOS account for your <a href="{uri}">organization.</a></p>
  <p>
    {activation}
  </p>

  <p>With best regards,<br />your WEBKNOSSOS team</p>
"##
        );
        html_mail(recipient, subject, page(&content, "\n"))
    }

    /// DefaultMails.overLimitMail (`notifyAdminTimeLimit`).
    pub fn over_limit(
        full_name: &str,
        abbreviated_name: &str,
        project_name: &str,
        task_id: &str,
        annotation_id: &str,
        uri: &str,
        project_owner: &str,
    ) -> Mail {
        let subject =
            format!("WEBKNOSSOS | Time limit reached. {abbreviated_name} in {project_name}");
        let (user_name, project_name, task_id, annotation_id, uri) = (
            e(full_name),
            e(project_name),
            e(task_id),
            e(annotation_id),
            e(uri),
        );
        let content = format!(
            r##"
  <p>Hi,</p>

  <p>
    We noticed a user reached the time limit for a project:
  </p>

  <p>
    <ul>
      <li>User: {user_name}</li>
      <li>Project: {project_name}</li>
      <li>Task: {task_id}</li>
    </ul>

  </p>
  <p>For more information visit <a href="{uri}/annotations/Task/{annotation_id}">{uri}/annotations/Task/{annotation_id}</a></p>

  <p>With best regards,<br />your WEBKNOSSOS team</p>
"##
        );
        html_mail(project_owner, subject, page(&content, "\n"))
    }

    /// DefaultMails.newUserMail (`newUser`).
    pub fn new_user(name: &str, recipient: &str, enable_auto_verify: bool) -> Mail {
        let name = e(name);
        let welcome = if !enable_auto_verify {
            r##"
    <p>
      Welcome to your new WEBKNOSSOS account. You are almost ready to share and annotate your large 3D datasets.
    </p>
    <p>Your account is currently under review. An administrator will activate you soon.</p>
  "##
        } else {
            r##"
    <p>
      Welcome to your new WEBKNOSSOS account. Get ready to share and annotate your large 3D datasets.
    </p>
  "##
        };
        let content = format!(
            r##"

  <p>Hi {name},</p>

  {welcome}

  <p>With best regards,<br />your WEBKNOSSOS team</p>
"##
        );
        html_mail(
            recipient,
            "Welcome to WEBKNOSSOS".into(),
            page(&content, "\n"),
        )
    }

    /// DefaultMails.activatedMail (`validateUser`).
    pub fn activated(name: &str, recipient: &str, uri: &str) -> Mail {
        let (name, uri) = (e(name), e(uri));
        let content = format!(
            r##"
  <p>Hi {name},</p>

  <p>
    Great news, your account is now activated and you are ready to share and annotate your large 3D datasets.
  </p>

  <p><a href="{uri}">Click here to get started with WEBKNOSSOS.</a></p>

  <p>With best regards,<br />your WEBKNOSSOS team</p>
"##
        );
        html_mail(
            recipient,
            "WEBKNOSSOS | Account activated".into(),
            page(&content, "\n"),
        )
    }

    /// DefaultMails.changePasswordMail (`passwordChanged`).
    pub fn change_password(name: &str, recipient: &str, uri: &str) -> Mail {
        let (name, uri) = (e(name), e(uri));
        let content = format!(
            r##"
  <p>Hi {name},</p>

  <p>
    The password for your WEBKNOSSOS account on <a href="{uri}">{uri}</a> has successfully been changed.
  </p>

  <p>
    If you did not initiate this change, please contact your administrator immediately.
  </p>

  <p>With best regards,<br />your WEBKNOSSOS team</p>
"##
        );
        html_mail(
            recipient,
            "WEBKNOSSOS | Password changed".into(),
            page(&content, "\n\n"),
        )
    }

    /// DefaultMails.resetPasswordMail (`resetPassword`).
    pub fn reset_password(name: &str, recipient: &str, uri: &str, token: &str) -> Mail {
        let (name, uri, token) = (e(name), e(uri), e(token));
        let content = format!(
            r##"
  <p>Hi {name},</p>
  <p>
    You received this mail because you requested to change your password.
    To change your password <a href="{uri}/auth/finishResetPassword?token={token}">click here</a> (or go to {uri}/auth/finishResetPassword?token={token}) and reset your password.
  </p>

  <p>With best regards,<br />your WEBKNOSSOS team</p>
"##
        );
        html_mail(
            recipient,
            "WEBKNOSSOS | Password Reset".into(),
            page(&content, "\n"),
        )
    }

    /// DefaultMails.newOrganizationMail (`notifyAdminNewOrganization`); the
    /// recipient is `webKnossos.newOrganizationMailingList`.
    pub fn new_organization(
        organization_name: &str,
        creator_email: &str,
        domain: &str,
        recipient: &str,
    ) -> Mail {
        let subject = format!("WEBKNOSSOS | New Organization created on {domain}");
        let (organization_name, creator_mail, domain) =
            (e(organization_name), e(creator_email), e(domain));
        let content = format!(
            r##"
  <p>Hi,</p>

  <p>
    we noticed that {creator_mail} created a new WEBKNOSSOS organization named “{organization_name}” on <a href="{domain}">{domain}</a>.
  </p>

  <p>With best regards,<br />your WEBKNOSSOS team</p>
"##
        );
        html_mail(recipient, subject, page(&content, "\n"))
    }

    /// DefaultMails.inviteMail (`invite`).
    pub fn invite(
        recipient: &str,
        invite_token_value: &str,
        auto_verify: bool,
        organization_name: &str,
        sender_name: &str,
        uri: &str,
    ) -> Mail {
        // `Try(new URI(uri)).toOption.getOrElse(uri)` renders the URI verbatim.
        let subject =
            format!("{sender_name} invited you to join their WEBKNOSSOS organization at {uri}");
        // `autoVerify` is a template parameter Play's invite template ignores.
        let _ = auto_verify;
        let (sender_name, organization_name, invite_token_value, uri) = (
            e(sender_name),
            e(organization_name),
            e(invite_token_value),
            e(uri),
        );
        let content = format!(
            r##"

  <p>Hello,</p>

  <p>
    You have been invited by {sender_name} to join their organization “{organization_name}” in WEBKNOSSOS.
  </p>
  <p>
    Please visit <a href="{uri}/invite/{invite_token_value}">{uri}/invite/{invite_token_value}</a> to sign up or join them with an existing WEBKNOSSOS account.
  </p>

  <p>With best regards,<br />your WEBKNOSSOS team</p>
"##
        );
        html_mail(recipient, subject, page(&content, "\n"))
    }

    /// DefaultMails.helpMail (`help`): to support and the user, reply-to both.
    pub fn help(
        full_name: &str,
        email: &str,
        organization_name: &str,
        message: &str,
        current_url: &str,
        support_email: &str,
    ) -> Mail {
        let (name, organization_name, message, current_url) = (
            e(full_name),
            e(organization_name),
            e(message),
            e(current_url),
        );
        let content = format!(
            r##"
<p>Hi WEBKNOSSOS team</p>
<p>I have a question or feedback for you:</p>
<p style="white-space: pre-wrap">
  {message}
</p>

<p>Current URL: <a href="{current_url}">{current_url}</a></p>

<p>With best regards,<br />{name} from {organization_name}</p>
"##
        );
        Mail {
            subject: "Help requested // Feedback provided".into(),
            body_html: page(&content, "\n"),
            recipients: vec![support_email.to_owned(), email.to_owned()],
            reply_to: vec![email.to_owned(), support_email.to_owned()],
            ..Mail::default()
        }
    }

    /// DefaultMails.pricingPlanExpiryReminderMail (`pricingPlanExpiryReminder`).
    /// `expiry_date` is Formatter.formatDateOnly output; the button links to
    /// `{uri}/organization/overview`.
    #[allow(clippy::too_many_arguments)]
    pub fn pricing_plan_expiry_reminder(
        full_name: &str,
        email: &str,
        organization_name: &str,
        pricing_plan_label: &str,
        expiry_date: &str,
        days_remaining: i64,
        uri: &str,
        support_email: &str,
    ) -> Mail {
        let subject =
            format!("WEBKNOSSOS | Your {pricing_plan_label} plan expires on {expiry_date}");
        let renew = button("Renew Plan", &format!("{uri}/organization/overview"));
        let (name, organization_name, pricing_plan_label, expiry_date) = (
            e(full_name),
            e(organization_name),
            e(pricing_plan_label),
            e(expiry_date),
        );
        let remaining = if days_remaining == 1 {
            " — that is tomorrow.".to_owned()
        } else {
            format!(" — that is in {days_remaining} days.")
        };
        let content = format!(
            r##"
<p>Hi {name},</p>

<p>
  the WEBKNOSSOS <i>{pricing_plan_label}</i> plan of your organization <i>{organization_name}</i> expires on
  <b>{expiry_date}</b>{remaining}
</p>

<p>
  Renew now to keep access to all features of your plan. Once the plan has expired, your organization may be downgraded,
  which blocks users and disables plan features.
</p>

{renew}

<p>If you have already renewed or would like to discuss your options, simply reply to this email.</p>

<p>With best regards,<br />the WEBKNOSSOS team</p>
"##
        );
        Mail {
            subject,
            body_html: page(&content, "\n"),
            recipients: vec![email.to_owned()],
            reply_to: vec![support_email.to_owned()],
            ..Mail::default()
        }
    }

    /// DefaultMails.upgradeRequestMail (`upgradeRequest`).
    pub fn upgrade_request(
        full_name: &str,
        email: &str,
        organization_name: &str,
        requested_changes: &[String],
        note: Option<&str>,
        support_email: &str,
    ) -> Mail {
        let subject = format!("WEBKNOSSOS Upgrade Request: {organization_name}");
        let (name, email_html, organization_name) = (e(full_name), e(email), e(organization_name));
        let changes: String = requested_changes
            .iter()
            .map(|change| format!("\n  <li>{}</li>\n  ", e(change)))
            .collect();
        let note = note
            .map(|note_text| {
                format!(
                    "\n<p>Note:</p>\n<p style=\"white-space: pre-wrap\">{}</p>\n",
                    e(note_text)
                )
            })
            .unwrap_or_default();
        let content = format!(
            r##"
<p>Hi {name}</p>
<p>Thank you for your upgrade request. Our sales team will contact you shortly.</p>
<p>Organization: {organization_name}<br />Requested by: {name} (<a href="mailto:{email_html}">{email_html}</a>)</p>
<p>Requested changes:</p>
<ul>
  {changes}
</ul>
{note}
<p>With best regards,<br />the WEBKNOSSOS team</p>
"##
        );
        Mail {
            subject,
            body_html: page(&content, "\n"),
            recipients: vec![support_email.to_owned(), email.to_owned()],
            reply_to: vec![email.to_owned(), support_email.to_owned()],
            ..Mail::default()
        }
    }

    /// DefaultMails.pricingPlanUpgradedMail (`pricingPlanUpgraded`).
    pub fn pricing_plan_upgraded(
        full_name: &str,
        email: &str,
        organization_name: &str,
        plan_label: &str,
        feature_highlights: &[&str],
        uri: &str,
        support_email: &str,
    ) -> Mail {
        let subject =
            format!("WEBKNOSSOS Upgrade: Your organization is now on the {plan_label} plan");
        let open = button("Open WEBKNOSSOS", uri);
        let (name, organization_name, new_plan_label) =
            (e(full_name), e(organization_name), e(plan_label));
        let features: String = feature_highlights
            .iter()
            .map(|feature| format!("\n    <li>{}</li>\n  ", e(feature)))
            .collect();
        let content = format!(
            r##"
<p>Hi {name},</p>

<p>
  Your organization <strong>{organization_name}</strong> has been upgraded to the WEBKNOSSOS {new_plan_label} plan.
  The following features are now available to everyone in your organization:
</p>

<p><strong>{new_plan_label} plan</strong></p>
<ul>
  {features}
</ul>

{open}

<p>If you have any questions about your new plan, simply reply to this email.</p>

<p>With best regards,<br />the WEBKNOSSOS team</p>
"##
        );
        Mail {
            subject,
            body_html: page(&content, "\n"),
            recipients: vec![email.to_owned()],
            reply_to: vec![support_email.to_owned()],
            ..Mail::default()
        }
    }

    /// DefaultMails.jobSuccessfulGenericMail (`jobSuccessfulGeneric`).
    pub fn job_successful_generic(
        full_name: &str,
        email: &str,
        dataset_name: &str,
        job_link: &str,
        job_title: &str,
        job_description: &str,
    ) -> Mail {
        let open = button("Open in WEBKNOSSOS", job_link);
        let robot = image(
            "https://static.webknossos.org/mails/email-drawing-successful-job.png",
            "A robot celebrating a successful WEBKNOSSOS job",
            300,
            250,
        );
        let (name, dataset_name, job_description) =
            (e(full_name), e(dataset_name), e(job_description));
        let content = format!(
            r##"
<p>Hi {name},</p>

<p>Your background job for the dataset <i>{dataset_name}</i> has finished successfully and is ready for exploration.</p>
<p>{job_description} Click the button below to open WEBKNOSSOS</p>

{open}

<p>With best regards,<br />the WEBKNOSSOS team</p>

{robot}
"##
        );
        html_mail(email, format!("{job_title} is ready"), page(&content, "\n"))
    }

    /// DefaultMails.jobSuccessfulUploadConvertMail (`jobSuccessfulUploadConvert`).
    pub fn job_successful_upload_convert(
        full_name: &str,
        email: &str,
        dataset_name: &str,
        job_link: &str,
    ) -> Mail {
        let open = button("Open dataset in WEBKNOSSOS", job_link);
        let preview = image(
            "https://static.webknossos.org/mails/email-alignment-preview.gif",
            "A preview of the alignment services for a WEBKNOSSOS dataset",
            300,
            300,
        );
        let (name, dataset_name) = (e(full_name), e(dataset_name));
        let content = format!(
            r##"
<p>Hi {name},</p>

<p>
  Your dataset <i>{dataset_name}</i> has been successfully converted and uploaded in WEBKNOSSOS.{SP}

  Click the button below to open the dataset, or find it in your selected dataset folder on the WEBKNOSSOS dashboard.
</p>

{open}

<p>
  Align your dataset directly in WEBKNOSSOS to prepare it for downstream analysis. Our <a href="https://youtu.be/Rt3uG31r2bI?si=9es-5LVi2lCvmSMG">step-by-step tutorial</a> will guide you through the process.
</p>
{preview}

<p>With best regards,<br />the WEBKNOSSOS team</p>
"##
        );
        html_mail(email, "Your dataset is ready".into(), page(&content, "\n"))
    }

    /// DefaultMails.jobSuccessfulNeuronSegmentationMail.
    pub fn job_successful_neuron_segmentation(
        full_name: &str,
        email: &str,
        job_link: &str,
    ) -> Mail {
        let open = button("Open segmentation in WEBKNOSSOS", job_link);
        let preview = image(
            "https://static.webknossos.org/mails/email-full-segmentation-preview.gif",
            "A preview of a full, automated segmentation of a WEBKNOSSOS dataset",
            300,
            300,
        );
        let name = e(full_name);
        let content = format!(
            r##"
<p>Hi {name},</p>

<p>
  Your segmentation has successfully finished and is ready for exploration.{SP}
  Click the button below to open the new, segmented dataset, or find it amongst your other datasets in the WEBKNOSSOS dashboard.
</p>

{open}

<p>
  If you are happy with the results, you can now apply the model to the full dataset. If you have already segmented the full volume, continue with the proofreading tools to review and finalize the segmentation.
</p>
<p>
  If the results are not quite what you expected, <a href="https://youtu.be/MlT4MgU6ayw?si=daGZoX5Y-Y3FXSC5">custom training or fine-tuning</a> of models can help improve performance on your specific data. For especially large or complex neuron segmentation projects, we also offer dedicated <a href="https://home.webknossos.org/services/automated-segmentation">automated segmentation</a> and <a href="https://home.webknossos.org/services/connectome-reconstruction">connectome reconstruction services</a>.
</p>
{preview}


<p>With best regards,<br />the WEBKNOSSOS team</p>
"##
        );
        html_mail(
            email,
            "Your segmentation is ready".into(),
            page(&content, "\n"),
        )
    }

    /// DefaultMails.jobSuccessfulMitoSegmentationMail.
    pub fn job_successful_mito_segmentation(full_name: &str, email: &str, job_link: &str) -> Mail {
        let open = button("Open segmentation in WEBKNOSSOS", job_link);
        let preview = image(
            "https://static.webknossos.org/mails/email-mito-segmentation-preview.gif",
            "A preview of a full, automated mitochondria segmentation of a WEBKNOSSOS dataset",
            300,
            300,
        );
        let name = e(full_name);
        let content = format!(
            r##"
<p>Hi {name},</p>

<p>
  Your mitochondria detection job has successfully finished and is ready for exploration.{SP}
  Click the button below to open the new, segmented dataset, or find it amongst your other datasets in the WEBKNOSSOS dashboard.
</p>

{open}

<p>
  If you would like to improve detection accuracy for your specific data, consider <a href="https://youtu.be/MlT4MgU6ayw?si=uekAKL6kOC0c_Dhj">training a custom model</a> or contact us about our <a href="https://home.webknossos.org/services/automated-segmentation">automated segmentation services</a>.
</p>

{preview}


<p>With best regards,<br />the WEBKNOSSOS team</p>
"##
        );
        html_mail(
            email,
            "Your mitochondria segmentation is ready".into(),
            page(&content, "\n"),
        )
    }

    /// DefaultMails.jobSuccessfulAlignmentMail.
    pub fn job_successful_alignment(
        full_name: &str,
        email: &str,
        dataset_name: &str,
        job_link: &str,
    ) -> Mail {
        let open = button("Open dataset in WEBKNOSSOS", job_link);
        let preview = image(
            "https://static.webknossos.org/mails/email-alignment-preview.gif",
            "A preview of an aligned WEBKNOSSOS dataset",
            300,
            300,
        );
        let (name, dataset_name) = (e(full_name), e(dataset_name));
        let content = format!(
            r##"
<p>Hi {name},</p>

<p>
  The automated alignment for your dataset <i>{dataset_name}</i> has finished successfully.{SP}
  Click the button below to open the new, aligned dataset, or find it amongst your other datasets in the WEBKNOSSOS dashboard.
</p>

{open}

<p>
  Next, you can run our pre-trained models for neuron segmentation and mitochondria detection, or train a custom model tailored to your data. <a href="https://www.youtube.com/playlist?list=PLpizOgyiA4kH-MbmYUpLcYf9RV8zuhDJ9">Step-by-step tutorials</a> are available to guide you through these workflows.
</p>

<p>
  If the alignment quality is not sufficient due to challenging raw data, our <a href="https://home.webknossos.org/services/alignment">custom alignment and preprocessing services</a> can provide additional support.
</p>
{preview}


<p>With best regards,<br />the WEBKNOSSOS team</p>
"##
        );
        html_mail(
            email,
            "Your alignment is ready".into(),
            page(&content, "\n"),
        )
    }

    /// DefaultMails.jobSuccessfulModelTrainingMail.
    pub fn job_successful_model_training(full_name: &str, email: &str, job_link: &str) -> Mail {
        let open = button("Open WEBKNOSSOS", job_link);
        let preview = image(
            "https://static.webknossos.org/mails/email-manual-annotation-service.gif",
            "A preview of manual annotation of a WEBKNOSSOS dataset",
            300,
            300,
        );
        let name = e(full_name);
        let content = format!(
            r##"
<p>Hi {name},</p>

<p>
  Your custom machine learning model has been successfully trained and is now available in WEBKNOSSOS. You can access it under AI Analysis → AI Models, or via the button below.
</p>

{open}


<p>
To run your model, open the dataset you would like to segment, define a bounding box for testing, and select <i>Run AI Model</i>. Your custom model will appear below the pre-trained models and can be selected from there.
</p>


{preview}

<p>
If you require additional ground truth annotations to further improve model performance, our <a href="https://home.webknossos.org/services/annotations">manual annotation services</a> are available to support your project.
</p>

<p>With best regards,<br />the WEBKNOSSOS team</p>
"##
        );
        html_mail(
            email,
            "Your model training is ready".into(),
            page(&content, "\n"),
        )
    }

    const ERROR_STYLE: &str = "background-color: #f5f5f5; border-left: 3px solid #d9d9d9; border-radius: 4px; padding: 12px 16px; color: #555555; white-space: pre-wrap;";

    /// DefaultMails.jobFailedGenericMail (`jobFailedGeneric`).
    pub fn job_failed_generic(
        full_name: &str,
        email: &str,
        dataset_name: &str,
        job_title: &str,
        error_message: Option<&str>,
    ) -> Mail {
        let robot = image(
            "https://static.webknossos.org/mails/email-drawing-failed-job.png",
            "A robot dismayed about an unsuccessful WEBKNOSSOS job",
            300,
            250,
        );
        let (name, dataset_name, job_title) = (e(full_name), e(dataset_name), e(job_title));
        let failure = match error_message {
            Some(message) => format!(
                "\n<p>\n  Unfortunately, your {job_title} job for the {dataset_name} dataset failed with the following error:\n</p>\n<p style=\"{ERROR_STYLE}\">{}</p>\n  ",
                e(message)
            ),
            None => format!(
                "\n<p>\n  Something unexpected went wrong while processing your {job_title} job for the {dataset_name} dataset. This should not have happened, and we apologize for the inconvenience.\n</p>\n  "
            ),
        };
        let content = format!(
            r##"
<p>Hi {name},</p>

{failure}
<p>
  Any compute credits used for this job have been fully refunded.{SP}
</p>

<p>Feel free to <a href="mailto:support@webknossos.org">contact us via email</a> for assistance or please try again later.</p>

<p>With best regards,<br />the WEBKNOSSOS team</p>

{robot}

"##
        );
        html_mail(
            email,
            "Oops. Your WEBKNOSSOS job failed".into(),
            page(&content, "\n"),
        )
    }

    /// DefaultMails.jobFailedUploadConvertMail (`jobFailedUploadConvert`).
    pub fn job_failed_upload_convert(
        full_name: &str,
        email: &str,
        dataset_name: &str,
        error_message: Option<&str>,
    ) -> Mail {
        let robot = image(
            "https://static.webknossos.org/mails/email-drawing-failed-job.png",
            "A robot dismayed about an unsuccessful WEBKNOSSOS dataset upload job",
            300,
            250,
        );
        let (name, dataset_name) = (e(full_name), e(dataset_name));
        let failure = match error_message {
            Some(message) => format!(
                "\n<p>\n  Unfortunately, uploading and processing your dataset <i>{dataset_name}</i> failed with the following error:\n</p>\n<p style=\"{ERROR_STYLE}\">{}</p>\n  ",
                e(message)
            ),
            None => format!(
                "\n<p>\n  Something unexpected went wrong while uploading and processing your dataset <i>{dataset_name}</i>. This should not have happened, and we apologize for the inconvenience.\n</p>\n  "
            ),
        };
        let content = format!(
            r##"
<p>Hi {name},</p>

{failure}
<p>
  Feel free to <a href="mailto:hello@webknossos.com">contact us for assistance</a> or please try again later.
</p>

<p>Here are some tips for uploading and converting datasets:
<ul>
  <li><a href="https://docs.webknossos.org/webknossos/data/index.html">See the documentation on supported file formats</a></li>
  <li><a href="https://docs.webknossos.org/webknossos-py/index.html">Try our Python library for uploading datasets</a></li>
  <li><a href="https://docs.webknossos.org/webknossos/data/streaming.html">Try streaming your data as Zarr, Neuroglancer, or N5 files instead of uploading</a></li>
</ul>
</p>

<p>With best regards,<br />the WEBKNOSSOS team</p>

{robot}
"##
        );
        html_mail(
            email,
            "Oops. Your dataset upload & conversion failed".into(),
            page(&content, "\n"),
        )
    }

    /// DefaultMails.emailVerificationMail (`verifyEmail`); `link_expiry` is
    /// the rendered duration (e.g. `30 days`) when a link expiry is configured.
    pub fn email_verification(
        name: &str,
        recipient: &str,
        link: &str,
        link_expiry: Option<&str>,
    ) -> Mail {
        let link_expiry = e(&link_expiry
            .map(|expiry| format!("This link will expire in {expiry}. "))
            .unwrap_or_default());
        let (name, url) = (e(name), e(link));
        let content = format!(
            r##"
  <p>Hi {name},</p>

  <p>
    To continue setting up your WEBKNOSSOS account, please verify that this is your email address.
  </p>
  <div style="text-align: center;">
    <a href="{url}" style="
        color: #fff;
        padding: 4px 15px;
        height: 32px;
        background: #5660ff;
        border: 1px solid #808cff;
        text-align: center;
        font-weight: 400;
        font-size: 14px;
        line-height: 2.1;
        text-decoration: none;
        border-radius: 4px;
        display: inline-block;
      ">
      Verify email address
    </a>
  </div>
  <p>With best regards,<br />your WEBKNOSSOS team</p>
  <p style="margin-top: 20px; color: #888; font-size: 0.6rem;">
    {link_expiry}If you did not make this request, please disregard this email.
  </p>
"##
        );
        html_mail(
            recipient,
            "Verify Your Email at WEBKNOSSOS".into(),
            page(&content, "\n\n"),
        )
    }

    // `emailBaseTemplate.scala.html`, split around `@content` and
    // `@Html(additionalFooter)`.
    const BASE_PREFIX: &str = r##"<html>

<body style="background-color: #f0f2f5; margin: 0; padding: 0;">
  <style type="text/css">
    body,
    p,
    li,
    h2 {
      font-family: "Monospaced Number", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
        "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial,
        sans-serif;
      font-size: 14px;
      line-height: 1.6;
    }
  </style>

  <div style="background-color: #f0f2f5; padding: 32px 16px;">
    <div style="margin-left: auto; margin-right: auto; max-width: 600px;">

      <a href="https://webknossos.org">
        <img src="https://static.webknossos.org/mails/email-header.600.png"
          alt="WEBKNOSSOS" style="width: 100%; max-width: 600px; display: block; border-radius: 8px 8px 0 0;" />
      </a>
      <div style="background-color: #ffffff; border-radius: 0 0 8px 8px; padding: 36px 40px 40px 40px; color: #333333;">
        "##;
    const BASE_MIDDLE: &str = r##"
      </div>

      <!-- Social icons -->
      <p style="text-align: center; padding-top: 28px; padding-bottom: 4px;">
        <a href="https://webknossos.org"
          style="display: inline-block; background-color: #5660ff; border-radius: 50%; width: 44px; height: 44px; line-height: 44px; text-align: center; margin: 0 4px;">
          <img src="https://static.webknossos.org/mails/email-footer-webknossos.png"
            alt="WEBKNOSSOS" width="44" height="44" style="width: 22px; height: 22px; margin: 11px; display:block;"/>
        </a>
        <a href="https://docs.webknossos.org"
          style="display: inline-block; background-color: #5660ff; border-radius: 50%; width: 44px; height: 44px; line-height: 44px; text-align: center; margin: 0 4px;">
          <img src="https://static.webknossos.org/mails/email-footer-docs.png"
            alt="Documentation" width="44" height="44" style="width: 22px; height: 22px; margin: 11px; display:block;"/>
        </a>
        <a href="https://www.youtube.com/channel/UCVQqjQ50lJORCZuLxnEE-tA"
          style="display: inline-block; background-color: #5660ff; border-radius: 50%; width: 44px; height: 44px; line-height: 44px; text-align: center; margin: 0 4px;">
          <img src="https://static.webknossos.org/mails/email-footer-youtube.png"
            alt="YouTube Channel" width="44" height="44" style="width: 22px; height: 22px; margin: 11px; display:block;"/>
        </a>
        <a href="https://twitter.com/webknossos"
          style="display: inline-block; background-color: #5660ff; border-radius: 50%; width: 44px; height: 44px; line-height: 44px; text-align: center; margin: 0 4px;">
          <img src="https://static.webknossos.org/mails/email-footer-twitter.png"
            alt="Twitter / X" width="44" height="44" style="width: 22px; height: 22px; margin: 11px; display:block;"/>
        </a>
        <a href="https://bsky.app/profile/webknossos.org"
          style="display: inline-block; background-color: #5660ff; border-radius: 50%; width: 44px; height: 44px; line-height: 44px; text-align: center; margin: 0 4px;">
          <img src="https://static.webknossos.org/mails/email-footer-bluesky.png"
            alt="Bluesky" width="44" height="44" style="width: 22px; height: 22px; margin: 11px; display:block;"/>
        </a>
      </p>

      <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;" />

      <p style="color: #aaaaaa; font-size: 0.8em; line-height: 1.6; text-align: center; margin: 0 0 8px 0;">
        You are receiving this email because you signed up for an account on WEBKNOSSOS. You may
        cancel your account at any time.
      </p>
      <p style="color: #aaaaaa; font-size: 0.8em; text-align: center; margin: 0;">
        "##;
    const BASE_SUFFIX: &str = r##"
      </p>

      <div style="height: 40px;">&nbsp;</div>
    </div>
  </div>
</body>

</html>"##;
}
