
use super::*;

fn cwd() -> PathBuf {
    PathBuf::from("/srv/wk")
}

fn load(pairs: &[(&str, &str)]) -> Result<DatastoreConfig, ConfigError> {
    let values = pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    DatastoreConfig::from_values(&values, &cwd())
}

#[test]
fn defaults_match_standalone_datastore_conf() {
    let config = DatastoreConfig::defaults(&cwd());
    assert_eq!(config.http.uri, "http://localhost:9090");
    assert_eq!(config.http.port, 9090);
    assert_eq!(config.http.address.to_string(), "0.0.0.0");
    assert_eq!(config.http.request_timeout, Duration::from_secs(10_000));
    assert_eq!(config.http.max_memory_buffer, 250 << 20);
    assert_eq!(config.http.max_disk_buffer, 1 << 30);
    assert_eq!(config.key.expose(), "something-secur3");
    assert!(config.uses_default_key());
    assert_eq!(config.name, "standalone-9090");
    assert_eq!(config.webknossos.uri, "http://localhost:9000");
    assert_eq!(config.webknossos.ping_interval, Duration::from_secs(600));
    assert_eq!(
        config.base_directories,
        vec![BaseDirectory {
            path: "/srv/wk/binaryData".into(),
            is_remote: false,
            organization_id: None,
            allows_upload: true,
            do_scan: true,
        }]
    );
    assert!(config.local_directory_whitelist.is_empty());
    assert!(!config.write_virtual_datasets_mirror);
    assert!(config.watch_file_system.enabled);
    assert_eq!(config.watch_file_system.interval, Duration::from_secs(60));
    assert_eq!(
        config.watch_file_system.initial_delay,
        Duration::from_secs(5)
    );
    assert!(!config.upload_delete_temporary_files_after_upload);
    assert_eq!(config.cache.mapping_max_entries, 5);
    assert_eq!(
        config.cache.image_array_chunks_max_size_bytes,
        2_000_000_000
    );
    assert_eq!(config.cache.agglomerate_file.max_file_handle_entries, 15);
    assert_eq!(
        config.cache.agglomerate_file.max_segment_id_entries,
        625_000
    );
    assert_eq!(config.cache.agglomerate_file.block_size, 512);
    assert_eq!(
        config.cache.agglomerate_file.cumsum_max_reader_range,
        1_310_720
    );
    assert_eq!(config.ad_hoc_mesh.timeout, Duration::from_secs(30));
    assert_eq!(config.ad_hoc_mesh.actor_pool_size, 8);
    assert_eq!(config.redis.authority(), "localhost:6379");
    assert_eq!(config.agglomerate_tree_max_edges, 1_000_000);
    assert_eq!(config.agglomerate_graph_max_edges, 10_000_000);
    assert!(config.data_vault_credentials.is_empty());
    assert_eq!(config.skipped_data_vault_credentials, 0);
    assert!(config.slack_notifications.uri.expose().is_empty());
    assert!(!config.slack_notifications.verbose_logging_enabled);
}

