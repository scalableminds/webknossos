use super::*;

#[test]
fn time_tracking_gate_matches_scala() {
    assert!(should_track_time(1, true));
    assert!(should_track_time(0, false));
    assert!(should_track_time(3, false));
    assert!(!should_track_time(0, true));
    assert!(!should_track_time(-1, true));
}

#[test]
fn report_json_accepts_scala_instant_forms_and_optional_fields() {
    let report: AnnotationUpdatesReport = serde_json::from_value(json!({
        "annotationId": "0123456789abcdef01234567",
        "timestamps": [1, "2", "1970-01-01T00:00:00.003Z"],
        "significantChangesCount": 0,
        "viewChangesCount": 2
    }))
    .unwrap();
    assert_eq!(report.timestamps, vec![1, 2, 3]);
    assert!(report.statistics.is_none() && report.user_token.is_none());
    assert!(
        serde_json::from_value::<AnnotationUpdatesReport>(json!({
            "annotationId": "0123456789abcdef01234567",
            "timestamps": [true],
            "significantChangesCount": 0,
            "viewChangesCount": 0
        }))
        .is_err()
    );
}
