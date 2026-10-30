//! SMTP delivery from one background worker and message building.
use std::sync::Mutex;

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

use super::{
    Mail, Mailer,
    config::{SmtpConfig, SmtpTlsMode},
};

/// Maximum number of mails waiting for the SMTP worker; further mails are
/// dropped with an error log instead of blocking or growing without bound.
const SMTP_QUEUE_CAPACITY: usize = 1024;

/// Implicit-TLS SMTP port (RFC 8314); with `tls` enabled it connects via TLS
/// directly instead of STARTTLS.
pub(super) const SMTPS_PORT: u16 = 465;

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
fn build_message(mail: &Mail) -> Result<Message, String> {
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
