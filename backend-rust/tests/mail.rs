//! Mail templates (golden HTML from Play's compiled Twirl templates), mail
//! configuration, and SMTP delivery against an in-process fake SMTP server.
use std::{collections::HashMap, time::Duration};

use base64::Engine as _;
use serde_json::Value;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::TcpListener,
    sync::mpsc,
};
use webknossos_backend::mail::{
    DEFAULT_SENDER, Mail, MailConfig, MailSender, MailSettings, RecordingMailer, SmtpConfig,
    SmtpTlsMode, config_from_values, templates,
};

const NAME: &str = "Jane <O'Brien> & \"Co\"";
const URI: &str = "https://wk.example/?a=1&b=2";
const FOOTER: &str = "<a href=\"https://imprint.example\">Imprint</a> &amp; more";
const LINK: &str = "https://wk.example/datasets/abc/view?token=x&y=1";
const DS: &str = "dataset <1> & 'two'";
const R: &str = "recipient@example.test";

fn settings() -> MailSettings {
    MailSettings {
        default_sender: DEFAULT_SENDER.into(),
        additional_footer: FOOTER.into(),
    }
}

fn html(mail: Mail) -> String {
    settings().finalize(mail).body_html
}

/// Rust inputs mirroring tests/fixtures/MailTemplateOracle.java.
fn rendered_cases() -> Vec<(&'static str, Mail)> {
    vec![
        ("new_user_review", templates::new_user(NAME, R, false)),
        ("new_user_auto", templates::new_user(NAME, R, true)),
        (
            "register_admin_notifier_auto",
            templates::register_admin_notifier(NAME, "j@example.test", URI, "Org", "o1", true, R),
        ),
        (
            "register_admin_notifier_manual",
            templates::register_admin_notifier(NAME, "j@example.test", URI, "Org", "o1", false, R),
        ),
        (
            "over_limit",
            templates::over_limit(NAME, "jo", "Proj <1>", "task&1", "ann'1", URI, R),
        ),
        ("activated", templates::activated(NAME, R, URI)),
        ("change_password", templates::change_password(NAME, R, URI)),
        (
            "reset_password",
            templates::reset_password(NAME, R, URI, "tok&en"),
        ),
        (
            "new_organization",
            templates::new_organization("Org \"X\"", "creator@ex.test", "wk.example:9000", R),
        ),
        (
            "invite",
            templates::invite(R, "tok'1", true, "Org <X>", NAME, URI),
        ),
        (
            "help",
            templates::help(
                NAME,
                R,
                "Org & Co",
                "Help me\n<please>",
                URI,
                "support@example.test",
            ),
        ),
        (
            "pricing_plan_expiry_reminder_1",
            templates::pricing_plan_expiry_reminder(
                NAME,
                R,
                "Org & Co",
                "Team",
                "2026-10-11",
                1,
                URI,
                "s@x.test",
            ),
        ),
        (
            "pricing_plan_expiry_reminder_14",
            templates::pricing_plan_expiry_reminder(
                NAME,
                R,
                "Org & Co",
                "Team",
                "2026-10-11",
                14,
                URI,
                "s@x.test",
            ),
        ),
        (
            "pricing_plan_upgraded",
            templates::pricing_plan_upgraded(
                NAME,
                R,
                "Org & Co",
                "Power",
                &["A & B", "C <D>"],
                URI,
                "s@x.test",
            ),
        ),
        (
            "job_successful_generic",
            templates::job_successful_generic(
                NAME,
                R,
                DS,
                LINK,
                "Mesh Generation",
                "Your meshes & more are ready.",
            ),
        ),
        (
            "job_successful_upload_convert",
            templates::job_successful_upload_convert(NAME, R, DS, LINK),
        ),
        (
            "job_successful_neuron_segmentation",
            templates::job_successful_neuron_segmentation(NAME, R, LINK),
        ),
        (
            "job_successful_mito_segmentation",
            templates::job_successful_mito_segmentation(NAME, R, LINK),
        ),
        (
            "job_successful_alignment",
            templates::job_successful_alignment(NAME, R, DS, LINK),
        ),
        (
            "job_successful_model_training",
            templates::job_successful_model_training(NAME, R, LINK),
        ),
        (
            "email_verification_expiry",
            templates::email_verification(NAME, R, LINK, Some("30 days")),
        ),
        (
            "email_verification_no_expiry",
            templates::email_verification(NAME, R, LINK, None),
        ),
    ]
}

