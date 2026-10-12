//! DS2-core: Zarr v2 arrays written by the test (raw and compressed) read back through the local
//! file vault with `DatasetArray`, checked against the byte layout Scala returns (wk axis order,
//! Fortran order, little endian; raw chunk bytes for the single-chunk shortcut).

use std::{
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

use serde_json::{Value, json};
use webknossos_datastore::{
    compression::{CompressionSetting, CompressionSettings, Compressor},
    datareaders::{
        ChunkContentsCache, DatasetArray, RequestedAdditionalCoordinate,
        nd_array::to_long_array,
        zarr::{open_zarr_array, parse_zarr_header},
    },
    datavault::{FileSystemDataVault, UPath, VaultPath},
    models::{AdditionalAxis, AxisOrder, DataSourceId, Vec3Int},
};

static COUNTER: AtomicUsize = AtomicUsize::new(0);

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "wk-ds2-core-{}-{}-{name}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::SeqCst)
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn vault_path(dir: &Path) -> VaultPath {
    VaultPath::new(
        UPath::parse(dir.to_str().unwrap()).unwrap(),
        Arc::new(FileSystemDataVault),
    )
}

struct ArraySpec<'a> {
    shape: Vec<i64>,
    chunks: Vec<i64>,
    dtype: &'a str,
    order: &'a str,
    separator: &'a str,
    fill_value: Value,
    compressor: Option<Value>,
    /// Encoded element at physical coordinates (also called for chunk padding positions).
    element: &'a dyn Fn(&[i64]) -> Vec<u8>,
    /// Chunk indices that are not written (missing chunks).
    skip: Vec<Vec<i64>>,
}

fn settings(json: &Value) -> CompressionSettings {
    json.as_object()
        .unwrap()
        .iter()
        .map(|(k, v)| (k.clone(), CompressionSetting::from_json(v).unwrap()))
        .collect()
}

/// Writes `.zarray` and all chunks (padded border chunks contain `element` values too).
fn write_array(dir: &Path, spec: &ArraySpec) {
    let zarray = json!({
        "zarr_format": 2, "shape": spec.shape, "chunks": spec.chunks, "dtype": spec.dtype,
        "order": spec.order, "fill_value": spec.fill_value, "compressor": spec.compressor,
        "filters": null, "dimension_separator": spec.separator
    });
    std::fs::write(dir.join(".zarray"), serde_json::to_vec(&zarray).unwrap()).unwrap();
    let compressor = match &spec.compressor {
        Some(c) => Compressor::from_zarr_settings(&settings(c)).unwrap(),
        None => Compressor::Null,
    };
    let rank = spec.shape.len();
    let grid: Vec<i64> = (0..rank)
        .map(|d| (spec.shape[d] + spec.chunks[d] - 1) / spec.chunks[d])
        .collect();
    for chunk_index in all_indices(&grid, false) {
        if spec.skip.contains(&chunk_index) {
            continue;
        }
        let mut raw = Vec::new();
        for local in all_indices(&spec.chunks, spec.order == "F") {
            let global: Vec<i64> = (0..rank)
                .map(|d| chunk_index[d] * spec.chunks[d] + local[d])
                .collect();
            raw.extend((spec.element)(&global));
        }
        let name = chunk_index
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(spec.separator);
        let path = dir.join(&name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, compressor.compress(&raw).unwrap()).unwrap();
    }
}

/// All indices of `shape` in C order (last fastest) or F order (first fastest).
fn all_indices(shape: &[i64], f_order: bool) -> Vec<Vec<i64>> {
    let rank = shape.len();
    let mut out = Vec::new();
    let mut current = vec![0i64; rank];
    let total: i64 = shape.iter().product();
    for _ in 0..total {
        out.push(current.clone());
        let dims: Vec<usize> = if f_order {
            (0..rank).collect()
        } else {
            (0..rank).rev().collect()
        };
        for d in dims {
            current[d] += 1;
            if current[d] < shape[d] {
                break;
            }
            current[d] = 0;
        }
    }
    out
}

fn cache() -> Arc<ChunkContentsCache> {
    Arc::new(ChunkContentsCache::new(100_000_000))
}

fn id() -> DataSourceId {
    DataSourceId::new("ds", "org")
}

async fn open(
    dir: &Path,
    axis_order: Option<AxisOrder>,
    channel_index: Option<i32>,
    additional_axes: Option<Vec<AdditionalAxis>>,
) -> DatasetArray {
    open_zarr_array(
        &vault_path(dir),
        id(),
        "layer",
        axis_order,
        channel_index,
        additional_axes,
        cache(),
        None,
    )
    .await
    .unwrap()
}

