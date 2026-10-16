use super::*;
use chrono::TimeZone;

fn bbox(values: [i32; 6]) -> BoundingBox {
    let [x, y, z, width, height, depth] = values;
    BoundingBox {
        x,
        y,
        z,
        width,
        height,
        depth,
    }
}

#[test]
fn bounding_box_division_and_union_follow_scala() {
    assert_eq!(
        bbox([5, -5, 7, 10, 3, 1]).divide([2, 2, 4]),
        Some(bbox([2, -2, 1, 5, 2, 1]))
    );
    assert_eq!(bbox([0, 0, 0, 1, 1, 1]).divide([0, 1, 1]), None);
    // MathUtils.ceilDiv rounds the magnitude up, then applies the sign.
    assert_eq!(ceil_div(-3, 2), -2);
    assert_eq!(ceil_div(0, 4), 0);
    assert_eq!(
        bbox([0, 0, 0, 10, 10, 10]).union(&bbox([5, -5, 2, 10, 2, 2])),
        bbox([0, -5, 0, 15, 15, 10])
    );
    assert_eq!(bbox([1, 2, 3, 4, 5, 6]).to_literal(), "1,2,3,4,5,6");
    assert_eq!(
        bbox([0, 0, 0, i32::MAX, i32::MAX, i32::MAX]).volume(),
        4_611_686_024_869_838_847
    );
}

#[test]
fn mags_and_play_booleans() {
    assert_eq!(parse_mag("2"), Some([2, 2, 2]));
    assert_eq!(parse_mag("-1"), Some([-1, -1, -1]));
    assert_eq!(parse_mag("1-2-4"), Some([1, 2, 4]));
    assert_eq!(parse_mag("1-2"), None);
    assert_eq!(parse_mag("1-2-4-8"), None);
    assert_eq!(parse_mag("1-+2-4"), None);
    assert_eq!(parse_play_boolean(" true "), Some(true));
    assert_eq!(parse_play_boolean("0"), Some(false));
    assert_eq!(parse_play_boolean("2"), Some(true));
    assert_eq!(parse_play_boolean("yes"), None);
}

#[test]
fn object_ids_accept_either_case_and_prefixes_are_split() {
    assert_eq!(
        parse_object_id("0123456789ABCDEF01234567").as_deref(),
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
