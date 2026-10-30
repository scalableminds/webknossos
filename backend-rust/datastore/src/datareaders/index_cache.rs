//! Bounded single-flight cache for immutable shard/minishard indexes (Scala AlfuCache defaults).
use crate::cache::{DEFAULT_TIME_TO_IDLE, DEFAULT_TIME_TO_LIVE};
use crate::{
    cache::AlfuCache,
    datavault::{VaultError, VaultResult},
};
use std::{future::Future, sync::Arc};

pub(crate) struct IndexCache<T> {
    cache: AlfuCache<String, Arc<T>, VaultError>,
}

impl<T: Send + Sync + 'static> Default for IndexCache<T> {
    fn default() -> Self {
        Self::with_capacity(1000)
    }
}

impl<T> std::fmt::Debug for IndexCache<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("IndexCache")
    }
}

impl<T: Send + Sync + 'static> IndexCache<T> {
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            cache: AlfuCache::new(capacity, DEFAULT_TIME_TO_LIVE, DEFAULT_TIME_TO_IDLE),
        }
    }

    pub fn clear_matching(&self, mut predicate: impl FnMut(&str) -> bool) -> usize {
        self.cache.clear_matching(|key| predicate(key))
    }

    pub fn len(&self) -> usize {
        self.cache.len()
    }

    pub async fn get_or_load<F, Fut>(&self, key: &str, load: F) -> VaultResult<Arc<T>>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = VaultResult<T>>,
    {
        self.cache
            .get_or_load_by_ref(key, || async { load().await.map(Arc::new) })
            .await
    }
}

#[cfg(test)]
mod datareaders_index_cache_tests;
