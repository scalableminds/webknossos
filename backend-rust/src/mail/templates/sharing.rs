//! Sharing and task assignment mails.
use super::{button, e, html_mail, page};
use crate::mail::Mail;

/// `your team <i>A</i>` or `your teams <i>A, B</i>` (annotationShared and
/// datasetShared: `@if(teamNames.length == 1) {...} else {...}`).
fn your_teams(team_names: &[String]) -> String {
    match team_names {
        [team_name] => format!("your team <i>{}</i>", e(team_name)),
        _ => format!("your teams <i>{}</i>", e(&team_names.join(", "))),
    }
}

/// DefaultMails.annotationSharedMail (`annotationShared`).
pub fn annotation_shared(
    full_name: &str,
    recipient: &str,
    sharer_name: &str,
    annotation_name: &str,
    dataset_name: &str,
    team_names: &[String],
    annotation_url: &str,
) -> Mail {
    let subject = format!("WEBKNOSSOS | {sharer_name} shared an annotation with you");
    let open = button("Open Annotation", annotation_url);
    let teams = your_teams(team_names);
    let (name, sharer_name, annotation_name, dataset_name) = (
        e(full_name),
        e(sharer_name),
        e(annotation_name),
        e(dataset_name),
    );
    let content = format!(
        r##"
<p>Hi {name},</p>

<p>
  {sharer_name} shared the annotation <i>{annotation_name}</i> of the dataset <i>{dataset_name}</i> with
  {teams}.
</p>

{open}

<p>With best regards,<br />the WEBKNOSSOS team</p>
"##
    );
    html_mail(recipient, subject, page(&content, "\n"))
}

/// DefaultMails.annotationTransferredMail (`annotationTransferred`).
pub fn annotation_transferred(
    full_name: &str,
    recipient: &str,
    issuer_name: &str,
    annotation_name: &str,
    dataset_name: &str,
    annotation_url: &str,
) -> Mail {
    let subject = format!("WEBKNOSSOS | {issuer_name} transferred an annotation to you");
    let open = button("Open Annotation", annotation_url);
    let (name, issuer_name, annotation_name, dataset_name) = (
        e(full_name),
        e(issuer_name),
        e(annotation_name),
        e(dataset_name),
    );
    let content = format!(
        r##"
<p>Hi {name},</p>

<p>
  {issuer_name} transferred the annotation <i>{annotation_name}</i> of the dataset <i>{dataset_name}</i> to you.
  You are now its owner and can find it in your dashboard.
</p>

{open}

<p>With best regards,<br />the WEBKNOSSOS team</p>
"##
    );
    html_mail(recipient, subject, page(&content, "\n"))
}

/// DefaultMails.datasetSharedMail (`datasetShared`).
pub fn dataset_shared(
    full_name: &str,
    recipient: &str,
    sharer_name: &str,
    dataset_name: &str,
    team_names: &[String],
    dataset_url: &str,
) -> Mail {
    let subject = format!("WEBKNOSSOS | {sharer_name} shared the dataset {dataset_name} with you");
    let open = button("View Dataset", dataset_url);
    let teams = your_teams(team_names);
    let (name, sharer_name, dataset_name) = (e(full_name), e(sharer_name), e(dataset_name));
    let content = format!(
        r##"
<p>Hi {name},</p>

<p>
  {sharer_name} gave
  {teams}
  access to the dataset <i>{dataset_name}</i>.
</p>

{open}

<p>With best regards,<br />the WEBKNOSSOS team</p>
"##
    );
    html_mail(recipient, subject, page(&content, "\n"))
}

/// DefaultMails.accessChangedMail (`accessChanged`).
pub fn access_changed(
    full_name: &str,
    recipient: &str,
    issuer_name: &str,
    organization_name: &str,
    changes: &[String],
    dashboard_url: &str,
) -> Mail {
    let subject = format!("WEBKNOSSOS | Your access in {organization_name} has changed");
    let open = button("Open WEBKNOSSOS", dashboard_url);
    let (name, issuer_name, organization_name) =
        (e(full_name), e(issuer_name), e(organization_name));
    let changes: String = changes
        .iter()
        .map(|change| format!("\n  <li>{}</li>\n  ", e(change)))
        .collect();
    let content = format!(
        r##"
<p>Hi {name},</p>

<p>{issuer_name} changed your access in the WEBKNOSSOS organization <i>{organization_name}</i>:</p>

<ul>
  {changes}
</ul>

{open}

<p>If you did not expect this change, please contact an admin of your organization.</p>

<p>With best regards,<br />the WEBKNOSSOS team</p>
"##
    );
    html_mail(recipient, subject, page(&content, "\n"))
}

/// DefaultMails.taskAssignedMail (`taskAssigned`).
pub fn task_assigned(
    full_name: &str,
    recipient: &str,
    issuer_name: &str,
    project_name: &str,
    task_type_name: &str,
    annotation_url: &str,
) -> Mail {
    let subject = format!("WEBKNOSSOS | {issuer_name} assigned a task to you");
    let start = button("Start Task", annotation_url);
    let (name, issuer_name, project_name, task_type_name) = (
        e(full_name),
        e(issuer_name),
        e(project_name),
        e(task_type_name),
    );
    let content = format!(
        r##"
<p>Hi {name},</p>

<p>
  {issuer_name} assigned a <i>{task_type_name}</i> task of the project <i>{project_name}</i> to you.
  You can also find it in the task list of your dashboard.
</p>

{start}

<p>With best regards,<br />the WEBKNOSSOS team</p>
"##
    );
    html_mail(recipient, subject, page(&content, "\n"))
}
