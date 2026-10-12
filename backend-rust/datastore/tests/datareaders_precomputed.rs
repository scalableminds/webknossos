use serde::Deserialize;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use webknossos_datastore::{
    datareaders::{
        ArrayDataType, ChunkContentsCache,
        precomputed::{
            compressed_segmentation, jpeg, open_precomputed_array,
            sharding::{compressed_morton_code, murmurhash3_x86_128_low64, parse_minishard_index},
        },
    },
    datavault::{FileSystemDataVault, UPath, VaultPath},
    models::{AxisOrder, DataSourceId, Vec3Int},
};
fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/precomputed")
}
#[derive(Deserialize)]
struct Case {
    name: String,
    volume: Vec<i32>,
    channels: usize,
    block: [i32; 3],
    width: usize,
}
#[test]
fn native_compressed_segmentation_golden_cases() {
    let p = fixtures();
    let cases: Vec<Case> =
        serde_json::from_slice(&std::fs::read(p.join("segmentation.json")).unwrap()).unwrap();
    for c in cases {
        let input = std::fs::read(p.join(format!("{}.encoded", c.name))).unwrap();
        let expected = std::fs::read(p.join(format!("{}.decoded", c.name))).unwrap();
        let output = compressed_segmentation::decode(
            &input,
            &c.volume,
            c.channels,
            Vec3Int::new(c.block[0], c.block[1], c.block[2]),
            if c.width == 4 {
                ArrayDataType::U4
            } else {
                ArrayDataType::U8
            },
        )
        .unwrap();
        assert_eq!(output, expected, "{}", c.name);
    }
}
#[test]
fn mmh3_reference_and_unsigned_addressing() {
    let p = fixtures();
    let values: Vec<serde_json::Value> =
        serde_json::from_slice(&std::fs::read(p.join("murmur.json")).unwrap()).unwrap();
    for v in values {
        let input = v["input"].as_str().unwrap().parse::<u64>().unwrap();
        let expected = v["hash"].as_str().unwrap().parse::<u64>().unwrap();
        assert_eq!(murmurhash3_x86_128_low64(input), expected, "{input}");
    }
    assert_eq!(compressed_morton_code([1, 1, 1], [2, 2, 2]).unwrap(), 7);
    assert_eq!(compressed_morton_code([3, 1, 0], [4, 2, 1]).unwrap(), 7);
    let bytes: [u64; 6] = [5, 3, 100, u64::MAX - 109, 10, 2];
    let encoded: Vec<u8> = bytes.into_iter().flat_map(u64::to_le_bytes).collect();
    let entries = parse_minishard_index(&encoded).unwrap();
    assert_eq!(
        (entries[0].id, entries[0].offset, entries[0].size),
        (5, 100, 10)
    );
    assert_eq!(
        (entries[1].id, entries[1].offset, entries[1].size),
        (8, 0, 2)
    );
}
#[test]
fn java_imageio_jpeg_raster_layout() {
    for name in [
        "gray_baseline",
        "gray_progressive",
        "bgr_baseline",
        "bgr_progressive",
    ] {
        let p = fixtures();
        let actual = jpeg::decode(&std::fs::read(p.join(format!("{name}.jpeg"))).unwrap()).unwrap();
        let expected = std::fs::read(p.join(format!("{name}.decoded"))).unwrap();
        assert_eq!(actual.len(), expected.len());
        let differences: Vec<_> = actual
            .iter()
            .zip(&expected)
            .map(|(a, b)| a.abs_diff(*b))
            .collect();
        eprintln!(
            "{name}: max pixel difference {}, changed {}",
            differences.iter().max().unwrap(),
            differences.iter().filter(|d| **d != 0).count()
        );
        assert!(
            differences.iter().all(|d| *d <= 2),
            "{name}: max {}",
            differences.iter().max().unwrap()
        );
    }
}

