use super::*;

fn values(pairs: &[(&str, &str)]) -> HashMap<String, String> {
    pairs
        .iter()
        .map(|(key, value)| ((*key).into(), (*value).into()))
        .collect()
}

const RUNTIME: RuntimeSnapshot = RuntimeSnapshot {
    workers: 8,
    alive_tasks: 42,
    global_queue_depth: 3,
};

#[test]
fn defaults_match_scala() {
    let config = config_from_values(&HashMap::new()).unwrap();
    assert_eq!(config, PoolHealthLogConfig::default());
    assert!(config.schedule.enabled);
    assert_eq!(config.schedule.interval, Duration::from_secs(600));
    assert_eq!(config.schedule.initial_delay, Duration::from_secs(600));
}

#[test]
fn config_reads_env() {
    let config = config_from_values(&values(&[
        ("WK_POOL_HEALTH_LOG_ENABLED", "false"),
        ("WK_POOL_HEALTH_LOG_INTERVAL_SECONDS", "60"),
        ("WK_POOL_HEALTH_LOG_INITIAL_DELAY_SECONDS", "0"),
    ]))
    .unwrap();
    assert_eq!(
        config.schedule,
        JobSchedule {
            enabled: false,
            interval: Duration::from_secs(60),
            initial_delay: Duration::ZERO,
        }
    );
    for (key, value) in [
        ("WK_POOL_HEALTH_LOG_ENABLED", "maybe"),
        ("WK_POOL_HEALTH_LOG_INTERVAL_SECONDS", "0"),
        ("WK_POOL_HEALTH_LOG_INITIAL_DELAY_SECONDS", "x"),
    ] {
        let error = config_from_values(&values(&[(key, value)])).unwrap_err();
        assert!(error.0.starts_with(key), "{key}={value}: {error}");
    }
}

#[test]
fn healthy_pool_is_info() {
    let db = DbPoolSnapshot {
        size: 5,
        idle: 3,
        max: 10,
    };
    let health = assess(db, Some(RUNTIME));
    assert!(!health.db_pool_saturated);
    assert_eq!(
        health.message,
        "Pool health: DB pool: size=5, inUse=2, idle=3, maxConnections=10; \
         Tokio runtime: workers=8, aliveTasks=42, globalQueueDepth=3."
    );
}

#[test]
fn full_pool_with_idle_connections_is_not_saturated() {
    let db = DbPoolSnapshot {
        size: 10,
        idle: 1,
        max: 10,
    };
    assert!(!assess(db, Some(RUNTIME)).db_pool_saturated);
}

#[test]
fn all_connections_in_use_warns() {
    let db = DbPoolSnapshot {
        size: 10,
        idle: 0,
        max: 10,
    };
    let health = assess(db, None);
    assert!(health.db_pool_saturated);
    assert_eq!(
        health.message,
        "Pool health: DB pool: size=10, inUse=10, idle=0, maxConnections=10; \
         Tokio runtime: not available. All database connections are in use."
    );
}

#[test]
fn empty_pool_is_not_saturated() {
    let db = DbPoolSnapshot {
        size: 0,
        idle: 0,
        max: 10,
    };
    assert!(!assess(db, None).db_pool_saturated);
}

#[tokio::test]
async fn disabled_job_spawns_nothing() {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgres://localhost/unused")
        .unwrap();
    let mut config = PoolHealthLogConfig::default();
    config.schedule.enabled = false;
    let handle = spawn(pool, &config);
    assert!(handle.job_names().is_empty());
    handle.shutdown().await;
}