#[test]
fn templates_match_play_twirl_rendering_byte_for_byte() {
    let fixture: Value =
        serde_json::from_str(include_str!("fixtures/mail_templates_scala.json")).unwrap();
    let cases = fixture["cases"].as_object().unwrap();
    let rendered = rendered_cases();
    assert_eq!(rendered.len(), cases.len());
    for (name, mail) in rendered {
        let expected = cases[name].as_str().unwrap();
        let actual = html(mail);
        if actual != expected {
            let at = actual
                .chars()
                .zip(expected.chars())
                .take_while(|(a, b)| a == b)
                .count();
            let context = |s: &str| {
                s.chars()
                    .skip(at.saturating_sub(40))
                    .take(120)
                    .collect::<String>()
            };
            panic!(
                "{name} differs at char {at}:\n--- rust\n{}\n--- play\n{}",
                context(&actual),
                context(expected)
            );
        }
    }
}

/// Play's emailBaseTemplate around `content` (derived from a golden case).
fn wrap(content: &str, trailing: &str) -> String {
    let fixture: Value =
        serde_json::from_str(include_str!("fixtures/mail_templates_scala.json")).unwrap();
    // validateUser: content is everything between the base template parts.
    let golden = fixture["cases"]["activated"].as_str().unwrap();
    let activated_content = "\n  <p>Hi Jane &lt;O&#x27;Brien&gt; &amp; &quot;Co&quot;,</p>\n\n  <p>\n    Great news, your account is now activated and you are ready to share and annotate your large 3D datasets.\n  </p>\n\n  <p><a href=\"https://wk.example/?a=1&amp;b=2\">Click here to get started with WEBKNOSSOS.</a></p>\n\n  <p>With best regards,<br />your WEBKNOSSOS team</p>\n";
    let (prefix, rest) = golden.split_once(activated_content).unwrap();
    let suffix = rest.strip_suffix('\n').unwrap();
    format!("{prefix}{content}{suffix}{trailing}")
}

const ROBOT_FAILED: &str = "\n<div style=\"text-align: center;\">\n  <img src=\"https://static.webknossos.org/mails/email-drawing-failed-job.png\"\n    alt=\"ALT\"\n    style=\"width: 300px; height: 250px; margin-top: 10px;\" />\n</div>\n";
const ERROR_STYLE: &str = "background-color: #f5f5f5; border-left: 3px solid #d9d9d9; border-radius: 4px; padding: 12px 16px; color: #555555; white-space: pre-wrap;";

