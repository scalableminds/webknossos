//! Scala `ChunkCacheService.sharedChunkContentsCache`: one process-wide async loading cache of
//! chunk contents, keyed with a JSON-encoded source/layer scope plus vault path and chunk index,
//! weighted in kilobytes (`sizeBytes / 1000`) with a maximum weight of
//! `floor(imageArrayChunks.maxSizeBytes / 1000)` (default 2 GB), expire after write 2 h and after
//! access 1 h (Scala `AlfuCache` defaults). Concurrent loads of one key share a single load;
//! failures are not cached. See [`crate::cache`] for the moka-backed implementation and its
//! eviction deviation.

use std::{future::Future, sync::Arc, time::Duration};

use super::chunk::ChunkContents;
use crate::{
    cache::AlfuCache,
    error::{DsError, DsResult},
};

/// Scala default `datastore.cache.imageArrayChunks.maxSizeBytes`.
pub const DEFAULT_MAX_SIZE_BYTES: u64 = 2_000_000_000;
const TIME_TO_LIVE: Duration = Duration::from_secs(2 * 60 * 60);
const TIME_TO_IDLE: Duration = Duration::from_secs(60 * 60);

/// A loaded chunk with its weight in kilobytes (the weight depends on the array header, which
/// only the loader knows).
#[derive(Clone)]
struct WeighedChunk {
    contents: Arc<ChunkContents>,
    weight_kb: u32,
}

/// The shared chunk contents cache (Scala `AlfuCache[String, MultiArray]`).
pub(crate) fn source_layer_cache_key(id: &crate::models::DataSourceId, layer: &str) -> String {
    serde_json::to_string(&[&id.organization_id, &id.directory_name, layer])
        .expect("string array serializes")
}

#[derive(Debug)]
pub struct ChunkContentsCache {
    cache: AlfuCache<String, WeighedChunk, DsError>,
}

impl ChunkContentsCache {
    /// Scala `ChunkCacheService` with `maxSizeBytes` (`WK_DS` config
    /// `cache.image_array_chunks_max_size_bytes`).
    pub fn new(max_size_bytes: u64) -> Self {
        Self {
            cache: AlfuCache::weighted(
                max_size_bytes / 1000,
                TIME_TO_LIVE,
                TIME_TO_IDLE,
                |chunk: &WeighedChunk| chunk.weight_kb,
            ),
        }
    }

    pub fn len(&self) -> usize {
        self.cache.len()
    }

    pub fn is_empty(&self) -> bool {
        self.cache.is_empty()
    }

    /// Total weight of loaded entries in kilobytes.
    pub fn weight_kb(&self) -> u64 {
        self.cache.weighted_size()
    }

    pub fn contains(&self, key: &str) -> bool {
        self.cache.contains(key)
    }

    /// Scala `clear(predicate)`: removes matching keys, returns how many.
    pub fn clear_matching(&self, mut predicate: impl FnMut(&str) -> bool) -> usize {
        self.cache.clear_matching(|key| predicate(key))
    }

    /// Clear exactly one source/layer, including names containing the old __ delimiter.
    pub fn clear_for_source(&self, id: &crate::models::DataSourceId, layer: Option<&str>) -> usize {
        self.clear_matching(|key| {
            let mut stream = serde_json::Deserializer::from_str(key).into_iter::<Vec<String>>();
            stream.next().is_some_and(|scope| {
                scope.is_ok_and(|scope| {
                    scope.len() == 3
                        && scope[0] == id.organization_id
                        && scope[1] == id.directory_name
                        && layer.is_none_or(|l| scope[2] == l)
                })
            })
        })
    }

    /// Scala `getOrLoad`. `weigh` gives the loaded value's size in bytes.
    pub async fn get_or_load<F, Fut>(
        &self,
        key: &str,
        load: F,
        weigh: impl FnOnce(&ChunkContents) -> usize,
    ) -> DsResult<Arc<ChunkContents>>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = DsResult<ChunkContents>>,
    {
        self.cache
            .get_or_load_by_ref(key, || async {
                let contents = load().await?;
                let weight_kb = u32::try_from((weigh(&contents) / 1000).max(1)).unwrap_or(u32::MAX);
                Ok(WeighedChunk {
                    contents: Arc::new(contents),
                    weight_kb,
                })
            })
            .await
            .map(|chunk| chunk.contents)
    }
}

#[cfg(test)]
mod tests;
