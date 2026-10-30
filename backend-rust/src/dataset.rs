pub mod access;
pub mod compose;
pub mod configuration;
pub mod create;
pub(crate) mod dataset_dao;
pub mod explore;
pub(crate) mod legacy;
pub mod lifecycle;
pub mod options;
pub mod paths;
pub mod remote;
pub mod routes;
pub mod sam;
pub mod source;
pub mod thumbnails;
pub mod update;
pub mod upload_paths;

use crate::AppState;
use axum::Router;

pub fn router() -> Router<AppState> {
    Router::new()
        .merge(routes::router())
        .merge(routes::metadata_router())
        .merge(routes::lookup_router())
        .merge(configuration::router())
        .merge(remote::router())
        .merge(thumbnails::router())
        .merge(paths::router())
        .merge(compose::router())
        .merge(sam::router())
        .merge(explore::router())
        .merge(upload_paths::router())
        .merge(update::router())
        .merge(lifecycle::router())
}
