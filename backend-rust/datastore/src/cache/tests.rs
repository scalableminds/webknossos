use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

#[tokio::test]
async fn cache_keeps_values_and_drops_failures() {
    let cache: AlfuCache<&str, u32> = AlfuCache::with_defaults();
    let calls = AtomicUsize::new(0);
    let load = || async {
        calls.fetch_add(1, Ordering::SeqCst);
        Ok(7)
    };
    assert_eq!(cache.get_or_load("a", load).await.unwrap(), 7);
    assert_eq!(cache.get_or_load("a", load).await.unwrap(), 7);
    assert_eq!(calls.load(Ordering::SeqCst), 1);

    let fail = || async {
        calls.fetch_add(1, Ordering::SeqCst);
        Err(DsError::failure("boom"))
    };
    assert!(cache.get_or_load("b", fail).await.is_err());
    assert!(cache.get_or_load("b", fail).await.is_err());
    assert_eq!(calls.load(Ordering::SeqCst), 3);
    assert_eq!(cache.len(), 1);
}

#[tokio::test]
async fn cache_entries_expire() {
    let cache: AlfuCache<u8, u8> =
        AlfuCache::new(10, Duration::from_millis(30), Duration::from_secs(60));
    let calls = AtomicUsize::new(0);
    let load = || async {
        calls.fetch_add(1, Ordering::SeqCst);
        Ok(1)
    };
    cache.get_or_load(1, load).await.unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    cache.get_or_load(1, load).await.unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn cache_shares_concurrent_loads() {
    let cache: AlfuCache<u8, u8> = AlfuCache::with_defaults();
    let calls = AtomicUsize::new(0);
    let load = || async {
        calls.fetch_add(1, Ordering::SeqCst);
        tokio::time::sleep(Duration::from_millis(30)).await;
        Ok(5)
    };
    let (a, b) = tokio::join!(cache.get_or_load(1, load), cache.get_or_load(1, load));
    assert_eq!((a.unwrap(), b.unwrap()), (5, 5));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn cache_evicts_least_recently_used_at_capacity() {
    let cache: AlfuCache<u8, u8> =
        AlfuCache::new(2, Duration::from_secs(60), Duration::from_secs(60));
    for key in [1, 2] {
        cache
            .get_or_load(key, || async move { Ok(key) })
            .await
            .unwrap();
    }
    // `len` applies moka's buffered reads and writes, which keeps the access order exact here.
    assert_eq!(cache.len(), 2);
    cache.get_or_load(1, || async { Ok(99) }).await.unwrap();
    assert_eq!(cache.len(), 2);
    cache.get_or_load(3, || async { Ok(3) }).await.unwrap();
    assert_eq!(cache.len(), 2);
    // 2 was least recently used and is reloaded.
    assert_eq!(cache.get_or_load(2, || async { Ok(42) }).await.unwrap(), 42);
}

#[tokio::test]
async fn invalidation_during_a_load_discards_its_value() {
    let cache: AlfuCache<u8, u8> = AlfuCache::with_defaults();
    let (started_tx, started_rx) = tokio::sync::oneshot::channel();
    let (finish_tx, finish_rx) = tokio::sync::oneshot::channel::<()>();
    let stale = cache.get_or_load(1, || async move {
        started_tx.send(()).unwrap();
        finish_rx.await.unwrap();
        Ok(1)
    });
    let invalidate = async {
        started_rx.await.unwrap();
        assert!(cache.contains(&1), "a load in progress is an entry");
        assert_eq!(cache.clear_matching(|k| *k == 1), 1);
        finish_tx.send(()).unwrap();
    };
    let (stale, ()) = tokio::join!(stale, invalidate);
    // The caller still gets its value (as from Caffeine's removed future), the cache does not.
    assert_eq!(stale.unwrap(), 1);
    assert!(!cache.contains(&1));
    assert_eq!(cache.get_or_load(1, || async { Ok(2) }).await.unwrap(), 2);
}

#[tokio::test]
async fn weighted_caches_evict_by_loaded_weight() {
    let cache: AlfuCache<u8, u32> = AlfuCache::weighted(
        10,
        Duration::from_secs(60),
        Duration::from_secs(60),
        |weight| *weight,
    );
    for key in [1, 2, 3] {
        cache.get_or_load(key, || async { Ok(4) }).await.unwrap();
    }
    assert_eq!(cache.weighted_size(), 8);
    assert_eq!(cache.len(), 2);
    assert!(!cache.contains(&1), "least recently used");
    // Failures weigh nothing and are dropped.
    let failed: Result<u32, DsError> = cache
        .get_or_load(4, || async { Err(DsError::failure("boom")) })
        .await;
    assert!(failed.is_err() && !cache.contains(&4));
}

#[tokio::test]
async fn loads_in_progress_do_not_expire() {
    let cache: AlfuCache<u8, u8> =
        AlfuCache::new(10, Duration::from_millis(20), Duration::from_millis(20));
    let calls = AtomicUsize::new(0);
    let slow = || async {
        calls.fetch_add(1, Ordering::SeqCst);
        tokio::time::sleep(Duration::from_millis(60)).await;
        Ok(3)
    };
    let late = async {
        tokio::time::sleep(Duration::from_millis(40)).await;
        cache.get_or_load(5, slow).await
    };
    let (first, second) = tokio::join!(cache.get_or_load(5, slow), late);
    assert_eq!((first.unwrap(), second.unwrap()), (3, 3));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}
