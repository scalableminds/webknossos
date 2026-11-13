use super::*;
use chrono::TimeZone;

#[test]
fn advisory_lock_key_is_pinned_and_unique() {
    // Independently computed FNV-1a; a rename would silently change the lock identity.
    assert_eq!(advisory_lock_key(JOB_NAME), 3_425_888_693_342_096_311);
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
fn activity_tag_uses_a_strict_14_day_cutoff() {
    let now = Utc.with_ymd_and_hms(2026, 11, 3, 12, 0, 0).unwrap();
    let cutoff = now - TimeDelta::days(14);
    assert_eq!(
        activity_tag(cutoff - TimeDelta::milliseconds(1), now),
        MailchimpTag::WasInactiveInWeeksTwoAndThree
    );
    assert_eq!(
        activity_tag(cutoff, now),
        MailchimpTag::WasActiveInWeeksTwoOrThree
    );
    assert_eq!(
        activity_tag(now - TimeDelta::days(1), now),
        MailchimpTag::WasActiveInWeeksTwoOrThree
    );
}