/// These three templates changed after the last local Scala compile, so they
/// are derived by hand from the Twirl parse tree (match/for blocks emit the
/// text between their braces; whitespace between `case`s is dropped).
#[test]
fn templates_changed_after_the_scala_build_follow_twirl_rules() {
    let name = "Jane &lt;O&#x27;Brien&gt; &amp; &quot;Co&quot;";
    let ds = "dataset &lt;1&gt; &amp; &#x27;two&#x27;";
    let generic_robot = ROBOT_FAILED.replace(
        "ALT",
        "A robot dismayed about an unsuccessful WEBKNOSSOS job",
    );
    let generic_tail = format!(
        "\n<p>\n  Any compute credits used for this job have been fully refunded. \n</p>\n\n<p>Feel free to <a href=\"mailto:support@webknossos.org\">contact us via email</a> for assistance or please try again later.</p>\n\n<p>With best regards,<br />the WEBKNOSSOS team</p>\n\n{generic_robot}\n\n"
    );
    assert_eq!(
        html(templates::job_failed_generic(
            NAME,
            R,
            DS,
            "infer_neurons",
            Some("out <of> memory")
        )),
        wrap(
            &format!(
                "\n<p>Hi {name},</p>\n\n\n<p>\n  Unfortunately, your infer_neurons job for the {ds} dataset failed with the following error:\n</p>\n<p style=\"{ERROR_STYLE}\">out &lt;of&gt; memory</p>\n  {generic_tail}"
            ),
            "\n"
        )
    );
    assert_eq!(
        html(templates::job_failed_generic(
            NAME,
            R,
            DS,
            "infer_neurons",
            None
        )),
        wrap(
            &format!(
                "\n<p>Hi {name},</p>\n\n\n<p>\n  Something unexpected went wrong while processing your infer_neurons job for the {ds} dataset. This should not have happened, and we apologize for the inconvenience.\n</p>\n  {generic_tail}"
            ),
            "\n"
        )
    );
    let upload_robot = ROBOT_FAILED.replace(
        "ALT",
        "A robot dismayed about an unsuccessful WEBKNOSSOS dataset upload job",
    );
    let upload_tail = format!(
        "\n<p>\n  Feel free to <a href=\"mailto:hello@webknossos.com\">contact us for assistance</a> or please try again later.\n</p>\n\n<p>Here are some tips for uploading and converting datasets:\n<ul>\n  <li><a href=\"https://docs.webknossos.org/webknossos/data/index.html\">See the documentation on supported file formats</a></li>\n  <li><a href=\"https://docs.webknossos.org/webknossos-py/index.html\">Try our Python library for uploading datasets</a></li>\n  <li><a href=\"https://docs.webknossos.org/webknossos/data/streaming.html\">Try streaming your data as Zarr, Neuroglancer, or N5 files instead of uploading</a></li>\n</ul>\n</p>\n\n<p>With best regards,<br />the WEBKNOSSOS team</p>\n\n{upload_robot}\n"
    );
    assert_eq!(
        html(templates::job_failed_upload_convert(
            NAME,
            R,
            DS,
            Some("bad")
        )),
        wrap(
            &format!(
                "\n<p>Hi {name},</p>\n\n\n<p>\n  Unfortunately, uploading and processing your dataset <i>{ds}</i> failed with the following error:\n</p>\n<p style=\"{ERROR_STYLE}\">bad</p>\n  {upload_tail}"
            ),
            "\n"
        )
    );
    assert_eq!(
        html(templates::job_failed_upload_convert(NAME, R, DS, None)),
        wrap(
            &format!(
                "\n<p>Hi {name},</p>\n\n\n<p>\n  Something unexpected went wrong while uploading and processing your dataset <i>{ds}</i>. This should not have happened, and we apologize for the inconvenience.\n</p>\n  {upload_tail}"
            ),
            "\n"
        )
    );
    let changes = ["Upgrade to <Power>".to_owned(), "2 users".to_owned()];
    let request = |note| {
        html(templates::upgrade_request(
            NAME,
            "j&o@example.test",
            "Org & Co",
            &changes,
            note,
            "support@example.test",
        ))
    };
    let head = format!(
        "\n<p>Hi {name}</p>\n<p>Thank you for your upgrade request. Our sales team will contact you shortly.</p>\n<p>Organization: Org &amp; Co<br />Requested by: {name} (<a href=\"mailto:j&amp;o@example.test\">j&amp;o@example.test</a>)</p>\n<p>Requested changes:</p>\n<ul>\n  \n  <li>Upgrade to &lt;Power&gt;</li>\n  \n  <li>2 users</li>\n  \n</ul>\n"
    );
    let tail = "\n<p>With best regards,<br />the WEBKNOSSOS team</p>\n";
    assert_eq!(
        request(Some("call <me>")),
        wrap(
            &format!(
                "{head}\n<p>Note:</p>\n<p style=\"white-space: pre-wrap\">call &lt;me&gt;</p>\n{tail}"
            ),
            "\n"
        )
    );
    assert_eq!(request(None), wrap(&format!("{head}{tail}"), "\n"));
}

