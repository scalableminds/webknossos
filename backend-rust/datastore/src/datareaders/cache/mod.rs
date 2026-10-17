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
    /// Independent LRU shards chosen by key hash. One global lock serialized every chunk access of
    /// every request (differential load phase 2026-10-17: readData/histogram stopped scaling past
    /// 8 connections); Scala's Caffeine cache is concurrent. Weight limits apply per shard.
    shards: Box<[Mutex<State>]>,
    max_weight_kb_per_shard: u64,
}

/// Each shard holds at least this much, so small (test) caches stay one exact LRU.
const MIN_SHARD_WEIGHT_KB: u64 = 64 * 1024;
const MAX_SHARDS: u64 = 32;

impl std::fmt::Debug for ChunkContentsCache {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ChunkContentsCache")
            .field("max_weight_kb_per_shard", &self.max_weight_kb_per_shard)
            .field("shards", &self.shards.len())
            .field("entries", &self.len())
            .finish()
    }
}

impl ChunkContentsCache {
    /// Scala `ChunkCacheService` with `maxSizeBytes` (`WK_DS` config
    /// `cache.image_array_chunks_max_size_bytes`).
    pub fn new(max_size_bytes: u64) -> Self {
        let max_weight_kb = max_size_bytes / 1000;
        let shards = (max_weight_kb / MIN_SHARD_WEIGHT_KB).clamp(1, MAX_SHARDS);
        Self {
            shards: (0..shards).map(|_| Mutex::new(State::default())).collect(),
            max_weight_kb_per_shard: max_weight_kb / shards,
        }
    }

    fn lock_shard(shard: &Mutex<State>) -> std::sync::MutexGuard<'_, State> {
        shard.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// The shard of `key`; the key is hashed before any lock is taken.
    fn lock(&self, key: &str) -> std::sync::MutexGuard<'_, State> {
        use std::hash::{BuildHasher, BuildHasherDefault, DefaultHasher};
        let hash = BuildHasherDefault::<DefaultHasher>::default().hash_one(key);
        Self::lock_shard(&self.shards[(hash % self.shards.len() as u64) as usize])
    }

    fn sum(&self, f: impl Fn(&State) -> u64) -> u64 {
        self.shards
            .iter()
            .map(|shard| f(&Self::lock_shard(shard)))
            .sum()
    }

    pub fn len(&self) -> usize {
        self.sum(|state| state.entries.len() as u64) as usize
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Total weight of loaded entries in kilobytes.
    pub fn weight_kb(&self) -> u64 {
        self.sum(|state| state.total_weight)
    }

    pub fn contains(&self, key: &str) -> bool {
        self.lock(key).entries.contains_key(key)
    }

    /// Scala `clear(predicate)`: removes matching keys, returns how many.
    pub fn clear_matching(&self, mut predicate: impl FnMut(&str) -> bool) -> usize {
        let mut removed = 0;
        for shard in &self.shards {
            let mut state = Self::lock_shard(shard);
            let keys: Vec<String> = state
                .entries
                .keys()
                .filter(|k| predicate(k))
                .cloned()
                .collect();
            for key in &keys {
                state.remove(key);
            }
            removed += keys.len();
        }
        removed
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
            let mut state = self.lock(key);
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
        let mut state = self.lock(key);
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
                        let max = self.max_weight_kb_per_shard;
                        state.evict(max);
                    }
                }
            }
        }
        result
    }
}

#[cfg(test)]
mod tests;
