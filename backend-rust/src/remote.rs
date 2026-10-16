pub mod datastore;
pub mod tracingstore;
pub mod user_access;

use crate::AppState;
use axum::Router;

pub fn router(allow_delete_datasets: bool) -> Router<AppState> {
    Router::new()
        .merge(datastore::credentials::router())
        .merge(datastore::router())
        .merge(datastore::lookup::router())
        .merge(datastore::mag_upload::router())
        .merge(datastore::dataset_upload::router())
        .merge(datastore::dataset_report::router())
        .merge(datastore::attachment_upload::router())
        .merge(tracingstore::reads::router())
        .merge(tracingstore::update::router())
        .merge(tracingstore::report::router())
        .merge(tracingstore::create::router())
        .merge(user_access::router(allow_delete_datasets))
}
