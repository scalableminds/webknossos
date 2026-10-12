use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use webknossos_datastore::{
    compression::{CompressionSetting, Compressor},
    datareaders::{
        ChunkContentsCache,
        n5::{N5Header, extract_block, open_n5_array},
    },
    datavault::{FileSystemDataVault, UPath, VaultPath},
    models::{AxisOrder, DataSourceId, Vec3Int},
};
fn temp() -> PathBuf {
    static COUNT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let p = std::env::temp_dir().join(format!(
        "wk-n5-{}-{}",
        std::process::id(),
        COUNT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&p).unwrap();
    p
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
fn value(x: i32, y: i32, z: i32) -> u16 {
    (1 + x + 20 * y + 400 * z) as u16
}
fn write(p: &Path, compression: Value) {
    let metadata = json!({"dimensions":[5,4,3],"blockSize":[2,3,2],"dataType":"uint16","compression":compression});
    std::fs::write(
        p.join("attributes.json"),
        serde_json::to_vec(&metadata).unwrap(),
    )
    .unwrap();
    let compressor = Compressor::from_n5_settings(
        &compression
            .as_object()
            .unwrap()
            .iter()
            .map(|(k, v)| (k.clone(), CompressionSetting::from_json(v).unwrap()))
            .collect(),
    )
    .unwrap();
    for cx in 0..3 {
        for cy in 0..2 {
            for cz in 0..2 {
                let shape = [2.min(5 - cx * 2), 3.min(4 - cy * 3), 2.min(3 - cz * 2)];
                let mut data = Vec::new();
                for z in 0..shape[2] {
                    for y in 0..shape[1] {
                        for x in 0..shape[0] {
                            data.extend(value(cx * 2 + x, cy * 3 + y, cz * 2 + z).to_be_bytes());
                        }
                    }
                }
                let mut chunk = vec![0, 0, 0, 3];
                for d in shape {
                    chunk.extend(d.to_be_bytes());
                }
                chunk.extend(compressor.compress(&data).unwrap());
                let target = p.join(format!("{cx}/{cy}/{cz}"));
                std::fs::create_dir_all(target.parent().unwrap()).unwrap();
                std::fs::write(target, chunk).unwrap();
            }
        }
    }
}
#[tokio::test]
async fn codecs_and_smaller_edge_chunks_preserve_n5_axes_and_big_endian() {
    for compression in [
        json!({"type":"raw"}),
        json!({"type":"gzip"}),
        json!({"type":"zstd","level":3}),
        json!({"type":"gzip","useZlib":true}),
    ] {
        let p = temp();
        write(&p, compression);
        let a = open_n5_array(
            &root(&p),
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
        let bytes = a
            .read_bytes_with_additional_coordinates(
                Vec3Int::new(1, 1, 0),
                Vec3Int::new(4, 3, 3),
                None,
                false,
                None,
            )
            .await
            .unwrap();
        let mut expected = Vec::new();
        for z in 0..3 {
            for y in 1..4 {
                for x in 1..5 {
                    expected.extend(value(x, y, z).to_le_bytes());
                }
            }
        }
        assert_eq!(bytes, expected);
        let a = open_n5_array(
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
        let bytes = a
            .read_bytes_with_additional_coordinates(
                Vec3Int::new(0, 1, 1),
                Vec3Int::new(2, 2, 3),
                None,
                false,
                None,
            )
            .await
            .unwrap();
        let mut expected = Vec::new();
        for z in 1..4 {
            for y in 1..3 {
                for x in 0..2 {
                    expected.extend(value(z, y, x).to_le_bytes());
                }
            }
        }
        assert_eq!(bytes, expected, "Scala defaults to zyx");
    }
}
#[tokio::test]
async fn varlength_mode_uses_shape_and_pads_short_payload_ignoring_element_count() {
    let p = temp();
    std::fs::write(
        p.join("attributes.json"),
        serde_json::to_vec(&json!({"dimensions":[2,2,2],"blockSize":[2,2,2],"dataType":"uint16"}))
            .unwrap(),
    )
    .unwrap();
    let mut block = vec![0, 1, 0, 3];
    for _ in 0..3 {
        block.extend(2i32.to_be_bytes());
    }
    block.extend(1i32.to_be_bytes());
    block.extend(1234u16.to_be_bytes());
    std::fs::create_dir_all(p.join("0/0")).unwrap();
    std::fs::write(p.join("0/0/0"), block).unwrap();
    let a = open_n5_array(
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
    let bytes = a
        .read_bytes_with_additional_coordinates(
            Vec3Int::new(0, 0, 0),
            Vec3Int::new(2, 2, 2),
            None,
            false,
            None,
        )
        .await
        .unwrap();
    let mut expected = vec![0; 16];
    expected[..2].copy_from_slice(&1234u16.to_le_bytes());
    assert_eq!(bytes, expected);
    let empty = temp();
    std::fs::write(
        empty.join("attributes.json"),
        std::fs::read(p.join("attributes.json")).unwrap(),
    )
    .unwrap();
    let a = open_n5_array(
        &root(&empty),
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
            Vec3Int::new(2, 2, 2),
            None,
            false,
            None
        )
        .await
        .unwrap(),
        vec![0; 16]
    );
}
#[test]
fn header_and_block_validation() {
    assert!(N5Header::parse(br#"{"dimensions":[2],"blockSize":[0],"dataType":"uint8"}"#).is_err());
    assert!(N5Header::parse(br#"{"dimensions":[2],"blockSize":[2],"dataType":"bool"}"#).is_err());
    let (header, payload) = extract_block(&[0, 2, 0, 0, 0, 7, 1, 2]).unwrap();
    assert_eq!(header.mode, 2);
    assert_eq!(header.num_elements, 7);
    assert!(header.block_size.is_empty());
    assert_eq!(payload, [1, 2]);
    for len in 0..6 {
        assert!(extract_block(&[0, 2, 0, 0, 0, 7][..len]).is_err());
    }
}

#[tokio::test]
async fn real_n5_gzip_block_matches_independent_numpy_oracle() {
    let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/n5/real_gzip");
    let a = open_n5_array(
        &root(&p),
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
            Vec3Int::new(1, 2, 3),
            Vec3Int::new(8, 8, 8),
            None,
            false,
            None,
        )
        .await
        .unwrap();
    assert_eq!(actual, std::fs::read(p.join("expected.bin")).unwrap());
}
