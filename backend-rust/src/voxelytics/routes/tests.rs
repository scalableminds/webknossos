use super::*;

#[test]
fn instants_accept_scala_inputs() {
    assert_eq!(
        parse_instant(&json!(1500)).unwrap().timestamp_millis(),
        1500
    );
    assert_eq!(
        parse_instant(&json!("1500")).unwrap().timestamp_millis(),
        1500
    );
    assert_eq!(
        parse_instant(&json!("1970-01-01T00:00:01.5Z"))
            .unwrap()
            .timestamp_millis(),
        1500
    );
    assert!(parse_instant(&json!(1.5)).is_none());
    assert!(parse_instant(&json!(null)).is_none());
}

#[test]
fn events_are_grouped_and_validated() {
    let grouped = parse_events(vec![
        json!({"type": "RUN_HEARTBEAT", "timestamp": 1}),
        json!({"type": "RUN_STATE_CHANGE", "state": "RUNNING", "timestamp": "2"}),
    ])
    .unwrap();
    assert_eq!(grouped.heartbeats.len(), 1);
    assert_eq!(grouped.run_states[0].state, "RUNNING");
    for invalid in [
        json!({"timestamp": 1}),
        json!({"type": "OTHER"}),
        json!({"type": "RUN_STATE_CHANGE", "state": "running", "timestamp": 1}),
    ] {
        assert!(parse_events(vec![invalid]).is_err());
    }
}

#[test]
fn state_times_follow_the_event_state() {
    let t = DateTime::from_timestamp_millis(1000).unwrap();
    assert_eq!(
        state_times("RUNNING", t),
        (json!("1970-01-01T00:00:01.000Z"), Value::Null)
    );
    assert_eq!(
        state_times("FAILED", t),
        (Value::Null, json!("1970-01-01T00:00:01.000Z"))
    );
    assert_eq!(state_times("SKIPPED", t), (Value::Null, Value::Null));
}
