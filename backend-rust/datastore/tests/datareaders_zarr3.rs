use std::{path::Path, sync::Arc};
use webknossos_datastore::{
    datareaders::{ChunkContentsCache, zarr3::open_zarr3_array},
    datavault::{FileSystemDataVault, UPath, VaultPath},
    models::{DataSourceId, Vec3Int},
};
fn root(p: &Path) -> VaultPath {
    VaultPath::new(
        UPath::parse(p.to_str().unwrap()).unwrap(),
        Arc::new(FileSystemDataVault),
    )
}
#[tokio::test]
async fn python_zarr3_golden_codecs_endian_transpose_and_sharding() {
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/zarr3");
    for name in [
        "big_c",
        "little_f",
        "gzip",
        "zstd",
        "blosc",
        "crc",
        "shard_start",
        "shard_end",
    ] {
        let p = fixtures.join(name);
        let a = open_zarr3_array(
            &root(&p),
            DataSourceId::new("ds", "org"),
            "color",
            None,
            None,
            None,
            Arc::new(ChunkContentsCache::new(100_000_000)),
            None,
        )
        .await
        .unwrap_or_else(|e| panic!("{name}: {e:?}"));
        let actual = a
            .read_bytes_with_additional_coordinates(
                Vec3Int::new(1, 1, 1),
                Vec3Int::new(6, 5, 4),
                None,
                false,
                None,
            )
            .await
            .unwrap_or_else(|e| panic!("{name}: {e:?}"));
        assert_eq!(
            actual,
            std::fs::read(p.join("expected.bin")).unwrap(),
            "{name}"
        );
        let zero = a
            .read_bytes_with_additional_coordinates(
                Vec3Int::new(0, 0, 0),
                Vec3Int::new(2, 3, 2),
                None,
                false,
                None,
            )
            .await
            .unwrap();
        assert_eq!(zero, vec![0; 24], "missing {name}");
    }
}

mod reader_support;
fn cache() -> Arc<ChunkContentsCache> {
    Arc::new(ChunkContentsCache::new(100_000_000))
}
fn temp() -> std::path::PathBuf {
    static COUNT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let p = std::env::temp_dir().join(format!(
        "wk-zarr3-{}-{}",
        std::process::id(),
        COUNT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&p).unwrap();
    p
}
fn fixture(name: &str) -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/zarr3")
        .join(name)
}
#[tokio::test]
async fn ranged_shards_cache_index_and_use_each_requests_token() {
    use webknossos_datastore::datavault::ByteRange;
    for name in ["shard_start", "shard_end"] {
        let p = fixture(name);
        let (root, vault) = reader_support::recording_path(&p);
        let a = open_zarr3_array(
            &root,
            DataSourceId::new("ds", "org"),
            "color",
            None,
            None,
            None,
            cache(),
            Some("opening-token"),
        )
        .await
        .unwrap();
        let (x, y) = tokio::join!(
            a.source_chunk_with_cache(&[0, 1, 0, 0], Some("token-a")),
            a.source_chunk_with_cache(&[0, 0, 1, 0], Some("token-a"))
        );
        assert!(x.is_ok() && y.is_ok());
        a.source_chunk_with_cache(&[0, 1, 1, 0], Some("token-b"))
            .await
            .unwrap();
        a.source_chunk_with_cache(&[0, 0, 0, 0], Some("token-b"))
            .await
            .unwrap();
        let reads = vault.reads.lock().unwrap();
        let shard: Vec<_> = reads
            .iter()
            .filter(|(p, _, _)| p.ends_with("c/0/0/0/0"))
            .collect();
        assert!(
            shard
                .iter()
                .all(|(_, range, _)| *range != ByteRange::Complete)
        );
        let index_read = |r: &ByteRange| {
            if name == "shard_start" {
                *r == ByteRange::StartEnd { start: 0, end: 132 }
            } else {
                *r == ByteRange::Suffix { length: 132 }
            }
        };
        assert_eq!(
            shard
                .iter()
                .filter(|(_, r, t)| index_read(r) && t.as_deref() == Some("token-a"))
                .count(),
            1
        );
        assert_eq!(
            shard
                .iter()
                .filter(|(_, r, t)| index_read(r) && t.as_deref() == Some("token-b"))
                .count(),
            1
        );
        assert!(
            shard
                .iter()
                .all(|(_, _, t)| t.as_deref() != Some("opening-token"))
        );
    }
}
#[tokio::test]
async fn crc_corruption_fails_for_chunks_and_shard_indices() {
    for name in ["crc", "shard_start", "shard_end"] {
        let p = temp();
        let original = fixture(name);
        std::fs::write(
            p.join("zarr.json"),
            std::fs::read(original.join("zarr.json")).unwrap(),
        )
        .unwrap();
        let key = if name == "crc" {
            "c/0/1/0/0"
        } else {
            "c/0/0/0/0"
        };
        let mut bytes = std::fs::read(original.join(key)).unwrap();
        let pos = if name == "shard_start" {
            128
        } else {
            bytes.len() - 1
        };
        bytes[pos] ^= 1;
        std::fs::create_dir_all(p.join(key).parent().unwrap()).unwrap();
        std::fs::write(p.join(key), bytes).unwrap();
        let a = open_zarr3_array(
            &root(&p),
            DataSourceId::new("ds", "org"),
            "color",
            None,
            None,
            None,
            cache(),
            None,
        )
        .await
        .unwrap();
        assert!(
            a.source_chunk_with_cache(&[0, 1, 0, 0], None)
                .await
                .is_err(),
            "{name}"
        );
    }
}
#[tokio::test]
async fn invalid_metadata_is_rejected_and_legacy_metadata_is_normalized() {
    let base: serde_json::Value =
        serde_json::from_slice(&std::fs::read(fixture("little_f").join("zarr.json")).unwrap())
            .unwrap();
    for (field, value) in [
        ("zarr_format", serde_json::json!(2)),
        ("node_type", serde_json::json!("group")),
        ("data_type", serde_json::json!("string")),
        ("codecs", serde_json::json!([{"name":"unsupported"}])),
    ] {
        let p = temp();
        let mut meta = base.clone();
        meta[field] = value;
        std::fs::write(p.join("zarr.json"), serde_json::to_vec(&meta).unwrap()).unwrap();
        assert!(
            open_zarr3_array(
                &root(&p),
                DataSourceId::new("ds", "org"),
                "color",
                None,
                None,
                None,
                cache(),
                None
            )
            .await
            .is_err(),
            "{field}"
        );
    }
    let p = temp();
    let mut legacy = base;
    legacy["codecs"][0]["configuration"]["order"] = "F".into();
    legacy["codecs"][1]["name"] = "endian".into();
    legacy["chunk_key_encoding"] = serde_json::json!({"name":"v2"});
    std::fs::write(p.join("zarr.json"), serde_json::to_vec(&legacy).unwrap()).unwrap();
    let a = open_zarr3_array(
        &root(&p),
        DataSourceId::new("ds", "org"),
        "color",
        None,
        None,
        None,
        cache(),
        None,
    )
    .await
    .unwrap();
    assert_eq!(
        a.read_bytes_with_additional_coordinates(
            Vec3Int::new(0, 0, 0),
            Vec3Int::new(2, 3, 2),
            None,
            false,
            None
        )
        .await
        .unwrap(),
        vec![0; 24]
    );
}