fn root(p: &Path) -> VaultPath {
    VaultPath::new(
        UPath::parse(p.to_str().unwrap()).unwrap(),
        Arc::new(FileSystemDataVault),
    )
}
fn cache() -> Arc<ChunkContentsCache> {
    Arc::new(ChunkContentsCache::new(100_000_000))
}
fn temp() -> PathBuf {
    static COUNT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let p = std::env::temp_dir().join(format!(
        "wk-precomputed-{}-{}",
        std::process::id(),
        COUNT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&p).unwrap();
    p
}
#[tokio::test]
async fn independent_raw_and_sharded_arrays_with_offsets_edge_chunks_and_missing_data() {
    for name in ["raw", "shard_identity", "shard_gzip", "shard_murmur"] {
        let p = fixtures().join(name);
        let path = root(&p.join("1"));
        let a = open_precomputed_array(
            &path,
            DataSourceId::new("ds", "org"),
            "color",
            Some(AxisOrder::XYZ),
            None,
            None,
            cache(),
            None,
        )
        .await
        .unwrap();
        let actual = a
            .read_bytes_with_additional_coordinates(
                Vec3Int::new(6, 8, 12),
                Vec3Int::new(4, 3, 2),
                None,
                false,
                None,
            )
            .await
            .unwrap();
        assert_eq!(
            actual,
            std::fs::read(p.join("expected.bin")).unwrap(),
            "{name}"
        );
    }
}
#[tokio::test]
async fn compressed_segmentation_reader_and_empty_minishards_are_fill() {
    let p = temp();
    std::fs::create_dir_all(p.join("1")).unwrap();
    let meta = serde_json::json!({"type":"segmentation","data_type":"uint32","num_channels":1,"scales":[{"key":"1","size":[15,4,3],"resolution":[1,1,1],"chunk_sizes":[[5,4,3]],"encoding":"compressed_segmentation","compressed_segmentation_block_size":[2,3,2],"sharding":{"@type":"neuroglancer_uint64_sharded_v1","preshift_bits":0,"minishard_bits":1,"shard_bits":1,"hash":"identity","minishard_index_encoding":"gzip","data_encoding":"gzip"}}]});
    std::fs::write(p.join("info"), serde_json::to_vec(&meta).unwrap()).unwrap();
    let gzip =
        webknossos_datastore::compression::Compressor::from_precomputed_sharding_encoding("gzip")
            .unwrap();
    let data = gzip
        .compress(&std::fs::read(fixtures().join("seg32.encoded")).unwrap())
        .unwrap();
    let index: Vec<u8> = [0u64, 0, data.len() as u64]
        .into_iter()
        .flat_map(u64::to_le_bytes)
        .collect();
    let index = gzip.compress(&index).unwrap();
    let mut shard = Vec::new();
    shard.extend((data.len() as u64).to_le_bytes());
    shard.extend(((data.len() + index.len()) as u64).to_le_bytes());
    shard.extend([0u8; 16]);
    shard.extend(data);
    shard.extend(index);
    std::fs::write(p.join("1/0.shard"), shard).unwrap();
    let a = open_precomputed_array(
        &root(&p.join("1")),
        DataSourceId::new("ds", "org"),
        "seg",
        Some(AxisOrder::XYZ),
        None,
        None,
        cache(),
        None,
    )
    .await
    .unwrap();
    let actual = a
        .read_bytes_with_additional_coordinates(
            Vec3Int::new(0, 0, 0),
            Vec3Int::new(5, 4, 3),
            None,
            false,
            None,
        )
        .await
        .unwrap();
    assert_eq!(
        actual,
        std::fs::read(fixtures().join("seg32.decoded")).unwrap()
    );
    for x in [5, 10] {
        assert_eq!(
            a.read_bytes_with_additional_coordinates(
                Vec3Int::new(x, 0, 0),
                Vec3Int::new(5, 4, 3),
                None,
                false,
                None
            )
            .await
            .unwrap(),
            vec![0; 240]
        );
    }
}
mod reader_support;
#[tokio::test]
async fn shard_range_reads_cache_indexes_and_forward_current_token() {
    let p = fixtures().join("shard_identity/1");
    let (path, vault) = reader_support::recording_path(&p);
    let a = open_precomputed_array(
        &path,
        DataSourceId::new("ds", "org"),
        "color",
        Some(AxisOrder::XYZ),
        None,
        None,
        cache(),
        Some("opening-token"),
    )
    .await
    .unwrap();
    let (x, y) = tokio::join!(
        a.source_chunk_with_cache(&[0, 1, 0], Some("token-a")),
        a.source_chunk_with_cache(&[2, 1, 0], Some("token-a"))
    );
    assert!(x.is_ok() && y.is_ok());
    a.source_chunk_with_cache(&[1, 0, 1], Some("token-b"))
        .await
        .unwrap();
    let reads = vault.reads.lock().unwrap();
    let shard_reads: Vec<_> = reads
        .iter()
        .filter(|(p, _, _)| p.ends_with(".shard"))
        .collect();
    assert!(shard_reads.iter().all(|(_, r, t)| *r
        != webknossos_datastore::datavault::ByteRange::Complete
        && t.as_deref() != Some("opening-token")));
    assert!(
        shard_reads
            .iter()
            .any(|(_, _, t)| t.as_deref() == Some("token-b"))
    );
    let mut headers = std::collections::HashMap::new();
    for (p, r, _) in &shard_reads {
        if *r == (webknossos_datastore::datavault::ByteRange::StartEnd { start: 0, end: 32 }) {
            *headers.entry(p).or_insert(0) += 1;
        }
    }
    assert!(headers.values().all(|n| *n == 1));
}
#[test]
fn malformed_compressed_segmentation_and_indexes_fail() {
    let p = fixtures();
    let mut data = std::fs::read(p.join("seg32.encoded")).unwrap();
    data[..4].copy_from_slice(&u32::MAX.to_le_bytes());
    assert!(
        compressed_segmentation::decode(
            &data,
            &[5, 4, 3],
            1,
            Vec3Int::new(2, 3, 2),
            ArrayDataType::U4
        )
        .is_err()
    );
    assert!(parse_minishard_index(&[0; 23]).is_err());
    assert!(jpeg::decode(b"invalid jpeg").is_err());
}

#[tokio::test]
async fn default_zyx_axes_and_jpeg_array_reads() {
    let p = temp();
    std::fs::create_dir_all(p.join("1")).unwrap();
    let metadata = serde_json::json!({"type":"image","data_type":"uint8","num_channels":1,"scales":[{"key":"1","size":[3,2,1],"resolution":[1,1,1],"chunk_sizes":[[3,2,1]],"encoding":"raw"}]});
    std::fs::write(p.join("info"), serde_json::to_vec(&metadata).unwrap()).unwrap();
    std::fs::write(p.join("1/0-3_0-2_0-1"), [1, 2, 3, 4, 5, 6]).unwrap();
    let a = open_precomputed_array(
        &root(&p.join("1")),
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
            Vec3Int::new(1, 2, 3),
            None,
            false,
            None
        )
        .await
        .unwrap(),
        vec![1, 4, 2, 5, 3, 6]
    );
    let mut metadata = metadata;
    metadata["scales"][0]["size"] = serde_json::json!([16, 32, 1]);
    metadata["scales"][0]["chunk_sizes"] = serde_json::json!([[16, 32, 1]]);
    metadata["scales"][0]["encoding"] = "jpeg".into();
    std::fs::write(p.join("info"), serde_json::to_vec(&metadata).unwrap()).unwrap();
    std::fs::copy(
        fixtures().join("gray_baseline.jpeg"),
        p.join("1/0-16_0-32_0-1"),
    )
    .unwrap();
    let a = open_precomputed_array(
        &root(&p.join("1")),
        DataSourceId::new("ds", "org"),
        "color",
        Some(AxisOrder::XYZ),
        None,
        None,
        cache(),
        None,
    )
    .await
    .unwrap();
    let actual = a
        .read_bytes_with_additional_coordinates(
            Vec3Int::new(2, 3, 0),
            Vec3Int::new(5, 7, 1),
            None,
            false,
            None,
        )
        .await
        .unwrap();
    let golden = std::fs::read(fixtures().join("gray_baseline.decoded")).unwrap();
    let expected: Vec<u8> = (3..10)
        .flat_map(|y| (2..7).map(move |x| y * 16 + x))
        .map(|i| golden[i])
        .collect();
    assert_eq!(actual.len(), expected.len());
    assert!(
        actual
            .iter()
            .zip(&expected)
            .all(|(a, b)| a.abs_diff(*b) <= 1)
    );
}
#[tokio::test]
async fn corrupt_shard_index_fails_and_header_validation_is_explicit() {
    let p = temp();
    std::fs::create_dir_all(p.join("1")).unwrap();
    let original = fixtures().join("shard_identity");
    std::fs::copy(original.join("info"), p.join("info")).unwrap();
    let mut data = std::fs::read(original.join("1/1.shard")).unwrap();
    data[..8].copy_from_slice(&1000u64.to_le_bytes());
    data[8..16].copy_from_slice(&2u64.to_le_bytes());
    std::fs::write(p.join("1/1.shard"), data).unwrap();
    let a = open_precomputed_array(
        &root(&p.join("1")),
        DataSourceId::new("ds", "org"),
        "color",
        Some(AxisOrder::XYZ),
        None,
        None,
        cache(),
        None,
    )
    .await
    .unwrap();
    assert!(
        a.source_chunk_with_cache(&[0, 1, 0], None)
            .await
            .unwrap_err()
            .message
            .contains("Invalid Neuroglancer minishard range")
    );
    let mut header: serde_json::Value =
        serde_json::from_slice(&std::fs::read(p.join("info")).unwrap()).unwrap();
    header["scales"][0]["sharding"]["minishard_bits"] = 64.into();
    std::fs::write(p.join("info"), serde_json::to_vec(&header).unwrap()).unwrap();
    assert!(
        open_precomputed_array(
            &root(&p.join("1")),
            DataSourceId::new("ds", "org"),
            "color",
            None,
            None,
            None,
            cache(),
            None
        )
        .await
        .is_err()
    );
}

