use serde::Deserialize;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use webknossos_datastore::datareaders::{ArrayAxes, ArraySource};
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
            ArraySource {
                path: &path,
                data_source_id: DataSourceId::new("ds", "org"),
                layer_name: "color",
                cache: cache(),
            },
            ArrayAxes {
                axis_order: Some(AxisOrder::XYZ),
                channel_index: None,
                additional_axes: None,
            },
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
        ArraySource {
            path: &root(&p.join("1")),
            data_source_id: DataSourceId::new("ds", "org"),
            layer_name: "seg",
            cache: cache(),
        },
        ArrayAxes {
            axis_order: Some(AxisOrder::XYZ),
            channel_index: None,
            additional_axes: None,
        },
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
        ArraySource {
            path: &path,
            data_source_id: DataSourceId::new("ds", "org"),
            layer_name: "color",
            cache: cache(),
        },
        ArrayAxes {
            axis_order: Some(AxisOrder::XYZ),
            channel_index: None,
            additional_axes: None,
        },
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
#[test]
fn jpeg_headers_announcing_more_than_the_decompression_limit_are_rejected() {
    let mut bytes = std::fs::read(fixtures().join("gray_baseline.jpeg")).unwrap();
    let sof = bytes
        .windows(2)
        .position(|w| w == [0xff, 0xc0])
        .expect("baseline SOF0 marker");
    // SOF0: marker, length (2), precision (1), height (2), width (2), all big-endian.
    bytes[sof + 5..sof + 9].copy_from_slice(&[0xff, 0xff, 0xff, 0xff]);
    assert_eq!(
        jpeg::decode(&bytes).unwrap_err().message,
        "jpeg: decompressed size 17179344900 exceeds limit of 1073741824 bytes"
    );
}

