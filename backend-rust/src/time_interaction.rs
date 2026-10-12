//! Pure, deterministic time-interaction planner (TW1).
//!
//! Port of the planning half of Scala `TimeSpanService.trackTime`
//! (`app/models/user/time/TimeSpanService.scala`). The planner turns the
//! user's cached span plus a list of client interaction timestamps (epoch
//! milliseconds, in the order supplied) into an [`InteractionPlan`]: spans to
//! insert, span closes with their credited deltas, and the span that becomes the
//! user's new cached activity. It performs no SQL, clock reads, ID allocation
//! or mail; a later executor (TW2) allocates ObjectIds for [`SpanRef::New`]
//! spans, applies the plan in one transaction and publishes the new cache value
//! through [`UserActivityGuard::publish`] only after commit.
//!
//! Scala semantics preserved here:
//! - timestamps are never sorted; duplicates are kept;
//! - a gap strictly below the pause continues a span (negative gaps too); a gap
//!   equal to or above the pause interrupts it without crediting idle time;
//! - switching annotations within the pause closes the cached span of the
//!   *previous* annotation at the first new timestamp;
//! - a close with a negative delta is skipped entirely (no count increment);
//!   a zero delta still increments `numberOfUpdates`;
//! - inserts and closes are listed in Scala's prepend order (newest first);
//! - signed differences use wrapping `Long` subtraction and must fit Scala's
//!   millisecond `FiniteDuration` range, otherwise the whole call fails before
//!   any effect; accumulated span time/count use wrapping `Long` addition.
//!
//! Intentional improvement: every timestamp that would be persisted must be
//! representable by chrono and PostgreSQL `TIMESTAMPTZ`; the planner rejects
//! the call up front instead of failing halfway through a flush.

use crate::id::ObjectId;
use std::{
    collections::HashMap,
    fmt,
    sync::{Arc, Mutex},
};
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};

/// Scala `webKnossos.user.timeTrackingPause = 60 seconds`.
pub const DEFAULT_PAUSE_MILLIS: i64 = 60_000;

/// Largest absolute millisecond length accepted by Scala's `FiniteDuration`
/// (`Long.MaxValue / 1_000_000`).
pub const MAX_DURATION_MILLIS: i64 = i64::MAX / 1_000_000;

/// Earliest instant PostgreSQL `TIMESTAMPTZ` accepts (4714-11-24 BC 00:00 UTC),
/// in Unix epoch milliseconds.
pub const MIN_STORABLE_MILLIS: i64 = -210_866_803_200_000;

/// Latest instant chrono's `DateTime<Utc>` can represent (+262142-12-31),
/// which is below PostgreSQL's upper bound, in Unix epoch milliseconds.
pub const MAX_STORABLE_MILLIS: i64 = 8_210_266_876_799_999;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TimeInteractionError {
    /// Configured pause must be positive and a valid `FiniteDuration`.
    InvalidPause { pause_millis: i64 },
    /// `to - from` (wrapping) is outside Scala's millisecond `FiniteDuration`
    /// range; Scala throws `IllegalArgumentException` here.
    DurationOutOfRange { from_millis: i64, to_millis: i64 },
    /// A timestamp that would be persisted is not representable as
    /// chrono/PostgreSQL `TIMESTAMPTZ`.
    TimestampNotStorable { millis: i64 },
    /// The executor supplied a different number of ObjectIds than the plan
    /// creates spans.
    NewSpanIdCount { expected: usize, actual: usize },
}

impl fmt::Display for TimeInteractionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidPause { pause_millis } => write!(
                f,
                "time tracking pause must be between 1 and {MAX_DURATION_MILLIS} ms, got {pause_millis}"
            ),
            Self::DurationOutOfRange {
                from_millis,
                to_millis,
            } => write!(
                f,
                "duration from {from_millis} to {to_millis} ms exceeds the representable range"
            ),
            Self::TimestampNotStorable { millis } => {
                write!(f, "timestamp {millis} ms cannot be stored")
            }
            Self::NewSpanIdCount { expected, actual } => write!(
                f,
                "expected {expected} ids for new time spans, got {actual}"
            ),
        }
    }
}

