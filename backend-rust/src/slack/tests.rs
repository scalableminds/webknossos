use super::*;
use chrono::TimeZone;

#[test]
fn config_defaults_disable_sending() {
    let config = config_from_values(&HashMap::new()).unwrap();
    assert!(config.uri.is_none());
    assert!(!config.verbose_logging_enabled);
    assert_eq!(config.public_uri, "http://localhost:9000");
    assert!(!SlackNotificationService::new(&config).is_enabled());
    let empty = HashMap::from([("WK_SLACK_NOTIFICATIONS_URI".into(), " ".into())]);
    assert!(config_from_values(&empty).unwrap().uri.is_none());
}

#[test]
fn config_parses_values_and_redacts_uri() {
    let values = HashMap::from([
        (
            "WK_SLACK_NOTIFICATIONS_URI".to_owned(),
            "https://hooks.slack.com/services/T0/B0/hooktoken".to_owned(),
        ),
        (
            "WK_SLACK_NOTIFICATIONS_VERBOSE_LOGGING_ENABLED".to_owned(),
            "true".to_owned(),
        ),
        (
            "WK_PUBLIC_URL".to_owned(),
            "https://wk.example.org/".to_owned(),
        ),
    ]);
    let config = config_from_values(&values).unwrap();
    assert!(config.uri.is_some());
    assert!(config.verbose_logging_enabled);
    assert_eq!(config.public_uri, "https://wk.example.org");
    assert!(!format!("{config:?}").contains("hooktoken"));
    let service = SlackNotificationService::new(&config);
    assert!(service.is_enabled());
    assert!(!format!("{service:?}").contains("hooktoken"));

    for (key, value) in [
        ("WK_SLACK_NOTIFICATIONS_URI", "not a url"),
        ("WK_SLACK_NOTIFICATIONS_URI", "ftp://example.org/hook"),
        ("WK_SLACK_NOTIFICATIONS_VERBOSE_LOGGING_ENABLED", "yes"),
    ] {
        let values = HashMap::from([(key.to_owned(), value.to_owned())]);
        assert!(config_from_values(&values).is_err(), "{key}={value}");
    }
}

#[test]
fn messages_match_scala_format() {
    let body = payload(attachment(
        "WEBKNOSSOS at http://localhost:9000",
        "Startup",
        "WEBKNOSSOS version `1.0` started",
        COLOR_INFO,
    ));
    // Key order is irrelevant to Slack (the main crate has no serde_json preserve_order).
    let expected: Value = serde_json::from_str(
            r##"{"attachments":[{"title":"Startup reported from WEBKNOSSOS at http://localhost:9000","text":"WEBKNOSSOS version `1.0` started","color":"#333ccc"}]}"##,
        )
        .unwrap();
    assert_eq!(body, expected);
    assert_eq!(
        [COLOR_WARN, COLOR_INFO, COLOR_SUCCESS, COLOR_ERROR],
        ["#ff8a00", "#333ccc", "#049b4a", "#e10000"]
    );
}

#[test]
fn rate_limit_is_a_fixed_window_of_thirty_per_minute() {
    let start = Instant::now();
    let mut limiter = RateLimiter::default();
    for _ in 0..30 {
        assert!(limiter.test_and_set(start));
    }
    assert!(!limiter.test_and_set(start));
    // Exactly one interval later the window is still running (strict `>`).
    assert!(!limiter.test_and_set(start + RATE_LIMIT_INTERVAL));
    assert_eq!(limiter.sent_since_reset(), 30);
    let later = start + RATE_LIMIT_INTERVAL + Duration::from_millis(1);
    assert!(limiter.test_and_set(later));
    assert_eq!(limiter.sent_since_reset(), 1);
    // The new window starts at `later`, not at the old window's end.
    for _ in 0..29 {
        assert!(limiter.test_and_set(later + Duration::from_secs(59)));
    }
    assert!(!limiter.test_and_set(later + Duration::from_secs(60)));
    assert!(limiter.test_and_set(later + Duration::from_secs(61)));
}

#[test]
fn format_duration_matches_scala_formatter() {
    for (millis, expected) in [
        (0, "0ms"),
        (999, "999ms"),
        (-500, "-500ms"),
        (1000, "1s"),
        (1500, "1.5s"),
        (1234, "1.23s"),
        (1999, "1s"), // Scala quirk: centis rounds to 100 % 100 = 0
        (59994, "59.99s"),
        (59995, "1m"),
        (61_000, "1m 1s"),
        (3_599_600, "1h"),
        (3_661_000, "1h 1m 1s"),
        (86_400_000, "1 day"),
        (
            2 * 86_400_000 + 3 * 3_600_000 + 4 * 60_000 + 5_000,
            "2 days 3h 4m",
        ),
        (86_399_600, "1 day"),
    ] {
        assert_eq!(format_duration(millis), expected, "{millis}");
    }
}

#[test]
fn job_labels_match_job_service() {
    let at = |s: i64| Utc.timestamp_millis_opt(s * 1000).unwrap();
    assert_eq!(job_duration_label(at(0), None, None, None), "");
    assert_eq!(job_duration_label(at(0), Some(at(5)), None, None), "");
    assert_eq!(
        job_duration_label(at(0), Some(at(5)), Some(at(70)), None),
        " after waiting 5s and running 1m 5s"
    );
    assert_eq!(
        job_duration_label(at(0), Some(at(5)), Some(at(7)), Some(at(3))),
        " after waiting 2s and running 2s"
    );
    assert_eq!(result_link_slack_formatted(None), "");
    assert_eq!(
        result_link_slack_formatted(Some("http://wk/datasets/1")),
        " <http://wk/datasets/1|Result>"
    );
    assert_eq!(workflow_link_slack_formatted("http://wk", None), "");
    assert_eq!(
        workflow_link_slack_formatted("http://wk", Some("abc")),
        " <http://wk/workflows/abc|Workflow Report>"
    );
}

#[test]
fn heartbeat_label_matches_worker_service() {
    let at = |millis: i64| Utc.timestamp_millis_opt(millis).unwrap();
    assert_eq!(
        format_heartbeat(at(1_700_000_000_000), at(1_700_000_125_000)),
        "Last heartbeat was at 2023-11-14T22:13:20Z (2m 5s ago)"
    );
    // ISO_INSTANT prints milliseconds only when non-zero; micros are cut.
    let micros = Utc.timestamp_micros(1_700_000_000_123_456).unwrap();
    assert_eq!(
        format_heartbeat(micros, at(1_700_000_000_623)),
        "Last heartbeat was at 2023-11-14T22:13:20.123Z (500ms ago)"
    );
}

#[test]
fn disabled_service_never_spawns() {
    assert!(!global().is_enabled());
    let service = SlackNotificationService::default();
    assert!(service.send_message("t", "m", COLOR_INFO).is_none());
}
