pub(crate) mod auth_dao;
pub mod browser;
pub mod extractors;
pub mod oidc;
pub mod routes;
pub mod webauthn;

pub use extractors::*;

use crate::AppState;
use axum::Router;

pub fn router() -> Router<AppState> {
    Router::new()
        .merge(oidc::router())
        .merge(webauthn::router())
        .merge(routes::router())
        .merge(browser::router())
        .merge(browser::account::router())
        .merge(browser::onboarding::router())
}
