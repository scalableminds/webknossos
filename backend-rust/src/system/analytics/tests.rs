use super::*;

#[test]
fn well_known_uris_follow_java_split() {
    let parse = |entries: &[&str]| {
        parse_well_known_uris(&entries.iter().map(|e| e.to_string()).collect::<Vec<_>>())
    };
    let parsed = parse(&["https://a|k1", "https://b|k2|extra", "|k3"]).unwrap();
    assert_eq!(parsed["https://a"], "k1");
    assert_eq!(parsed["https://b"], "k2");
    assert_eq!(parsed[""], "k3");
    assert!(parse(&["https://a"]).is_none());
    assert!(parse(&["https://a|"]).is_none());
    assert!(parse(&[]).unwrap().is_empty());
}

#[test]
fn ingest_reads_both_casings() {
    let snake = json!({"events": [{
            "event_type": "x", "user_id": "5c766bec6c01006c018c7459", "time": "1970-01-01T00:00:01Z",
            "user_properties": {"organization_id": "o", "is_organization_admin": true,
                "is_superuser": false, "webknossos_uri": "u"},
            "event_properties": {"a": 1}, "session_id": 5}], "api_key": "k"});
    let (events, key) = read_ingest(&snake).unwrap();
    assert_eq!(key, "k");
    assert_eq!(events[0].time.timestamp_millis(), 1000);
    let camel = json!({"events": [{
            "eventType": "x", "userId": "5c766bec6c01006c018c7459", "time": "1000",
            "userProperties": {"organizationId": "o", "isOrganizationAdmin": true,
                "isSuperUser": false, "webknossosUri": "u"},
            "eventProperties": {"a": 1}, "sessionId": 5}], "apiKey": "k"});
    assert_eq!(read_ingest(&camel).unwrap().0, events);
    let mistyped = json!({"events": [], "api_key": 1, "apiKey": "k"});
    assert!(read_ingest(&mistyped).is_err());
    let bad_id = json!({"events": [{"eventType": "x", "userId": "nope"}], "apiKey": "k"});
    assert!(read_ingest(&bad_id).is_err());
}

#[test]
fn heartbeat_schedule_follows_scala_and_analytics_config() {
    let mut config = MiscConfig::default();
    let schedule = heartbeat_schedule(&config);
    assert!(schedule.enabled, "default forwarding URI enables it");
    assert_eq!(schedule.interval, Duration::from_secs(86_400));
    assert_eq!(schedule.initial_delay, Duration::from_secs(10));
    config.analytics.uri = String::new();
    assert!(!heartbeat_schedule(&config).enabled);
    config.analytics.save_to_database_enabled = true;
    assert!(heartbeat_schedule(&config).enabled);
}

#[test]
fn heartbeat_lock_key_is_pinned_and_unique() {
    let key = advisory_lock_key(HEARTBEAT_JOB_NAME);
    assert_eq!(key, -3_148_850_142_407_920_231);
    let mut others: Vec<i64> = crate::background::housekeeping::HousekeepingJob::ALL
        .iter()
        .map(|job| job.advisory_lock_key())
        .collect();
    others.push(advisory_lock_key(
        crate::background::credit_ticker::JOB_NAME,
    ));
    others.push(advisory_lock_key(crate::organization::storage::JOB_NAME));
    others.push(advisory_lock_key("worker-liveness"));
    assert!(!others.contains(&key));
}

#[tokio::test]
async fn disabled_heartbeat_spawns_no_job() {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgres://unused@127.0.0.1:1/unused")
        .unwrap();
    let mut config = MiscConfig::default();
    config.analytics.uri = String::new();
    let handle = spawn_heartbeat(pool, MiscState::new(config));
    assert!(handle.job_names().is_empty());
    handle.shutdown().await;
}

#[test]
fn sessions_expire_after_pause() {
    let misc = MiscState::default();
    let start = DateTime::from_timestamp_millis(10_000_000).unwrap();
    let first = refresh_session_id(&misc, "m", start);
    assert_eq!(first, start.timestamp_millis());
    let later = start + chrono::Duration::minutes(29);
    assert_eq!(refresh_session_id(&misc, "m", later), first);
    let much_later = later + chrono::Duration::minutes(31);
    assert_eq!(
        refresh_session_id(&misc, "m", much_later),
        much_later.timestamp_millis()
    );
}
