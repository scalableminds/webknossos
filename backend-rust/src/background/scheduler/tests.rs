use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

fn schedule(interval_ms: u64, initial_delay_ms: u64) -> JobSchedule {
    JobSchedule {
        enabled: true,
        interval: Duration::from_millis(interval_ms),
        initial_delay: Duration::from_millis(initial_delay_ms),
    }
}

async fn wait_until(mut condition: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while !condition() {
        assert!(Instant::now() < deadline, "condition not reached in time");
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
}

#[tokio::test]
async fn runs_never_overlap_and_interval_counts_from_completion() {
    let active = Arc::new(AtomicUsize::new(0));
    let max_active = Arc::new(AtomicUsize::new(0));
    let runs = Arc::new(AtomicUsize::new(0));
    let (a, m, r) = (active.clone(), max_active.clone(), runs.clone());
    let mut scheduler = Scheduler::new();
    // The run (30 ms) is far longer than the interval (1 ms).
    scheduler.add(Job::new("slow", schedule(1, 0), move || {
        let (a, m, r) = (a.clone(), m.clone(), r.clone());
        async move {
            let now = a.fetch_add(1, Ordering::SeqCst) + 1;
            m.fetch_max(now, Ordering::SeqCst);
            tokio::time::sleep(Duration::from_millis(30)).await;
            a.fetch_sub(1, Ordering::SeqCst);
            r.fetch_add(1, Ordering::SeqCst);
            Ok(JobOutcome::Completed("ok".into()))
        }
    }));
    let handle = scheduler.spawn();
    let started = Instant::now();
    wait_until(|| runs.load(Ordering::SeqCst) >= 3).await;
    // Three serial 30 ms runs need at least 90 ms.
    assert!(started.elapsed() >= Duration::from_millis(90));
    handle.shutdown().await;
    assert_eq!(max_active.load(Ordering::SeqCst), 1);
    assert_eq!(active.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn errors_and_panics_do_not_stop_the_schedule() {
    let runs = Arc::new(AtomicUsize::new(0));
    let r = runs.clone();
    let mut scheduler = Scheduler::new();
    scheduler.add(Job::new("flaky", schedule(1, 0), move || {
        let run = r.fetch_add(1, Ordering::SeqCst);
        if run == 2 {
            panic!("job factory panicked");
        }
        async move {
            match run {
                0 => Err::<JobOutcome, JobError>("database unavailable".into()),
                1 => panic!("job future panicked"),
                _ => Ok(JobOutcome::Completed("ok".into())),
            }
        }
    }));
    let handle = scheduler.spawn();
    wait_until(|| runs.load(Ordering::SeqCst) >= 5).await;
    assert_eq!(handle.job_names(), vec!["flaky"]);
    handle.shutdown().await;
}

#[tokio::test]
async fn disabled_jobs_never_run_and_initial_delay_is_respected() {
    let disabled_runs = Arc::new(AtomicUsize::new(0));
    let delayed_runs = Arc::new(AtomicUsize::new(0));
    let (d, l) = (disabled_runs.clone(), delayed_runs.clone());
    let mut scheduler = Scheduler::new();
    scheduler
        .add(Job::new(
            "disabled",
            JobSchedule {
                enabled: false,
                ..schedule(1, 0)
            },
            move || {
                d.fetch_add(1, Ordering::SeqCst);
                async { Ok(JobOutcome::SkippedLocked) }
            },
        ))
        .add(Job::new("delayed", schedule(1, 3_600_000), move || {
            l.fetch_add(1, Ordering::SeqCst);
            async { Ok(JobOutcome::SkippedLocked) }
        }));
    let handle = scheduler.spawn();
    assert_eq!(handle.job_names(), vec!["delayed"]);
    tokio::time::sleep(Duration::from_millis(50)).await;
    let started = Instant::now();
    handle.shutdown().await;
    // Cancellation interrupts the one-hour initial delay immediately.
    assert!(started.elapsed() < Duration::from_secs(1));
    assert_eq!(disabled_runs.load(Ordering::SeqCst), 0);
    assert_eq!(delayed_runs.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn shutdown_waits_for_in_flight_run_then_stops() {
    let started_runs = Arc::new(AtomicUsize::new(0));
    let finished_runs = Arc::new(AtomicUsize::new(0));
    let (s, f) = (started_runs.clone(), finished_runs.clone());
    let mut scheduler = Scheduler::new();
    scheduler.add(Job::new("long", schedule(1, 0), move || {
        let (s, f) = (s.clone(), f.clone());
        async move {
            s.fetch_add(1, Ordering::SeqCst);
            tokio::time::sleep(Duration::from_millis(50)).await;
            f.fetch_add(1, Ordering::SeqCst);
            Ok(JobOutcome::Completed("done".into()))
        }
    }));
    let handle = scheduler.spawn();
    wait_until(|| started_runs.load(Ordering::SeqCst) == 1).await;
    handle.shutdown().await;
    assert_eq!(started_runs.load(Ordering::SeqCst), 1);
    assert_eq!(finished_runs.load(Ordering::SeqCst), 1);
    tokio::time::sleep(Duration::from_millis(20)).await;
    assert_eq!(started_runs.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn empty_handle_shuts_down() {
    let handle = SchedulerHandle::empty();
    assert!(handle.job_names().is_empty());
    handle.shutdown().await;
}

#[test]
fn advisory_lock_keys_are_pinned() {
    // Pinned (independently computed FNV-1a) so a refactor cannot silently change the
    // cross-instance lock identity of a job.
    const KEY: i64 = advisory_lock_key("expired-annotation-mutexes");
    assert_eq!(KEY, -3_287_501_116_225_812_901);
    assert_eq!(
        advisory_lock_key("expired-tokens"),
        8_171_176_992_823_393_154
    );
    assert_eq!(advisory_lock_key("old-tokens"), -2_542_763_403_359_019_322);
    assert_eq!(
        advisory_lock_key("expired-invites"),
        -6_959_999_106_386_544_098
    );
    assert_eq!(
        advisory_lock_key("initializing-annotations"),
        -8_590_498_379_649_204_646
    );
    assert_eq!(
        advisory_lock_key("expired-thumbnails"),
        -618_485_299_474_650_739
    );
}
