pub mod access;
pub mod compose;
pub mod configuration;
pub mod create;
pub(crate) mod dao;
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

pub fn router(
    datasets: &options::DatasetRouteConfig,
    allow_delete_datasets: bool,
) -> Router<AppState> {
    Router::new()
        .merge(routes::router())
        .merge(routes::metadata_router())
        .merge(routes::lookup_router())
        .merge(configuration::router())
        .merge(remote::router())
        .merge(thumbnails::router())
        .merge(paths::router(datasets.clone()))
        .merge(compose::router())
        .merge(sam::router(datasets.clone()))
        .merge(explore::router())
        .merge(upload_paths::router(datasets.clone()))
        .merge(update::router())
        .merge(lifecycle::router(allow_delete_datasets))
}