fn value_u16(x: i64, y: i64, z: i64) -> u16 {
    (x * 7 + y * 131 + z * 1009) as u16
}

/// Expected 32³ bucket (F order: x fastest), `value` given wk xyz global coordinates.
fn expected_bucket(
    offset: (i64, i64, i64),
    size: (i64, i64, i64),
    value: impl Fn(i64, i64, i64) -> Vec<u8>,
) -> Vec<u8> {
    let mut out = Vec::new();
    for z in 0..size.2 {
        for y in 0..size.1 {
            for x in 0..size.0 {
                out.extend(value(offset.0 + x, offset.1 + y, offset.2 + z));
            }
        }
    }
    out
}

#[tokio::test]
async fn c_order_zyx_u2_raw_with_border_and_missing_chunks() {
    let dir = temp_dir("zyx");
    // physical z, y, x; big-endian u2; chunks differ per axis
    let element = |p: &[i64]| value_u16(p[2], p[1], p[0]).to_be_bytes().to_vec();
    write_array(
        &dir,
        &ArraySpec {
            shape: vec![40, 50, 60],
            chunks: vec![16, 32, 24],
            dtype: ">u2",
            order: "C",
            separator: ".",
            fill_value: json!(7),
            compressor: None,
            element: &element,
            skip: vec![vec![2, 1, 2]],
        },
    );
    let array = open(&dir, None, None, None).await;
    assert_eq!(array.full_axis_order().unwrap().to_string(), "zyx");

    // fully inside the array, crossing chunk borders in every axis
    let bytes = array
        .read_bytes_with_additional_coordinates(
            Vec3Int::new(10, 5, 3),
            Vec3Int::new(32, 32, 32),
            None,
            false,
            None,
        )
        .await
        .unwrap();
    let expected = expected_bucket((10, 5, 3), (32, 32, 32), |x, y, z| {
        value_u16(x, y, z).to_le_bytes().to_vec()
    });
    assert_eq!(bytes, expected);

    // border: positions beyond the shape but inside the chunk grid come from chunk padding,
    // positions beyond the grid stay 0; chunk (2,1,2) is missing -> fill value 7
    let bytes = array
        .read_bytes_with_additional_coordinates(
            Vec3Int::new(40, 32, 32),
            Vec3Int::new(32, 32, 32),
            None,
            false,
            None,
        )
        .await
        .unwrap();
    let expected = expected_bucket((40, 32, 32), (32, 32, 32), |x, y, z| {
        let in_grid = x < 72 && y < 64 && z < 48;
        let missing = (32..48).contains(&z) && (32..64).contains(&y) && (48..72).contains(&x);
        let v = if !in_grid {
            0
        } else if missing {
            7
        } else {
            value_u16(x, y, z)
        };
        v.to_le_bytes().to_vec()
    });
    assert_eq!(bytes, expected);

    // completely outside: clamped chunk indices do not overlap -> zeros
    let bytes = array
        .read_bytes_with_additional_coordinates(
            Vec3Int::new(1024, 0, 0),
            Vec3Int::new(32, 32, 32),
            None,
            false,
            None,
        )
        .await
        .unwrap();
    assert!(bytes.iter().all(|&b| b == 0) && bytes.len() == 32 * 32 * 32 * 2);
}

