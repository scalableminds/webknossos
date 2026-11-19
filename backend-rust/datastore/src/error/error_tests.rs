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
fn param_failures_show_their_status_in_every_chain_entry() {
    // Scala (live): Failure("Failed RPC …") ~> 400 ?~> "inner" ?~> "outer"; `ParamFailure ?~>`
    // keeps the param, and `formatOneFailure` renders `msg + " " + param`.
    let error = DsError::failure("Failed RPC 1: POST /x. Response: 400 '{}'")
        .with_param_status(StatusCode::BAD_REQUEST)
        .wrap("inner")
        .wrap("outer");
    assert_eq!(
        error.body_at(UNIX_EPOCH),
        serde_json::json!({"messages": [
            {"error": "outer"},
            {"chain": "[Server Time 1970-01-01T00:00:00Z] inner 400 <~ Failed RPC 1: POST /x. Response: 400 '{}' 400"}
        ]})
    );
    // Scala `ParamFailure ~> 404` nests the failure; a plain failure only gets the status.
    // Live: `datasetCache.getById(id) ?~> notFound ~> NOT_FOUND` after a failed datasource RPC.
    let nested = error.with_param_status(StatusCode::NOT_FOUND);
    assert_eq!(nested.status, StatusCode::NOT_FOUND);
    assert_eq!(
        nested.chain,
        [
            "outer 400",
            "inner 400",
            "Failed RPC 1: POST /x. Response: 400 '{}' 400"
        ]
    );
    let plain = DsError::failure("a").with_param_status(StatusCode::NOT_FOUND);
    assert!(plain.chain.is_empty());
    assert_eq!(plain.wrap("b").chain, ["a 404"]);
    // Statuses set with `with_status` are not params.
    let plain = DsError::failure("a")
        .with_status(StatusCode::FORBIDDEN)
        .wrap("b");
    assert_eq!(plain.chain, ["a"]);
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
