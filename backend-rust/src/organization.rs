pub mod credit_transactions;
pub(crate) mod organization_dao;
pub mod pricing;
pub mod routes;
pub mod storage;
pub mod terms_of_service;

use crate::AppState;
use axum::Router;

pub fn router() -> Router<AppState> {
    Router::new()
        .merge(routes::router())
        .merge(pricing::router())
        .merge(terms_of_service::router())
        .merge(credit_transactions::router())
}
