use super::*;
#[test]
fn rate_limit_has_strict_scala_window_boundary() {
    // A delayed first notification starts the window, rather than process startup.
    let now = Instant::now() + Duration::from_secs(59);
    let mut rate = Rate {
        reset: None,
        sent: 0,
    };
    for _ in 0..30 {
        assert!(rate.reserve(now));
    }
    assert!(!rate.reserve(now));
    assert!(!rate.reserve(now + Duration::from_secs(60)));
    assert!(rate.reserve(now + Duration::from_millis(60_001)));
    assert_eq!(rate.sent, 1);
}
#[test]
fn alert_uri_omits_credentials_and_queries() {
    assert_eq!(
        redact_uri("/data/datasets/x?token=secret&key=other"),
        "/data/datasets/x"
    );
    assert_eq!(
        redact_uri("https://user:pass@example.org/path?key=secret"),
        "https://example.org/path"
    );
}
