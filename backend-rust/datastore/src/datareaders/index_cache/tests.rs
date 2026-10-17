use super::*;
use crate::datavault::VaultError;
use std::sync::atomic::{AtomicUsize, Ordering};

async fn load(
    cache: &IndexCache<usize>,
    key: &str,
    loads: &AtomicUsize,
) -> VaultResult<Arc<usize>> {
    cache
        .get_or_load(key, || async { Ok(loads.fetch_add(1, Ordering::SeqCst)) })
        .await
}

#[tokio::test]
async fn hits_return_the_loaded_value_without_reloading() {
    let cache = IndexCache::with_capacity(10);
    let loads = AtomicUsize::new(0);
    let first = load(&cache, "a", &loads).await.unwrap();
    let second = load(&cache, "a", &loads).await.unwrap();
    assert!(Arc::ptr_eq(&first, &second));
    assert_eq!(loads.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn concurrent_misses_share_one_load() {
    let cache = IndexCache::with_capacity(10);
    let loads = AtomicUsize::new(0);
    let (a, b) = tokio::join!(
        cache.get_or_load("a", || async {
            tokio::task::yield_now().await;
            Ok(loads.fetch_add(1, Ordering::SeqCst))
        }),
        load(&cache, "a", &loads),
    );
    assert!(Arc::ptr_eq(&a.unwrap(), &b.unwrap()));
    assert_eq!(loads.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn failed_loads_are_not_cached() {
    let cache = IndexCache::<usize>::with_capacity(10);
    let failed = cache
        .get_or_load("a", || async { Err(VaultError::failure("boom")) })
        .await;
    assert!(failed.is_err());
    assert_eq!(cache.len(), 0);
    let loads = AtomicUsize::new(0);
    load(&cache, "a", &loads).await.unwrap();
    assert_eq!(loads.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn idle_and_old_entries_are_reloaded_on_hit() {
    let cache = IndexCache::with_capacity(10);
    let loads = AtomicUsize::new(0);
    load(&cache, "idle", &loads).await.unwrap();
    load(&cache, "old", &loads).await.unwrap();
    {
        let mut entries = cache.entries.lock().unwrap();
        let ago = |secs| {
            Instant::now()
                .checked_sub(Duration::from_secs(secs))
                .unwrap()
        };
        entries.get_mut("idle").unwrap().accessed = ago(3600);
        entries.get_mut("old").unwrap().loaded = Some(ago(7200));
    }
    assert_eq!(*load(&cache, "idle", &loads).await.unwrap(), 2);
    assert_eq!(*load(&cache, "old", &loads).await.unwrap(), 3);
    assert_eq!(*load(&cache, "idle", &loads).await.unwrap(), 2);
}

#[tokio::test]
async fn evicts_the_least_recently_accessed_entry_above_capacity() {
    let cache = IndexCache::with_capacity(2);
    let loads = AtomicUsize::new(0);
    load(&cache, "a", &loads).await.unwrap();
    load(&cache, "b", &loads).await.unwrap();
    load(&cache, "a", &loads).await.unwrap(); // hit refreshes "a"
    load(&cache, "c", &loads).await.unwrap();
    assert_eq!(cache.len(), 2);
    assert_eq!(*load(&cache, "a", &loads).await.unwrap(), 0);
    assert_eq!(*load(&cache, "b", &loads).await.unwrap(), 3);
}
