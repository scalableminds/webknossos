use super::*;

#[test]
fn log_ql_escapes_values_and_lists_levels_from_the_minimum() {
    assert_eq!(
        log_ql("http://wk", "run", "org", None, "WARNING"),
        r#"{vx_run_name="run",wk_org="org",wk_url="http://wk"} | json vx_task_name,level | level=~"(WARNING|ERROR|CRITICAL)""#
    );
    // The organization is matched exactly, not as a regular expression.
    assert_eq!(
        log_ql("http://wk", "r\"}", "a.b", Some("t"), "unknown"),
        r#"{vx_run_name="r\"}",wk_org="a.b",wk_url="http://wk"} | json vx_task_name,level | vx_task_name="t" | level=~"(INFO|NOTICE|WARNING|ERROR|CRITICAL)""#
    );
    assert_eq!(
        log_ql("http://\"wk", "r", "o", Some("t\"}\n\\"), "INFO"),
        r#"{vx_run_name="r",wk_org="o",wk_url="http://\"wk"} | json vx_task_name,level | vx_task_name="t\"}\n\\" | level=~"(INFO|NOTICE|WARNING|ERROR|CRITICAL)""#
    );
}

#[test]
fn instants_and_timestamps_follow_scala() {
    assert_eq!(iso_instant(0), "1970-01-01T00:00:00Z");
    assert_eq!(iso_instant(1_500), "1970-01-01T00:00:01.500Z");
    assert_eq!(log_timestamp("1970-01-01T00:00:01.5Z"), Some(1_500));
    assert_eq!(log_timestamp("1234Z"), None);
    assert!(log_timestamp("2024-01-01T10:00:00.123").is_some());
    assert_eq!(log_timestamp("garbage"), None);
}

#[test]
fn local_log_timestamps_use_the_24_hour_clock_in_the_system_zone() {
    let expected = |hour, nanos| {
        Local
            .with_ymd_and_hms(2024, 2, 8, hour, 50, 59)
            .earliest()
            .map(|t| t.timestamp_millis() + i64::from(nanos / 1_000_000))
    };
    for (literal, hour, nanos) in [
        ("2024-02-08T00:50:59.123", 0, 123_000_000),
        ("2024-02-08T10:50:59.123", 10, 123_000_000),
        ("2024-02-08T12:50:59.123", 12, 123_000_000),
        ("2024-02-08T13:50:59.123", 13, 123_000_000),
        ("2024-02-08T12:50:59.123456", 12, 123_000_000),
        ("2024-02-08T12:50:59", 12, 0),
    ] {
        assert_eq!(
            log_timestamp(literal),
            expected(hour, nanos),
            "for {literal}"
        );
    }
}

#[test]
fn query_responses_merge_labels_and_sort() {
    let body = json!({"data": {"result": [
        {"stream": {"vx_run_name": "r"}, "values": [
            ["3000000000", "{\"message\":\"b\"}"],
            ["1000000000", "{\"message\":\"a\"}"]
        ]}
    ]}});
    let entries = parse_query_response(body.to_string().as_bytes()).unwrap();
    assert_eq!(entries[0]["message"], "a");
    assert_eq!(entries[0]["timestamp"], 1000);
    assert_eq!(entries[1]["vx_run_name"], "r");
    assert!(parse_query_response(b"{\"data\":{}}").is_none());
}
