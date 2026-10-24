//! Port of test/backend/NotificationEmailTestSuite.scala plus the triggering
//! conditions of NotificationEmailService.
use std::collections::{HashMap, HashSet};

use super::*;
use crate::mail::{MailSettings, RecordingMailer};

const TEAM_A: &str = "5c0b3e8a1d00000000000001";
const TEAM_B: &str = "5c0b3e8a1d00000000000002";

fn team_names() -> HashMap<String, String> {
    HashMap::from([
        (TEAM_A.to_owned(), "Team A".to_owned()),
        (TEAM_B.to_owned(), "Team B".to_owned()),
    ])
}

fn membership(team: &str, is_team_manager: bool) -> TeamMembership {
    TeamMembership::new(team, is_team_manager)
}

fn user() -> UserAccess {
    UserAccess::default()
}

#[test]
fn access_changes_are_empty_if_nothing_changed() {
    assert!(
        access_changes(
            &[membership(TEAM_A, false)],
            &[membership(TEAM_A, false)],
            user(),
            user(),
            &team_names()
        )
        .is_empty()
    );
}

#[test]
fn access_changes_describe_added_and_removed_teams() {
    assert_eq!(
        access_changes(
            &[membership(TEAM_A, false)],
            &[membership(TEAM_B, true)],
            user(),
            user(),
            &team_names()
        ),
        [
            "You were added to the team Team B as team manager.",
            "You were removed from the team Team A."
        ]
    );
    assert_eq!(
        access_changes(
            &[],
            &[membership(TEAM_A, false)],
            user(),
            user(),
            &team_names()
        ),
        ["You were added to the team Team A."]
    );
}

#[test]
fn access_changes_describe_team_manager_changes() {
    assert_eq!(
        access_changes(
            &[membership(TEAM_A, false)],
            &[membership(TEAM_A, true)],
            user(),
            user(),
            &team_names()
        ),
        ["You are now a team manager of the team Team A."]
    );
    assert_eq!(
        access_changes(
            &[membership(TEAM_A, true)],
            &[membership(TEAM_A, false)],
            user(),
            user(),
            &team_names()
        ),
        ["You are no longer a team manager of the team Team A."]
    );
}

#[test]
fn access_changes_describe_role_changes_before_team_changes() {
    let promoted = UserAccess {
        is_admin: true,
        is_dataset_manager: true,
        ..user()
    };
    assert_eq!(
        access_changes(
            &[],
            &[membership(TEAM_A, false)],
            user(),
            promoted,
            &team_names()
        ),
        [
            "You are now an admin of the organization.",
            "You are now a dataset manager.",
            "You were added to the team Team A."
        ]
    );
    assert_eq!(
        access_changes(&[], &[], promoted, user(), &team_names()),
        [
            "You are no longer an admin of the organization.",
            "You are no longer a dataset manager."
        ]
    );
}

#[test]
fn access_changes_fall_back_to_the_team_id_for_unknown_teams() {
    assert_eq!(
        access_changes(
            &[membership(TEAM_A, false)],
            &[],
            user(),
            user(),
            &HashMap::new()
        ),
        [format!("You were removed from the team {TEAM_A}.")]
    );
}

fn render_annotation_shared(team_names: &[String]) -> String {
    templates::annotation_shared(
        "Sample User",
        "sample@example.test",
        "Other <b>User</b>",
        "My Annotation",
        "My Dataset",
        team_names,
        "http://localhost:9000/annotations/abc",
    )
    .body_html
}

#[test]
fn the_annotation_shared_mail_lists_the_teams_it_was_shared_with() {
    assert!(render_annotation_shared(&["Team A".into()]).contains("your team <i>Team A</i>."));
    assert!(
        render_annotation_shared(&["Team A".into(), "Team B".into()])
            .contains("your teams <i>Team A, Team B</i>.")
    );
}

// Names are chosen by users, so they must not be able to inject HTML into
// mails sent to others.
#[test]
fn the_annotation_shared_mail_escapes_user_provided_names() {
    assert!(render_annotation_shared(&["Team A".into()]).contains("Other &lt;b&gt;User&lt;/b&gt;"));
}

