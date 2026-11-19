//! Alignment projects (AlignmentProjectController, AlignmentProjectService, AlignmentProjectDAO):
//! tiles plus a tile CSV, uploaded through the datastore (see
//! `remote::datastore::alignment_project_upload` for the datastore callbacks), in which `align`
//! jobs can be started. Only admins and dataset managers of the project's organization see or
//! change alignment projects, and only while jobs are enabled.
//!
//! The uploaded input data is deleted [`AlignmentProjectsConfig::input_data_retention`] after
//! the project was created (`background::alignment_project_cleanup`).
pub(crate) mod alignment_project_dao;
pub mod routes;
pub(crate) mod service;

use std::{collections::HashMap, time::Duration};

use axum::Router;

use crate::{
    AppState,
    background::scheduler::JobSchedule,
    config::{ConfigError, Env},
};

pub fn router() -> Router<AppState> {
    routes::router()
}

/// Scala `webKnossos.alignmentProjects.inputDataRetention` default (90 days).
pub const DEFAULT_INPUT_DATA_RETENTION: Duration = Duration::from_secs(90 * 24 * 60 * 60);
/// Scala `webKnossos.alignmentProjects.inputDataCleanupInterval` default (6 hours).
pub const DEFAULT_INPUT_DATA_CLEANUP_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
/// Scala `IntervalScheduler.tickerInitialDelay` default.
pub const DEFAULT_INPUT_DATA_CLEANUP_INITIAL_DELAY: Duration = Duration::from_secs(10);

/// `webKnossos.alignmentProjects`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AlignmentProjectsConfig {
    /// `inputDataRetention`: uploaded input data is deleted this long after the project was
    /// created (postponed while alignments are pending or running).
    pub input_data_retention: Duration,
    /// The input data cleanup (`inputDataCleanupInterval`, always enabled in Scala).
    pub input_data_cleanup: JobSchedule,
}

impl Default for AlignmentProjectsConfig {
    fn default() -> Self {
        Self {
            input_data_retention: DEFAULT_INPUT_DATA_RETENTION,
            input_data_cleanup: JobSchedule {
                enabled: true,
                interval: DEFAULT_INPUT_DATA_CLEANUP_INTERVAL,
                initial_delay: DEFAULT_INPUT_DATA_CLEANUP_INITIAL_DELAY,
            },
        }
    }
}

/// Parses the settings from environment values (called by config.rs).
///
/// - `WK_ALIGNMENT_PROJECTS_INPUT_DATA_RETENTION_SECONDS` (> 0, default 7776000 = 90 days).
/// - `WK_ALIGNMENT_PROJECTS_INPUT_DATA_CLEANUP_INTERVAL_SECONDS` (> 0, default 21600 = 6 h).
/// - `WK_ALIGNMENT_PROJECTS_INPUT_DATA_CLEANUP_ENABLED` (default `true`; Scala has no switch).
pub fn config_from_values(
    values: &HashMap<String, String>,
) -> Result<AlignmentProjectsConfig, ConfigError> {
    let env = Env::new(values);
    let defaults = AlignmentProjectsConfig::default();
    Ok(AlignmentProjectsConfig {
        input_data_retention: env
            .seconds("WK_ALIGNMENT_PROJECTS_INPUT_DATA_RETENTION_SECONDS", false)?
            .unwrap_or(defaults.input_data_retention),
        input_data_cleanup: JobSchedule {
            interval: env
                .seconds(
                    "WK_ALIGNMENT_PROJECTS_INPUT_DATA_CLEANUP_INTERVAL_SECONDS",
                    false,
                )?
                .unwrap_or(defaults.input_data_cleanup.interval),
            ..defaults.input_data_cleanup
        }
        .with_enabled_from_env(env, "WK_ALIGNMENT_PROJECTS_INPUT_DATA_CLEANUP")?,
    })
}

#[cfg(test)]
mod alignment_project_tests;