#[tokio::test]
async fn default_zyx_axes_and_jpeg_array_reads() {
    let p = temp();
    std::fs::create_dir_all(p.join("1")).unwrap();
    let metadata = serde_json::json!({"type":"image","data_type":"uint8","num_channels":1,"scales":[{"key":"1","size":[3,2,1],"resolution":[1,1,1],"chunk_sizes":[[3,2,1]],"encoding":"raw"}]});
    std::fs::write(p.join("info"), serde_json::to_vec(&metadata).unwrap()).unwrap();
    std::fs::write(p.join("1/0-3_0-2_0-1"), [1, 2, 3, 4, 5, 6]).unwrap();
    let a = open_precomputed_array(
        ArraySource {
            path: &root(&p.join("1")),
            data_source_id: DataSourceId::new("ds", "org"),
            layer_name: "color",
            cache: cache(),
        },
        ArrayAxes {
            axis_order: None,
            channel_index: None,
            additional_axes: None,
        },
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
        ArraySource {
            path: &root(&p.join("1")),
            data_source_id: DataSourceId::new("ds", "org"),
            layer_name: "color",
            cache: cache(),
        },
        ArrayAxes {
            axis_order: Some(AxisOrder::XYZ),
            channel_index: None,
            additional_axes: None,
        },
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
        ArraySource {
            path: &root(&p.join("1")),
            data_source_id: DataSourceId::new("ds", "org"),
            layer_name: "color",
            cache: cache(),
        },
        ArrayAxes {
            axis_order: Some(AxisOrder::XYZ),
            channel_index: None,
            additional_axes: None,
        },
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
            ArraySource {
                path: &root(&p.join("1")),
                data_source_id: DataSourceId::new("ds", "org"),
                layer_name: "color",
                cache: cache()
            },
            ArrayAxes {
                axis_order: None,
                channel_index: None,
                additional_axes: None
            },
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
        ArraySource {
            path: &root(&p.join("1")),
            data_source_id: DataSourceId::new("ds", "org"),
            layer_name: "color",
            cache: cache(),
        },
        ArrayAxes {
            axis_order: Some(AxisOrder::XYZ),
            channel_index: None,
            additional_axes: None,
        },
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
        ArraySource {
            path: &root(&p.join("1")),
            data_source_id: DataSourceId::new("ds", "org"),
            layer_name: "color",
            cache: cache(),
        },
        ArrayAxes {
            axis_order: Some(AxisOrder::XYZ),
            channel_index: Some(1),
            additional_axes: None,
        },
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
        ArraySource {
            path: &root(&p.join("1")),
            data_source_id: DataSourceId::new("ds", "org"),
            layer_name: "seg",
            cache: cache(),
        },
        ArrayAxes {
            axis_order: Some(AxisOrder::XYZ),
            channel_index: Some(1),
            additional_axes: None,
        },
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

// Scala `PrecomputedArrayTestSuite`: the volume size is deliberately not a multiple of the chunk
// size, so the edge chunks are clipped in every axis.
const UNALIGNED_VOLUME: [i32; 3] = [40, 40, 40];
const UNALIGNED_CHUNK: i32 = 32;
const SEGMENTATION_BLOCK: i32 = 8;

fn unaligned_voxel_value(x: i32, y: i32, z: i32) -> u64 {
    (x + UNALIGNED_VOLUME[0] * (y + UNALIGNED_VOLUME[1] * z)) as u64 + 1
}

fn is_in_unaligned_volume(x: i32, y: i32, z: i32) -> bool {
    x < UNALIGNED_VOLUME[0] && y < UNALIGNED_VOLUME[1] && z < UNALIGNED_VOLUME[2]
}

fn encode_raw_chunk(top_left: [i32; 3], bottom_right: [i32; 3]) -> Vec<u8> {
    let mut out = Vec::new();
    for z in top_left[2]..bottom_right[2] {
        for y in top_left[1]..bottom_right[1] {
            for x in top_left[0]..bottom_right[0] {
                out.extend(unaligned_voxel_value(x, y, z).to_le_bytes());
            }
        }
    }
    out
}

/// Minimal single-channel encoder for
/// https://github.com/google/neuroglancer/tree/master/src/neuroglancer/sliceview/compressed_segmentation
fn encode_compressed_segmentation_chunk(top_left: [i32; 3], bottom_right: [i32; 3]) -> Vec<u8> {
    let bs = SEGMENTATION_BLOCK;
    let grid: Vec<i32> = (0..3)
        .map(|d| (bottom_right[d] - top_left[d] + bs - 1) / bs)
        .collect();
    let block_count = (grid[0] * grid[1] * grid[2]) as usize;
    let mut headers = vec![0u32; block_count * 2];
    let mut body: Vec<u32> = Vec::new();
    let mut body_offset = block_count * 2;
    for block_z in 0..grid[2] {
        for block_y in 0..grid[1] {
            for block_x in 0..grid[0] {
                let mut values = Vec::new();
                for z in 0..bs {
                    for y in 0..bs {
                        for x in 0..bs {
                            let (gx, gy, gz) = (
                                top_left[0] + block_x * bs + x,
                                top_left[1] + block_y * bs + y,
                                top_left[2] + block_z * bs + z,
                            );
                            values.push(if is_in_unaligned_volume(gx, gy, gz) {
                                unaligned_voxel_value(gx, gy, gz)
                            } else {
                                0
                            });
                        }
                    }
                }
                let mut table: Vec<u64> = Vec::new();
                for v in &values {
                    if !table.contains(v) {
                        table.push(*v);
                    }
                }
                let encoded_bits = if table.len() == 1 {
                    0
                } else {
                    [1usize, 2, 4, 8, 16, 32]
                        .into_iter()
                        .find(|b| (1u64 << b) >= table.len() as u64)
                        .unwrap()
                };
                let mut encoded = vec![0u32; ((bs * bs * bs) as usize * encoded_bits).div_ceil(32)];
                for (i, value) in values.iter().enumerate() {
                    let bit = i * encoded_bits;
                    let index = table.iter().position(|t| t == value).unwrap() as u32;
                    if encoded_bits > 0 {
                        encoded[bit / 32] |= index << (bit % 32);
                    }
                }
                let block_index = (block_x + grid[0] * (block_y + grid[1] * block_z)) as usize;
                let table_offset = body_offset + encoded.len();
                headers[block_index * 2] = table_offset as u32 | ((encoded_bits as u32) << 24);
                headers[block_index * 2 + 1] = body_offset as u32;
                body.extend(&encoded);
                body.extend(table.iter().flat_map(|v| [*v as u32, (v >> 32) as u32]));
                body_offset = table_offset + table.len() * 2;
            }
        }
    }
    std::iter::once(1u32)
        .chain(headers)
        .chain(body)
        .flat_map(u32::to_le_bytes)
        .collect()
}

/// Returns the scale directory (the mag path); `info` lives in its parent.
fn write_unaligned_precomputed(encoding: &str) -> PathBuf {
    let root_dir = temp();
    let mut scale = serde_json::json!({
        "key": "1_1_1",
        "size": UNALIGNED_VOLUME,
        "resolution": [1, 1, 1],
        "chunk_sizes": [[UNALIGNED_CHUNK, UNALIGNED_CHUNK, UNALIGNED_CHUNK]],
        "encoding": encoding,
        "voxel_offset": [0, 0, 0]
    });
    if encoding == "compressed_segmentation" {
        scale["compressed_segmentation_block_size"] = serde_json::json!([8, 8, 8]);
    }
    let info = serde_json::json!({
        "type": "segmentation", "data_type": "uint64", "num_channels": 1, "scales": [scale]
    });
    std::fs::write(root_dir.join("info"), serde_json::to_vec(&info).unwrap()).unwrap();
    let scale_dir = root_dir.join("1_1_1");
    std::fs::create_dir_all(&scale_dir).unwrap();
    for cx in 0..2 {
        for cy in 0..2 {
            for cz in 0..2 {
                let top_left = [cx, cy, cz].map(|c| c * UNALIGNED_CHUNK);
                let bottom_right: [i32; 3] = std::array::from_fn(|d| {
                    (top_left[d] + UNALIGNED_CHUNK).min(UNALIGNED_VOLUME[d])
                });
                let bytes = if encoding == "raw" {
                    encode_raw_chunk(top_left, bottom_right)
                } else {
                    encode_compressed_segmentation_chunk(top_left, bottom_right)
                };
                let name = format!(
                    "{}-{}_{}-{}_{}-{}",
                    top_left[0],
                    bottom_right[0],
                    top_left[1],
                    bottom_right[1],
                    top_left[2],
                    bottom_right[2]
                );
                std::fs::write(scale_dir.join(name), bytes).unwrap();
            }
        }
    }
    scale_dir
}

async fn open_unaligned(
    scale_dir: &Path,
    cache: Arc<ChunkContentsCache>,
) -> webknossos_datastore::datareaders::DatasetArray {
    open_precomputed_array(
        ArraySource {
            path: &root(scale_dir),
            data_source_id: DataSourceId::new("ds", "org"),
            layer_name: "segmentation",
            cache,
        },
        ArrayAxes {
            axis_order: Some(AxisOrder::XYZ),
            channel_index: None,
            additional_axes: None,
        },
        None,
    )
    .await
    .unwrap()
}

async fn assert_unaligned_reads(
    array: &webknossos_datastore::datareaders::DatasetArray,
    offset: Vec3Int,
    shape: Vec3Int,
) {
    let bytes = array
        .read_bytes_with_additional_coordinates(offset, shape, None, false, None)
        .await
        .unwrap_or_else(|e| panic!("read {offset:?}/{shape:?} failed: {}", e.message));
    let actual: Vec<u64> = bytes
        .as_chunks::<8>()
        .0
        .iter()
        .map(|v| u64::from_le_bytes(*v))
        .collect();
    let mut expected = Vec::new();
    for z in offset.z..offset.z + shape.z {
        for y in offset.y..offset.y + shape.y {
            for x in offset.x..offset.x + shape.x {
                expected.push(if is_in_unaligned_volume(x, y, z) {
                    unaligned_voxel_value(x, y, z)
                } else {
                    0
                });
            }
        }
    }
    assert_eq!(
        actual.len(),
        expected.len(),
        "read {offset:?}/{shape:?} returned {} voxels",
        actual.len()
    );
    assert!(
        actual == expected,
        "read {offset:?}/{shape:?} returned wrong values"
    );
}

#[tokio::test]
async fn clipped_edge_chunks_read_correctly_for_raw_and_compressed_segmentation() {
    let full = Vec3Int::full(UNALIGNED_CHUNK);
    let volume = Vec3Int::new(
        UNALIGNED_VOLUME[0],
        UNALIGNED_VOLUME[1],
        UNALIGNED_VOLUME[2],
    );
    for encoding in ["raw", "compressed_segmentation"] {
        let scale_dir = write_unaligned_precomputed(encoding);
        // Each read gets a fresh cache, so results don't depend on which reads ran before
        for (offset, shape) in [
            (Vec3Int::new(0, 0, 0), full),                     // interior chunk
            (Vec3Int::new(32, 0, 0), full), // full bucket on a chunk clipped in x
            (Vec3Int::new(0, 32, 0), full), // ... clipped in y
            (Vec3Int::new(0, 0, 32), full), // ... clipped in z
            (Vec3Int::new(32, 32, 32), full), // ... clipped in all axes
            (Vec3Int::new(32, 0, 0), Vec3Int::new(8, 32, 32)), // exactly the stored extent
            (Vec3Int::new(33, 1, 0), Vec3Int::new(7, 7, 32)), // offset into a clipped chunk
            (Vec3Int::new(0, 0, 0), volume), // the whole volume
        ] {
            let array = open_unaligned(&scale_dir, cache()).await;
            assert_unaligned_reads(&array, offset, shape).await;
        }

        // a chunk cached by a full-chunk read first
        let array = open_unaligned(&scale_dir, cache()).await;
        assert_unaligned_reads(&array, Vec3Int::new(0, 0, 0), full).await;
        assert_unaligned_reads(&array, Vec3Int::new(32, 0, 0), Vec3Int::new(8, 32, 32)).await;
        assert_unaligned_reads(&array, Vec3Int::new(1, 1, 1), Vec3Int::full(16)).await;
        assert_unaligned_reads(&array, Vec3Int::new(0, 0, 0), volume).await;

        // a chunk cached by a partial read first
        let array = open_unaligned(&scale_dir, cache()).await;
        assert_unaligned_reads(&array, Vec3Int::new(1, 1, 1), Vec3Int::full(16)).await;
        assert_unaligned_reads(&array, Vec3Int::new(0, 0, 0), full).await;
    }
}
