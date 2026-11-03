use chrono::TimeZone;

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
    assert_eq!(config, PricingPlanExpiryReminderConfig::default());
    assert!(!config.schedule.enabled);
    assert!(!config.effective_schedule().enabled);
    assert_eq!(config.schedule.interval, Duration::from_secs(6 * 3600));
    assert_eq!(config.schedule.initial_delay, Duration::from_secs(300));
    assert_eq!(config.lead_times_days, vec![30, 14, 7]);
    assert_eq!(config.trial_lead_times_days, vec![7]);
}

#[test]
fn overrides() {
    let config = config_from_values(&values(&[
        ("WK_PRICING_PLAN_EXPIRY_REMINDER_ENABLED", "true"),
        ("WK_PRICING_PLAN_EXPIRY_REMINDER_INTERVAL_SECONDS", "60"),
        // Removed variable: Play hard-codes the initial delay, so it is ignored.
        ("WK_PRICING_PLAN_EXPIRY_REMINDER_INITIAL_DELAY_SECONDS", "0"),
        (
            "WK_PRICING_PLAN_EXPIRY_REMINDER_LEAD_TIMES_DAYS",
            " 60, 3 ,1",
        ),
        ("WK_PRICING_PLAN_EXPIRY_REMINDER_TRIAL_LEAD_TIMES_DAYS", ""),
    ]))
    .unwrap();
    assert_eq!(
        config,
        PricingPlanExpiryReminderConfig {
            schedule: JobSchedule {
                enabled: true,
                interval: Duration::from_secs(60),
                initial_delay: DEFAULT_INITIAL_DELAY,
            },
            lead_times_days: vec![60, 3, 1],
            trial_lead_times_days: vec![],
        }
    );
    assert!(config.effective_schedule().enabled);
    assert_eq!(config.max_lead_time_days(), Some(60));
}

#[test]
fn enabled_without_lead_times_does_not_run() {
    // Scala tickerEnabled: enabled && allLeadTimesDays.nonEmpty.
    let config = config_from_values(&values(&[
        ("WK_PRICING_PLAN_EXPIRY_REMINDER_ENABLED", "true"),
        ("WK_PRICING_PLAN_EXPIRY_REMINDER_LEAD_TIMES_DAYS", ""),
        ("WK_PRICING_PLAN_EXPIRY_REMINDER_TRIAL_LEAD_TIMES_DAYS", " "),
    ]))
    .unwrap();
    assert!(config.schedule.enabled);
    assert!(!config.effective_schedule().enabled);
    assert_eq!(config.max_lead_time_days(), None);
    // Only trial lead times still enable the job.
    let config = config_from_values(&values(&[
        ("WK_PRICING_PLAN_EXPIRY_REMINDER_ENABLED", "true"),
        ("WK_PRICING_PLAN_EXPIRY_REMINDER_LEAD_TIMES_DAYS", ""),
    ]))
    .unwrap();
    assert!(config.effective_schedule().enabled);
    assert_eq!(config.max_lead_time_days(), Some(7));
}

#[test]
fn invalid_values_are_rejected() {
    for (key, value) in [
        ("WK_PRICING_PLAN_EXPIRY_REMINDER_ENABLED", "yes"),
        ("WK_PRICING_PLAN_EXPIRY_REMINDER_INTERVAL_SECONDS", "0"),
        ("WK_PRICING_PLAN_EXPIRY_REMINDER_LEAD_TIMES_DAYS", "30;14"),
        ("WK_PRICING_PLAN_EXPIRY_REMINDER_LEAD_TIMES_DAYS", "-1"),
        (
            "WK_PRICING_PLAN_EXPIRY_REMINDER_TRIAL_LEAD_TIMES_DAYS",
            "7d",
        ),
    ] {
        let error = config_from_values(&values(&[(key, value)])).unwrap_err();
        assert!(error.0.starts_with(key), "{key}={value}: {error}");
    }
}

