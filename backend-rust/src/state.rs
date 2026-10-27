use crate::system::application_info::{MiscConfig, MiscState};
use axum::extract::FromRef;

/// Shared services and startup configuration. Handlers extract the part they need with
/// `State<T>`; `FromRef` makes a field that is not in the state a compile error.
#[derive(Clone, FromRef)]
pub struct AppState {
    pub pool: sqlx::PgPool,
    pub jobs_enabled: JobsEnabled,
    pub misc: MiscState,
}

/// `features.jobsEnabled`.
#[derive(Clone, Copy, Debug, Default)]
pub struct JobsEnabled(pub bool);

/// Startup configuration of an [`AppState`]; `build` creates the services from it.
pub struct AppStateBuilder {
    pool: sqlx::PgPool,
    jobs_enabled: bool,
    misc: MiscConfig,
}

impl AppState {
    /// Local defaults (matching `router`'s), as used by tests.
    pub fn new(pool: sqlx::PgPool) -> Self {
        Self::builder(pool).build()
    }

    /// Local defaults, to be overridden by the builder's setters.
    pub fn builder(pool: sqlx::PgPool) -> AppStateBuilder {
        AppStateBuilder {
            pool,
            jobs_enabled: false,
            misc: MiscConfig::default(),
        }
    }

    pub fn from_config(pool: sqlx::PgPool, config: &crate::config::Config) -> Self {
        Self::builder(pool)
            .jobs_enabled(config.jobs_enabled)
            .misc(config.misc.clone())
            .build()
    }
}

impl AppStateBuilder {
    pub fn jobs_enabled(mut self, enabled: bool) -> Self {
        self.jobs_enabled = enabled;
        self
    }

    pub fn misc(mut self, misc: MiscConfig) -> Self {
        self.misc = misc;
        self
    }

    pub fn build(self) -> AppState {
        AppState {
            pool: self.pool,
            jobs_enabled: JobsEnabled(self.jobs_enabled),
            misc: MiscState::new(self.misc),
        }
    }
}