#[test]
fn subjects_senders_and_recipients_match_default_mails() {
    let cases: Vec<(Mail, &str, Vec<&str>, Vec<&str>)> = vec![
        (
            templates::register_admin_notifier(
                "Ann",
                "a@x.test",
                "http://wk",
                "Org",
                "o1",
                true,
                R,
            ),
            "WEBKNOSSOS | A new user (Ann, a@x.test) registered on http://wk for Org (o1)",
            vec![R],
            vec![],
        ),
        (
            templates::over_limit("Ann Bo", "abo", "P", "t", "a", "http://wk", R),
            "WEBKNOSSOS | Time limit reached. abo in P",
            vec![R],
            vec![],
        ),
        (
            templates::new_user("Ann", R, true),
            "Welcome to WEBKNOSSOS",
            vec![R],
            vec![],
        ),
        (
            templates::activated("Ann", R, "http://wk"),
            "WEBKNOSSOS | Account activated",
            vec![R],
            vec![],
        ),
        (
            templates::change_password("Ann", R, "http://wk"),
            "WEBKNOSSOS | Password changed",
            vec![R],
            vec![],
        ),
        (
            templates::reset_password("Ann", R, "http://wk", "t"),
            "WEBKNOSSOS | Password Reset",
            vec![R],
            vec![],
        ),
        (
            templates::new_organization("Org", "c@x.test", "wk.example", "list@x.test"),
            "WEBKNOSSOS | New Organization created on wk.example",
            vec!["list@x.test"],
            vec![],
        ),
        (
            templates::invite(R, "t", false, "Org", "Ann & Bo", "http://wk"),
            "Ann & Bo invited you to join their WEBKNOSSOS organization at http://wk",
            vec![R],
            vec![],
        ),
        (
            templates::help("Ann", "ann@x.test", "Org", "m", "u", "s@x.test"),
            "Help requested // Feedback provided",
            vec!["s@x.test", "ann@x.test"],
            vec!["ann@x.test", "s@x.test"],
        ),
        (
            templates::pricing_plan_expiry_reminder(
                "Ann",
                R,
                "Org",
                "Team",
                "2026-10-11",
                7,
                "http://wk",
                "s@x.test",
            ),
            "WEBKNOSSOS | Your Team plan expires on 2026-10-11",
            vec![R],
            vec!["s@x.test"],
        ),
        (
            templates::upgrade_request("Ann", "ann@x.test", "Org", &[], None, "s@x.test"),
            "WEBKNOSSOS Upgrade Request: Org",
            vec!["s@x.test", "ann@x.test"],
            vec!["ann@x.test", "s@x.test"],
        ),
        (
            templates::pricing_plan_upgraded(
                "Ann",
                R,
                "Org",
                "Power",
                &[],
                "http://wk",
                "s@x.test",
            ),
            "WEBKNOSSOS Upgrade: Your organization is now on the Power plan",
            vec![R],
            vec!["s@x.test"],
        ),
        (
            templates::job_successful_generic("Ann", R, "d", "l", "Mesh Generation", "x"),
            "Mesh Generation is ready",
            vec![R],
            vec![],
        ),
        (
            templates::job_successful_upload_convert("Ann", R, "d", "l"),
            "Your dataset is ready",
            vec![R],
            vec![],
        ),
        (
            templates::job_successful_neuron_segmentation("Ann", R, "l"),
            "Your segmentation is ready",
            vec![R],
            vec![],
        ),
        (
            templates::job_successful_mito_segmentation("Ann", R, "l"),
            "Your mitochondria segmentation is ready",
            vec![R],
            vec![],
        ),
        (
            templates::job_successful_alignment("Ann", R, "d", "l"),
            "Your alignment is ready",
            vec![R],
            vec![],
        ),
        (
            templates::job_successful_model_training("Ann", R, "l"),
            "Your model training is ready",
            vec![R],
            vec![],
        ),
        (
            templates::job_failed_generic("Ann", R, "d", "c", None),
            "Oops. Your WEBKNOSSOS job failed",
            vec![R],
            vec![],
        ),
        (
            templates::job_failed_upload_convert("Ann", R, "d", None),
            "Oops. Your dataset upload & conversion failed",
            vec![R],
            vec![],
        ),
        (
            templates::email_verification("Ann", R, "l", None),
            "Verify Your Email at WEBKNOSSOS",
            vec![R],
            vec![],
        ),
    ];
    for (mail, subject, recipients, reply_to) in cases {
        let mail = MailSettings::default().finalize(mail);
        assert_eq!(mail.subject, subject);
        assert_eq!(mail.from, DEFAULT_SENDER, "{subject}");
        assert_eq!(mail.recipients, recipients, "{subject}");
        assert_eq!(mail.reply_to, reply_to, "{subject}");
        assert!(mail.body_text.is_empty() && mail.cc_recipients.is_empty());
        assert!(mail.body_html.starts_with("\n<html>"), "{subject}");
        assert!(!mail.body_html.contains("wk:additionalFooter"), "{subject}");
    }
}

