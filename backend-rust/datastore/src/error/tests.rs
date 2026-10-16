use super::*;
use std::time::Duration;

#[test]
fn iso_instant_matches_java_formatting() {
    assert_eq!(format_iso_instant(UNIX_EPOCH), "1970-01-01T00:00:00Z");
    let t = UNIX_EPOCH + Duration::from_millis(1_791_706_530_120);
    assert_eq!(format_iso_instant(t), "2026-10-11T08:15:30.120Z");
    let leap = UNIX_EPOCH + Duration::from_secs(951_782_400); // 2000-02-29
    assert_eq!(format_iso_instant(leap), "2000-02-29T00:00:00Z");
}

#[test]
fn plain_failure_has_only_error_message() {
    let error = DsError::failure("Something failed");
    assert_eq!(error.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        error.body_at(UNIX_EPOCH),
        serde_json::json!({"messages": [{"error": "Something failed"}]})
    );
}

#[test]
fn wrapped_failures_render_scala_chain() {
    // Scala: Fox.fromFuture(failed(e)) ?-> "Redis access failure" ?-> "Redis health check failed."
    let error = DsError::from_exception("java.io.IOException: reset")
        .wrap("Redis access failure")
        .wrap("Redis health check failed.");
    assert_eq!(
        error.body_at(UNIX_EPOCH),
        serde_json::json!({"messages": [
            {"error": "Redis health check failed."},
            {"chain": "[Server Time 1970-01-01T00:00:00Z] Redis access failure <~ java.io.IOException: reset java.io.IOException: reset"}
        ]})
    );
}

#[test]
fn explicit_status_survives_wrapping_and_empty_is_404() {
    let error = DsError::failure("inner")
        .with_status(StatusCode::FORBIDDEN)
        .wrap("outer");
    assert_eq!(error.status, StatusCode::FORBIDDEN);
    assert_eq!(error.chain, ["inner"]);
    let empty = DsError::empty();
    assert_eq!(empty.status, StatusCode::NOT_FOUND);
    assert_eq!(empty.message, MSG_NOT_FOUND);
}