#[test]
fn advisory_lock_key_is_pinned_and_unique() {
    // Independently computed FNV-1a; a rename would silently change the lock identity.
    assert_eq!(advisory_lock_key(JOB_NAME), -4_808_420_269_438_205_693);
    let mut keys: Vec<i64> = crate::background::housekeeping::HousekeepingJob::ALL
        .iter()
        .map(|job| job.advisory_lock_key())
        .collect();
    keys.push(advisory_lock_key(
        crate::background::credit_ticker::JOB_NAME,
    ));
    keys.push(advisory_lock_key(
        crate::background::worker_liveness::JOB_NAME,
    ));
    keys.push(advisory_lock_key(crate::organization::storage::JOB_NAME));
    assert!(!keys.contains(&advisory_lock_key(JOB_NAME)));
}

#[test]
fn crossed_lead_times_days_matches_scala() {
    let lead = [30, 14, 7];
    assert_eq!(crossed_lead_times_days(31, &lead), Vec::<i32>::new());
    assert_eq!(crossed_lead_times_days(30, &lead), vec![30]);
    assert_eq!(crossed_lead_times_days(15, &lead), vec![30]);
    assert_eq!(crossed_lead_times_days(14, &lead), vec![14, 30]);
    assert_eq!(crossed_lead_times_days(8, &lead), vec![14, 30]);
    assert_eq!(crossed_lead_times_days(7, &lead), vec![7, 14, 30]);
    assert_eq!(crossed_lead_times_days(1, &lead), vec![7, 14, 30]);
    // Expired: nothing is due any more.
    assert_eq!(crossed_lead_times_days(0, &lead), Vec::<i32>::new());
    assert_eq!(crossed_lead_times_days(-3, &lead), Vec::<i32>::new());
    // Unsorted configuration, ascending result.
    assert_eq!(crossed_lead_times_days(2, &[3, 14, 2]), vec![2, 3, 14]);
    assert_eq!(crossed_lead_times_days(5, &[]), Vec::<i32>::new());
}

#[test]
fn lead_times_days_for_trials_uses_trial_lead_times() {
    let (lead, trial) = ([30, 14, 7], [7]);
    for plan in [PricingPlan::Team_Trial, PricingPlan::Power_Trial] {
        assert_eq!(lead_times_days_for(plan, &lead, &trial), &trial);
    }
    for plan in [
        PricingPlan::Personal,
        PricingPlan::Team,
        PricingPlan::Power,
        PricingPlan::Custom,
    ] {
        assert_eq!(lead_times_days_for(plan, &lead, &trial), &lead);
    }
}

#[test]
fn days_until_rounds_up_like_scala() {
    let now = Utc.with_ymd_and_hms(2026, 11, 3, 12, 0, 0).unwrap();
    let day = chrono::Duration::days(1);
    assert_eq!(days_until(now, now), 0);
    assert_eq!(days_until(now, now + chrono::Duration::milliseconds(1)), 1);
    assert_eq!(days_until(now, now + day), 1);
    assert_eq!(
        days_until(now, now + day + chrono::Duration::milliseconds(1)),
        2
    );
    assert_eq!(
        days_until(now, now + day * 14 - chrono::Duration::hours(1)),
        14
    );
    // Math.ceil of a negative fraction rounds towards zero.
    assert_eq!(days_until(now, now - chrono::Duration::hours(1)), 0);
    assert_eq!(days_until(now, now - day - chrono::Duration::hours(1)), -1);
}

#[test]
fn format_date_only_matches_scala_pattern() {
    // `d MMMM yyyy` in the local zone; noon UTC is the same date in every zone up to +-11 h.
    let instant = Utc.with_ymd_and_hms(2026, 3, 5, 12, 0, 0).unwrap();
    assert_eq!(format_date_only(instant), "5 March 2026");
    let instant = Utc.with_ymd_and_hms(2026, 12, 24, 12, 0, 0).unwrap();
    assert_eq!(format_date_only(instant), "24 December 2026");
}
