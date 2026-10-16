pub mod assignment;
pub mod creation;
pub mod creation_from_files;
pub mod request;
pub mod routes;
pub mod types;

use crate::AppState;
use axum::Router;

pub fn router(jobs_enabled: bool) -> Router<AppState> {
    Router::new()
        .merge(assignment::router(jobs_enabled))
        .merge(request::router(jobs_enabled))
        .merge(creation::router(jobs_enabled))
        .merge(creation_from_files::router(jobs_enabled))
        .merge(types::router())
        .merge(routes::router())
}
