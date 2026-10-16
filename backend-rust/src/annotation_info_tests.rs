use super::parse_optional_timestamp;

#[test]
fn optional_timestamp_follows_play_option_long_binder() {
    assert_eq!(parse_optional_timestamp(None).unwrap(), None);
    assert_eq!(
        parse_optional_timestamp(Some("sharingToken=x")).unwrap(),
        None
    );
    assert_eq!(
        parse_optional_timestamp(Some("timestamp=5&timestamp=7")).unwrap(),
        Some(5)
    );
    assert_eq!(
        parse_optional_timestamp(Some("timestamp=abc"))
            .unwrap_err()
            .message,
        "Cannot parse parameter timestamp as Long: For input string: \"abc\""
    );
}
