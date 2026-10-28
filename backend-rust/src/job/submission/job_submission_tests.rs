use chrono::{TimeZone, Utc};
use serde_json::json;

use super::failure::Failure;
use super::{
    dataset_files::MESH_SUBMIT_FAILED,
    export::parse_additional_coordinates,
    params::{format_date_for_filename, json_int, parse_object_id, parse_play_boolean},
    service::{ORGANIZATION_STORAGE_EXCEEDED, STORAGE_EXCEEDED},
};
use crate::util::id::ObjectId;
use axum::http::StatusCode;

#[test]
fn play_booleans() {
    assert_eq!(parse_play_boolean(" true "), Some(true));
    assert_eq!(parse_play_boolean("0"), Some(false));
    assert_eq!(parse_play_boolean("2"), Some(true));
    assert_eq!(parse_play_boolean("yes"), None);
}

#[test]
fn object_ids_accept_either_case_and_prefixes_are_split() {
    assert_eq!(
        parse_object_id("0123456789ABCDEF01234567")
            .as_ref()
            .map(ObjectId::as_str),
        Some("0123456789abcdef01234567")
    );
    assert_eq!(parse_object_id("0123"), None);
    assert_eq!(json_int(&json!(3.0)), Some(3));
    assert_eq!(json_int(&json!(3.5)), None);
    assert_eq!(json_int(&json!(1u64 << 40)), None);
}

#[test]
fn filename_dates_use_the_week_year() {
    let date = |y, m, d| Utc.with_ymd_and_hms(y, m, d, 13, 7, 0).unwrap();
    assert_eq!(
        format_date_for_filename(date(2026, 10, 9)),
        "2026-10-09_13-07"
    );
    // Sunday 2024-12-29 starts the week containing 2025-01-01.
    assert_eq!(
        format_date_for_filename(date(2024, 12, 29)),
        "2025-12-29_13-07"
    );
    assert_eq!(
        format_date_for_filename(date(2024, 12, 28)),
        "2024-12-28_13-07"
    );
    assert_eq!(
        format_date_for_filename(date(2025, 1, 1)),
        "2025-01-01_13-07"
    );
}

#[test]
fn failure_chains_render_like_play() {
    let failure = Failure::new(ORGANIZATION_STORAGE_EXCEEDED)
        .wrap(STORAGE_EXCEEDED)
        .with_param(StatusCode::FORBIDDEN)
        .wrap(MESH_SUBMIT_FAILED);
    assert_eq!(failure.status, Some(StatusCode::FORBIDDEN));
    assert_eq!(
        failure.cause.unwrap().format_chain(),
        format!("{STORAGE_EXCEEDED} 403 <~ {ORGANIZATION_STORAGE_EXCEEDED}")
    );
    assert_eq!(
        parse_additional_coordinates(r#"[{"name":"t","value":3}]"#),
        Ok(vec![("t".into(), 3)])
    );
    assert!(parse_additional_coordinates("[{\"name\":1}]").is_err());
}