impl std::error::Error for TimeInteractionError {}

pub type TimeInteractionResult<T> = Result<T, TimeInteractionError>;

/// Algorithm configuration. The significant-changes gate of tracingstore
/// reports is caller configuration and intentionally not part of this type.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TimeInteractionConfig {
    pause_millis: i64,
}

impl TimeInteractionConfig {
    pub fn new(pause_millis: i64) -> TimeInteractionResult<Self> {
        if (1..=MAX_DURATION_MILLIS).contains(&pause_millis) {
            Ok(Self { pause_millis })
        } else {
            Err(TimeInteractionError::InvalidPause { pause_millis })
        }
    }

    pub fn pause_millis(&self) -> i64 {
        self.pause_millis
    }
}

impl Default for TimeInteractionConfig {
    fn default() -> Self {
        Self {
            pause_millis: DEFAULT_PAUSE_MILLIS,
        }
    }
}

/// Scala `logUserInteractionIfTheyArePotentialContributor` gate:
/// owner, or collaboration mode `Exclusive`/`Concurrent` (`othersMayEdit`).
pub fn is_potential_contributor(
    user_id: &ObjectId,
    annotation_owner_id: &ObjectId,
    collaboration_mode: &str,
) -> bool {
    user_id == annotation_owner_id || matches!(collaboration_mode, "Exclusive" | "Concurrent")
}

/// Mutable accounting fields of a `webknossos.timespans` row.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpanState {
    /// `None` only for legacy rows; every planned new span has an annotation.
    pub annotation_id: Option<ObjectId>,
    pub time_millis: i64,
    pub last_update_millis: i64,
    pub number_of_updates: i64,
    pub created_millis: i64,
}

impl SpanState {
    /// Scala `TimeSpan.fromInstant`: time 0, numberOfUpdates 0 (the schema
    /// default of 1 must not be used), lastUpdate = created = timestamp.
    fn starting_at(annotation_id: &ObjectId, timestamp: i64) -> Self {
        Self {
            annotation_id: Some(annotation_id.clone()),
            time_millis: 0,
            last_update_millis: timestamp,
            number_of_updates: 0,
            created_millis: timestamp,
        }
    }

    /// Scala `TimeSpan.addTime` with JVM `Long` wrapping.
    fn add_time(&self, delta_millis: i64, timestamp: i64) -> Self {
        Self {
            annotation_id: self.annotation_id.clone(),
            time_millis: self.time_millis.wrapping_add(delta_millis),
            last_update_millis: timestamp,
            number_of_updates: self.number_of_updates.wrapping_add(1),
            created_millis: self.created_millis,
        }
    }
}

/// A persisted span as held in the per-user activity cache.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpanSnapshot {
    pub id: ObjectId,
    pub state: SpanState,
}

/// Identity of a span inside a plan.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SpanRef {
    /// Already persisted span (the cached one).
    Existing(ObjectId),
    /// Span created by this plan; the value is its creation ordinal
    /// (0 = first created, chronologically in planning order).
    New(usize),
}

impl SpanRef {
    /// Resolve against executor-allocated ids indexed by creation ordinal.
    pub fn resolve(&self, new_span_ids: &[ObjectId]) -> TimeInteractionResult<ObjectId> {
        match self {
            Self::Existing(id) => Ok(id.clone()),
            Self::New(ordinal) => {
                new_span_ids
                    .get(*ordinal)
                    .cloned()
                    .ok_or(TimeInteractionError::NewSpanIdCount {
                        expected: ordinal + 1,
                        actual: new_span_ids.len(),
                    })
            }
        }
    }
}

/// A span with plan-local identity.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlannedSpan {
    pub span: SpanRef,
    pub state: SpanState,
}