#[test]
fn mail_sender_applies_settings_and_skips_blank_recipients() {
    let recorder = RecordingMailer::default();
    let sender = MailSender::with_settings(
        recorder.clone(),
        MailSettings {
            default_sender: "Ops <ops@example.test>".into(),
            additional_footer: "<b>Imprint</b>".into(),
        },
    );
    sender.send(templates::new_user("Ann", " ", true));
    assert!(recorder.take().is_empty());
    sender.send(templates::new_user("Ann", R, true));
    let mail = recorder.take().pop().unwrap();
    assert_eq!(mail.from, "Ops <ops@example.test>");
    assert!(
        mail.body_html
            .contains("text-align: center; margin: 0;\">\n        <b>Imprint</b>\n      </p>")
    );
    // An explicit sender is kept.
    sender.send(Mail {
        from: "Other <o@example.test>".into(),
        recipients: vec![R.into()],
        ..Mail::default()
    });
    assert_eq!(recorder.take()[0].from, "Other <o@example.test>");
    // Debug output never contains bodies.
    let debug = format!("{mail:?}");
    assert!(!debug.contains("Imprint") && debug.contains("[redacted]"));
}

fn values(pairs: &[(&str, &str)]) -> HashMap<String, String> {
    pairs
        .iter()
        .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
        .collect()
}

#[test]
fn mail_config_defaults_follow_application_conf() {
    let config = config_from_values(&HashMap::new()).unwrap();
    assert_eq!(config, MailConfig::default());
    assert!(!config.log_to_stdout);
    assert!(!config.smtp_enabled());
    assert_eq!(
        config.smtp,
        SmtpConfig {
            host: String::new(),
            port: 465,
            tls: true,
            auth: true,
            user: String::new(),
            pass: String::new(),
        }
    );
    assert_eq!(
        config.settings.default_sender,
        "WEBKNOSSOS <no-reply@webknossos.org>"
    );
    assert_eq!(config.settings.additional_footer, "");
}

#[test]
fn mail_config_parses_values_validates_and_redacts_secrets() {
    let config = config_from_values(&values(&[
        ("WK_MAIL_LOG_TO_STDOUT", "true"),
        ("WK_MAIL_SMTP_HOST", " smtp.example.test "),
        ("WK_MAIL_SMTP_PORT", "587"),
        ("WK_MAIL_SMTP_TLS", "false"),
        ("WK_MAIL_SMTP_AUTH", "false"),
        ("WK_MAIL_SMTP_USER", "mailer-user"),
        ("WK_MAIL_SMTP_PASS", "hunter2-secret"),
        ("WK_MAIL_DEFAULT_SENDER", "Ops <ops@example.test>"),
        (
            "WK_MAIL_ADDITIONAL_FOOTER",
            "<a href=\"/imprint\">Imprint</a>",
        ),
    ]))
    .unwrap();
    assert!(config.log_to_stdout && config.smtp_enabled());
    assert_eq!(config.smtp.host, "smtp.example.test");
    assert_eq!(config.smtp.port, 587);
    assert!(!config.smtp.tls && !config.smtp.auth);
    assert_eq!(config.smtp.user, "mailer-user");
    assert_eq!(config.smtp.pass, "hunter2-secret");
    assert_eq!(config.settings.default_sender, "Ops <ops@example.test>");
    assert_eq!(
        config.settings.additional_footer,
        "<a href=\"/imprint\">Imprint</a>"
    );
    let debug = format!("{config:?}");
    assert!(!debug.contains("hunter2-secret") && !debug.contains("mailer-user"));
    assert!(debug.contains("password_configured: true"));

    for (key, value) in [
        ("WK_MAIL_SMTP_PORT", "0"),
        ("WK_MAIL_SMTP_PORT", "70000"),
        ("WK_MAIL_SMTP_PORT", "smtp"),
        ("WK_MAIL_SMTP_TLS", "yes"),
        ("WK_MAIL_SMTP_AUTH", "1"),
        ("WK_MAIL_LOG_TO_STDOUT", "on"),
        ("WK_MAIL_SMTP_HOST", "smtp example"),
    ] {
        let error = config_from_values(&values(&[(key, value)])).unwrap_err();
        assert!(error.contains(key), "{key}={value}: {error}");
    }
    // The sender must be a valid mailbox once SMTP delivery is enabled.
    let error = config_from_values(&values(&[
        ("WK_MAIL_SMTP_HOST", "smtp.example.test"),
        ("WK_MAIL_DEFAULT_SENDER", "not a mailbox"),
    ]))
    .unwrap_err();
    assert!(error.contains("WK_MAIL_DEFAULT_SENDER"));
    assert!(config_from_values(&values(&[("WK_MAIL_DEFAULT_SENDER", "not a mailbox")])).is_ok());
}

