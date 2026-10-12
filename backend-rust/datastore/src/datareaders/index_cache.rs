//! Bounded single-flight cache for immutable shard/minishard indexes (Scala AlfuCache defaults).
use crate::datavault::VaultResult;
use std::{
    collections::HashMap,
    future::Future,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::OnceCell;
struct Entry<T> {
    cell: Arc<OnceCell<Arc<T>>>,
    loaded: Option<Instant>,
    accessed: Instant,
}
pub(crate) struct IndexCache<T> {
    entries: Mutex<HashMap<String, Entry<T>>>,
    capacity: usize,
}
impl<T> Default for IndexCache<T> {
    fn default() -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            capacity: 1000,
        }
    }
}
impl<T> std::fmt::Debug for IndexCache<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("IndexCache")
    }
}
impl<T> IndexCache<T> {
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            capacity,
        }
    }
    pub fn clear_matching(&self, mut predicate: impl FnMut(&str) -> bool) -> usize {
        let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        let before = entries.len();
        entries.retain(|key, _| !predicate(key));
        before - entries.len()
    }
    pub fn len(&self) -> usize {
        self.entries.lock().unwrap_or_else(|e| e.into_inner()).len()
    }

    pub async fn get_or_load<F, Fut>(&self, key: &str, load: F) -> VaultResult<Arc<T>>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = VaultResult<T>>,
    {
        let cell = {
            let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
            let now = Instant::now();
            entries.retain(|_, e| {
                e.loaded
                    .is_none_or(|t| now.duration_since(t) < Duration::from_secs(7200))
                    && now.duration_since(e.accessed) < Duration::from_secs(3600)
            });
            let entry = entries.entry(key.to_owned()).or_insert_with(|| Entry {
                cell: Arc::new(OnceCell::new()),
                loaded: None,
                accessed: now,
            });
            entry.accessed = now;
            Arc::clone(&entry.cell)
        };
        let result = cell
            .get_or_try_init(|| async { load().await.map(Arc::new) })
            .await
            .cloned();
        let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        if entries
            .get(key)
            .is_some_and(|e| Arc::ptr_eq(&e.cell, &cell))
        {
            if result.is_err() {
                entries.remove(key);
            } else if let Some(e) = entries.get_mut(key) {
                e.loaded.get_or_insert_with(Instant::now);
            }
        }
        while entries.len() > self.capacity {
            if let Some(old) = entries
                .iter()
                .filter(|(_, e)| e.loaded.is_some())
                .min_by_key(|(_, e)| e.accessed)
                .map(|(k, _)| k.clone())
            {
                entries.remove(&old);
            } else {
                break;
            }
        }
        result
    }
}
