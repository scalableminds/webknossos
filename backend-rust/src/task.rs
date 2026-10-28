pub mod assignment;
pub mod creation;
pub mod creation_from_files;
pub mod request;
pub mod routes;
pub(crate) mod task_dao;
pub mod types;

use crate::AppState;
use axum::Router;

pub fn router() -> Router<AppState> {
    Router::new()
        .merge(assignment::router())
        .merge(request::router())
        .merge(creation::router())
        .merge(creation_from_files::router())
        .merge(types::router())
        .merge(routes::router())
}