#[test]
fn smtp_tls_mode_follows_tls_flag_and_port() {
    let mode = |pairs: &[(&str, &str)]| config_from_values(&values(pairs)).unwrap().smtp.tls_mode();
    // Play defaults: tls = true on port 465 -> implicit TLS.
    assert_eq!(mode(&[]), SmtpTlsMode::Implicit);
    assert_eq!(
        mode(&[("WK_MAIL_SMTP_PORT", "587")]),
        SmtpTlsMode::StartTlsIfOffered
    );
    assert_eq!(
        mode(&[("WK_MAIL_SMTP_PORT", "25")]),
        SmtpTlsMode::StartTlsIfOffered
    );
    assert_eq!(mode(&[("WK_MAIL_SMTP_TLS", "false")]), SmtpTlsMode::None);
    assert_eq!(
        mode(&[("WK_MAIL_SMTP_TLS", "false"), ("WK_MAIL_SMTP_PORT", "587")]),
        SmtpTlsMode::None
    );
}

// ---------------------------------------------------------------------------
// Fake SMTP server

#[derive(Debug, Default)]
struct Session {
    commands: Vec<String>,
    data: String,
}

struct FakeSmtp {
    port: u16,
    sessions: mpsc::UnboundedReceiver<Session>,
}

impl FakeSmtp {
    /// Accepts connections forever; `reject_rcpt` answers matching RCPT TO
    /// commands with a permanent failure.
    async fn start(advertise_auth: bool, reject_rcpt: Option<&'static str>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (sender, sessions) = mpsc::unbounded_channel();
        tokio::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    return;
                };
                let sender = sender.clone();
                tokio::spawn(async move {
                    let (read, mut write) = stream.into_split();
                    let mut lines = BufReader::new(read);
                    let mut session = Session::default();
                    write.write_all(b"220 fake.test ESMTP\r\n").await.unwrap();
                    let mut line = String::new();
                    loop {
                        line.clear();
                        if lines.read_line(&mut line).await.unwrap_or(0) == 0 {
                            break;
                        }
                        let command = line.trim_end().to_owned();
                        let upper = command.to_ascii_uppercase();
                        session.commands.push(command.clone());
                        let reply: &[u8] = if upper.starts_with("EHLO") {
                            if advertise_auth {
                                b"250-fake.test\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n"
                            } else {
                                b"250-fake.test\r\n250 8BITMIME\r\n"
                            }
                        } else if upper.starts_with("AUTH") {
                            b"235 2.7.0 Authentication successful\r\n"
                        } else if upper.starts_with("RCPT")
                            && reject_rcpt.is_some_and(|reject| command.contains(reject))
                        {
                            b"550 5.1.1 Mailbox unavailable\r\n"
                        } else if upper == "DATA" {
                            write
                                .write_all(b"354 End data with <CR><LF>.<CR><LF>\r\n")
                                .await
                                .unwrap();
                            loop {
                                line.clear();
                                if lines.read_line(&mut line).await.unwrap_or(0) == 0 {
                                    break;
                                }
                                if line == ".\r\n" {
                                    break;
                                }
                                session.data.push_str(&line);
                            }
                            b"250 2.0.0 Queued\r\n"
                        } else if upper == "QUIT" {
                            write.write_all(b"221 2.0.0 Bye\r\n").await.unwrap();
                            break;
                        } else {
                            b"250 2.0.0 OK\r\n"
                        };
                        if write.write_all(reply).await.is_err() {
                            break;
                        }
                    }
                    let _ = sender.send(session);
                });
            }
        });
        Self { port, sessions }
    }

    async fn next_session(&mut self) -> Session {
        tokio::time::timeout(Duration::from_secs(20), self.sessions.recv())
            .await
            .expect("SMTP session within 20 s")
            .expect("fake SMTP server running")
    }

    fn config(&self, extra: &[(&str, &str)]) -> MailConfig {
        let port = self.port.to_string();
        let mut pairs = vec![
            ("WK_MAIL_SMTP_HOST", "127.0.0.1"),
            ("WK_MAIL_SMTP_PORT", port.as_str()),
        ];
        pairs.extend_from_slice(extra);
        config_from_values(&values(&pairs)).unwrap()
    }
}