#[test]
fn overrides_are_parsed() {
    let config = load(&[
            ("WK_DS_HTTP_PORT", "9191"),
            ("WK_DS_HTTP_URI", "https://ds.example.org/"),
            ("WK_DS_HTTP_ADDRESS", "127.0.0.1"),
            ("WK_DS_KEY", "k3y"),
            ("WK_DS_NAME", "ds-1"),
            ("WK_DS_WEBKNOSSOS_PING_INTERVAL", "2 hours"),
            ("WK_DS_WATCH_FILE_SYSTEM_ENABLED", "off"),
            ("WK_DS_WATCH_FILE_SYSTEM_INITIAL_DELAY", "0"),
            ("WK_DS_AD_HOC_MESH_TIMEOUT", "1500ms"),
            ("WK_DS_PARSER_MAX_DISK_BUFFER", "2GB"),
            ("WK_DS_REDIS_ADDRESS", "redis"),
            ("WK_DS_REDIS_PORT", "6380"),
            ("WK_DS_LOCAL_DIRECTORY_WHITELIST", r#"["/data/a","/data/b"]"#),
            (
                "WK_DS_BASE_DIRECTORIES",
                r#"[{"path":"./data/../binaryData/","organizationId":null,"allowsUpload":true,"doScan":true},
                    {"path":"s3://minio:9000/bucket//orga/","organizationId":"orga","allowsUpload":true,"doScan":false},
                    {"path":"file:///mnt/x","allowsUpload":false,"doScan":true}]"#,
            ),
        ])
        .unwrap();
    assert_eq!(config.http.port, 9191);
    assert_eq!(config.http.uri, "https://ds.example.org");
    assert!(!config.uses_default_key());
    assert_eq!(config.webknossos.ping_interval, Duration::from_secs(7200));
    assert!(!config.watch_file_system.enabled);
    assert!(config.watch_file_system.initial_delay.is_zero());
    assert_eq!(config.ad_hoc_mesh.timeout, Duration::from_millis(1500));
    assert_eq!(config.http.max_disk_buffer, 2_000_000_000);
    assert_eq!(config.redis.authority(), "redis:6380");
    assert_eq!(config.local_directory_whitelist, ["/data/a", "/data/b"]);
    let paths: Vec<_> = config
        .base_directories
        .iter()
        .map(|d| (d.path.as_str(), d.is_remote, d.organization_id.as_deref()))
        .collect();
    assert_eq!(
        paths,
        [
            ("/srv/wk/binaryData", false, None),
            ("s3://minio:9000/bucket/orga", true, Some("orga")),
            ("/mnt/x", false, None),
        ]
    );
}

#[test]
fn scheduler_intervals_are_validated_before_startup() {
    assert!(load(&[("WK_DS_WEBKNOSSOS_PING_INTERVAL", "99ms")]).is_err());
    assert!(load(&[("WK_DS_WEBKNOSSOS_PING_INTERVAL", "100ms")]).is_ok());
    assert!(load(&[("WK_DS_WATCH_FILE_SYSTEM_INTERVAL", "99ms")]).is_err());
    assert!(load(&[("WK_DS_WATCH_FILE_SYSTEM_INTERVAL", "100ms")]).is_ok());
    assert!(
        load(&[
            ("WK_DS_WATCH_FILE_SYSTEM_ENABLED", "false"),
            ("WK_DS_WATCH_FILE_SYSTEM_INTERVAL", "1ms"),
        ])
        .is_ok()
    );
}

#[test]
fn invalid_values_are_rejected() {
    for (name, value) in [
        ("WK_DS_HTTP_PORT", "0"),
        ("WK_DS_HTTP_PORT", "70000"),
        ("WK_DS_HTTP_URI", "localhost:9090"),
        ("WK_DS_WEBKNOSSOS_URI", "ftp://wk"),
        ("WK_DS_KEY", ""),
        ("WK_DS_NAME", ""),
        ("WK_DS_WEBKNOSSOS_PING_INTERVAL", "0s"),
        ("WK_DS_WEBKNOSSOS_PING_INTERVAL", "10 fortnights"),
        ("WK_DS_WATCH_FILE_SYSTEM_ENABLED", "maybe"),
        ("WK_DS_CACHE_MAPPING_MAX_ENTRIES", "-1"),
        ("WK_DS_AD_HOC_MESH_ACTOR_POOL_SIZE", "0"),
        ("WK_DS_PARSER_MAX_MEMORY_BUFFER", "12 parsecs"),
        ("WK_DS_REDIS_PORT", "0"),
        ("WK_DS_LOCAL_DIRECTORY_WHITELIST", "/a,/b"),
        ("WK_DS_BASE_DIRECTORIES", "[]"),
        (
            "WK_DS_BASE_DIRECTORIES",
            r#"[{"path":"x","allowsUpload":true}]"#,
        ),
        (
            "WK_DS_BASE_DIRECTORIES",
            r#"[{"path":"s3://e/b","allowsUpload":true,"doScan":true}]"#,
        ),
        (
            "WK_DS_BASE_DIRECTORIES",
            r#"[{"path":"/a","allowsUpload":true,"doScan":true},{"path":"/a/b","allowsUpload":true,"doScan":true}]"#,
        ),
        (
            "WK_DS_BASE_DIRECTORIES",
            r#"[{"path":"file://relative","allowsUpload":true,"doScan":true}]"#,
        ),
        ("WK_DS_DATA_VAULTS_CREDENTIALS", "{}"),
        ("WK_DS_SLACK_NOTIFICATIONS_URI", "not a url"),
    ] {
        assert!(
            load(&[(name, value)]).is_err(),
            "{name}={value} must be rejected"
        );
    }
}