#[tokio::test]
async fn f_order_cxyz_shortcut_returns_raw_chunk_bytes() {
    for (compressor, dtype) in [
        (
            Some(json!({"id": "blosc", "cname": "lz4", "clevel": 5, "shuffle": 1})),
            ">u2",
        ),
        (Some(json!({"id": "zstd", "level": 3})), "<u2"),
        (None, ">u2"),
    ] {
        let dir = temp_dir("cxyz");
        let big = dtype.starts_with('>');
        let element = move |p: &[i64]| {
            let v = value_u16(p[1], p[2], p[3]);
            if big {
                v.to_be_bytes().to_vec()
            } else {
                v.to_le_bytes().to_vec()
            }
        };
        write_array(
            &dir,
            &ArraySpec {
                shape: vec![1, 64, 64, 64],
                chunks: vec![1, 32, 32, 32],
                dtype,
                order: "F",
                separator: "/",
                fill_value: json!(258),
                compressor: compressor.clone(),
                element: &element,
                skip: vec![vec![0, 1, 1, 1]],
            },
        );
        let array = open(&dir, Some(AxisOrder::cxyz()), None, None).await;
        let bytes = array
            .read_bytes_with_additional_coordinates(
                Vec3Int::new(32, 0, 32),
                Vec3Int::new(32, 32, 32),
                None,
                false,
                None,
            )
            .await
            .unwrap();
        // Scala skip-typing shortcut: the decompressed chunk as stored (byte order unchanged)
        let expected = expected_bucket((32, 0, 32), (32, 32, 32), |x, y, z| element(&[0, x, y, z]));
        assert_eq!(bytes, expected, "{compressor:?}");
        // missing chunk in the shortcut: every byte is fill_value.byteValue (258 -> 2)
        let bytes = array
            .read_bytes_with_additional_coordinates(
                Vec3Int::new(32, 32, 32),
                Vec3Int::new(32, 32, 32),
                None,
                false,
                None,
            )
            .await
            .unwrap();
        assert!(bytes.len() == 65536 && bytes.iter().all(|&b| b == 2));
        // unaligned read uses the typed path: little-endian values
        let bytes = array
            .read_bytes_with_additional_coordinates(
                Vec3Int::new(16, 0, 0),
                Vec3Int::new(32, 32, 32),
                None,
                false,
                None,
            )
            .await
            .unwrap();
        let expected = expected_bucket((16, 0, 0), (32, 32, 32), |x, y, z| {
            value_u16(x, y, z).to_le_bytes().to_vec()
        });
        assert_eq!(bytes, expected);
    }
}

#[tokio::test]
async fn uint24_channels_and_channel_index_c_order() {
    let dir = temp_dir("rgb");
    // physical c, x, y, z (C order), 3 channels
    let element = |p: &[i64]| vec![(p[0] * 100 + p[1] + p[2] * 3 + p[3] * 5) as u8];
    write_array(
        &dir,
        &ArraySpec {
            shape: vec![3, 40, 40, 40],
            chunks: vec![3, 32, 32, 32],
            dtype: "|u1",
            order: "C",
            separator: ".",
            fill_value: json!(0),
            compressor: Some(json!({"id": "gzip", "level": 5})),
            element: &element,
            skip: vec![],
        },
    );
    let array = open(&dir, Some(AxisOrder::cxyz()), None, None).await;
    let bytes = array
        .read_bytes_with_additional_coordinates(
            Vec3Int::new(8, 0, 4),
            Vec3Int::new(32, 32, 32),
            None,
            true,
            None,
        )
        .await
        .unwrap();
    // F order over (c, x, y, z): channels interleaved per voxel
    let expected = expected_bucket((8, 0, 4), (32, 32, 32), |x, y, z| {
        (0..3).map(|c| element(&[c, x, y, z])[0]).collect()
    });
    assert_eq!(bytes, expected);

    // channel index 2 selects the third channel
    let array = open(&dir, Some(AxisOrder::cxyz()), Some(2), None).await;
    let bytes = array
        .read_bytes_with_additional_coordinates(
            Vec3Int::new(0, 0, 0),
            Vec3Int::new(32, 32, 32),
            None,
            false,
            None,
        )
        .await
        .unwrap();
    let expected = expected_bucket((0, 0, 0), (32, 32, 32), |x, y, z| element(&[2, x, y, z]));
    assert_eq!(bytes, expected);
}

