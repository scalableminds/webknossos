pub mod routes;
pub mod submission;
pub mod workers;

use crate::AppState;
use axum::Router;

pub fn router(
    jobs_enabled: bool,
    jobs: &routes::JobsConfig,
    auth_routes: &crate::auth::routes::AuthRouteConfig,
) -> Router<AppState> {
    Router::new()
        .merge(submission::router(jobs_enabled))
        .merge(workers::router(jobs, auth_routes.auth_idle_timeout))
        .merge(routes::router(
            jobs_enabled,
            jobs.clone(),
            auth_routes.clone(),
        ))
}
