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
    // `len` applies moka's buffered reads and writes, which keeps the access order exact here.
    assert_eq!(cache.len(), 2);
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
    assert_eq!(cache.len(), 2);
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

#[tokio::test]
async fn clearing_counts_removed_entries() {
    let cache = ChunkContentsCache::new(super::DEFAULT_MAX_SIZE_BYTES);
    for i in 0..300 {
        cache
            .get_or_load(&format!("key-{i}"), || async { Ok(chunk(1000)) }, |_| 1000)
            .await
            .unwrap();
    }
    assert_eq!(cache.len(), 300);
    assert_eq!(cache.weight_kb(), 300);
    assert_eq!(cache.clear_matching(|k| k.ends_with('7')), 30);
    assert_eq!(cache.len(), 270);
}
