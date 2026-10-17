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
    assert_eq!(config, CreditTickerConfig::default());
    assert!(config.schedule.enabled);
    assert_eq!(config.schedule.interval, Duration::from_secs(1200));
    assert_eq!(config.schedule.initial_delay, Duration::from_secs(10));
}

#[test]
fn overrides() {
    let config = config_from_values(&values(&[
        ("WK_CREDIT_TICKER_ENABLED", "false"),
        ("WK_CREDIT_TICKER_INTERVAL_SECONDS", "60"),
        ("WK_CREDIT_TICKER_INITIAL_DELAY_SECONDS", "0"),
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
}

#[test]
fn invalid_values_are_rejected() {
    for (key, value) in [
        ("WK_CREDIT_TICKER_ENABLED", "yes"),
        ("WK_CREDIT_TICKER_INTERVAL_SECONDS", "0"),
        ("WK_CREDIT_TICKER_INTERVAL_SECONDS", "-5"),
        ("WK_CREDIT_TICKER_INTERVAL_SECONDS", "2147483648"),
        ("WK_CREDIT_TICKER_INITIAL_DELAY_SECONDS", "x"),
    ] {
        let error = config_from_values(&values(&[(key, value)])).unwrap_err();
        assert!(error.0.starts_with(key), "{key}={value}: {error}");
    }
}

#[test]
fn advisory_lock_key_is_pinned() {
    // Independently computed FNV-1a; a rename would silently change the lock identity.
    assert_eq!(advisory_lock_key(JOB_NAME), -6_829_639_099_625_385_059);
}

#[test]
fn advisory_lock_key_differs_from_housekeeping_keys() {
    use crate::background::housekeeping::HousekeepingJob;
    for job in HousekeepingJob::ALL {
        assert_ne!(job.name(), JOB_NAME);
        assert_ne!(job.advisory_lock_key(), advisory_lock_key(JOB_NAME));
    }
}

#[test]
fn failed_revocation_slack_body_matches_scala() {
    use crate::organization::credit_transactions::{
        FailedRevocation, failed_revocations_slack_body,
    };
    let failure = |transaction: &str, organization: &str| FailedRevocation {
        transaction_id: transaction.into(),
        organization_id: organization.into(),
    };
    assert_eq!(
        failed_revocations_slack_body(&[failure("t1", "orgA"), failure("t2", "orgB")]),
        "Failed to revoke credits for transaction t1 for organization orgA.\n\
             Failed to revoke credits for transaction t2 for organization orgB."
    );
}

#[tokio::test]
async fn disabled_ticker_spawns_no_job() {
    let pool = PgPool::connect_lazy("postgres://unused@127.0.0.1:1/unused").unwrap();
    let config = CreditTickerConfig {
        schedule: JobSchedule {
            enabled: false,
            ..CreditTickerConfig::default().schedule
        },
    };
    let handle = spawn(pool.clone(), &config, 2000);
    assert!(handle.job_names().is_empty());
    handle.shutdown().await;
    let handle = spawn(pool, &CreditTickerConfig::default(), 2000);
    assert_eq!(handle.job_names(), vec![JOB_NAME]);
    handle.shutdown().await;
}
