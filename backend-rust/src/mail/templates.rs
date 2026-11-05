//! Play's `DefaultMails` with the Twirl templates in `app/views/mail`. Each
//! HTML body is byte-identical to Play's rendering (see tests/mail.rs and the
//! checkpoint smtp-mail.md). `from` stays empty and the additional footer is a
//! slot; [`MailSender::send`] fills both from the configured [`MailSettings`].
use webknossos_common::text::escape_html;

use super::Mail;

mod account;
mod jobs;
mod pricing;
mod sharing;

pub use account::{
    activated, change_password, email_verification, help, invite, new_organization, new_user,
    over_limit, register_admin_notifier, reset_password,
};
pub use jobs::{
    job_failed_generic, job_failed_upload_convert, job_successful_alignment,
    job_successful_generic, job_successful_mito_segmentation, job_successful_model_training,
    job_successful_neuron_segmentation, job_successful_upload_convert,
};
pub use pricing::{pricing_plan_expiry_reminder, pricing_plan_upgraded, upgrade_request};
pub use sharing::{
    access_changed, annotation_shared, annotation_transferred, dataset_shared, task_assigned,
};

/// Placeholder for `mail.additionalFooter`. Interpolated values are
/// HTML-escaped, so they can never contain this marker.
pub(super) const FOOTER_SLOT: &str = "<!--wk:additionalFooter-->";

pub(super) fn e(text: &str) -> String {
    escape_html(text)
}

/// The whole template file: one newline (after the signature line), the
/// `emailBaseTemplate` call, then whatever follows its closing brace.
pub(super) fn page(content: &str, trailing: &str) -> String {
    format!("\n{BASE_PREFIX}{content}{BASE_MIDDLE}{FOOTER_SLOT}{BASE_SUFFIX}{trailing}")
}

/// `emailButton.scala.html`.
pub(super) fn button(label: &str, url: &str) -> String {
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
pub(super) fn image(src: &str, alt: &str, width: u32, height: u32) -> String {
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

pub(super) fn html_mail(recipient: &str, subject: String, body_html: String) -> Mail {
    Mail {
        subject,
        body_html,
        recipients: vec![recipient.to_owned()],
        ..Mail::default()
    }
}

/// Trailing space at the end of several template source lines.
pub(super) const SP: &str = " ";

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