/// `INSERT INTO webknossos.timespans` of a fresh span (time 0, count 0,
/// isDeleted false) for the interacting user.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlannedInsert {
    pub ordinal: usize,
    pub state: SpanState,
}

/// One accepted (non-negative) close: `UPDATE timespans` with the absolute
/// `after` values (all fields except created), then add `delta_millis` to
/// the tracingTime of `after.annotation_id` and its task.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlannedClose {
    pub span: SpanRef,
    pub before: SpanState,
    pub after: SpanState,
    pub delta_millis: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InteractionPlan {
    /// Inserts in Scala flush order (newest created first).
    pub inserts: Vec<PlannedInsert>,
    /// Closes in Scala flush order (newest planned first); executed after all
    /// inserts.
    pub closes: Vec<PlannedClose>,
    /// Value to publish into the user's activity cache after commit.
    pub next_cached: PlannedSpan,
}

impl InteractionPlan {
    pub fn new_span_count(&self) -> usize {
        self.inserts.len()
    }

    /// Cache value to publish after commit, with resolved span id.
    pub fn next_cached_snapshot(
        &self,
        new_span_ids: &[ObjectId],
    ) -> TimeInteractionResult<SpanSnapshot> {
        if new_span_ids.len() != self.new_span_count() {
            return Err(TimeInteractionError::NewSpanIdCount {
                expected: self.new_span_count(),
                actual: new_span_ids.len(),
            });
        }
        Ok(SpanSnapshot {
            id: self.next_cached.span.resolve(new_span_ids)?,
            state: self.next_cached.state.clone(),
        })
    }
}

/// Scala `Instant - Instant`: wrapping `Long` subtraction, then the
/// `FiniteDuration` millisecond bound check.
fn duration_between(from_millis: i64, to_millis: i64) -> TimeInteractionResult<i64> {
    let delta = to_millis.wrapping_sub(from_millis);
    if (-MAX_DURATION_MILLIS..=MAX_DURATION_MILLIS).contains(&delta) {
        Ok(delta)
    } else {
        Err(TimeInteractionError::DurationOutOfRange {
            from_millis,
            to_millis,
        })
    }
}

fn ensure_storable(millis: i64) -> TimeInteractionResult<()> {
    if (MIN_STORABLE_MILLIS..=MAX_STORABLE_MILLIS).contains(&millis) {
        Ok(())
    } else {
        Err(TimeInteractionError::TimestampNotStorable { millis })
    }
}

struct Planner<'a> {
    annotation_id: &'a ObjectId,
    inserts: Vec<PlannedInsert>,
    closes: Vec<PlannedClose>,
    created: usize,
}

impl Planner<'_> {
    fn create(&mut self, timestamp: i64) -> TimeInteractionResult<PlannedSpan> {
        ensure_storable(timestamp)?;
        let ordinal = self.created;
        self.created += 1;
        let state = SpanState::starting_at(self.annotation_id, timestamp);
        self.inserts.push(PlannedInsert {
            ordinal,
            state: state.clone(),
        });
        Ok(PlannedSpan {
            span: SpanRef::New(ordinal),
            state,
        })
    }

    /// Scala `updateTimeSpan`: negative deltas leave the span untouched.
    fn close(&mut self, span: &PlannedSpan, timestamp: i64) -> TimeInteractionResult<PlannedSpan> {
        let delta = duration_between(span.state.last_update_millis, timestamp)?;
        if delta < 0 {
            return Ok(span.clone());
        }
        ensure_storable(timestamp)?;
        let after = span.state.add_time(delta, timestamp);
        self.closes.push(PlannedClose {
            span: span.span.clone(),
            before: span.state.clone(),
            after: after.clone(),
            delta_millis: delta,
        });
        Ok(PlannedSpan {
            span: span.span.clone(),
            state: after,
        })
    }
}

