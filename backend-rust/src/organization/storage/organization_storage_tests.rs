use super::*;

#[test]
fn paths_resolve_like_java_nio() {
    assert_eq!(normalize("ds/./a/../mesh.hdf5"), "ds/mesh.hdf5");
    assert_eq!(normalize("ds/../../x"), "../x");
    assert!(is_local_path("/srv/a") && is_local_path("file:///srv/a"));
    assert!(!is_local_path("s3://bucket/a"));
    let mag = MagRow {
        dataset_id: ObjectId::parse("0123456789abcdef01234567").unwrap(),
        layer_name: "color".into(),
        mag_x: 2,
        mag_y: 2,
        mag_z: 2,
        path: None,
        real_path: None,
        directory_name: "ds".into(),
    };
    assert_eq!(mag_paths(&mag), ["ds/color/2", "ds/color/2-2-2"]);
}

fn values(pairs: &[(&str, &str)]) -> HashMap<String, String> {
    pairs
        .iter()
        .map(|(key, value)| ((*key).into(), (*value).into()))
        .collect()
}

#[test]
fn config_defaults_match_scala() {
    let config = config_from_values(&HashMap::new()).unwrap();
    assert_eq!(config, UsedStorageConfig::default());
    assert!(config.schedule.enabled);
    assert_eq!(config.schedule.interval, Duration::from_secs(600));
    assert_eq!(config.schedule.initial_delay, Duration::from_secs(60));
    assert_eq!(config.rescan_interval, Duration::from_secs(86_400));
    assert_eq!(config.scans_per_tick, 10);
    assert_eq!(config.pause_after_each_organization, Duration::from_secs(5));
}

#[test]
fn config_overrides() {
    let config = config_from_values(&values(&[
        ("WK_USED_STORAGE_ENABLED", "false"),
        ("WK_USED_STORAGE_TICKER_INTERVAL_SECONDS", "30"),
        ("WK_USED_STORAGE_INITIAL_DELAY_SECONDS", "0"),
        ("WK_USED_STORAGE_RESCAN_INTERVAL_SECONDS", "3600"),
        ("WK_USED_STORAGE_SCANS_PER_TICK", "0"),
        ("WK_USED_STORAGE_PAUSE_AFTER_ORGANIZATION_SECONDS", "0"),
    ]))
    .unwrap();
    assert_eq!(
        config,
        UsedStorageConfig {
            schedule: JobSchedule {
                enabled: false,
                interval: Duration::from_secs(30),
                initial_delay: Duration::ZERO,
            },
            rescan_interval: Duration::from_secs(3600),
            scans_per_tick: 0,
            pause_after_each_organization: Duration::ZERO,
        }
    );
}

#[test]
fn config_rejects_invalid_values() {
    for (key, value) in [
        ("WK_USED_STORAGE_ENABLED", "yes"),
        ("WK_USED_STORAGE_TICKER_INTERVAL_SECONDS", "0"),
        ("WK_USED_STORAGE_TICKER_INTERVAL_SECONDS", "2147483648"),
        ("WK_USED_STORAGE_INITIAL_DELAY_SECONDS", "-1"),
        ("WK_USED_STORAGE_RESCAN_INTERVAL_SECONDS", "1d"),
        ("WK_USED_STORAGE_SCANS_PER_TICK", "-5"),
        ("WK_USED_STORAGE_SCANS_PER_TICK", "2147483648"),
        ("WK_USED_STORAGE_PAUSE_AFTER_ORGANIZATION_SECONDS", "x"),
    ] {
        let error = config_from_values(&values(&[(key, value)])).unwrap_err();
        assert!(error.0.starts_with(key), "{error}");
    }
}

#[test]
fn lock_key_is_pinned_and_unique() {
    assert_eq!(advisory_lock_key(JOB_NAME), 6_145_974_474_599_947_089);
    let mut keys: Vec<i64> = crate::background::housekeeping::HousekeepingJob::ALL
        .iter()
        .map(|job| job.advisory_lock_key())
        .collect();
    keys.push(advisory_lock_key(
        crate::background::credit_ticker::JOB_NAME,
    ));
    assert!(!keys.contains(&advisory_lock_key(JOB_NAME)));
}

#[tokio::test]
async fn disabled_scan_spawns_no_job() {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgres://unused@127.0.0.1:1/unused")
        .unwrap();
    let clients =
        ServiceClients::new(crate::stores::client::ServiceClientConfig::default()).unwrap();
    let mut config = UsedStorageConfig::default();
    config.schedule.enabled = false;
    let handle = spawn(pool, clients, &config);
    assert!(handle.job_names().is_empty());
    handle.shutdown().await;
}
