use super::parse_timestamp;

#[test]
fn timestamp_follows_play_long_binder() {
    assert_eq!(parse_timestamp(Some("timestamp=123")).unwrap(), 123);
    assert_eq!(
        parse_timestamp(Some("timestamp=-5&timestamp=7")).unwrap(),
        -5
    );
    assert_eq!(parse_timestamp(Some("timestamp=%2B9")).unwrap(), 9);
    assert_eq!(
        parse_timestamp(None).unwrap_err().message,
        "Missing parameter: timestamp"
    );
    for bad in ["abc", "", "1.5", " 1", "9223372036854775808"] {
        let query = format!("timestamp={}", bad.replace(' ', "%20"));
        assert_eq!(
            parse_timestamp(Some(&query)).unwrap_err().message,
            format!("Cannot parse parameter timestamp as Long: For input string: \"{bad}\""),
        );
    }
}