#[tokio::test]
async fn attachments_1d_and_2d_arrays_keep_physical_chunk_addresses() {
    use webknossos_datastore::{datareaders::nd_array::to_byte_array, models::AxisOrder};
    for dims in [1usize, 2] {
        let p = temp();
        let meta = serde_json::json!({"zarr_format":3,"node_type":"array","shape":vec![4;dims],"data_type":"uint8","chunk_grid":{"name":"regular","configuration":{"chunk_shape":vec![2;dims]}},"chunk_key_encoding":{"name":"v2","configuration":{"separator":"."}},"fill_value":9,"codecs":[{"name":"bytes"}]});
        std::fs::write(p.join("zarr.json"), serde_json::to_vec(&meta).unwrap()).unwrap();
        if dims == 1 {
            std::fs::write(p.join("0"), [5, 6]).unwrap();
        } else {
            std::fs::write(p.join("0.1"), [1, 2, 3, 4]).unwrap();
        }
        let a = open_zarr3_array(
            &root(&p),
            DataSourceId::new("ds", "org"),
            "color",
            if dims == 1 {
                None
            } else {
                Some(AxisOrder::new(0, 1, None, None))
            },
            None,
            None,
            cache(),
            None,
        )
        .await
        .unwrap();
        if dims == 1 {
            assert_eq!(
                to_byte_array(&a.read_as_multi_array_1d(0, 4, None).await.unwrap())
                    .unwrap()
                    .as_slice(),
                vec![5, 6, 9, 9].as_slice()
            );
        } else {
            assert_eq!(
                a.read_bytes_with_additional_coordinates(
                    Vec3Int::new(0, 2, 0),
                    Vec3Int::new(2, 2, 1),
                    None,
                    false,
                    None
                )
                .await
                .unwrap(),
                vec![1, 3, 2, 4]
            );
        }
    }
}

#[tokio::test]
async fn overflowed_shard_offsets_fail_before_library_arithmetic() {
    let p = temp();
    let original = fixture("shard_end");
    let mut metadata: serde_json::Value =
        serde_json::from_slice(&std::fs::read(original.join("zarr.json")).unwrap()).unwrap();
    metadata["codecs"][0]["configuration"]["index_codecs"] =
        serde_json::json!([{"name":"bytes","configuration":{"endian":"little"}}]);
    std::fs::write(p.join("zarr.json"), serde_json::to_vec(&metadata).unwrap()).unwrap();
    let key = "c/0/0/0/0";
    let mut shard = std::fs::read(original.join(key)).unwrap();
    shard.truncate(shard.len() - 4);
    let offset = shard.len() - 128 + 64; // local [0,1,0,0] entry
    shard[offset..offset + 8].copy_from_slice(&(u64::MAX - 3).to_le_bytes());
    shard[offset + 8..offset + 16].copy_from_slice(&10u64.to_le_bytes());
    std::fs::create_dir_all(p.join(key).parent().unwrap()).unwrap();
    std::fs::write(p.join(key), shard).unwrap();
    let a = open_zarr3_array(
        &root(&p),
        DataSourceId::new("ds", "org"),
        "color",
        None,
        None,
        None,
        cache(),
        None,
    )
    .await
    .unwrap();
    let e = a
        .source_chunk_with_cache(&[0, 1, 0, 0], None)
        .await
        .unwrap_err();
    assert!(
        e.chain
            .iter()
            .any(|message| message.contains("Invalid Zarr3 shard index byte range")),
        "{e:?}"
    );
}
