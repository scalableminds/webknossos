//! Scala `ChunkCacheService.sharedChunkContentsCache`: one process-wide async loading cache of
//! chunk contents, keyed with a JSON-encoded source/layer scope plus vault path and chunk index,
//! weighted in kilobytes (`sizeBytes / 1000`) with a maximum weight of
//! `floor(imageArrayChunks.maxSizeBytes / 1000)` (default 2 GB), expire after write 2 h and after
//! access 1 h (Scala `AlfuCache` defaults). Concurrent loads of one key share a single load;
//! failures are not cached.
//!
//! Deviation: Caffeine evicts with W-TinyLFU; this cache evicts least recently used entries.

use std::{
    collections::{BTreeMap, HashMap},
    future::Future,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use tokio::sync::OnceCell;

use super::chunk::ChunkContents;
use crate::error::DsResult;

/// Scala default `datastore.cache.imageArrayChunks.maxSizeBytes`.
pub const DEFAULT_MAX_SIZE_BYTES: u64 = 2_000_000_000;
const TIME_TO_LIVE: Duration = Duration::from_secs(2 * 60 * 60);
const TIME_TO_IDLE: Duration = Duration::from_secs(60 * 60);

type Cell = Arc<OnceCell<DsResult<Arc<ChunkContents>>>>;

struct Entry {
    cell: Cell,
    /// Weight in kilobytes once loaded; `None` while loading.
    weight: Option<u64>,
    loaded_at: Option<Instant>,
    accessed_at: Instant,
    tick: u64,
}

#[derive(Default)]
struct State {
    entries: HashMap<String, Entry>,
    /// Access order: tick → key (oldest first).
    order: BTreeMap<u64, String>,
    next_tick: u64,
    total_weight: u64,
}

impl State {
    fn touch(&mut self, key: &str, now: Instant) {
        let tick = self.next_tick;
        self.next_tick += 1;
        if let Some(entry) = self.entries.get_mut(key) {
            self.order.remove(&entry.tick);
            entry.tick = tick;
            entry.accessed_at = now;
            self.order.insert(tick, key.to_string());
        }
    }

    fn remove(&mut self, key: &str) {
        if let Some(entry) = self.entries.remove(key) {
            self.order.remove(&entry.tick);
            self.total_weight -= entry.weight.unwrap_or(0);
        }
    }

    fn is_expired(entry: &Entry, now: Instant) -> bool {
        entry.loaded_at.is_some_and(|loaded| {
            now.duration_since(loaded) >= TIME_TO_LIVE
                || now.duration_since(entry.accessed_at) >= TIME_TO_IDLE
        })
    }

    fn evict(&mut self, max_weight: u64) {
        let mut skipped = Vec::new();
        while self.total_weight > max_weight {
            let Some((&tick, key)) = self.order.iter().find(|(t, _)| !skipped.contains(*t)) else {
                break;
            };
            let key = key.clone();
            if self.entries.get(&key).is_some_and(|e| e.weight.is_none()) {
                skipped.push(tick); // in-flight loads are not evicted
                continue;
            }
            self.remove(&key);
        }
    }
}

/// The shared chunk contents cache (Scala `AlfuCache[String, MultiArray]`).
pub(crate) fn source_layer_cache_key(id: &crate::models::DataSourceId, layer: &str) -> String {
    serde_json::to_string(&[&id.organization_id, &id.directory_name, layer])
        .expect("string array serializes")
}
pub struct ChunkContentsCache {
    state: Mutex<State>,
    max_weight_kb: u64,
}

impl std::fmt::Debug for ChunkContentsCache {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ChunkContentsCache")
            .field("max_weight_kb", &self.max_weight_kb)
            .field("entries", &self.len())
            .finish()
    }
}

