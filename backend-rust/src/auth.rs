pub mod browser;
pub(crate) mod dao;
pub mod extractors;
pub mod oidc;
pub mod routes;
pub mod webauthn;

pub use extractors::*;

use crate::AppState;
use axum::Router;

pub fn router(oidc: oidc::OidcConfig, auth_routes: routes::AuthRouteConfig) -> Router<AppState> {
    Router::new()
        .merge(oidc::router(oidc))
        .merge(webauthn::router())
        .merge(routes::router(auth_routes))
        .merge(browser::router())
        .merge(browser::account::router())
        .merge(browser::onboarding::router())
}
