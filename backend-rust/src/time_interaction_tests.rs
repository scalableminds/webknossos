use super::*;

fn id(n: u8) -> ObjectId {
    ObjectId::parse(&format!("{n:024x}")).unwrap()
}

fn plan(cached: Option<&SpanSnapshot>, annotation: u8, ts: &[i64]) -> InteractionPlan {
    plan_interactions(
        &TimeInteractionConfig::default(),
        cached,
        &id(annotation),
        ts,
    )
    .unwrap()
    .unwrap()
}

fn state(annotation: u8, time: i64, last: i64, count: i64, created: i64) -> SpanState {
    SpanState {
        annotation_id: Some(id(annotation)),
        time_millis: time,
        last_update_millis: last,
        number_of_updates: count,
        created_millis: created,
    }
}

fn cached(span: u8, s: SpanState) -> SpanSnapshot {
    SpanSnapshot {
        id: id(span),
        state: s,
    }
}

/// Emulates the TW2 executor applying a plan to the cache.
fn commit(p: &InteractionPlan, first_new_id: u8) -> SpanSnapshot {
    let ids: Vec<_> = (0..p.new_span_count())
        .map(|i| id(first_new_id + i as u8))
        .collect();
    p.next_cached_snapshot(&ids).unwrap()
}

#[test]
fn default_pause_is_sixty_seconds_and_validated() {
    assert_eq!(TimeInteractionConfig::default().pause_millis(), 60_000);
    assert!(TimeInteractionConfig::new(1).is_ok());
    assert!(TimeInteractionConfig::new(MAX_DURATION_MILLIS).is_ok());
    for bad in [0, -1, MAX_DURATION_MILLIS + 1] {
        assert_eq!(
            TimeInteractionConfig::new(bad),
            Err(TimeInteractionError::InvalidPause { pause_millis: bad })
        );
    }
}

#[test]
fn storable_bounds_match_chrono_and_postgres() {
    use chrono::{DateTime, NaiveDate, Utc};
    let pg_min = NaiveDate::from_ymd_opt(-4713, 11, 24)
        .unwrap()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc()
        .timestamp_millis();
    assert_eq!(pg_min, MIN_STORABLE_MILLIS);
    assert_eq!(
        DateTime::<Utc>::MAX_UTC.timestamp_millis(),
        MAX_STORABLE_MILLIS
    );
    assert!(DateTime::from_timestamp_millis(MAX_STORABLE_MILLIS).is_some());
    assert!(DateTime::from_timestamp_millis(MAX_STORABLE_MILLIS + 1).is_none());
}

#[test]
fn empty_input_is_noop() {
    let c = cached(9, state(1, 5, 100, 1, 0));
    let cfg = TimeInteractionConfig::default();
    assert_eq!(plan_interactions(&cfg, Some(&c), &id(1), &[]), Ok(None));
    assert_eq!(plan_interactions(&cfg, None, &id(1), &[]), Ok(None));
}

#[test]
fn single_timestamp_creates_zero_duration_span_with_one_update() {
    let p = plan(None, 1, &[1000]);
    assert_eq!(
        p.inserts,
        vec![PlannedInsert {
            ordinal: 0,
            state: state(1, 0, 1000, 0, 1000)
        }]
    );
    assert_eq!(
        p.closes,
        vec![PlannedClose {
            span: SpanRef::New(0),
            before: state(1, 0, 1000, 0, 1000),
            after: state(1, 0, 1000, 1, 1000),
            delta_millis: 0,
        }]
    );
    assert_eq!(p.next_cached.span, SpanRef::New(0));
    assert_eq!(p.next_cached.state, state(1, 0, 1000, 1, 1000));
}

#[test]
fn overlapping_reports_continue_and_skip_negative_closes() {
    let first = plan(None, 1, &[1000, 11000]);
    assert_eq!(first.next_cached.state, state(1, 10000, 11000, 1, 1000));
    let c = commit(&first, 9);
    assert_eq!(c.id, id(9));

    let second = plan(Some(&c), 1, &[6000, 16000]);
    assert!(second.inserts.is_empty());
    assert_eq!(second.closes.len(), 1);
    assert_eq!(second.closes[0].span, SpanRef::Existing(id(9)));
    assert_eq!(second.closes[0].delta_millis, 5000);
    assert_eq!(second.next_cached.state, state(1, 15000, 16000, 2, 1000));
    let c = commit(&second, 20);

    // Final timestamp before lastUpdate: nothing credited, no count increment.
    let third = plan(Some(&c), 1, &[6000, 9000]);
    assert!(third.inserts.is_empty());
    assert!(third.closes.is_empty());
    assert_eq!(third.next_cached.span, SpanRef::Existing(id(9)));
    assert_eq!(third.next_cached.state, c.state);
}

#[test]
fn duplicate_timestamps_increment_count_with_zero_delta() {
    let c = cached(9, state(1, 500, 2000, 3, 0));
    let p = plan(Some(&c), 1, &[2000, 2000, 2000]);
    assert!(p.inserts.is_empty());
    assert_eq!(p.closes.len(), 1);
    assert_eq!(p.closes[0].delta_millis, 0);
    assert_eq!(p.next_cached.state, state(1, 500, 2000, 4, 0));
}

