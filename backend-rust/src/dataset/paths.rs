//! PathDeletionService. Paths in managed S3 cannot be deleted synchronously:
//! they are queued in the database and periodically fetched and deleted by the
//! datastores (see `remote::datastore::paths_to_delete`).
use reqwest::Method;

use crate::{
    error::{ApiError, ApiResult},
    stores::client::ServiceClients,
};

/// UPath.toZipEntryUPath succeeds for `outer|zip:inner` and `outer|zip`.
fn is_zip_entry(path: &str) -> bool {
    path.contains("|zip:") || path.ends_with("|zip")
}

/// PathDeletionService.deletePaths: the datastore deletes local paths and
/// returns the managed-S3 paths, which are queued for the datastores.
pub(crate) async fn delete_paths(
    pool: &sqlx::PgPool,
    clients: &ServiceClients,
    store_url: &str,
    paths: &[String],
) -> ApiResult<()> {
    let filtered: Vec<&String> = paths.iter().filter(|p| !is_zip_entry(p)).collect();
    let response = clients
        .request(
            Method::DELETE,
            store_url,
            &["data", "datasets", "deletePaths"],
            &[],
            Some(&serde_json::json!(filtered)),
        )
        .await?;
    let external: Vec<String> = serde_json::from_slice(&response.bytes)
        .map_err(|_| ApiError::from(crate::stores::client::ServiceError::InvalidJson))?;
    if !external.is_empty() {
        crate::dataset::dataset_dao::insert_paths_to_delete(pool, &external).await?;
    }
    Ok(())
}
