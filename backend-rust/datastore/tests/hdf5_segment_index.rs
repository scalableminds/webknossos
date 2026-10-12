use serde_json::Value;
use std::{path::PathBuf, sync::Arc};
use webknossos_datastore::{
    AppState,
    config::DatastoreConfig,
    datareaders::hdf5::Hdf5Reader,
    models::{DataSourceId, LayerAttachment, UPath, Vec3Int, enums::LayerAttachmentDataformat},
    services::segment_index::{SegmentIndexFileKey, SegmentIndexService},
};

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/segment_index")
        .join(format!("{name}.hdf5"))
}
fn service() -> Arc<SegmentIndexService> {
    AppState::new(DatastoreConfig::defaults(std::path::Path::new("/tmp"))).segment_index
}
fn key(path: PathBuf) -> SegmentIndexFileKey {
    SegmentIndexFileKey {
        data_source_id: DataSourceId::new("ds", "org"),
        layer_name: "seg".into(),
        attachment: LayerAttachment {
            name: "idx".into(),
            path: UPath::parse(path.to_string_lossy().as_ref()).unwrap(),
            data_format: LayerAttachmentDataformat::Hdf5,
            credential_id: None,
        },
    }
}

#[tokio::test]
async fn contiguous_and_filtered_big_endian_hyperslabs() {
    for name in ["contiguous", "chunked", "chunked_v1"] {
        let svc = service();
        let k = key(fixture(name));
        for (id, expected) in [
            (2, vec![[0, 0, 0], [1, 0, 0]]),
            (4, vec![[2, 3, 0]]),
            (3, vec![[5, 5, 5]]),
            (-1, vec![[32767, -32768, -1]]),
            (6, vec![]),
        ] {
            assert_eq!(
                svc.read_segment_index(&k, id, None).await.unwrap(),
                expected
                    .into_iter()
                    .map(|[x, y, z]| Vec3Int::new(x, y, z))
                    .collect::<Vec<_>>(),
                "{name}: {id}"
            );
        }
    }
}

#[tokio::test]
async fn real_repository_file_matches_h5py_oracle() {
    let path = fixture("real_l4_sample");
    let reader = Hdf5Reader::open(&path).unwrap();
    let oracle: Value =
        serde_json::from_str(include_str!("fixtures/segment_index/real_oracle.json")).unwrap();
    assert_eq!(
        reader.root_u64("n_hash_buckets").unwrap(),
        oracle["n_hash_buckets"].as_u64().unwrap()
    );
    assert_eq!(
        reader.root_string("hash_function").unwrap(),
        oracle["hash_function"].as_str().unwrap()
    );
    assert_eq!(
        reader.root_string("dtype_bucket_entries").unwrap(),
        "uint16"
    );
    let svc = service();
    let k = key(path);
    for query in oracle["queries"].as_array().unwrap() {
        let id = query["segment_id"]
            .as_str()
            .unwrap()
            .parse::<u64>()
            .unwrap();
        let points = svc.read_segment_index(&k, id as i64, None).await.unwrap();
        assert_eq!(
            serde_json::to_value(points).unwrap(),
            query["positions"],
            "{id}"
        );
    }
}

#[tokio::test]
async fn malformed_files_return_errors_and_failed_loads_are_retryable() {
    let svc = service();
    for name in [
        "zero_buckets",
        "inverted_offsets",
        "excessive_offsets",
        "bad_dtype",
    ] {
        assert!(
            svc.read_segment_index(&key(fixture(name)), 2, None)
                .await
                .is_err(),
            "{name}"
        );
    }
    // Unsupported entry dtype is read only when the segment is found, as in Scala.
    assert!(
        svc.read_segment_index(&key(fixture("bad_dtype")), 6, None)
            .await
            .unwrap()
            .is_empty()
    );
    let svc = service();
    let temp = std::env::temp_dir().join(format!("wk-hdf5-retry-{}.hdf5", std::process::id()));
    let k = key(temp.clone());
    std::fs::write(&temp, b"not HDF5").unwrap();
    assert!(svc.read_segment_index(&k, 2, None).await.is_err());
    std::fs::copy(fixture("contiguous"), &temp).unwrap();
    assert_eq!(svc.read_segment_index(&k, 2, None).await.unwrap().len(), 2);
    // Replacing the inode leaves the cached handle on the old file until invalidation.
    let replacement = temp.with_extension("replacement");
    std::fs::copy(fixture("zero_buckets"), &replacement).unwrap();
    std::fs::rename(&replacement, &temp).unwrap();
    assert_eq!(svc.read_segment_index(&k, 2, None).await.unwrap().len(), 2);
    assert_eq!(svc.clear_caches(&k.data_source_id, Some("other")), 0);
    assert_eq!(svc.clear_caches(&k.data_source_id, Some("seg")), 1);
    assert!(svc.read_segment_index(&k, 2, None).await.is_err());
}

#[test]
fn invalid_selections_fail_without_allocating() {
    let reader = Hdf5Reader::open(&fixture("contiguous")).unwrap();
    assert!(
        reader
            .u64_slice("hash_bucket_offsets", u64::MAX, 2, false)
            .is_err()
    );
    assert!(
        reader
            .u64_slice("hash_bucket_offsets", 4, 1, false)
            .is_err()
    );
    assert!(reader.u16_matrix("hash_buckets", 0, 1).is_err());
}
