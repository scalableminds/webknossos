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

pub fn router(mutex_expiry: std::time::Duration) -> Router<AppState> {
    Router::new()
        .merge(private_links::router())
        .merge(lists::router())
        .merge(lifecycle::router())
        .merge(metadata::router())
        .merge(mutex::router(mutex_expiry))
        .merge(reopen::router())
        .merge(finish::router())
        .merge(info::router())
        .merge(duplicate::router())
        .merge(io::download::router())
        .merge(create::router())
        .merge(io::upload::router())
        .merge(merge::router())
        .merge(reset::router())
        .merge(reservations::router())
        .merge(sandbox::router())
        .merge(transfer::router())
}