#[test]
fn notification_subjects_and_links_match_default_mails() {
    let teams = ["Team A".to_owned()];
    let url = "https://wk.example/annotations/abc";
    let cases = [
        (
            templates::annotation_shared("N", "r@x.test", "Sharer", "A", "D", &teams, url),
            "WEBKNOSSOS | Sharer shared an annotation with you",
            "Open Annotation",
        ),
        (
            templates::annotation_transferred("N", "r@x.test", "Issuer", "A", "D", url),
            "WEBKNOSSOS | Issuer transferred an annotation to you",
            "Open Annotation",
        ),
        (
            templates::dataset_shared("N", "r@x.test", "Sharer", "ds_1", &teams, url),
            "WEBKNOSSOS | Sharer shared the dataset ds_1 with you",
            "View Dataset",
        ),
        (
            templates::access_changed("N", "r@x.test", "Issuer", "Org", &[], url),
            "WEBKNOSSOS | Your access in Org has changed",
            "Open WEBKNOSSOS",
        ),
        (
            templates::task_assigned("N", "r@x.test", "Issuer", "P", "T", url),
            "WEBKNOSSOS | Issuer assigned a task to you",
            "Start Task",
        ),
    ];
    for (mail, subject, button) in cases {
        assert_eq!(mail.subject, subject);
        assert_eq!(mail.recipients, ["r@x.test"]);
        assert!(mail.from.is_empty(), "uses mail.defaultSender");
        assert!(mail.body_html.contains(&format!("href=\"{url}\"")));
        assert!(mail.body_html.contains(button));
    }
}

fn service(settings: NotificationEmailSettings) -> NotificationEmailService {
    NotificationEmailService::new(
        MailSender::with_settings(
            RecordingMailer::default(),
            MailSettings {
                notification_emails: settings,
                ..MailSettings::default()
            },
        ),
        "https://wk.example/",
    )
}

fn enabled() -> NotificationEmailService {
    service(NotificationEmailSettings::default())
}

fn disabled() -> NotificationEmailService {
    service(NotificationEmailSettings {
        access_changes: false,
        manual_task_assignments: false,
    })
}

#[test]
fn notification_emails_are_enabled_by_default() {
    assert_eq!(
        MailSettings::default().notification_emails,
        NotificationEmailSettings {
            access_changes: true,
            manual_task_assignments: true
        }
    );
}

#[test]
fn links_use_the_public_uri() {
    assert_eq!(
        enabled().annotation_url("abc"),
        "https://wk.example/annotations/abc"
    );
}

#[test]
fn transfers_are_announced_only_to_other_users() {
    assert!(enabled().wants_transfer_email("owner", "issuer"));
    assert!(!enabled().wants_transfer_email("issuer", "issuer"));
    assert!(!disabled().wants_transfer_email("owner", "issuer"));
}

#[test]
fn task_assignments_are_announced_only_to_other_active_users() {
    assert!(enabled().wants_task_assigned_email("assignee", false, "issuer"));
    assert!(!enabled().wants_task_assigned_email("issuer", false, "issuer"));
    assert!(!enabled().wants_task_assigned_email("assignee", true, "issuer"));
    assert!(!disabled().wants_task_assigned_email("assignee", false, "issuer"));
    // The flags are independent.
    let only_tasks = service(NotificationEmailSettings {
        access_changes: false,
        manual_task_assignments: true,
    });
    assert!(only_tasks.wants_task_assigned_email("assignee", false, "issuer"));
    assert!(!only_tasks.wants_transfer_email("owner", "issuer"));
}

#[test]
fn access_changes_are_announced_only_for_other_users_that_stay_active() {
    let active = user();
    let deactivated = UserAccess {
        is_deactivated: true,
        ..user()
    };
    let service = enabled();
    assert!(service.wants_access_changed_email("u1", active, active, "issuer"));
    assert!(!service.wants_access_changed_email("issuer", active, active, "issuer"));
    assert!(!service.wants_access_changed_email("u2", active, deactivated, "issuer"));
    assert!(!service.wants_access_changed_email("u3", deactivated, deactivated, "issuer"));
    assert!(!disabled().wants_access_changed_email("u1", active, active, "issuer"));
}

