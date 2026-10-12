//! Scala DatasetCache: datasource RPCs already contain resolved mag and attachment paths.
use std::{sync::Arc, time::Duration};

use crate::{
    error::{DsError, DsResult},
    models::{DataSource, StaticLayer, UsableDataSource},
    wk_client::{AlfuCache, WkClient},
};

#[derive(Clone)]
pub struct DatasetCache {
    client: WkClient,
    cache: Arc<AlfuCache<String, Arc<UsableDataSource>>>,
}

impl DatasetCache {
    pub fn new(client: WkClient) -> Self {
        Self {
            client,
            // DatasetCache overrides TTL/capacity; AlfuCache's default idle timeout stays 1h.
            cache: Arc::new(AlfuCache::new(
                5000,
                Duration::from_secs(24 * 60 * 60),
                Duration::from_secs(60 * 60),
            )),
        }
    }

    /// Controllers must validate dataset access before calling this token-independent cache.
    pub async fn get_by_id(&self, id: &str) -> DsResult<Arc<UsableDataSource>> {
        self.cache
            .get_or_load(id.to_owned(), || async {
                let source: DataSource = self.client.get_data_source(id).await?;
                match source {
                    DataSource::Usable(source) => Ok(Arc::new(source)),
                    DataSource::Unusable(source) => Err(DsError::failure(format!(
                        "Data source is not usable: Some({})",
                        source.status
                    ))),
                }
            })
            .await
    }

    pub async fn get_with_layer(
        &self,
        id: &str,
        name: &str,
    ) -> DsResult<(Arc<UsableDataSource>, Arc<StaticLayer>)> {
        let source = self.get_by_id(id).await?;
        let layer = source.get_data_layer(name).cloned().ok_or_else(|| {
            DsError::failure(format!("Could not find layer “{name}” in dataset."))
        })?;
        Ok((source, Arc::new(layer)))
    }

    pub fn invalidate(&self, id: &str) {
        self.cache.remove(&id.to_owned());
    }

    pub fn len(&self) -> usize {
        self.cache.len()
    }

    pub fn is_empty(&self) -> bool {
        self.cache.is_empty()
    }
}
