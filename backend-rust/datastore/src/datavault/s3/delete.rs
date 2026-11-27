//! Recursive deletion of managed S3 paths (Scala `ManagedS3Service.deleteRecursively`).
use futures::StreamExt;
use object_store::{ObjectStoreExt, list::PaginatedListOptions};

use super::{S3DataVault, VaultError, VaultResult, cloud};

impl S3DataVault {
    /// Deletes the object at `key` (if it is a file) and all objects below `key/` (if it is a
    /// directory). Bulk deletes go through `object_store`'s `delete_stream` (`DeleteObjects`).
    pub async fn delete_recursively(&self, key: &str) -> VaultResult<()> {
        let key = key.trim_end_matches('/');
        let store = self.store().await?;
        let prefix = format!("{key}/");
        let mut page_token = None;
        loop {
            let options = PaginatedListOptions {
                page_token,
                max_keys: Some(1000),
                ..PaginatedListOptions::default()
            };
            let page = store
                .list_paginated(Some(&prefix), options)
                .await
                .map_err(cloud::failure)?;
            let locations: Vec<_> = page
                .result
                .objects
                .into_iter()
                .map(|object| Ok(object.location))
                .collect();
            if !locations.is_empty() {
                let count = locations.len();
                let errors: Vec<object_store::Error> = store
                    .delete_stream(futures::stream::iter(locations).boxed())
                    .filter_map(|result| async move { result.err() })
                    .collect()
                    .await;
                if let Some(first) = errors.first() {
                    let bucket = self.bucket.as_deref().unwrap_or("null");
                    return Err(VaultError::failure(format!(
                        "Failed to delete {} of {count} objects in bucket {bucket}. First error: {first}",
                        errors.len()
                    )));
                }
            }
            match page.page_token {
                Some(token) => page_token = Some(token),
                None => break,
            }
        }
        // Deleting a missing object succeeds, like S3's DeleteObject.
        match store.delete(&cloud::object_path(key)?).await {
            Ok(()) | Err(object_store::Error::NotFound { .. }) => Ok(()),
            Err(error) => Err(cloud::failure(error)),
        }
    }
}
