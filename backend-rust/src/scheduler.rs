//! Background interval scheduler, the Rust counterpart of Scala's `CleanUpService.register`
//! (pekko `scheduleWithFixedDelay`) and the datastore `IntervalScheduler` trait.
//!
//! Every enabled job runs in its own Tokio task: wait `initial_delay`, run, then wait `interval`
//! measured from the *completion* of the previous run (IntervalScheduler semantics). A job is
//! therefore never run twice at once inside one process. Failures and panics are logged and the job
//! keeps its schedule. [`SchedulerHandle::shutdown`] stops all waiting jobs immediately and lets a
//! run that is already in progress finish (callers bound this with their shutdown deadline).
//!
//! Across processes (several Rust instances, or a Rust instance beside the Scala backend during a
//! staged cutover) jobs serialize with [`try_advisory_xact_lock`]: a transaction-scoped PostgreSQL
//! advisory lock keyed by [`advisory_lock_key`] of the job name. The Scala backend takes no such
//! lock, but every housekeeping job is a single idempotent statement, so a parallel Scala run only
//! means a second statement finding nothing left to do.

use std::{
    fmt,
    future::Future,
    panic::AssertUnwindSafe,
    pin::Pin,
    sync::Arc,
    time::{Duration, Instant},
};

use futures_util::FutureExt;
use sqlx::PgConnection;
use tokio::{sync::watch, task::JoinHandle};

pub type JobError = Box<dyn std::error::Error + Send + Sync>;

/// Result of one job execution, used for the completion log line.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum JobOutcome {
    /// The job ran; the string is a short human readable result (e.g. affected row count).
    Completed(String),
    /// Another instance currently holds this job's advisory lock; nothing was done.
    SkippedLocked,
}

pub type JobFuture = Pin<Box<dyn Future<Output = Result<JobOutcome, JobError>> + Send>>;

type JobFn = Arc<dyn Fn() -> JobFuture + Send + Sync>;

/// Schedule of one job.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct JobSchedule {
    pub enabled: bool,
    pub interval: Duration,
    pub initial_delay: Duration,
}

/// A named job: a factory producing one run's future, plus its schedule.
#[derive(Clone)]
pub struct Job {
    name: String,
    schedule: JobSchedule,
    run: JobFn,
}

impl fmt::Debug for Job {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Job")
            .field("name", &self.name)
            .field("schedule", &self.schedule)
            .finish_non_exhaustive()
    }
}

impl Job {
    pub fn new<F, Fut>(name: impl Into<String>, schedule: JobSchedule, run: F) -> Self
    where
        F: Fn() -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<JobOutcome, JobError>> + Send + 'static,
    {
        Self {
            name: name.into(),
            schedule,
            run: Arc::new(move || Box::pin(run())),
        }
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn schedule(&self) -> JobSchedule {
        self.schedule
    }
}

/// Collects jobs, then [`Scheduler::spawn`]s them onto the current Tokio runtime.
#[derive(Debug, Default)]
pub struct Scheduler {
    jobs: Vec<Job>,
}

impl Scheduler {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add(&mut self, job: Job) -> &mut Self {
        self.jobs.push(job);
        self
    }

    /// Starts one task per enabled job. Disabled jobs are logged and never run.
    pub fn spawn(self) -> SchedulerHandle {
        let (stop_send, stop_recv) = watch::channel(false);
        let mut tasks = Vec::new();
        for job in self.jobs {
            if !job.schedule.enabled {
                tracing::info!(job = %job.name, "Background job disabled");
                continue;
            }
            tracing::info!(
                job = %job.name,
                interval_seconds = job.schedule.interval.as_secs_f64(),
                initial_delay_seconds = job.schedule.initial_delay.as_secs_f64(),
                "Background job scheduled"
            );
            let name = job.name.clone();
            tasks.push((name, tokio::spawn(job_loop(job, stop_recv.clone()))));
        }
        SchedulerHandle {
            stop: stop_send,
            tasks,
        }
    }
}

/// Owns the spawned job tasks. Dropping the handle also stops the jobs (after any in-flight run),
/// but only [`SchedulerHandle::shutdown`] waits for them.
#[derive(Debug)]
pub struct SchedulerHandle {
    stop: watch::Sender<bool>,
    tasks: Vec<(String, JoinHandle<()>)>,
}

impl SchedulerHandle {
    /// A handle with no jobs (e.g. housekeeping globally disabled).
    pub fn empty() -> Self {
        Scheduler::new().spawn()
    }