#[tokio::test]
async fn multichannel_raw_rgb_channel_selection_and_segment_channels() {
    let p = temp();
    std::fs::create_dir_all(p.join("1")).unwrap();
    let mut metadata = serde_json::json!({"type":"image","data_type":"uint8","num_channels":3,"scales":[{"key":"1","size":[3,2,1],"resolution":[1,1,1],"chunk_sizes":[[3,2,1]],"encoding":"raw"}]});
    std::fs::write(p.join("info"), serde_json::to_vec(&metadata).unwrap()).unwrap();
    let planar: Vec<u8> = (0..3)
        .flat_map(|c| (0..6).map(move |i| 10 + c * 10 + i))
        .collect();
    std::fs::write(p.join("1/0-3_0-2_0-1"), planar).unwrap();
    let a = open_precomputed_array(
        &root(&p.join("1")),
        DataSourceId::new("ds", "org"),
        "color",
        Some(AxisOrder::XYZ),
        None,
        None,
        cache(),
        None,
    )
    .await
    .unwrap();
    let expected: Vec<u8> = (0..6)
        .flat_map(|i| (0..3).map(move |c| 10 + c * 10 + i))
        .collect();
    assert_eq!(
        a.read_bytes_with_additional_coordinates(
            Vec3Int::zeros(),
            Vec3Int::new(3, 2, 1),
            None,
            true,
            None
        )
        .await
        .unwrap(),
        expected
    );
    let a = open_precomputed_array(
        &root(&p.join("1")),
        DataSourceId::new("ds", "org"),
        "color",
        Some(AxisOrder::XYZ),
        Some(1),
        None,
        cache(),
        None,
    )
    .await
    .unwrap();
    assert_eq!(
        a.read_bytes_with_additional_coordinates(
            Vec3Int::zeros(),
            Vec3Int::new(3, 2, 1),
            None,
            false,
            None
        )
        .await
        .unwrap(),
        vec![20, 21, 22, 23, 24, 25]
    );
    metadata["type"] = "segmentation".into();
    metadata["data_type"] = "uint64".into();
    metadata["num_channels"] = 2.into();
    metadata["scales"][0]["size"] = serde_json::json!([5, 4, 3]);
    metadata["scales"][0]["chunk_sizes"] = serde_json::json!([[5, 4, 3]]);
    metadata["scales"][0]["encoding"] = "compressed_segmentation".into();
    metadata["scales"][0]["compressed_segmentation_block_size"] = serde_json::json!([2, 3, 2]);
    std::fs::write(p.join("info"), serde_json::to_vec(&metadata).unwrap()).unwrap();
    std::fs::copy(
        fixtures().join("multichannel.encoded"),
        p.join("1/0-5_0-4_0-3"),
    )
    .unwrap();
    let a = open_precomputed_array(
        &root(&p.join("1")),
        DataSourceId::new("ds", "org"),
        "seg",
        Some(AxisOrder::XYZ),
        Some(1),
        None,
        cache(),
        None,
    )
    .await
    .unwrap();
    let bytes = a
        .read_bytes_with_additional_coordinates(
            Vec3Int::zeros(),
            Vec3Int::new(5, 4, 3),
            None,
            false,
            None,
        )
        .await
        .unwrap();
    let golden = std::fs::read(fixtures().join("multichannel.decoded")).unwrap();
    assert_eq!(bytes, golden[480..]);
}
