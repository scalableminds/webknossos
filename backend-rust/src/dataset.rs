pub mod access;
pub mod compose;
pub mod configuration;
pub mod create;
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
    jobs_enabled: bool,
    datasets: &options::DatasetRouteConfig,
    allow_delete_datasets: bool,
    datastore_tokens: explore::DatastoreTokenConfig,
) -> Router<AppState> {
    Router::new()
        .merge(routes::router())
        .merge(routes::metadata_router(jobs_enabled))
        .merge(routes::lookup_router(jobs_enabled))
        .merge(configuration::router())
        .merge(remote::router())
        .merge(thumbnails::router())
        .merge(paths::router(datasets.clone()))
        .merge(compose::router())
        .merge(sam::router(datasets.clone()))
        .merge(explore::router(datastore_tokens))
        .merge(upload_paths::router(datasets.clone()))
        .merge(update::router(jobs_enabled))
        .merge(lifecycle::router(allow_delete_datasets, jobs_enabled))
}
