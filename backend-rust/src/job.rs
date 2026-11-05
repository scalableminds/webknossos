pub(crate) mod job_dao;
pub mod routes;
pub mod submission;
pub mod workers;

use crate::AppState;
use axum::Router;

pub fn router() -> Router<AppState> {
    Router::new()
        .merge(submission::router())
        .merge(workers::router())
        .merge(routes::router())
}