#[tokio::test]
async fn additional_axis_single_and_batched_reads() {
    let dir = temp_dir("taxis");
    // physical t, c, z, y, x (OME order); t has 32 entries
    let element = |p: &[i64]| vec![(p[0] * 9 + p[3] * 3 + p[4]) as u8 ^ (p[2] as u8)];
    write_array(
        &dir,
        &ArraySpec {
            shape: vec![32, 1, 2, 32, 32],
            chunks: vec![8, 1, 1, 32, 32],
            dtype: "|u1",
            order: "C",
            separator: "/",
            fill_value: json!(0),
            compressor: Some(json!({"id": "zlib", "level": 1})),
            element: &element,
            skip: vec![],
        },
    );
    let axes = vec![AdditionalAxis {
        name: "t".into(),
        bounds: vec![0, 32],
        index: 0,
    }];
    let axis_order = AxisOrder::new(4, 3, Some(2), Some(1));
    let array = open(&dir, Some(axis_order), None, Some(axes)).await;
    assert_eq!(array.full_axis_order().unwrap().to_string_wk(), "tcxyz");

    // single t = 5, z = 1
    let coordinate = [RequestedAdditionalCoordinate {
        name: "t".into(),
        value: 5,
        length: None,
    }];
    let bytes = array
        .read_bytes_with_additional_coordinates(
            Vec3Int::new(0, 0, 1),
            Vec3Int::new(32, 32, 1),
            Some(&coordinate),
            false,
            None,
        )
        .await
        .unwrap();
    let expected = expected_bucket((0, 0, 1), (32, 32, 1), |x, y, z| element(&[5, 0, z, y, x]));
    assert_eq!(bytes, expected);

    // batched: 32 t values starting at 0 are repacked into the z slot (x fastest, then y, then t)
    let coordinate = [RequestedAdditionalCoordinate {
        name: "t".into(),
        value: 0,
        length: Some(32),
    }];
    let bytes = array
        .read_bytes_with_additional_coordinates(
            Vec3Int::new(0, 0, 1),
            Vec3Int::new(32, 32, 32),
            Some(&coordinate),
            false,
            None,
        )
        .await
        .unwrap();
    let mut expected = Vec::new();
    for t in 0..32 {
        for y in 0..32 {
            for x in 0..32 {
                expected.extend(element(&[t, 0, 1, y, x]));
            }
        }
    }
    assert_eq!(bytes, expected);

    // invalid batch length and unknown axis
    let invalid = [RequestedAdditionalCoordinate {
        name: "t".into(),
        value: 0,
        length: Some(5),
    }];
    let error = array
        .read_bytes_with_additional_coordinates(
            Vec3Int::new(0, 0, 0),
            Vec3Int::new(32, 32, 32),
            Some(&invalid),
            false,
            None,
        )
        .await
        .unwrap_err();
    assert_eq!(
        error.message,
        "failed to construct shape and offset array for requested coordinates"
    );
    assert!(error.chain[0].contains("must be 1 or 32, got 5."));
    let unknown = [RequestedAdditionalCoordinate {
        name: "q".into(),
        value: 0,
        length: None,
    }];
    let error = array
        .read_bytes_with_additional_coordinates(
            Vec3Int::new(0, 0, 0),
            Vec3Int::new(32, 32, 32),
            Some(&unknown),
            false,
            None,
        )
        .await
        .unwrap_err();
    assert!(error.chain[0].starts_with("key not found: q"));
}

#[tokio::test]
async fn two_d_array_and_multi_array_reads() {
    let dir = temp_dir("2d");
    // physical y, x; Scala's 2-d adapter appends z and names chunk files by `drop(1)`
    let element = |p: &[i64]| (p[0] * 1000 + p[1]).to_le_bytes().to_vec();
    write_array(
        &dir,
        &ArraySpec {
            shape: vec![20, 30],
            chunks: vec![32, 32],
            dtype: "<i8",
            order: "C",
            separator: ".",
            fill_value: json!(0),
            compressor: None,
            element: &element,
            skip: vec![],
        },
    );
    let axis_order = AxisOrder::new(1, 0, None, None);
    let array = open(&dir, Some(axis_order), None, None).await;
    assert_eq!(array.rank(), 3);
    assert_eq!(array.chunk_shape(), &[32, 32, 1]);
    // chunk [0, 0, 0] -> file "0.0" (drop(1) of the physical index)
    let bytes = array
        .read_bytes_with_additional_coordinates(
            Vec3Int::new(0, 0, 0),
            Vec3Int::new(32, 32, 1),
            None,
            false,
            None,
        )
        .await
        .unwrap();
    let expected = expected_bucket((0, 0, 0), (32, 32, 1), |x, y, _| element(&[y, x]));
    assert_eq!(bytes, expected);

    // readAsMultiArray: physical order (plus the adapter dimension), C layout
    let plain = open_zarr_array(
        &vault_path(&dir),
        id(),
        "layer",
        Some(AxisOrder::new(1, 0, None, None)),
        None,
        None,
        cache(),
        None,
    )
    .await
    .unwrap();
    let multi = plain
        .read_as_multi_array(&[3, 4, 0], &[2, 3, 1], None)
        .await
        .unwrap();
    assert_eq!(multi.shape(), &[2, 3, 1]);
    assert_eq!(
        to_long_array(&multi).unwrap(),
        vec![3004, 3005, 3006, 4004, 4005, 4006]
    );
    let empty = plain
        .read_as_multi_array(&[0, 0, 0], &[0, 1, 1], None)
        .await
        .unwrap();
    assert_eq!(empty.shape(), &[0, 0, 0]);
    let error = plain
        .read_as_multi_array(&[0, 0, 0], &[-1, 1, 1], None)
        .await
        .unwrap_err();
    assert_eq!(
        error.message,
        "Trying to read negative shape from DatasetArray: -1,1,1"
    );
}

