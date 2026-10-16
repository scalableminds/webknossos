
use super::*;
use std::sync::atomic::AtomicUsize;

#[test]
fn body_preview_truncates_like_scala() {
    assert_eq!(preview_body(b"{}"), "{}");
    let long = vec![b'a'; 130];
    assert_eq!(
        preview_body(&long),
        format!("{}... <omitted 30 bytes>", "a".repeat(100))
    );
}

#[test]
fn object_id_answers_are_validated() {
    let ok: ObjectIdString = serde_json::from_str("\"5f0c4e8a2b00002b00b4a1c3\"").unwrap();
    assert_eq!(ok.0, "5f0c4e8a2b00002b00b4a1c3");
    assert!(serde_json::from_str::<ObjectIdString>("\"nope\"").is_err());
}

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
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
    cache.get_or_load(1, || async { Ok(99) }).await.unwrap();
    tokio::time::sleep(Duration::from_millis(2)).await;
    cache.get_or_load(3, || async { Ok(3) }).await.unwrap();
    assert_eq!(cache.len(), 2);
    // 2 was least recently used and is reloaded.
    assert_eq!(cache.get_or_load(2, || async { Ok(42) }).await.unwrap(), 42);
}