/// Splits DATA into (headers, decoded body) with CRLF normalized to LF.
fn parse_message(data: &str) -> (String, String) {
    let (headers, body) = data.split_once("\r\n\r\n").expect("header/body separator");
    let headers = headers.replace("\r\n", "\n");
    // Undo SMTP dot-stuffing.
    let body = body
        .split("\r\n")
        .map(|line| {
            line.strip_prefix('.')
                .filter(|_| line.starts_with(".."))
                .unwrap_or(line)
        })
        .collect::<Vec<_>>()
        .join("\r\n");
    let lowered = headers.to_ascii_lowercase();
    let body = if lowered.contains("content-transfer-encoding: base64") {
        let joined: String = body.split_whitespace().collect();
        String::from_utf8(
            base64::engine::general_purpose::STANDARD
                .decode(joined)
                .unwrap(),
        )
        .unwrap()
    } else if lowered.contains("content-transfer-encoding: quoted-printable") {
        decode_quoted_printable(&body)
    } else {
        body
    };
    (headers, body.replace("\r\n", "\n"))
}

fn decode_quoted_printable(body: &str) -> String {
    let joined = body.replace("=\r\n", "");
    let bytes = joined.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'=' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap();
            out.push(u8::from_str_radix(hex, 16).unwrap());
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).unwrap()
}

fn header<'a>(headers: &'a str, name: &str) -> Vec<&'a str> {
    let prefix = format!("{}: ", name.to_ascii_lowercase());
    headers
        .lines()
        .filter(|line| line.to_ascii_lowercase().starts_with(&prefix))
        .map(|line| &line[prefix.len()..])
        .collect()
}

#[tokio::test]
async fn smtp_mailer_delivers_html_mail_with_auth_and_play_headers() {
    let mut server = FakeSmtp::start(true, None).await;
    let config = server.config(&[
        ("WK_MAIL_SMTP_TLS", "false"),
        ("WK_MAIL_SMTP_USER", "mailer"),
        ("WK_MAIL_SMTP_PASS", "s3cret"),
        ("WK_MAIL_ADDITIONAL_FOOTER", "<i>Imprint</i>"),
    ]);
    let sender = MailSender::from_config(&config);
    let mail = templates::reset_password("Ann Bo", "reset@example.test", "http://wk", "tok123");
    let expected_html = sender.settings().finalize(mail.clone()).body_html;
    sender.send(mail);

    let session = server.next_session().await;
    let auth = session
        .commands
        .iter()
        .find(|command| command.starts_with("AUTH PLAIN "))
        .expect("AUTH PLAIN");
    let credentials = base64::engine::general_purpose::STANDARD
        .decode(auth.trim_start_matches("AUTH PLAIN "))
        .unwrap();
    assert_eq!(credentials, b"\0mailer\0s3cret");
    assert!(
        session
            .commands
            .iter()
            .any(|command| command == "MAIL FROM:<no-reply@webknossos.org>"),
        "{:?}",
        session.commands
    );
    assert!(
        session
            .commands
            .iter()
            .any(|command| command == "RCPT TO:<reset@example.test>")
    );
    let (headers, body) = parse_message(&session.data);
    assert_eq!(
        header(&headers, "From"),
        ["WEBKNOSSOS <no-reply@webknossos.org>"]
    );
    assert_eq!(header(&headers, "To"), ["reset@example.test"]);
    assert_eq!(header(&headers, "Subject"), ["WEBKNOSSOS | Password Reset"]);
    assert_eq!(
        header(&headers, "Content-Type"),
        ["text/html; charset=utf-8"]
    );
    assert!(header(&headers, "Bcc").is_empty());
    // The encoded body ends with CRLF before the DATA terminator.
    assert_eq!(
        body.trim_end_matches('\n'),
        expected_html.trim_end_matches('\n')
    );
    // lettre picks the transfer encoding (long HTML lines rule out 7bit);
    // parse_message decoded it above.
    assert_eq!(header(&headers, "Content-Transfer-Encoding").len(), 1);
    assert!(body.contains("http://wk/auth/finishResetPassword?token=tok123"));
    assert!(body.contains("<i>Imprint</i>"));
}

