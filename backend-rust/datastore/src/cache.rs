//! Scala `util.cache.AlfuCache` (Caffeine `AsyncLoadingCache`) on [`moka`]: an async loading cache
//! whose concurrent loads of one key share a single load, whose failed loads are never kept, and
//! whose values expire `time_to_live` after the load or `time_to_idle` after the last access,
//! whichever comes first.
//!
//! moka stores one load cell per key. The cell is inserted when the load starts and stored again
//! when it succeeds, but only if the key still maps to that cell. A key invalidated during its
//! load therefore never gets the stale value (Caffeine removes the pending future the same way;
//! moka's own `get_with` would insert it after the invalidation). Loads in progress never expire
//! and weigh nothing.
//!
//! Deviation: entries are evicted least recently used first (moka's LRU policy). moka's TinyLFU
//! lacks Caffeine's admission window, so it could refuse a freshly loaded chunk that the next
//! bucket of the same request needs.

use std::{
    borrow::Borrow,
    future::Future,
    hash::Hash,
    sync::Arc,
    time::{Duration, Instant},
};

use moka::{Expiry, ops::compute::Op, policy::EvictionPolicy, sync::Cache};
use tokio::sync::OnceCell;

use crate::error::DsError;

type Cell<V, E> = Arc<OnceCell<Result<V, E>>>;
type Builder<K, V, E> = moka::sync::CacheBuilder<K, Cell<V, E>, Cache<K, Cell<V, E>>>;

fn is_loaded<V, E>(cell: &Cell<V, E>) -> bool {
    matches!(cell.get(), Some(Ok(_)))
}

/// Time to live from the completed load, time to idle from the last access; never while loading.
struct LoadExpiry {
    time_to_live: Duration,
    time_to_idle: Duration,
}

impl<K, V, E> Expiry<K, Cell<V, E>> for LoadExpiry {
    fn expire_after_create(&self, _: &K, cell: &Cell<V, E>, _: Instant) -> Option<Duration> {
        is_loaded(cell).then(|| self.time_to_live.min(self.time_to_idle))
    }

    fn expire_after_read(
        &self,
        _: &K,
        cell: &Cell<V, E>,
        read_at: Instant,
        duration_until_expiry: Option<Duration>,
        last_modified_at: Instant,
    ) -> Option<Duration> {
        if !is_loaded(cell) {
            return duration_until_expiry;
        }
        let lived = read_at.saturating_duration_since(last_modified_at);
        Some(
            self.time_to_live
                .saturating_sub(lived)
                .min(self.time_to_idle),
        )
    }

    fn expire_after_update(
        &self,
        _: &K,
        cell: &Cell<V, E>,
        _: Instant,
        duration_until_expiry: Option<Duration>,
    ) -> Option<Duration> {
        if is_loaded(cell) {
            Some(self.time_to_live.min(self.time_to_idle))
        } else {
            duration_until_expiry
        }
    }
}

pub struct AlfuCache<K, V, E = DsError> {
    cache: Cache<K, Cell<V, E>>,
}

impl<K, V, E> std::fmt::Debug for AlfuCache<K, V, E> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AlfuCache")
            .field("entries", &self.cache.entry_count())
            .finish()
    }
}

