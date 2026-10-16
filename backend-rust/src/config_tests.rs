use super::*;
fn values() -> HashMap<String, String> {
    HashMap::from([(
        "DATABASE_URL".into(),
        "postgres://user:secret@localhost/wk".into(),
    )])
}
#[test]
fn config_defaults_and_secrets_are_safe() {
    let mut configured = values();
    configured.insert("WK_RPC_TOKEN".into(), "rpc-signing-secret".into());
    let config = Config::from_values(configured).unwrap();
    assert_eq!(config.bind, "127.0.0.1:9001".parse().unwrap());
    assert_eq!(config.annotation_mutex_expiry, Duration::from_secs(120));
    assert_eq!(config.time_tracking, TimeTrackingConfig::default());
    assert!(!format!("{config:?}").contains("secret"));
    assert!(Config::from_values(HashMap::new()).is_err());
}
#[test]
fn invalid_pool_bounds_and_limits_are_rejected() {
    for (key, value) in [
        ("WK_DB_MAX_CONNECTIONS", "0"),
        ("WK_DB_MIN_CONNECTIONS", "11"),
        ("WK_BODY_LIMIT_BYTES", "0"),
        ("WK_REQUEST_TIMEOUT_SECONDS", "-1"),
        ("WK_BIND", "localhost"),
        ("WK_PUBLIC_URL", "javascript:alert(1)"),
        ("WK_PUBLIC_URL", "http://user:password@localhost"),
        ("DATABASE_URL", "sqlite://db"),
        ("WK_AUTH_TOKEN_EXPIRY_SECONDS", "2147483648"),
        ("WK_AUTH_TOKEN_IDLE_TIMEOUT_SECONDS", "0"),
        ("WK_DATASTORE_TOKEN_EXPIRY_SECONDS", "0"),
        ("WK_ANNOTATION_MUTEX_EXPIRY_SECONDS", "0"),
        ("WK_ANNOTATION_MUTEX_EXPIRY_SECONDS", "-1"),
        ("WK_ANNOTATION_MUTEX_EXPIRY_SECONDS", "2147483648"),
        ("WK_TIME_TRACKING_PAUSE_MILLIS", "0"),
        ("WK_TIME_TRACKING_ONLY_WITH_SIGNIFICANT_CHANGES", "yes"),
        ("WK_JOBS_ENABLED", "yes"),
        ("WK_PASSKEYS_ENABLED", "1"),
        ("WK_RPC_TOKEN", ""),
        ("WK_RPC_TOKEN", "token with spaces"),
        ("WK_RPC_TIMEOUT_SECONDS", "0"),
        ("WK_RPC_CONNECT_TIMEOUT_SECONDS", "0"),
        ("WK_RPC_MAX_RESPONSE_BYTES", "0"),
        ("WK_VOXELYTICS_STALE_TIMEOUT_SECONDS", "0"),
        ("WK_VOXELYTICS_LOKI_URI", "ftp://loki"),
        ("WK_VOXELYTICS_LOKI_URI", "http://user:pw@loki"),
    ] {
        let mut v = values();
        v.insert(key.into(), value.into());
        assert!(Config::from_values(v).is_err(), "{key}={value}");
    }
}
