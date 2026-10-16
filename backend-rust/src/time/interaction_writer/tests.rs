use super::*;
use axum::http::StatusCode;

#[test]
fn over_limit_mail_matches_scala_subject_recipient_and_link() {
    let notifier = OverLimitNotifier::new(MailSender::default(), "https://wk.example/");
    assert_eq!(notifier.public_uri, "https://wk.example");
    let mail = over_limit_mail(
        "Jane Ann",
        "Van Doe",
        "Proj",
        "t1",
        "a1",
        "owner@example.test",
        &notifier.public_uri,
    );
    assert_eq!(mail.recipients, vec!["owner@example.test".to_owned()]);
    assert_eq!(
        mail.subject,
        "WEBKNOSSOS | Time limit reached. jvan_doe in Proj"
    );
    assert!(mail.body_html.contains("User: Jane Ann Van Doe"));
    assert!(mail.body_html.contains("Task: t1"));
    assert!(
        mail.body_html
            .contains("https://wk.example/annotations/Task/a1")
    );
    // Empty first name: take(1) of "" is "".
    assert!(
        over_limit_mail("", "X", "P", "t", "a", "o", "u")
            .subject
            .ends_with(". x in P")
    );
}

#[test]
fn error_mapping_matches_scala_statuses() {
    let status = |e| ApiError::from(e).status;
    assert_eq!(
        status(TimeInteractionError::TimestampNotStorable { millis: 1 }),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        status(TimeInteractionError::DurationOutOfRange {
            from_millis: 0,
            to_millis: 1
        }),
        StatusCode::INTERNAL_SERVER_ERROR
    );
    assert_eq!(
        status(TimeInteractionError::NewSpanIdCount {
            expected: 1,
            actual: 0
        }),
        StatusCode::INTERNAL_SERVER_ERROR
    );
}
