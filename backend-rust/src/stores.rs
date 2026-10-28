pub mod client;
pub mod data;
pub(crate) mod stores_dao;
pub mod tracing;
pub mod tracing_client;

use crate::AppState;
use axum::Router;

pub fn router() -> Router<AppState> {
    Router::new().merge(data::router()).merge(tracing::router())
}
