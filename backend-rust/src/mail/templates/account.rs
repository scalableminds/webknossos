//! Account, organization and help mails.
use super::{e, html_mail, page};
use crate::mail::Mail;

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
    let subject = format!("WEBKNOSSOS | Time limit reached. {abbreviated_name} in {project_name}");
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
