use super::parse_remap_segment_ids;

#[test]
fn remap_segment_ids_follows_play_option_boolean_binder() {
    assert!(parse_remap_segment_ids(None).unwrap());
    assert!(parse_remap_segment_ids(Some("other=false")).unwrap());
    assert!(!parse_remap_segment_ids(Some("remapSegmentIds=false")).unwrap());
    assert!(!parse_remap_segment_ids(Some("remapSegmentIds=%200%20")).unwrap());
    assert!(parse_remap_segment_ids(Some("remapSegmentIds=2&remapSegmentIds=0")).unwrap());
    assert_eq!(
        parse_remap_segment_ids(Some("remapSegmentIds=yes"))
            .unwrap_err()
            .message,
        "Cannot parse parameter remapSegmentIds as Boolean: should be true, false, 0 or 1"
    );
}
