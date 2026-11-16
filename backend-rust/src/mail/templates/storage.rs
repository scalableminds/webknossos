//! Storage mails.
use super::{button, e, page};
use crate::mail::Mail;

/// Scala `Formatter.formatBytes`: decimal units with one decimal place, matching how storage is
/// shown in the organization overview, e.g. "92.0 GB". The unit is chosen like Scala
/// (`log10(bytes) / 3`); the decimal place is rounded half up on the exact value, as Java's
/// `%.1f` does for the shortest decimal representation of the quotient.
pub fn format_bytes(num_bytes: i64) -> String {
    const UNITS: [&str; 6] = ["B", "KB", "MB", "GB", "TB", "PB"];
    if num_bytes < 1000 {
        return format!("{num_bytes} B");
    }
    let exponent = ((num_bytes as f64).log10() / 3.0) as usize;
    let exponent = exponent.min(UNITS.len() - 1);
    let divisor = 1000_i128.pow(exponent as u32);
    let tenths = (i128::from(num_bytes) * 10 + divisor / 2) / divisor;
    format!("{}.{} {}", tenths / 10, tenths % 10, UNITS[exponent])
}

/// DefaultMails.storageWarningMail (`storageWarning`). The button links to
/// `{uri}/organization/overview`.
#[allow(clippy::too_many_arguments)]
pub fn storage_warning(
    full_name: &str,
    email: &str,
    organization_name: &str,
    used_storage_bytes: i64,
    included_storage_bytes: i64,
    usage_percent: f64,
    is_exceeded: bool,
    uri: &str,
    support_email: &str,
) -> Mail {
    // Floored, so that e.g. 89.9% is not announced as 90%. Only shown while not exceeded, so
    // always finite.
    let usage_percent_floored = usage_percent as i64;
    let subject = if is_exceeded {
        format!("WEBKNOSSOS | Your organization {organization_name} has used up its storage")
    } else {
        format!(
            "WEBKNOSSOS | Your organization {organization_name} has used \
             {usage_percent_floored}% of its storage"
        )
    };
    let manage = button("Manage Storage", &format!("{uri}/organization/overview"));
    let (name, organization_name, used_storage, included_storage) = (
        e(full_name),
        e(organization_name),
        e(&format_bytes(used_storage_bytes)),
        e(&format_bytes(included_storage_bytes)),
    );
    let message = if is_exceeded {
        format!(
            r##"
<p>
  your organization <i>{organization_name}</i> has used up its included storage: it currently uses
  <b>{used_storage}</b> of <b>{included_storage}</b>.
</p>

<p>
  New dataset uploads and jobs that create new data are blocked until storage is freed up or the storage is upgraded.
</p>
"##
        )
    } else {
        format!(
            r##"
<p>
  your organization <i>{organization_name}</i> is running out of storage: it currently uses <b>{used_storage}</b>
  of <b>{included_storage}</b> ({usage_percent_floored}%).
</p>

<p>
  Once the included storage is used up, new dataset uploads and jobs that create new data will be blocked.
  To avoid this, delete datasets you no longer need or upgrade your storage.
</p>
"##
        )
    };
    let content = format!(
        r##"
<p>Hi {name},</p>

{message}

{manage}

<p>If you would like to discuss your options, simply reply to this email.</p>

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
