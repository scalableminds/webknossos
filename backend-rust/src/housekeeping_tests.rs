use super::*;

fn values(pairs: &[(&str, &str)]) -> HashMap<String, String> {
    pairs
        .iter()
        .map(|(key, value)| ((*key).into(), (*value).into()))
        .collect()
}

#[test]
fn defaults_match_scala() {
    let config = config_from_values(&HashMap::new()).unwrap();
    assert_eq!(config, HousekeepingConfig::default());
    assert!(config.enabled);
    for job in HousekeepingJob::ALL {
        let schedule = config.schedule(job);
        assert!(schedule.enabled);
        if job == HousekeepingJob::ExpiredAnnotationMutexes {
            assert_eq!(schedule.interval, Duration::from_secs(3600));
            assert_eq!(schedule.initial_delay, Duration::from_secs(10));
        } else {
            assert_eq!(schedule.interval, DAY);
            assert_eq!(schedule.initial_delay, DAY);
        }
    }
}

#[test]
fn overrides_and_datastore_expiry_default() {
    let config = config_from_values(&values(&[
        ("WK_DATASTORE_TOKEN_EXPIRY_SECONDS", "600"),
        ("WK_HOUSEKEEPING_ENABLED", "false"),
        ("WK_HOUSEKEEPING_OLD_TOKENS_ENABLED", "false"),
        ("WK_HOUSEKEEPING_EXPIRED_THUMBNAILS_INTERVAL_SECONDS", "120"),
        ("WK_HOUSEKEEPING_EXPIRED_INVITES_INITIAL_DELAY_SECONDS", "0"),
        (
            "WK_HOUSEKEEPING_EXPIRED_ANNOTATION_MUTEXES_INTERVAL_SECONDS",
            "60",
        ),
    ]))
    .unwrap();
    assert!(!config.enabled);
    assert_eq!(config.expired_tokens.interval, Duration::from_secs(600));
    assert_eq!(
        config.expired_tokens.initial_delay,
        Duration::from_secs(600)
    );
    assert!(!config.old_tokens.enabled);
    assert!(config.expired_invites.enabled);
    assert_eq!(config.expired_thumbnails.interval, Duration::from_secs(120));
    assert_eq!(
        config.expired_thumbnails.initial_delay,
        Duration::from_secs(120)
    );
    assert_eq!(config.expired_invites.initial_delay, Duration::ZERO);
    assert_eq!(config.expired_invites.interval, DAY);
    assert_eq!(
        config.expired_annotation_mutexes.interval,
        Duration::from_secs(60)
    );
    assert_eq!(
        config.expired_annotation_mutexes.initial_delay,
        Duration::from_secs(10)
    );
}

#[test]
fn invalid_values_are_rejected() {
    for (key, value) in [
        ("WK_HOUSEKEEPING_ENABLED", "yes"),
        ("WK_HOUSEKEEPING_EXPIRED_TOKENS_ENABLED", "1"),
        ("WK_HOUSEKEEPING_OLD_TOKENS_INTERVAL_SECONDS", "0"),
        ("WK_HOUSEKEEPING_OLD_TOKENS_INTERVAL_SECONDS", "-5"),
        (
            "WK_HOUSEKEEPING_EXPIRED_INVITES_INTERVAL_SECONDS",
            "2147483648",
        ),
        ("WK_HOUSEKEEPING_EXPIRED_INVITES_INITIAL_DELAY_SECONDS", "x"),
    ] {
        let error = config_from_values(&values(&[(key, value)])).unwrap_err();
        assert!(error.starts_with(key), "{key}={value}: {error}");
    }
}

#[test]
fn job_names_and_lock_keys_are_unique() {
    let mut names = std::collections::HashSet::new();
    let mut keys = std::collections::HashSet::new();
    for job in HousekeepingJob::ALL {
        assert!(names.insert(job.name()));
        assert!(keys.insert(job.advisory_lock_key()));
    }
}

#[tokio::test]
async fn disabled_globally_spawns_nothing() {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgres://unused@127.0.0.1:1/unused")
        .unwrap();
    let config = HousekeepingConfig {
        enabled: false,
        ..HousekeepingConfig::default()
    };
    let handle = spawn(pool.clone(), &config);
    assert!(handle.job_names().is_empty());
    handle.shutdown().await;
    let mut partial = HousekeepingConfig::default();
    partial.old_tokens.enabled = false;
    let handle = spawn(pool, &partial);
    assert_eq!(handle.job_names().len(), 5);
    assert!(!handle.job_names().contains(&"old-tokens"));
    handle.shutdown().await;
}