#[test]
fn pause_equality_interrupts_and_below_pause_continues() {
    // Exactly the pause between pair elements splits.
    let p = plan(None, 1, &[0, 60_000]);
    assert_eq!(p.inserts.len(), 2);
    assert_eq!(
        p.closes.iter().map(|c| c.delta_millis).collect::<Vec<_>>(),
        vec![0, 0]
    );
    // One below the pause continues.
    let p = plan(None, 1, &[0, 59_999]);
    assert_eq!(p.inserts.len(), 1);
    assert_eq!(p.next_cached.state.time_millis, 59_999);

    // Cached gap equal to the pause: fresh span, old span not closed (no idle credit).
    let c = cached(9, state(1, 7, 1000, 1, 0));
    let p = plan(Some(&c), 1, &[61_000]);
    assert_eq!(p.inserts.len(), 1);
    assert_eq!(p.closes.len(), 1);
    assert_eq!(p.closes[0].span, SpanRef::New(0));
    assert_eq!(p.next_cached.state, state(1, 0, 61_000, 1, 61_000));
    // Cached gap just below the pause continues the cached span.
    let p = plan(Some(&c), 1, &[60_999]);
    assert!(p.inserts.is_empty());
    assert_eq!(p.next_cached.state, state(1, 60_006, 60_999, 2, 0));
}

#[test]
fn consecutive_pauses_split_and_flush_newest_first() {
    let p = plan(None, 1, &[0, 10_000, 70_000, 80_000, 200_000]);
    // Created chronologically 0,1,2; flushed newest first.
    assert_eq!(
        p.inserts
            .iter()
            .map(|i| (i.ordinal, i.state.created_millis))
            .collect::<Vec<_>>(),
        vec![(2, 200_000), (1, 70_000), (0, 0)]
    );
    assert_eq!(
        p.closes
            .iter()
            .map(|c| (c.span.clone(), c.delta_millis, c.after.last_update_millis))
            .collect::<Vec<_>>(),
        vec![
            (SpanRef::New(2), 0, 200_000),
            (SpanRef::New(1), 10_000, 80_000),
            (SpanRef::New(0), 10_000, 10_000),
        ]
    );
    assert_eq!(p.next_cached.span, SpanRef::New(2));
}

#[test]
fn input_order_is_preserved_not_sorted() {
    let p = plan(None, 1, &[0, 70_000, 65_000, 80_000]);
    assert_eq!(p.inserts.len(), 2);
    assert_eq!(
        p.closes
            .iter()
            .map(|c| (c.span.clone(), c.delta_millis))
            .collect::<Vec<_>>(),
        vec![(SpanRef::New(1), 10_000), (SpanRef::New(0), 0)]
    );
    assert_eq!(p.next_cached.state, state(1, 10_000, 80_000, 1, 70_000));

    // New span whose final timestamp lies before its creation stays uncredited.
    let p = plan(None, 1, &[0, 70_000, 65_000]);
    assert_eq!(p.inserts.len(), 2);
    assert_eq!(p.closes.len(), 1);
    assert_eq!(p.closes[0].span, SpanRef::New(0));
    assert_eq!(p.next_cached.span, SpanRef::New(1));
    assert_eq!(p.next_cached.state, state(1, 0, 70_000, 0, 70_000));
}

#[test]
fn short_gap_switch_credits_previous_annotation() {
    let c = cached(9, state(1, 100, 10_000, 2, 0));
    let p = plan(Some(&c), 2, &[25_000, 30_000]);
    assert_eq!(p.inserts.len(), 1);
    assert_eq!(p.inserts[0].state, state(2, 0, 25_000, 0, 25_000));
    assert_eq!(
        p.closes,
        vec![
            PlannedClose {
                span: SpanRef::New(0),
                before: state(2, 0, 25_000, 0, 25_000),
                after: state(2, 5_000, 30_000, 1, 25_000),
                delta_millis: 5_000,
            },
            PlannedClose {
                span: SpanRef::Existing(id(9)),
                before: state(1, 100, 10_000, 2, 0),
                after: state(1, 15_100, 25_000, 3, 0),
                delta_millis: 15_000,
            },
        ]
    );
    assert_eq!(p.next_cached.state.annotation_id, Some(id(2)));
}

#[test]
fn switch_with_negative_gap_skips_old_close() {
    let c = cached(9, state(1, 100, 10_000, 2, 0));
    let p = plan(Some(&c), 2, &[4_000]);
    assert_eq!(p.inserts.len(), 1);
    assert_eq!(p.closes.len(), 1);
    assert_eq!(p.closes[0].span, SpanRef::New(0));
    assert_eq!(p.next_cached.state, state(2, 0, 4_000, 1, 4_000));
}

#[test]
fn switch_after_pause_does_not_close_old_span() {
    let c = cached(9, state(1, 100, 10_000, 2, 0));
    let p = plan(Some(&c), 2, &[70_000]);
    assert!(p.closes.iter().all(|c| c.span == SpanRef::New(0)));
}

