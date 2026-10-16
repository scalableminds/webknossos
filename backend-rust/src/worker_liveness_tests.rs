use super::*;

fn values(pairs: &[(&str, &str)]) -> HashMap<String, String> {
    pairs
        .iter()
        .map(|(key, value)| ((*key).into(), (*value).into()))
        .collect()
}

fn worker(id: &str, last_heart_beat: DateTime<Utc>) -> WorkerHeartbeat {
    WorkerHeartbeat {
        id: id.into(),
        name: format!("worker {id}"),
        last_heart_beat,
    }
}

#[test]
fn defaults_match_scala() {
    let config = config_from_values(&HashMap::new()).unwrap();
    assert_eq!(config, WorkerLivenessConfig::default());
    assert!(config.schedule.enabled);
    assert_eq!(config.schedule.interval, Duration::from_secs(60));
    assert_eq!(config.schedule.initial_delay, Duration::from_secs(60));
    assert_eq!(config.re_report_interval, Duration::from_secs(3600));
}

#[test]
fn overrides() {
    let config = config_from_values(&values(&[
        ("WK_WORKER_LIVENESS_ENABLED", "false"),
        ("WK_WORKER_LIVENESS_INTERVAL_SECONDS", "5"),
        ("WK_WORKER_LIVENESS_INITIAL_DELAY_SECONDS", "0"),
        ("WK_WORKER_LIVENESS_RE_REPORT_INTERVAL_SECONDS", "120"),
    ]))
    .unwrap();
    assert_eq!(
        config,
        WorkerLivenessConfig {
            schedule: JobSchedule {
                enabled: false,
                interval: Duration::from_secs(5),
                initial_delay: Duration::ZERO,
            },
            re_report_interval: Duration::from_secs(120),
        }
    );
}

#[test]
fn invalid_values_are_rejected() {
    for (key, value) in [
        ("WK_WORKER_LIVENESS_ENABLED", "yes"),
        ("WK_WORKER_LIVENESS_INTERVAL_SECONDS", "0"),
        ("WK_WORKER_LIVENESS_INTERVAL_SECONDS", "-5"),
        ("WK_WORKER_LIVENESS_INITIAL_DELAY_SECONDS", "x"),
        ("WK_WORKER_LIVENESS_RE_REPORT_INTERVAL_SECONDS", "0"),
        (
            "WK_WORKER_LIVENESS_RE_REPORT_INTERVAL_SECONDS",
            "2147483648",
        ),
    ] {
        let error = config_from_values(&values(&[(key, value)])).unwrap_err();
        assert!(error.starts_with(key), "{key}={value}: {error}");
    }
}

#[test]
fn advisory_lock_key_is_pinned_and_unique() {
    // Independently computed FNV-1a; a rename would silently change the lock identity.
    assert_eq!(advisory_lock_key(JOB_NAME), -3_852_075_854_085_818_392);
    let mut keys: Vec<i64> = crate::housekeeping::HousekeepingJob::ALL
        .iter()
        .map(|job| job.advisory_lock_key())
        .collect();
    keys.push(advisory_lock_key(crate::credit_ticker::JOB_NAME));
    keys.push(advisory_lock_key(crate::dataset_storage::JOB_NAME));
    assert!(!keys.contains(&advisory_lock_key(JOB_NAME)));
}

#[test]
fn heart_beat_recency_is_strict() {
    let monitor = WorkerLivenessMonitor::new(
        Duration::from_secs(60),
        DEFAULT_RE_REPORT_INTERVAL,
        SlackNotificationService::default(),
    );
    let now = Utc::now();
    assert!(monitor.heart_beat_is_recent(now - chrono::Duration::seconds(59), now));
    assert!(!monitor.heart_beat_is_recent(now - chrono::Duration::seconds(60), now));
}

#[test]
fn evaluate_reports_missing_once_re_reports_after_expiry_and_returns() {
    let monitor = WorkerLivenessMonitor::new(
        Duration::from_secs(60),
        Duration::from_secs(3600),
        SlackNotificationService::default(),
    );
    let t0 = Utc::now();
    let dead = worker("a", t0 - chrono::Duration::minutes(5));
    let alive = worker("b", t0);
    let changes = monitor.evaluate(&[dead.clone(), alive], t0);
    assert_eq!(changes, vec![LivenessChange::Missing(dead.clone())]);
    assert_eq!(monitor.reported_as_dead(t0), vec!["a".to_owned()]);
    // Still missing within the re-report interval: nothing.
    let t1 = t0 + chrono::Duration::minutes(59);
    let alive = worker("b", t1);
    assert!(monitor.evaluate(&[dead.clone(), alive], t1).is_empty());
    // Entry expired: reported again.
    let t2 = t0 + chrono::Duration::minutes(60);
    assert_eq!(
        monitor.evaluate(std::slice::from_ref(&dead), t2),
        vec![LivenessChange::Missing(dead.clone())]
    );
    // Heartbeat again: return reported once, store emptied.
    let back = worker("a", t2);
    assert_eq!(
        monitor.evaluate(std::slice::from_ref(&back), t2),
        vec![LivenessChange::Returned(back.clone())]
    );
    assert!(monitor.evaluate(std::slice::from_ref(&back), t2).is_empty());
    assert!(monitor.reported_as_dead(t2).is_empty());
}

#[test]
fn return_after_expiry_is_not_reported() {
    // Scala: once the TemporaryStore entry expired, a returning worker is not in the store.
    let monitor = WorkerLivenessMonitor::new(
        Duration::from_secs(60),
        Duration::from_secs(600),
        SlackNotificationService::default(),
    );
    let t0 = Utc::now();
    monitor.evaluate(&[worker("a", t0 - chrono::Duration::minutes(5))], t0);
    let t1 = t0 + chrono::Duration::minutes(11);
    assert!(monitor.evaluate(&[worker("a", t1)], t1).is_empty());
}

#[tokio::test]
async fn disabled_monitor_spawns_no_job() {
    let pool = PgPool::connect_lazy("postgres://unused@127.0.0.1:1/unused").unwrap();
    let config = WorkerLivenessConfig {
        schedule: JobSchedule {
            enabled: false,
            ..WorkerLivenessConfig::default().schedule
        },
        ..WorkerLivenessConfig::default()
    };
    let handle = spawn(pool.clone(), &config, Duration::from_secs(60));
    assert!(handle.job_names().is_empty());
    handle.shutdown().await;
    let handle = spawn(
        pool,
        &WorkerLivenessConfig::default(),
        Duration::from_secs(60),
    );
    assert_eq!(handle.job_names(), vec![JOB_NAME]);
    handle.shutdown().await;
}