impl<K, V, E> AlfuCache<K, V, E>
where
    K: Hash + Eq + Send + Sync + 'static,
    V: Clone + Send + Sync + 'static,
    E: Clone + Send + Sync + 'static,
{
    /// Scala `AlfuCache.apply` defaults: capacity 1000, time to live 2 h, time to idle 1 h.
    pub fn with_defaults() -> Self {
        Self::new(
            1000,
            Duration::from_secs(2 * 60 * 60),
            Duration::from_secs(60 * 60),
        )
    }

    /// At most `max_capacity` entries.
    pub fn new(max_capacity: usize, time_to_live: Duration, time_to_idle: Duration) -> Self {
        Self::build(
            Cache::builder().max_capacity(max_capacity.max(1) as u64),
            time_to_live,
            time_to_idle,
        )
    }

    /// At most `max_weight` in total, `weigh` giving the weight of one loaded value.
    pub fn weighted(
        max_weight: u64,
        time_to_live: Duration,
        time_to_idle: Duration,
        weigh: impl Fn(&V) -> u32 + Send + Sync + 'static,
    ) -> Self {
        Self::build(
            Cache::builder().max_capacity(max_weight).weigher(
                move |_, cell: &Cell<V, E>| match cell.get() {
                    Some(Ok(value)) => weigh(value),
                    _ => 0,
                },
            ),
            time_to_live,
            time_to_idle,
        )
    }

    fn build(builder: Builder<K, V, E>, time_to_live: Duration, time_to_idle: Duration) -> Self {
        Self {
            cache: builder
                .eviction_policy(EvictionPolicy::lru())
                .expire_after(LoadExpiry {
                    time_to_live,
                    time_to_idle,
                })
                .build(),
        }
    }

    /// Scala `getOrLoad`.
    pub async fn get_or_load<F, Fut>(&self, key: K, load: F) -> Result<V, E>
    where
        K: Clone,
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<V, E>>,
    {
        self.get_or_load_by_ref(&key, load).await
    }

    /// [`Self::get_or_load`] for a borrowed key; hits do not allocate an owned key.
    pub async fn get_or_load_by_ref<Q, F, Fut>(&self, key: &Q, load: F) -> Result<V, E>
    where
        K: Borrow<Q>,
        Q: Hash + Eq + ToOwned<Owned = K> + ?Sized,
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<V, E>>,
    {
        let cell = match self.cache.get(key) {
            Some(cell) => cell,
            None => self
                .cache
                .entry_by_ref(key)
                .or_insert_with(|| Arc::new(OnceCell::new()))
                .into_value(),
        };
        if let Some(result) = cell.get() {
            return result.clone();
        }
        let mut loaded_here = false;
        let result = cell
            .get_or_init(|| {
                loaded_here = true;
                load()
            })
            .await
            .clone();
        if loaded_here {
            // Store again so the weigher and the expiry see the loaded value; drop failures. A
            // key that was invalidated or reloaded meanwhile is left alone.
            self.cache
                .entry_by_ref(key)
                .and_compute_with(|entry| match entry {
                    Some(entry) if Arc::ptr_eq(entry.value(), &cell) => {
                        if result.is_ok() {
                            Op::Put(Arc::clone(&cell))
                        } else {
                            Op::Remove
                        }
                    }
                    _ => Op::Nop,
                });
        }
        result
    }

    /// Scala `remove`.
    pub fn remove<Q>(&self, key: &Q)
    where
        K: Borrow<Q>,
        Q: Hash + Eq + ?Sized,
    {
        self.cache.invalidate(key);
    }

    /// Scala `clear(fn)`: removes all keys matching `predicate`, including loads in progress;
    /// returns how many.
    pub fn clear_matching(&self, mut predicate: impl FnMut(&K) -> bool) -> usize {
        // Apply pending evictions first, so evicted entries are not counted.
        self.cache.run_pending_tasks();
        let mut removed = 0;
        for (key, _) in self.cache.iter() {
            if predicate(&key) {
                self.cache.invalidate(&*key);
                removed += 1;
            }
        }
        removed
    }

    /// Scala `clear()`.
    pub fn clear(&self) {
        self.cache.invalidate_all();
    }

    pub fn contains<Q>(&self, key: &Q) -> bool
    where
        K: Borrow<Q>,
        Q: Hash + Eq + ?Sized,
    {
        self.cache.contains_key(key)
    }

    /// Number of entries, including loads in progress (after applying pending evictions).
    pub fn len(&self) -> usize {
        self.cache.run_pending_tasks();
        self.cache.entry_count() as usize
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Total weight of the loaded values (after applying pending evictions).
    pub fn weighted_size(&self) -> u64 {
        self.cache.run_pending_tasks();
        self.cache.weighted_size()
    }
}

#[cfg(test)]
mod cache_tests;