#[test]
fn legacy_span_without_annotation_is_treated_as_switch() {
    let mut legacy = state(1, 0, 1000, 0, 0);
    legacy.annotation_id = None;
    let c = cached(9, legacy);
    let p = plan(Some(&c), 1, &[2000]);
    assert_eq!(p.inserts.len(), 1);
    let old = p
        .closes
        .iter()
        .find(|c| c.span == SpanRef::Existing(id(9)))
        .unwrap();
    assert_eq!(old.after.annotation_id, None);
    assert_eq!(old.delta_millis, 1000);
}

#[test]
fn duration_outside_finite_duration_range_fails_without_plan() {
    let cfg = TimeInteractionConfig::default();
    let err = plan_interactions(&cfg, None, &id(1), &[0, MAX_DURATION_MILLIS + 1]);
    assert_eq!(
        err,
        Err(TimeInteractionError::DurationOutOfRange {
            from_millis: 0,
            to_millis: MAX_DURATION_MILLIS + 1
        })
    );
    // The negative bound applies too.
    assert!(matches!(
        plan_interactions(&cfg, None, &id(1), &[0, -MAX_DURATION_MILLIS - 1]),
        Err(TimeInteractionError::DurationOutOfRange { .. })
    ));
    // The bound itself is a valid gap.
    assert!(plan_interactions(&cfg, None, &id(1), &[0, MAX_DURATION_MILLIS]).is_ok());
    // Cached continuation check overflows on wrapping subtraction.
    let c = cached(9, state(1, 0, 0, 1, 0));
    assert!(matches!(
        plan_interactions(&cfg, Some(&c), &id(1), &[i64::MIN]),
        Err(TimeInteractionError::DurationOutOfRange { .. })
    ));
}

#[test]
fn unstorable_written_timestamps_are_rejected() {
    let cfg = TimeInteractionConfig::default();
    assert_eq!(
        plan_interactions(&cfg, None, &id(1), &[MIN_STORABLE_MILLIS - 1]),
        Err(TimeInteractionError::TimestampNotStorable {
            millis: MIN_STORABLE_MILLIS - 1
        })
    );
    assert!(plan_interactions(&cfg, None, &id(1), &[MIN_STORABLE_MILLIS]).is_ok());
    assert!(plan_interactions(&cfg, None, &id(1), &[MAX_STORABLE_MILLIS]).is_ok());
    assert!(plan_interactions(&cfg, None, &id(1), &[MAX_STORABLE_MILLIS + 1]).is_err());
    // Negative (skipped) closes are never written and need no storable check.
    let c = cached(9, state(1, 0, MIN_STORABLE_MILLIS + 10, 1, 0));
    assert!(plan_interactions(&cfg, Some(&c), &id(1), &[MIN_STORABLE_MILLIS + 5]).is_ok());
}

#[test]
fn accumulated_time_and_count_wrap_like_jvm_long() {
    let c = cached(9, state(1, i64::MAX, 0, i64::MAX, 0));
    let p = plan(Some(&c), 1, &[10]);
    assert_eq!(p.next_cached.state.time_millis, i64::MIN + 9);
    assert_eq!(p.next_cached.state.number_of_updates, i64::MIN);
}

#[test]
fn id_resolution_requires_exact_new_span_count() {
    let p = plan(None, 1, &[0, 70_000]);
    assert_eq!(
        p.next_cached_snapshot(&[id(5)]),
        Err(TimeInteractionError::NewSpanIdCount {
            expected: 2,
            actual: 1
        })
    );
    assert_eq!(p.next_cached_snapshot(&[id(5), id(6)]).unwrap().id, id(6));
    assert_eq!(SpanRef::Existing(id(3)).resolve(&[]), Ok(id(3)));
}

#[test]
fn potential_contributor_gate() {
    assert!(is_potential_contributor(&id(1), &id(1), "OwnerOnly"));
    assert!(!is_potential_contributor(&id(2), &id(1), "OwnerOnly"));
    assert!(is_potential_contributor(&id(2), &id(1), "Exclusive"));
    assert!(is_potential_contributor(&id(2), &id(1), "Concurrent"));
}

#[tokio::test]
async fn cache_publishes_only_on_commit_and_is_per_user() {
    let cfg = TimeInteractionConfig::default();
    let state = TimeInteractionState::default();
    let guard = state.lock_user(&id(1)).await;
    assert!(guard.cached().is_none());
    let p = guard.plan(&cfg, &id(7), &[1000]).unwrap().unwrap();
    drop(guard); // rollback: nothing published
    assert!(state.lock_user(&id(1)).await.cached().is_none());

    let guard = state.lock_user(&id(1)).await;
    guard.publish(p.next_cached_snapshot(&[id(8)]).unwrap());
    let clone = state.clone();
    let guard = clone.lock_user(&id(1)).await;
    assert_eq!(guard.user_id(), &id(1));
    assert_eq!(guard.cached().unwrap().id, id(8));
    // A different user is not blocked by the held guard and starts empty.
    assert!(state.lock_user(&id(2)).await.cached().is_none());
}
