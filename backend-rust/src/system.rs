pub mod analytics;
pub mod application_info;
pub mod initial_data;
pub mod maintenance;

use crate::AppState;
use axum::Router;

pub fn router() -> Router<AppState> {
    Router::new()
        .merge(application_info::router())
        .merge(analytics::router())
        .merge(initial_data::router())
        .merge(maintenance::router())
}