impl ChunkContentsCache {
    /// Scala `ChunkCacheService` with `maxSizeBytes` (`WK_DS` config
    /// `cache.image_array_chunks_max_size_bytes`).
    pub fn new(max_size_bytes: u64) -> Self {
        Self {
            state: Mutex::new(State::default()),
            max_weight_kb: max_size_bytes / 1000,
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn len(&self) -> usize {
        self.lock().entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Total weight of loaded entries in kilobytes.
    pub fn weight_kb(&self) -> u64 {
        self.lock().total_weight
    }

    pub fn contains(&self, key: &str) -> bool {
        self.lock().entries.contains_key(key)
    }

    /// Scala `clear(predicate)`: removes matching keys, returns how many.
    pub fn clear_matching(&self, mut predicate: impl FnMut(&str) -> bool) -> usize {
        let mut state = self.lock();
        let keys: Vec<String> = state
            .entries
            .keys()
            .filter(|k| predicate(k))
            .cloned()
            .collect();
        for key in &keys {
            state.remove(key);
        }
        keys.len()
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
        let cell: Cell = {
            let mut state = self.lock();
            let now = Instant::now();
            let live = state.entries.get(key).map(|e| !State::is_expired(e, now));
            match live {
                Some(true) => {
                    state.touch(key, now);
                    Arc::clone(&state.entries[key].cell)
                }
                _ => {
                    state.remove(key);
                    let cell: Cell = Arc::new(OnceCell::new());
                    let tick = state.next_tick;
                    state.next_tick += 1;
                    state.entries.insert(
                        key.to_string(),
                        Entry {
                            cell: Arc::clone(&cell),
                            weight: None,
                            loaded_at: None,
                            accessed_at: now,
                            tick,
                        },
                    );
                    state.order.insert(tick, key.to_string());
                    cell
                }
            }
        };
        let result = cell
            .get_or_init(|| async { load().await.map(Arc::new) })
            .await
            .clone();
        let mut state = self.lock();
        let is_ours = state
            .entries
            .get(key)
            .is_some_and(|e| Arc::ptr_eq(&e.cell, &cell));
        if is_ours {
            match &result {
                Err(_) => state.remove(key),
                Ok(value) => {
                    let pending = state.entries.get(key).is_some_and(|e| e.weight.is_none());
                    if pending {
                        let weight = (weigh(value) / 1000) as u64;
                        let now = Instant::now();
                        if let Some(entry) = state.entries.get_mut(key) {
                            entry.weight = Some(weight);
                            entry.loaded_at = Some(now);
                            entry.accessed_at = now;
                        }
                        state.total_weight += weight;
                        let max = self.max_weight_kb;
                        state.evict(max);
                    }
                }
            }
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chunk(len: usize) -> ChunkContents {
        ChunkContents::Bytes {
            bytes: Arc::new(vec![0; len]),
            shape: vec![len as i32],
        }
    }

    #[tokio::test]
    async fn caches_successes_and_evicts_by_weight() {
        let cache = ChunkContentsCache::new(5_000); // 5 KB
        let weigh = |c: &ChunkContents| match c {
            ChunkContents::Bytes { bytes, .. } => bytes.len(),
            ChunkContents::Fill { .. } => 0,
        };
        cache
            .get_or_load("a", || async { Ok(chunk(2000)) }, weigh)
            .await
            .unwrap();
        cache
            .get_or_load("b", || async { Ok(chunk(2000)) }, weigh)
            .await
            .unwrap();
        // cached: the loader must not run
        cache
            .get_or_load("a", || async { panic!("reloaded") }, weigh)
            .await
            .unwrap();
        assert_eq!(cache.weight_kb(), 4);
        cache
            .get_or_load("c", || async { Ok(chunk(2000)) }, weigh)
            .await
            .unwrap();
        // b was least recently used
        assert!(cache.contains("a") && cache.contains("c") && !cache.contains("b"));
        let failed = cache
            .get_or_load(
                "d",
                || async { Err(crate::error::DsError::failure("x")) },
                weigh,
            )
            .await;
        assert!(failed.is_err() && !cache.contains("d"));
        assert_eq!(cache.clear_matching(|k| k == "a"), 1);
    }
}
