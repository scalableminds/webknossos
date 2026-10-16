use super::*;

#[test]
fn log_ql_escapes_values_and_lists_levels_from_the_minimum() {
    assert_eq!(
        log_ql("http://wk", "run", "org", None, "WARNING"),
        r#"{vx_run_name="run",wk_org=~"org",wk_url="http://wk"} | json vx_task_name,level | level=~"(WARNING|ERROR|CRITICAL)""#
    );
    assert_eq!(
        log_ql("http://wk", "r\"}", "a.b", Some("t"), "unknown"),
        r#"{vx_run_name="r\"}",wk_org=~"a\\.b",wk_url="http://wk"} | json vx_task_name,level | vx_task_name="t" | level=~"(INFO|NOTICE|WARNING|ERROR|CRITICAL)""#
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