#[tokio::test]
async fn errors_cache_and_header_failures() {
    let dir = temp_dir("errors");
    let element = |p: &[i64]| vec![(p[0] + p[1] + p[2]) as u8];
    write_array(
        &dir,
        &ArraySpec {
            shape: vec![64, 32, 32],
            chunks: vec![32, 32, 32],
            dtype: "|u1",
            order: "C",
            separator: ".",
            fill_value: json!(0),
            compressor: Some(json!({"id": "zstd", "level": 1})),
            element: &element,
            skip: vec![],
        },
    );
    std::fs::write(dir.join("1.0.0"), b"not zstd").unwrap();
    let array = open(&dir, Some(AxisOrder::XYZ), None, None).await;
    let error = array
        .read_bytes_with_additional_coordinates(
            Vec3Int::new(32, 0, 0),
            Vec3Int::new(32, 32, 32),
            None,
            false,
            None,
        )
        .await
        .unwrap_err();
    assert!(
        error.message.starts_with("Reading chunk at ") && error.message.ends_with("1.0.0 failed")
    );
    assert_eq!(error.chain[0], "Could not decompress data chunk.");

    // the good chunk is cached: deleting the file does not change the result
    let read = || {
        array.read_bytes_with_additional_coordinates(
            Vec3Int::new(0, 0, 0),
            Vec3Int::new(32, 32, 32),
            None,
            false,
            None,
        )
    };
    let first = read().await.unwrap();
    std::fs::remove_file(dir.join("0.0.0")).unwrap();
    assert_eq!(read().await.unwrap(), first);
    let expected = expected_bucket((0, 0, 0), (32, 32, 32), |x, y, z| element(&[x, y, z]));
    assert_eq!(first, expected);

    // header errors
    let missing = temp_dir("missing");
    let error = open_zarr_array(
        &vault_path(&missing),
        id(),
        "l",
        None,
        None,
        None,
        cache(),
        None,
    )
    .await
    .unwrap_err();
    assert_eq!(error.message, "Could not read header at .zarray");
    std::fs::write(missing.join(".zarray"), br#"{"zarr_format": 2}"#).unwrap();
    let error = open_zarr_array(
        &vault_path(&missing),
        id(),
        "l",
        None,
        None,
        None,
        cache(),
        None,
    )
    .await
    .unwrap_err();
    assert_eq!(error.message, "Could not parse array header");
    let too_big = json!({"zarr_format": 2, "shape": [4096, 4096, 4096], "chunks": [1024, 1024, 1024],
        "dtype": "<f8", "order": "C"});
    std::fs::write(missing.join(".zarray"), too_big.to_string()).unwrap();
    let error = open_zarr_array(
        &vault_path(&missing),
        id(),
        "l",
        None,
        None,
        None,
        cache(),
        None,
    )
    .await
    .unwrap_err();
    assert_eq!(
        error.message,
        "Array chunk size exceeds limit of 314572800, got 8589934592"
    );
}

/// Real `.zarray` files under `binaryData/` (gitignored local data) parse and their first
/// bucket reads without error (real blosc data); skipped when the directory is absent.
#[tokio::test]
async fn local_binary_data_zarrays_parse_and_read() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../binaryData");
    let mut stack = vec![root];
    let mut parsed = 0;
    let mut nonzero_buckets = 0;
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.file_name().is_some_and(|n| n == ".zarray") {
                let bytes = std::fs::read(&path).unwrap();
                let header = parse_zarr_header(&bytes)
                    .unwrap_or_else(|e| panic!("{}: {e:?}", path.display()));
                header.check_data_type().unwrap();
                parsed += 1;
                let array_dir = std::fs::canonicalize(path.parent().unwrap()).unwrap();
                let array = open(&array_dir, None, None, None).await;
                let bucket = array
                    .read_bytes_with_additional_coordinates(
                        Vec3Int::new(0, 0, 0),
                        Vec3Int::new(32, 32, 32),
                        None,
                        false,
                        None,
                    )
                    .await
                    .unwrap_or_else(|e| panic!("{}: {e:?}", array_dir.display()));
                if bucket.iter().any(|&b| b != 0) {
                    nonzero_buckets += 1;
                }
            }
        }
    }
    eprintln!("parsed {parsed} local .zarray files, {nonzero_buckets} first buckets non-zero");
}
