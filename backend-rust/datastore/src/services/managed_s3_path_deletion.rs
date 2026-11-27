//! Scala `ManagedS3PathDeletionService`. Paths in managed S3 are not deleted synchronously when
//! a dataset (or a part of it) is deleted. Instead, WEBKNOSSOS queues them, and this service
//! periodically fetches them, deletes those covered by this datastore's global S3 credentials
//! and reports the deleted ones back.
use std::time::Duration;

use tokio::task::JoinHandle;
use webknossos_common::upath::UPath;

use crate::{
    clients::wk::WkClient, config::ManagedS3PathDeletionConfig, datavault::DataVaultService,
    error::DsResult,
};

/// Scala `IntervalScheduler.tickerInitialDelay`.
const INITIAL_DELAY: Duration = Duration::from_secs(10);

#[derive(Clone)]
pub struct ManagedS3PathDeletionService {
    wk_client: WkClient,
    data_vaults: DataVaultService,
}

impl ManagedS3PathDeletionService {
    pub fn new(wk_client: WkClient, data_vaults: DataVaultService) -> Self {
        Self {
            wk_client,
            data_vaults,
        }
    }

    /// Starts the periodic deletion (Scala `IntervalScheduler`: first tick after 10 s, then
    /// `interval` after the previous tick completed). `None` if disabled. Abort the handle on
    /// shutdown.
    pub fn spawn(&self, config: &ManagedS3PathDeletionConfig) -> Option<JoinHandle<()>> {
        if !config.enabled {
            return None;
        }
        let service = self.clone();
        let interval = config.interval;
        Some(tokio::spawn(async move {
            tokio::time::sleep(INITIAL_DELAY).await;
            loop {
                if let Err(error) = service.tick().await {
                    tracing::warn!("Deleting queued managed S3 paths failed: {error}");
                }
                tokio::time::sleep(interval).await;
            }
        }))
    }

    /// One `IntervalScheduler.tick`.
    pub async fn tick(&self) -> DsResult<()> {
        if !self.data_vaults.has_global_s3_credentials() {
            return Ok(());
        }
        let paths_to_delete = self.wk_client.get_paths_to_delete().await?;
        // Other datastores may be responsible for paths this one has no credentials for.
        let paths_to_delete_here: Vec<String> = paths_to_delete
            .into_iter()
            .filter(|literal| {
                UPath::parse(literal)
                    .is_ok_and(|path| self.data_vaults.path_is_in_managed_s3(&path))
            })
            .collect();
        let deleted_paths = self.delete_paths(paths_to_delete_here).await;
        if !deleted_paths.is_empty() {
            self.wk_client.mark_paths_as_deleted(&deleted_paths).await?;
        }
        Ok(())
    }

    /// Deletes the paths one after the other; returns those that were deleted.
    async fn delete_paths(&self, literals: Vec<String>) -> Vec<String> {
        if literals.is_empty() {
            return literals;
        }
        tracing::info!(
            "Deleting {} paths from managed S3 as listed by WEBKNOSSOS...",
            literals.len()
        );
        let mut deleted = Vec::with_capacity(literals.len());
        for literal in literals {
            let result = async {
                let path = UPath::parse(&literal)?;
                tracing::info!("Deleting {path} from managed S3...");
                self.data_vaults
                    .delete_recursively_in_managed_s3(&path)
                    .await
            }
            .await;
            match result {
                Ok(()) => deleted.push(literal),
                Err(error) => {
                    tracing::warn!("Could not delete {literal} from managed S3: {error}");
                }
            }
        }
        deleted
    }
}
