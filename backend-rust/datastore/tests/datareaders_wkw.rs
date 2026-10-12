//! WKW range reader: coordinate values provide an independent layout oracle.
mod reader_support;
use std::{
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};
use webknossos_datastore::{
    compression::wkw_compress_block,
    datareaders::{
        ArrayDataType, ChunkContentsCache, DatasetArray,
        wkw::{ChunkType, WkwHeader, open_wkw_array},
    },
    datavault::{FileSystemDataVault, UPath, VaultPath},
    models::{DataSourceId, Vec3Int},
};
static COUNTER: AtomicUsize = AtomicUsize::new(0);
fn temp() -> PathBuf {
    let p = std::env::temp_dir().join(format!(
        "wk-wkw-{}-{}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&p).unwrap();
    p
}
fn path(p: &Path) -> VaultPath {
    VaultPath::new(
        UPath::parse(p.to_str().unwrap()).unwrap(),
        Arc::new(FileSystemDataVault),
    )
}
async fn open(p: &Path) -> DatasetArray {
    open_wkw_array(
        &path(p),
        DataSourceId::new("ds", "org"),
        "color",
        Arc::new(ChunkContentsCache::new(100_000_000)),
        None,
    )
    .await
    .unwrap()
}
fn value(c: usize, x: usize, y: usize, z: usize) -> u8 {
    (c + 3 * x + 11 * y + 37 * z) as u8
}
fn write(p: &Path, kind: ChunkType, channels: usize) {
    let h = WkwHeader::new(2, 4, kind, ArrayDataType::U1, channels as i32);
    std::fs::write(p.join("header.wkw"), h.write_to(true)).unwrap();
    for sx in 0..2 {
        // Explicit Morton block order for the 2x2x2 shard; no production Morton helper used.
        let mut blocks = Vec::new();
        for m in 0..8 {
            let bx = m & 1;
            let by = (m >> 1) & 1;
            let bz = (m >> 2) & 1;
            let mut block = Vec::new();
            for z in 0..4 {
                for y in 0..4 {
                    for x in 0..4 {
                        for c in 0..channels {
                            block.push(value(c, sx * 8 + bx * 4 + x, by * 4 + y, bz * 4 + z));
                        }
                    }
                }
            }
            blocks.push(if kind.is_compressed() {
                wkw_compress_block(&block)
            } else {
                block
            });
        }
        // Encode the file header/table independently of the WKW writer.
        let mut file = b"WKW\x01".to_vec();
        file.extend([0x12, kind.id(), 1, channels as u8]);
        let mut offset = if kind.is_compressed() { 80i64 } else { 16 };
        file.extend(offset.to_le_bytes());
        if kind.is_compressed() {
            for b in &blocks {
                offset += b.len() as i64;
                file.extend(offset.to_le_bytes());
            }
        }
        for b in blocks {
            file.extend(b);
        }
        let shard = p.join(format!("z0/y0/x{sx}.wkw"));
        std::fs::create_dir_all(shard.parent().unwrap()).unwrap();
        std::fs::write(shard, file).unwrap();
    }
}
async fn read(a: &DatasetArray, offset: Vec3Int, shape: Vec3Int, rgb: bool) -> Vec<u8> {
    a.read_bytes_with_additional_coordinates(offset, shape, None, rgb, None)
        .await
        .unwrap()
}
#[tokio::test]
async fn raw_lz4_and_lz4hc_cross_blocks_and_shards() {
    for kind in [ChunkType::Raw, ChunkType::Lz4, ChunkType::Lz4Hc] {
        let p = temp();
        write(&p, kind, 1);
        let a = open(&p).await;
        let bytes = read(&a, Vec3Int::new(3, 2, 1), Vec3Int::new(10, 5, 6), false).await;
        let mut expected = Vec::new();
        for z in 1..7 {
            for y in 2..7 {
                for x in 3..13 {
                    expected.push(value(0, x, y, z));
                }
            }
        }
        assert_eq!(bytes, expected, "{kind:?}");
        let bytes = read(&a, Vec3Int::new(4, 4, 4), Vec3Int::new(4, 4, 4), false).await;
        let mut expected = Vec::new();
        for z in 4..8 {
            for y in 4..8 {
                for x in 4..8 {
                    expected.push(value(0, x, y, z));
                }
            }
        }
        assert_eq!(bytes, expected);
        assert_eq!(
            read(&a, Vec3Int::new(0, 16, 0), Vec3Int::new(4, 4, 4), false).await,
            vec![0; 64]
        );
    }
}
#[tokio::test]
async fn multichannel_rgb_and_default_first_channel() {
    let p = temp();
    write(&p, ChunkType::Lz4, 3);
    let a = open(&p).await;
    let mut expected = Vec::new();
    for z in 1..4 {
        for y in 2..5 {
            for x in 7..10 {
                for c in 0..3 {
                    expected.push(value(c, x, y, z));
                }
            }
        }
    }
    assert_eq!(
        read(&a, Vec3Int::new(7, 2, 1), Vec3Int::new(3, 3, 3), true).await,
        expected
    );
    assert_eq!(
        read(&a, Vec3Int::new(7, 2, 1), Vec3Int::new(1, 1, 1), false).await,
        vec![value(0, 7, 2, 1)]
    );
}
#[tokio::test]
async fn malformed_table_is_failure_and_failed_load_is_retryable() {
    let p = temp();
    write(&p, ChunkType::Lz4, 1);
    let a = open(&p).await;
    let shard = p.join("z0/y0/x0.wkw");
    let original = std::fs::read(&shard).unwrap();
    std::fs::write(&shard, &original[..24]).unwrap();
    assert!(
        a.source_chunk_with_cache(&[0, 0, 0, 0], None)
            .await
            .is_err()
    );
    std::fs::write(&shard, &original).unwrap();
    assert_eq!(
        read(&a, Vec3Int::new(0, 0, 0), Vec3Int::new(1, 1, 1), false).await,
        vec![0]
    );
    assert!(
        a.source_chunk_with_cache(&[0, -1, 0, 0], None)
            .await
            .unwrap_err()
            .message
            .contains("X coordinate is out of range")
    );
    let p = temp();
    write(&p, ChunkType::Raw, 1);
    let mut raw = std::fs::read(p.join("z0/y0/x0.wkw")).unwrap();
    raw[8..16].copy_from_slice(&(-1i64).to_le_bytes());
    std::fs::write(p.join("z0/y0/x0.wkw"), raw).unwrap();
    assert!(
        open(&p)
            .await
            .source_chunk_with_cache(&[0, 0, 0, 0], None)
            .await
            .unwrap_err()
            .message
            .contains("Invalid WKW block byte range")
    );
}
#[tokio::test]
async fn multibyte_preserves_scala_shortcut_and_typed_byte_order() {
    let p = temp();
    let h = WkwHeader::new(1, 2, ChunkType::Raw, ArrayDataType::U2, 1);
    std::fs::write(p.join("header.wkw"), h.write_to(true)).unwrap();
    std::fs::create_dir_all(p.join("z0/y0")).unwrap();
    let mut raw = h.write_to(false);
    raw.extend((1u16..=8).flat_map(u16::to_le_bytes));
    std::fs::write(p.join("z0/y0/x0.wkw"), raw).unwrap();
    let a = open(&p).await;
    assert_eq!(
        read(&a, Vec3Int::new(0, 0, 0), Vec3Int::new(2, 2, 2), false).await,
        (1u16..=8).flat_map(u16::to_le_bytes).collect::<Vec<_>>()
    );
    // WKWHeader inherits DatasetHeader's big endian default in Scala's typed path.
    assert_eq!(
        read(&a, Vec3Int::new(1, 0, 0), Vec3Int::new(1, 1, 1), false).await,
        vec![0, 2]
    );
}

#[tokio::test]
async fn native_wkw_golden_files() {
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/wkw");
    for kind in ["raw", "lz4", "lz4hc"] {
        let p = fixtures.join(kind);
        let expected = std::fs::read(p.join("expected.bin")).unwrap();
        assert!(expected.iter().any(|b| *b != 0));
        let actual = read(
            &open(&p).await,
            Vec3Int::new(3, 2, 1),
            Vec3Int::new(10, 5, 6),
            true,
        )
        .await;
        assert_eq!(actual, expected, "native oracle: {kind}");
    }
}

#[tokio::test]
async fn concurrent_chunks_share_one_ranged_shard_index_load_and_forward_token() {
    use webknossos_datastore::datavault::ByteRange;
    let p = temp();
    write(&p, ChunkType::Lz4, 1);
    let (root, vault) = reader_support::recording_path(&p);
    let array = open_wkw_array(
        &root,
        DataSourceId::new("ds", "org"),
        "color",
        Arc::new(ChunkContentsCache::new(100_000_000)),
        Some("test-token"),
    )
    .await
    .unwrap();
    let (a, b) = tokio::join!(
        array.source_chunk_with_cache(&[0, 0, 0, 0], Some("test-token")),
        array.source_chunk_with_cache(&[0, 1, 1, 1], Some("test-token"))
    );
    assert!(a.is_ok() && b.is_ok());
    let reads = vault.reads.lock().unwrap();
    assert_eq!(reads.len(), 4); // one header, one index, two blocks
    assert_eq!(
        reads
            .iter()
            .filter(|(_, r, _)| *r == ByteRange::StartEnd { start: 8, end: 80 })
            .count(),
        1
    );
    assert!(
        reads
            .iter()
            .all(|(_, _, t)| t.as_deref() == Some("test-token"))
    );
    assert!(
        reads
            .iter()
            .filter(|(p, _, _)| p.ends_with("x0.wkw"))
            .all(|(_, r, _)| *r != ByteRange::Complete)
    );
}
