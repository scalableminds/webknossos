//! WKRemoteDataStoreController.listPathsToDelete / markPathsAsDeleted: the
//! datastores periodically fetch the queued managed-S3 paths
//! (PathDeletionService), delete those covered by their global S3
//! credentials, and report the deleted ones back.
use axum::{
    Json, Router,
    extract::State,
    routing::{get, post},
};

use super::ValidatedDataStore;
use crate::{
    AppState,
    error::{ApiError, ApiResult},
    extract::Json as RequestJson,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/datastores/{name}/pathsToDelete",
            get(list_paths_to_delete),
        )
        .route(
            "/datastores/{name}/pathsToDelete/markAsDeleted",
            post(mark_paths_as_deleted),
        )
}

/// The queue holds paths of all organizations, so datastores restricted to
/// one organization may not access it.
fn assert_may_process_path_deletion_queue(store: &ValidatedDataStore) -> ApiResult<()> {
    if store.0.only_allowed_organization.is_some() {
        return Err(ApiError::forbidden(crate::msg::NOT_ALLOWED));
    }
    Ok(())
}

async fn list_paths_to_delete(
    State(state): State<AppState>,
    store: ValidatedDataStore,
) -> ApiResult<Json<Vec<String>>> {
    assert_may_process_path_deletion_queue(&store)?;
    Ok(Json(
        crate::dataset::dataset_dao::find_paths_to_delete(&state.pool).await?,
    ))
}

async fn mark_paths_as_deleted(
    State(state): State<AppState>,
    store: ValidatedDataStore,
    RequestJson(paths): RequestJson<Vec<String>>,
) -> ApiResult<()> {
    assert_may_process_path_deletion_queue(&store)?;
    // Scala deletes in batches of 100 without a transaction; a single bound
    // statement is equivalent and atomic.
    crate::dataset::dataset_dao::delete_paths_to_delete(&state.pool, &paths).await?;
    Ok(())
}
