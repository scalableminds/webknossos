//! The generic in-process `TemporaryStore` and the shared annotation data-source store.
use std::{
    collections::HashMap,
    hash::Hash,
    sync::{Arc, Mutex, PoisonError},
    time::{Duration, Instant},
};

use serde_json::Value;

use super::DATA_SOURCE_STORE_TTL;
use crate::util::id::ObjectId;

/// In-process `TemporaryStore` with per-entry expiry. Expired entries are
/// invisible immediately and pruned on insert.
#[derive(Debug)]
pub(super) struct TemporaryStore<K, V> {
    ttl: Duration,
    entries: Mutex<HashMap<K, (V, Instant)>>,
}

impl<K: Eq + Hash, V: Clone> TemporaryStore<K, V> {
    pub(super) fn new(ttl: Duration) -> Self {
        Self {
            ttl,
            entries: Mutex::new(HashMap::new()),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<K, (V, Instant)>> {
        self.entries.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(super) fn insert(&self, key: K, value: V) {
        let now = Instant::now();
        let expiry = now.checked_add(self.ttl).unwrap_or(now);
        let mut entries = self.lock();
        entries.retain(|_, (_, expiry)| *expiry > now);
        entries.insert(key, (value, expiry));
    }

    pub(super) fn get(&self, key: &K) -> Option<V> {
        let now = Instant::now();
        self.lock()
            .get(key)
            .filter(|(_, expiry)| *expiry > now)
            .map(|(value, _)| value.clone())
    }

    pub(super) fn find(&self, predicate: impl Fn(&V) -> bool) -> Option<V> {
        let now = Instant::now();
        self.lock()
            .values()
            .find(|(value, expiry)| *expiry > now && predicate(value))
            .map(|(value, _)| value.clone())
    }

    pub(super) fn remove(&self, key: &K) {
        self.lock().remove(key);
    }
}

/// Entry of the annotation data-source store: the usable DataSource JSON (as
/// sent to the datastore, real paths, credential ids included) and its dataset.
#[derive(Debug, Clone, PartialEq)]
pub struct TemporaryDataSource {
    pub data_source: Value,
    pub dataset_id: ObjectId,
}

/// `AnnotationDataSourceTemporaryStore`: process-wide, keyed by the
/// temporary (compound) annotation ID, i.e. the task/project/task-type ID,
/// kept for seven days. The tracing-store callbacks (`dataSource`,
/// `datasetId`) consult it before the annotation DAO. Cheap to clone; clones
/// share the store.
#[derive(Debug, Clone)]
pub struct AnnotationDataSourceStore {
    store: Arc<TemporaryStore<ObjectId, TemporaryDataSource>>,
}

impl Default for AnnotationDataSourceStore {
    fn default() -> Self {
        Self::with_ttl(DATA_SOURCE_STORE_TTL)
    }
}

impl AnnotationDataSourceStore {
    pub fn with_ttl(ttl: Duration) -> Self {
        Self {
            store: Arc::new(TemporaryStore::new(ttl)),
        }
    }

    pub fn store(&self, annotation_id: ObjectId, data_source: Value, dataset_id: ObjectId) {
        self.store.insert(
            annotation_id,
            TemporaryDataSource {
                data_source,
                dataset_id,
            },
        );
    }

    pub fn find(&self, annotation_id: &ObjectId) -> Option<TemporaryDataSource> {
        self.store.get(annotation_id)
    }
}