    /// Names of the jobs that were started (enabled jobs only).
    pub fn job_names(&self) -> Vec<&str> {
        self.tasks.iter().map(|(name, _)| name.as_str()).collect()
    }

    /// Signals all jobs to stop and waits until every task has ended. Waiting jobs stop at once;
    /// a run in progress completes first. Wrap in `tokio::time::timeout` for a hard deadline.
    pub async fn shutdown(self) {
        let _ = self.stop.send(true);
        for (name, task) in self.tasks {
            if let Err(error) = task.await {
                tracing::error!(job = %name, %error, "Background job task ended abnormally");
            }
        }
    }
}

async fn job_loop(job: Job, mut stop: watch::Receiver<bool>) {
    let mut delay = job.schedule.initial_delay;
    loop {
        tokio::select! {
            biased;
            _ = stop.wait_for(|stopped| *stopped) => break,
            () = tokio::time::sleep(delay) => {}
        }
        run_once(&job).await;
        if *stop.borrow() {
            break;
        }
        delay = job.schedule.interval;
    }
    tracing::debug!(job = %job.name, "Background job stopped");
}

/// One logged execution. Errors and panics are contained so the schedule continues.
async fn run_once(job: &Job) {
    let started = Instant::now();
    // The factory call sits inside the async block so a panic there is contained as well.
    let result = AssertUnwindSafe(async { (job.run)().await })
        .catch_unwind()
        .await;
    let duration_ms = started.elapsed().as_millis() as u64;
    match result {
        Ok(Ok(JobOutcome::Completed(result))) => {
            tracing::info!(job = %job.name, duration_ms, %result, "Completed cleanup job: {}. Result: {result}", job.name);
        }
        Ok(Ok(JobOutcome::SkippedLocked)) => {
            tracing::info!(job = %job.name, duration_ms, "Skipped cleanup job: {} (running on another instance)", job.name);
        }
        Ok(Err(error)) => {
            tracing::warn!(job = %job.name, duration_ms, %error, "Failed to execute cleanup job: {}. {error}", job.name);
        }
        Err(_) => {
            tracing::error!(job = %job.name, duration_ms, "Panic during execution of cleanup job: {}", job.name);
        }
    }
}

/// Stable 64-bit advisory lock key for a job name (FNV-1a over `webknossos.scheduler:<name>`).
/// Deliberately computed in Rust, not with PostgreSQL's `hashtext*`, so the key never depends on
/// the server version.
pub const fn advisory_lock_key(name: &str) -> i64 {
    const PREFIX: &[u8] = b"webknossos.scheduler:";
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    let mut index = 0;
    while index < PREFIX.len() {
        hash ^= PREFIX[index] as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        index += 1;
    }
    let bytes = name.as_bytes();
    index = 0;
    while index < bytes.len() {
        hash ^= bytes[index] as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        index += 1;
    }
    hash as i64
}

/// `pg_try_advisory_xact_lock(key)` on a connection that is inside a transaction. The lock is
/// released automatically at commit or rollback. Returns false if another session holds it.
pub async fn try_advisory_xact_lock(
    connection: &mut PgConnection,
    key: i64,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT pg_try_advisory_xact_lock($1)")
        .bind(key)
        .fetch_one(connection)
        .await
}

#[cfg(test)]
mod tests {
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
}
