pub mod access;
pub mod create;
pub(crate) mod dao;
pub mod duplicate;
pub mod finish;
pub mod info;
pub mod io;
pub mod lifecycle;
pub mod lists;
pub mod merge;
pub mod metadata;
pub mod mutex;
pub mod nml;
pub mod private_links;
pub mod provider;
pub mod reopen;
pub mod reservations;
pub mod reset;
pub mod sandbox;
pub mod tracing_initialization;
pub mod transfer;

use crate::AppState;
use axum::Router;

pub fn router(jobs_enabled: bool, mutex_expiry: std::time::Duration) -> Router<AppState> {
    Router::new()
        .merge(private_links::router())
        .merge(lists::router(jobs_enabled))
        .merge(lifecycle::router())
        .merge(metadata::router(jobs_enabled))
        .merge(mutex::router(mutex_expiry))
        .merge(reopen::router(jobs_enabled))
        .merge(finish::router(jobs_enabled))
        .merge(info::router(jobs_enabled))
        .merge(duplicate::router(jobs_enabled))
        .merge(io::download::router(jobs_enabled))
        .merge(create::router(jobs_enabled))
        .merge(io::upload::router(jobs_enabled))
        .merge(merge::router(jobs_enabled))
        .merge(reset::router(jobs_enabled))
        .merge(reservations::router(jobs_enabled))
        .merge(sandbox::router(jobs_enabled))
        .merge(transfer::router(jobs_enabled))
}