#[test]
fn changes_shortly_after_an_activation_are_not_announced() {
    let active = user();
    let deactivated = UserAccess {
        is_deactivated: true,
        ..user()
    };
    let service = enabled();
    // The activation itself is covered by the activation email.
    assert!(!service.wants_access_changed_email("new", deactivated, active, "issuer"));
    // Follow-up changes (e.g. teams configured in the user list) neither.
    assert!(!service.wants_access_changed_email("new", active, active, "issuer"));
    // Other users are unaffected, also through clones of the service.
    assert!(
        service
            .clone()
            .wants_access_changed_email("other", active, active, "issuer")
    );
    // Activations are recorded even while the emails are disabled.
    let disabled = disabled();
    disabled.wants_access_changed_email("new", deactivated, active, "issuer");
    assert!(
        disabled
            .recently_activated
            .lock()
            .unwrap()
            .contains_key("new")
    );
}

#[test]
fn only_added_teams_are_announced() {
    let ids = |ids: &[&str]| ids.iter().map(|id| (*id).to_owned()).collect::<Vec<_>>();
    assert_eq!(
        added_team_ids(&ids(&[TEAM_A]), &ids(&[TEAM_A, TEAM_B])),
        ids(&[TEAM_B])
    );
    assert!(added_team_ids(&ids(&[TEAM_A, TEAM_B]), &ids(&[TEAM_A])).is_empty());
}

#[test]
fn only_members_who_gain_access_are_notified() {
    let candidate = |id: &str| Candidate {
        user_id: id.to_owned(),
        team_ids: vec![TEAM_A.to_owned()],
    };
    let candidates = [candidate("before"), candidate("gained"), candidate("never")];
    let had: HashSet<String> = HashSet::from(["before".to_owned()]);
    let has: HashSet<String> = HashSet::from(["before".to_owned(), "gained".to_owned()]);
    let recipients: Vec<&str> = newly_allowed(&candidates, &had, &has)
        .into_iter()
        .map(|c| c.user_id.as_str())
        .collect();
    assert_eq!(recipients, ["gained"]);
}

#[test]
fn recipients_see_only_the_added_teams_they_are_members_of() {
    let added = [TEAM_B.to_owned(), TEAM_A.to_owned()];
    assert_eq!(
        recipient_team_names(&added, &[TEAM_A.to_owned()], &team_names()),
        ["Team A"]
    );
    assert_eq!(
        recipient_team_names(
            &added,
            &[TEAM_A.to_owned(), TEAM_B.to_owned()],
            &team_names()
        ),
        ["Team B", "Team A"]
    );
    // Teams deleted in the meantime are left out.
    assert!(recipient_team_names(&added, &[TEAM_A.to_owned()], &HashMap::new()).is_empty());
}

#[test]
fn unnamed_annotations_get_a_placeholder_name() {
    assert_eq!(annotation_name(""), "Unnamed annotation");
    assert_eq!(annotation_name("Mine"), "Mine");
}

#[test]
fn access_queries_evaluate_the_grants_per_candidate() {
    for resource in [
        SharedResource::Annotation { id: "a".into() },
        SharedResource::Dataset { id: "d".into() },
    ] {
        let query = resource.access_query();
        let (head, predicate) = query.split_once(" AND ").unwrap();
        assert!(head.contains("$1") && head.contains("$2"), "{head}");
        // Only the resource ($1) and candidate ids ($2) are bound.
        assert!(!predicate.contains('$'), "{predicate}");
        assert!(predicate.contains("candidate._id"));
    }
    let annotation = SharedResource::Annotation { id: "a".into() }.access_query();
    // Shared annotations also require read access to their dataset.
    assert!(annotation.contains("webknossos.datasets_ d WHERE d._id=a._dataset"));
    assert!(annotation.contains("candidate._organization"));
}
