//! Pricing plan mails.
use super::{button, e, page};
use crate::mail::Mail;

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
    let subject = format!("WEBKNOSSOS | Your {pricing_plan_label} plan expires on {expiry_date}");
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
    let subject = format!("WEBKNOSSOS Upgrade: Your organization is now on the {plan_label} plan");
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
