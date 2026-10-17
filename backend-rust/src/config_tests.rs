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
#[test]
fn database_session_time_zone_follows_jvm_resolution() {
    use std::path::PathBuf;
    let link = || Some(PathBuf::from("/var/db/timezone/zoneinfo/Europe/Berlin"));
    let explicit = "America/New_York".to_owned();
    assert_eq!(
        session_time_zone(Some(&explicit), None, link()).unwrap(),
        "America/New_York"
    );
    let tz = ":Asia/Tokyo".to_owned();
    assert_eq!(
        session_time_zone(None, Some(&tz), link()).unwrap(),
        "Asia/Tokyo"
    );
    assert_eq!(
        session_time_zone(None, None, link()).unwrap(),
        "Europe/Berlin"
    );
    assert_eq!(session_time_zone(None, None, None).unwrap(), "UTC");
    let injection = "UTC'; DROP TABLE x; --".to_owned();
    assert!(session_time_zone(Some(&injection), None, None).is_err());
    assert_eq!(
        session_time_zone(None, Some(&injection), None).unwrap(),
        "UTC"
    );
    let mut configured = values();
    configured.insert("WK_DB_TIME_ZONE".into(), "Etc/UTC".into());
    let config = Config::from_values(configured).unwrap();
    assert_eq!(
        config.database.session_time_zone.as_deref(),
        Some("Etc/UTC")
    );
}

#[test]
fn env_reads_typed_values_with_named_errors() {
    let values: HashMap<String, String> = [
        ("FLAG", " true "),
        ("ZERO", "0"),
        ("TOO_LONG", "2147483648"),
        ("BAD", "x"),
        ("URL", "https://user@example.com/"),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_owned(), v.to_owned()))
    .collect();
    let env = Env::new(&values);
    assert!(env.bool_or("FLAG", false).unwrap());
    assert!(env.bool_or("UNSET", true).unwrap());
    assert_eq!(env.unsigned("ZERO").unwrap(), Some(0));
    assert_eq!(env.seconds("ZERO", true).unwrap(), Some(Duration::ZERO));
    for (name, error) in [
        ("BAD", env.bool("BAD").unwrap_err()),
        ("BAD", env.unsigned("BAD").unwrap_err()),
        ("ZERO", env.positive("ZERO").unwrap_err()),
        ("ZERO", env.seconds("ZERO", false).unwrap_err()),
        ("TOO_LONG", env.seconds("TOO_LONG", true).unwrap_err()),
        (
            "URL",
            env.http_url("URL", "https://user@example.com/")
                .unwrap_err(),
        ),
    ] {
        assert!(error.0.starts_with(name), "{error}");
    }
    assert!(env.http_url("URL", "https://example.com/wk").is_ok());
}