#[test]
fn sibling_base_directories_with_common_prefix_are_not_nested() {
    let config = load(&[(
            "WK_DS_BASE_DIRECTORIES",
            r#"[{"path":"/data/a","allowsUpload":true,"doScan":true},{"path":"/data/ab","allowsUpload":true,"doScan":true}]"#,
        )])
        .unwrap();
    assert_eq!(config.base_directories.len(), 2);
}

#[test]
fn credentials_follow_scala_reader_and_are_redacted() {
    let config = load(&[(
            "WK_DS_DATA_VAULTS_CREDENTIALS",
            r#"[{"type":"S3AccessKey","name":"s3://bucket","identifier":"AKIA","secret":"s3-secret-value"},
                {"type":"HttpBasicAuth","name":"https://host","identifier":"user","secret":"basic-secret-value"},
                {"type":"GoogleServiceAccount","name":"gs://b","secret":"{\"private_key\":\"gcs-secret-value\"}"},
                {"type":"GoogleServiceAccount","name":"gs://c","secret":"not json"},
                {"type":"HttpToken","name":"https://t","secret":"token-secret-value"},
                {"type":"S3AccessKey","name":"s3://missing-secret","identifier":"x"},
                {"type":"Unknown","name":"x","secret":"y"},
                {"name":"no-type","secret":"z"}]"#,
        )])
        .unwrap();
    assert_eq!(config.data_vault_credentials.len(), 4);
    assert_eq!(config.skipped_data_vault_credentials, 4);
    assert_eq!(
        config.data_vault_credentials[0],
        DataVaultCredential::S3AccessKey {
            name: "s3://bucket".into(),
            key_id: "AKIA".into(),
            secret: Secret::new("s3-secret-value"),
        }
    );
    let debug = format!("{config:?}");
    for secret in [
        "s3-secret-value",
        "basic-secret-value",
        "gcs-secret-value",
        "token-secret-value",
        "something-secur3",
    ] {
        assert!(!debug.contains(secret), "Debug output leaks {secret}");
    }
    assert!(debug.contains("[redacted]"));
}

#[test]
fn credential_parse_errors_do_not_echo_input() {
    let error = load(&[(
        "WK_DS_DATA_VAULTS_CREDENTIALS",
        r#"[{"type":"S3AccessKey","secret":12345678}]"#,
    )])
    .unwrap_err();
    assert!(!error.0.contains("12345678"));
}

#[test]
fn slack_uri_is_redacted() {
    let config = load(&[(
        "WK_DS_SLACK_NOTIFICATIONS_URI",
        "https://hooks.slack.com/services/T000/B000/slack-secret-token",
    )])
    .unwrap();
    let debug = format!("{config:?}");
    assert!(!debug.contains("slack-secret-token"));
    assert!(debug.contains("uri_configured: true"));
}

#[test]
fn hocon_durations_and_sizes() {
    assert_eq!(parse_duration("10 minutes"), Some(Duration::from_secs(600)));
    assert_eq!(parse_duration("1 minute"), Some(Duration::from_secs(60)));
    assert_eq!(parse_duration("2 hours"), Some(Duration::from_secs(7200)));
    assert_eq!(parse_duration("10000s"), Some(Duration::from_secs(10_000)));
    assert_eq!(parse_duration("250"), Some(Duration::from_millis(250)));
    assert_eq!(parse_duration("1.5 s"), Some(Duration::from_millis(1500)));
    assert_eq!(parse_duration("1 d"), Some(Duration::from_secs(86_400)));
    assert_eq!(parse_duration("s"), None);
    assert_eq!(parse_duration("5 lightyears"), None);
    assert_eq!(parse_size("250M"), Some(250 * 1024 * 1024));
    assert_eq!(parse_size("1G"), Some(1 << 30));
    assert_eq!(parse_size("1GB"), Some(1_000_000_000));
    assert_eq!(parse_size("512"), Some(512));
    assert_eq!(parse_size("99999999999T"), None);
    assert_eq!(parse_bool(" yes "), Some(true));
    assert_eq!(parse_bool("1"), None);
}
