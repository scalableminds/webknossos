//! Scala `StorageWarningTestSuite` (`test/backend/StorageWarningTestSuite.scala`) plus settings.
use super::*;

const THRESHOLDS: [i32; 2] = [90, 100];

fn values(pairs: &[(&str, &str)]) -> HashMap<String, String> {
    pairs
        .iter()
        .map(|(key, value)| ((*key).into(), (*value).into()))
        .collect()
}

#[test]
fn usage_percent_relates_the_used_to_the_included_storage() {
    assert_eq!(usage_percent(45, 100), 45.0);
    assert_eq!(usage_percent(150, 100), 150.0);
}

/// An included storage of zero bytes means no storage at all, so any usage counts as exceeded.
/// Unlimited storage is represented by an unset included storage, for which no warnings are sent.
#[test]
fn usage_percent_treats_any_usage_as_exceeded_if_the_included_storage_is_zero() {
    assert_eq!(usage_percent(0, 0), 0.0);
    assert_eq!(usage_percent(1, 0), f64::INFINITY);
}

#[test]
fn is_exceeded_once_the_included_storage_is_used_up() {
    assert!(!is_exceeded(99.9));
    assert!(is_exceeded(100.0));
    assert!(is_exceeded(f64::INFINITY));
}

#[test]
fn crossed_thresholds_percent_matches_scala() {
    assert!(crossed_thresholds_percent(89.9, &THRESHOLDS).is_empty());
    assert_eq!(crossed_thresholds_percent(90.0, &THRESHOLDS), vec![90]);
    assert_eq!(
        crossed_thresholds_percent(100.0, &THRESHOLDS),
        vec![90, 100]
    );
    assert_eq!(
        crossed_thresholds_percent(f64::INFINITY, &THRESHOLDS),
        vec![90, 100]
    );
    // Unsorted configuration, ascending result.
    assert_eq!(
        crossed_thresholds_percent(95.0, &[100, 50, 90]),
        vec![50, 90]
    );
}

#[test]
fn rearmed_thresholds_percent_matches_scala() {
    // Without a margin, usage hovering around a threshold would trigger a new mail on every scan.
    assert_eq!(rearmed_thresholds_percent(86.0, &THRESHOLDS), vec![100]);
    assert!(rearmed_thresholds_percent(96.0, &THRESHOLDS).is_empty());
    // Re-armed once the usage dropped clearly below them.
    assert_eq!(rearmed_thresholds_percent(84.9, &THRESHOLDS), vec![90, 100]);
    assert_eq!(rearmed_thresholds_percent(94.0, &THRESHOLDS), vec![100]);
    // Never re-arms a threshold that is currently crossed.
    assert!(rearmed_thresholds_percent(120.0, &THRESHOLDS).is_empty());
}

#[test]
fn defaults_match_scala() {
    let config = config_from_values(&HashMap::new()).unwrap();
    assert_eq!(config, StorageWarningEmailsConfig::default());
    assert!(config.enabled);
    assert_eq!(config.thresholds_percent, vec![90, 100]);
}

#[test]
fn overrides() {
    let config = config_from_values(&values(&[
        ("WK_STORAGE_WARNING_EMAILS_ENABLED", "false"),
        (
            "WK_STORAGE_WARNING_EMAILS_THRESHOLDS_PERCENT",
            " 80, 95 ,100",
        ),
    ]))
    .unwrap();
    assert_eq!(
        config,
        StorageWarningEmailsConfig {
            enabled: false,
            thresholds_percent: vec![80, 95, 100],
        }
    );
    let config = config_from_values(&values(&[(
        "WK_STORAGE_WARNING_EMAILS_THRESHOLDS_PERCENT",
        "",
    )]))
    .unwrap();
    assert!(config.thresholds_percent.is_empty());
}

#[test]
fn invalid_values_are_rejected() {
    for (key, value) in [
        ("WK_STORAGE_WARNING_EMAILS_ENABLED", "yes"),
        ("WK_STORAGE_WARNING_EMAILS_THRESHOLDS_PERCENT", "90;100"),
        ("WK_STORAGE_WARNING_EMAILS_THRESHOLDS_PERCENT", "-1"),
        ("WK_STORAGE_WARNING_EMAILS_THRESHOLDS_PERCENT", "90%"),
    ] {
        let error = config_from_values(&values(&[(key, value)])).unwrap_err();
        assert!(error.0.starts_with(key), "{key}={value}: {error}");
    }
}
