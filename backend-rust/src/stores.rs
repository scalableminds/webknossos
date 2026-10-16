pub mod client;
pub mod data;
pub mod tracing;
pub mod tracing_client;

use crate::AppState;
use axum::Router;

pub fn router(jobs_enabled: bool) -> Router<AppState> {
    Router::new()
        .merge(data::router(jobs_enabled))
        .merge(tracing::router())
}