#[tokio::test]
async fn smtp_mailer_sends_reply_to_cc_bcc_custom_headers_and_text_alternative() {
    let mut server = FakeSmtp::start(false, None).await;
    // TLS enabled but the server offers no STARTTLS: like javamail's
    // `starttls.enable`, delivery falls back to plaintext. Auth is enabled
    // without a user, so no AUTH command is sent.
    let sender = MailSender::from_config(&server.config(&[]));
    sender.send(templates::help(
        "Ann",
        "ann@example.test",
        "Org",
        "Ünïcode — message",
        "http://wk/x",
        "Support <support@example.test>",
    ));
    let session = server.next_session().await;
    assert!(!session.commands.iter().any(|c| c.starts_with("AUTH")));
    let rcpts: Vec<&String> = session
        .commands
        .iter()
        .filter(|c| c.starts_with("RCPT TO:"))
        .collect();
    assert_eq!(
        rcpts,
        [
            "RCPT TO:<support@example.test>",
            "RCPT TO:<ann@example.test>"
        ]
    );
    let (headers, body) = parse_message(&session.data);
    assert_eq!(
        header(&headers, "Reply-To"),
        ["ann@example.test, Support <support@example.test>"]
    );
    assert!(body.contains("Ünïcode — message"));

    sender.send(Mail {
        from: "Ops <ops@example.test>".into(),
        subject: "Plain".into(),
        body_text: "text body".into(),
        body_html: "<p>html body</p>".into(),
        recipients: vec!["to@example.test".into()],
        cc_recipients: vec!["cc@example.test".into()],
        bcc_recipients: vec!["bcc@example.test".into()],
        headers: vec![("X-Wk-Test".into(), "yes".into())],
        ..Mail::default()
    });
    let session = server.next_session().await;
    let rcpts: Vec<&String> = session
        .commands
        .iter()
        .filter(|c| c.starts_with("RCPT TO:"))
        .collect();
    assert_eq!(rcpts.len(), 3, "{rcpts:?}");
    assert!(
        session
            .commands
            .contains(&"MAIL FROM:<ops@example.test>".to_owned())
    );
    let headers = session.data.split("\r\n\r\n").next().unwrap();
    assert!(headers.contains("Cc: cc@example.test"));
    assert!(!headers.contains("bcc@example.test"));
    assert!(headers.contains("X-Wk-Test: yes"));
    assert!(headers.contains("multipart/alternative"));
    assert!(session.data.contains("text body") && session.data.contains("<p>html body</p>"));
}

#[tokio::test]
async fn smtp_failures_are_logged_and_do_not_stop_the_worker() {
    let mut server = FakeSmtp::start(false, Some("rejected@")).await;
    let sender = MailSender::from_config(&server.config(&[("WK_MAIL_SMTP_TLS", "false")]));
    sender.send(templates::new_user("Ann", "rejected@example.test", true));
    sender.send(templates::new_user("Ann", "ok@example.test", true));
    let first = server.next_session().await;
    assert!(first.data.is_empty(), "rejected mail has no DATA");
    let second = server.next_session().await;
    assert!(
        second
            .commands
            .contains(&"RCPT TO:<ok@example.test>".to_owned())
    );
    assert!(second.data.contains("Subject: Welcome to WEBKNOSSOS"));
}

#[tokio::test]
async fn unreachable_smtp_server_never_blocks_or_panics_the_caller() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port().to_string();
    drop(listener);
    let config = config_from_values(&values(&[
        ("WK_MAIL_SMTP_HOST", "127.0.0.1"),
        ("WK_MAIL_SMTP_PORT", &port),
    ]))
    .unwrap();
    let sender = MailSender::from_config(&config);
    let started = std::time::Instant::now();
    for _ in 0..10 {
        sender.send(templates::new_user("Ann", R, true));
    }
    assert!(started.elapsed() < Duration::from_secs(1));
    tokio::time::sleep(Duration::from_millis(200)).await;
}
