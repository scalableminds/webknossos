use axum::extract::FromRef;

/// Shared services and startup configuration. Handlers extract the part they need with
/// `State<T>`; `FromRef` makes a field that is not in the state a compile error.
#[derive(Clone, FromRef)]
pub struct AppState {
    pub pool: sqlx::PgPool,
    pub jobs_enabled: JobsEnabled,
}

/// `features.jobsEnabled`.
#[derive(Clone, Copy, Debug, Default)]
pub struct JobsEnabled(pub bool);

impl AppState {
    /// Local defaults (matching `router`'s), as used by tests.
    pub fn new(pool: sqlx::PgPool) -> Self {
        Self {
            pool,
            jobs_enabled: JobsEnabled(false),
        }
    }

    pub fn from_config(pool: sqlx::PgPool, config: &crate::config::Config) -> Self {
        Self::new(pool).with_jobs_enabled(config.jobs_enabled)
    }

    pub fn with_jobs_enabled(mut self, enabled: bool) -> Self {
        self.jobs_enabled = JobsEnabled(enabled);
        self
    }
}