/// Plan one `trackTime` call. Returns `Ok(None)` for an empty timestamp list
/// (Scala logs a warning and does nothing, leaving the cache untouched).
/// Any error means: no writes and no cache change.
pub fn plan_interactions(
    config: &TimeInteractionConfig,
    cached: Option<&SpanSnapshot>,
    annotation_id: &ObjectId,
    timestamps: &[i64],
) -> TimeInteractionResult<Option<InteractionPlan>> {
    let (Some(&start), Some(&last)) = (timestamps.first(), timestamps.last()) else {
        return Ok(None);
    };
    let pause = config.pause_millis;
    let mut planner = Planner {
        annotation_id,
        inserts: Vec::new(),
        closes: Vec::new(),
        created: 0,
    };

    let mut continued = None;
    if let Some(cached) = cached {
        let cached = PlannedSpan {
            span: SpanRef::Existing(cached.id.clone()),
            state: cached.state.clone(),
        };
        if duration_between(cached.state.last_update_millis, start)? < pause {
            if cached.state.annotation_id.as_ref() == Some(annotation_id) {
                continued = Some(cached);
            } else {
                // Short-gap switch: credit the previous annotation up to `start`.
                planner.close(&cached, start)?;
            }
        }
    }
    let mut current = match continued {
        Some(span) => span,
        None => planner.create(start)?,
    };

    for pair in timestamps.windows(2) {
        let (pair_start, pair_end) = (pair[0], pair[1]);
        if duration_between(pair_start, pair_end)? >= pause {
            planner.close(&current, pair_start)?;
            current = planner.create(pair_end)?;
        }
    }
    let current = planner.close(&current, last)?;

    let Planner {
        mut inserts,
        mut closes,
        ..
    } = planner;
    // Scala prepends to immutable lists, so flushes run newest-first.
    inserts.reverse();
    closes.reverse();
    Ok(Some(InteractionPlan {
        inserts,
        closes,
        next_cached: current,
    }))
}

type ActivitySlot = Arc<AsyncMutex<Option<SpanSnapshot>>>;

/// Process-local `userId -> last span` cache (Scala `lastUserActivities`),
/// starting empty and never loaded from the database. One instance per
/// assembled application; clones share state.
#[derive(Clone, Default)]
pub struct TimeInteractionState {
    users: Arc<Mutex<HashMap<ObjectId, ActivitySlot>>>,
}

impl TimeInteractionState {
    /// Serialize one user's read/plan/write/publish sequence. Acquire before
    /// opening the accounting transaction; never hold across remote HTTP.
    pub async fn lock_user(&self, user_id: &ObjectId) -> UserActivityGuard {
        let slot = {
            let mut users = self.users.lock().unwrap_or_else(|e| e.into_inner());
            users.entry(user_id.clone()).or_default().clone()
        };
        UserActivityGuard {
            user_id: user_id.clone(),
            slot: slot.lock_owned().await,
        }
    }
}

/// Exclusive access to one user's cached span. Dropping it without
/// [`publish`](Self::publish) leaves the cache unchanged (rollback path).
pub struct UserActivityGuard {
    user_id: ObjectId,
    slot: OwnedMutexGuard<Option<SpanSnapshot>>,
}

impl UserActivityGuard {
    pub fn user_id(&self) -> &ObjectId {
        &self.user_id
    }

    pub fn cached(&self) -> Option<&SpanSnapshot> {
        self.slot.as_ref()
    }

    pub fn plan(
        &self,
        config: &TimeInteractionConfig,
        annotation_id: &ObjectId,
        timestamps: &[i64],
    ) -> TimeInteractionResult<Option<InteractionPlan>> {
        plan_interactions(config, self.cached(), annotation_id, timestamps)
    }

    /// Call only after the plan's transaction committed.
    pub fn publish(mut self, snapshot: SpanSnapshot) {
        *self.slot = Some(snapshot);
    }
}

#[cfg(test)]
mod tests {
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
}
