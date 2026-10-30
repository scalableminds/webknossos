# SMTP mail delivery (gap G1) checkpoint

Owner: sub-agent `smtp-mail` (2026-10-11, finished in a second pass after a usage-limit cut). Target dir
/tmp/webknossos-rust-verify-a. Owned: src/mail.rs, tests/mail.rs, tests/fixtures/mail_templates_scala.json,
tests/fixtures/MailTemplateOracle.java, .env.example (mail block), this file.

## Status

DONE. Remaining crate-level blocker NOT in this scope: `cargo clippy -D warnings`
fails on `src/browser_auth_onboarding.rs:801 create_organization_with_admin` (too_many_arguments, 8/7) because the
interrupted `slack` agent added a `SlackNotificationService` extractor there; the queued "slack finish" must add
`#[allow(clippy::too_many_arguments)]` (as on lines 405/528 of that file). With that lint allowed, clippy is clean.

## Scala truth

- `app/mail/Mail.scala` (case class), `Mailer.scala` (Pekko actor, commons-email `HtmlEmail`/`MultiPartEmail`,
  `setStartTLSEnabled(tls)`, `DefaultAuthenticator` when `auth`, `mail.smtp.ssl.protocols=TLSv1.2`, sends only when
  `smtp.host` non-empty, else logs "Mail was not sent as no smtp host is configured.", skips mails whose recipients
  are all blank, `logToStdout` logs the whole Mail, invalid addresses -> warn "Failed to set email address").
- `app/mail/DefaultMails.scala` (21 builders, all `from = defaultSender`), `app/views/mail/*.scala.html` (Twirl,
  wrapped by `emailBaseTemplate(additionalFooter)`; `additionalFooter` inserted unescaped via `@Html`).
- `conf/application.conf` `mail.*`; JobService.sendSuccessEmailNotification / sendFailedEmailNotification select
  the job mails (ported 1:1 in src/job_workers.rs `success_mail` / `failure_mail`, verified this pass).

## Config (src/mail.rs `config_from_values`, wired by parent as Config.mail)

| Variable | Play key | Default |
|---|---|---|
| `WK_MAIL_LOG_TO_STDOUT` | `mail.logToStdout` | `false` |
| `WK_MAIL_SMTP_HOST` | `mail.smtp.host` | empty = no delivery, LogMailer |
| `WK_MAIL_SMTP_PORT` | `mail.smtp.port` | `465` (1-65535) |
| `WK_MAIL_SMTP_TLS` | `mail.smtp.tls` | `true` |
| `WK_MAIL_SMTP_AUTH` | `mail.smtp.auth` | `true` |
| `WK_MAIL_SMTP_USER` | `mail.smtp.user` | empty (Debug shows only `user_configured`) |
| `WK_MAIL_SMTP_PASS` | `mail.smtp.pass` | empty (Debug shows only `password_configured`) |
| `WK_MAIL_DEFAULT_SENDER` | `mail.defaultSender` | `WEBKNOSSOS <no-reply@webknossos.org>` |
| `WK_MAIL_ADDITIONAL_FOOTER` | `mail.additionalFooter` | empty (raw HTML) |

`mail.supportEmail` stays `WK_SUPPORT_EMAIL` (existing misc config); `webKnossos.newOrganizationMailingList` stays
`WK_NEW_ORGANIZATION_MAILING_LIST`. Booleans accept `true`/`false` only; invalid values fail startup with the key name.

## Design

- `Mail` = Scala fields (from, subject, body_text, body_html, recipients, cc, bcc, reply_to, headers); Debug redacts
  bodies. `MailSettings { default_sender, additional_footer }`; `MailSender::send` skips all-blank recipients, fills
  empty `from` with the default sender, replaces the footer slot `<!--wk:additionalFooter-->` (cannot appear in
  escaped interpolations), optional `log_to_stdout` log (addresses + subject only).
- `MailSender::from_config`: `SmtpMailer` when host set (falls back to LogMailer with an error log if the transport
  cannot be built), else `LogMailer`.
- `SmtpMailer`: lettre `AsyncSmtpTransport<Tokio1Executor>` (rustls). One lazily spawned worker task per runtime,
  bounded queue (`SMTP_QUEUE_CAPACITY` 1024, `try_send`; full -> error log + drop), mails delivered sequentially like
  the actor; failures logged `Sending mail failed` with subject/recipient count/error, never retried, never surfaced.
  `build_message`: multipart/alternative when text+html, html-only for templates, plain otherwise; custom headers.
- Templates: `mail::templates::*`, one function per DefaultMails builder (incl. `pricing_plan_expiry_reminder` for
  G8), Twirl `HtmlFormat.escape` semantics, byte-identical HTML.

## Deviations

1. TLS: `tls=true` on port 465 uses implicit TLS (`SmtpTlsMode::Implicit`); other ports use STARTTLS when offered
   (javamail `starttls.enable`, plaintext fallback). Play only ever does STARTTLS, which cannot work against an
   implicit-TLS server on its own default port 465. rustls negotiates TLS 1.2 or 1.3 (Play pins TLSv1.2).
2. `logToStdout` logs from/to/cc/bcc/reply-to/subject but never bodies (Play logs the full Mail incl. reset tokens).
3. `auth=true` without a user sends unauthenticated with a warning (javamail would attempt auth with empty creds).
4. With SMTP enabled, an unparsable `WK_MAIL_DEFAULT_SENDER` fails startup (Play would send without From).
5. Bounded queue (1024) instead of the unbounded actor mailbox.

## Done

- src/mail.rs: config, settings, SmtpMailer/LogMailer/RecordingMailer, `SmtpTlsMode`, all templates.
- Call sites (mechanical): browser_auth.rs, browser_auth_account.rs, browser_auth_onboarding.rs, auth_oidc.rs,
  users.rs, pricing.rs, application_info.rs, time_interaction_writer.rs, job_workers.rs. Pricing-plan expiry
  reminder template exists; the job itself is G8.
- tests/mail.rs (11 tests): golden byte-for-byte comparison against Play's compiled Twirl output for 22 cases
  (fixture generated by tests/fixtures/MailTemplateOracle.java from ../target/scala-3.8.3/classes; those classes
  post-date the last commits of help/pricing templates), hand-derived Twirl expectations for the 3 templates newer than
  the last Scala build (jobFailedGeneric, jobFailedUploadConvert, upgradeRequest), subjects/senders/recipients/
  reply-to for all 21 builders, settings + blank-recipient skipping, config defaults/parsing/validation/redaction,
  TLS mode selection, and an in-process fake SMTP server (EHLO/AUTH/MAIL/RCPT/DATA/QUIT, no TLS) proving delivery
  with AUTH PLAIN credentials, envelope, From/To/Subject/Content-Type/Reply-To/Cc headers, Bcc hidden, custom header,
  multipart alternative, UTF-8 body, failure on rejected RCPT does not stop the worker, unreachable server never
  blocks the caller.
- .env.example: WK_MAIL_* block appended.

## Evidence

- `cargo test --test mail`: 11 passed.
- `cargo clippy --all-targets -- -D warnings -A clippy::too_many_arguments`: clean (see Status for the one foreign
  too_many_arguments error).
- `rustfmt --edition 2024 --check src/mail.rs tests/mail.rs`: clean.
- Full suite (`--include-ignored`, verify-a): 573 passed, 0 failed, 0 ignored, 88 harnesses, exit 0
  (log /tmp/webknossos-rust-smtp-mail-full.log).
