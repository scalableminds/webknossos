use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use webknossos_datastore::{
    AppState,
    config::DatastoreConfig,
    models::{DataSourceId, LayerAttachment},
    services::{
        mesh_file::{ChunkRequest, MeshFileKey, MeshFileService},
        mesh_manifest::{Manifest, merge},
    },
};
fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/meshes")
}
fn key(name: &str) -> MeshFileKey {
    let (path, format) = if name == "local" || name == "real" {
        (root().join(format!("{name}.hdf5")), "hdf5")
    } else if name == "zarr3" {
        (root().join(name), "zarr3")
    } else {
        (root().join(name), "neuroglancerPrecomputed")
    };
    MeshFileKey {
        source: DataSourceId::new("ds", "org"),
        layer: "seg".into(),
        attachment: LayerAttachment::from_json(
            &json!({"name":name,"path":path,"dataFormat":format}),
        )
        .unwrap(),
    }
}
fn service() -> Arc<MeshFileService> {
    AppState::new(DatastoreConfig::defaults(Path::new("/tmp"))).mesh_files
}
fn compact(value: impl serde::Serialize) -> Value {
    serde_json::from_str(&webknossos_datastore::models::json::compact(
        &serde_json::to_value(value).unwrap(),
    ))
    .unwrap()
}
#[test]
fn manifests_and_exact_float_transforms_match_actual_compiled_scala() {
    let bytes = include_bytes!("fixtures/meshes/manifest.bin");
    let manifest = Manifest::parse(bytes).unwrap();
    let transform = vec![
        vec![2., 0.5, 1., 10.],
        vec![0.25, 3., 0.75, 20.],
        vec![1., 0.5, 4., 30.],
    ];
    for (mode, offset) in [("local", 9), ("precomputed", 25)] {
        let lods = manifest
            .enrich(offset, u64::MAX, 0.75, &transform, mode == "precomputed")
            .unwrap();
        let expected: Value = serde_json::from_slice(
            &std::fs::read(root().join(format!("{mode}_oracle.json"))).unwrap(),
        )
        .unwrap();
        let info = merge(
            vec![lods],
            "draco".into(),
            if mode == "local" {
                [1.; 3]
            } else {
                [1. / 1024.; 3]
            },
        )
        .unwrap();
        assert_eq!(compact(info), expected);
    }
    for size in 0..bytes.len() {
        assert!(Manifest::parse(&bytes[..size]).is_err(), "{size}");
    }
    let mut invalid = bytes.to_vec();
    invalid[24..28].copy_from_slice(&i32::MAX.to_le_bytes());
    assert!(Manifest::parse(&invalid).is_err());
    invalid = bytes.to_vec();
    invalid[0..4].copy_from_slice(&f32::NAN.to_le_bytes());
    assert!(Manifest::parse(&invalid).is_err());
    assert!(manifest.enrich(0, 2, 1., &transform, false).is_err());
}
#[tokio::test]
async fn hdf5_zarr_and_precomputed_raw_gzip_shards_serve_same_payload_and_lods() {
    let svc = service();
    for name in ["local", "zarr3", "precomputed", "precomputed_gzip"] {
        let k = key(name);
        let info = svc.list_chunks(&k, &[-1], None).await.unwrap();
        let mut expected: Value = serde_json::from_slice(
            &std::fs::read(root().join(if name.starts_with("precomputed") {
                "precomputed_oracle.json"
            } else {
                "local_oracle.json"
            }))
            .unwrap(),
        )
        .unwrap();
        let actual = compact(&info);
        // Generated oracle uses the first segment's offset; compare real high-id payload offsets separately.
        for (lod, expected_lod) in expected["lods"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .enumerate()
        {
            for (chunk, c) in expected_lod["chunks"]
                .as_array_mut()
                .unwrap()
                .iter_mut()
                .enumerate()
            {
                c["byteOffset"] = actual["lods"][lod]["chunks"][chunk]["byteOffset"].clone();
            }
        }
        assert_eq!(actual, expected, "{name}");
        let chunks = info
            .lods
            .iter()
            .flat_map(|lod| &lod.chunks)
            .collect::<Vec<_>>();
        let req = |chunk: usize| ChunkRequest {
            byte_offset: chunks[chunk].byte_offset,
            byte_size: chunks[chunk].byte_size,
            segment_id: Some(u64::MAX),
        };
        let (bytes, encoding) = svc
            .read_chunks(&k, &[req(2), req(0), req(1)], None)
            .await
            .unwrap();
        assert_eq!(bytes, b"789123456", "{name}");
        assert_eq!(encoding, "draco");
        let merged = svc.list_chunks(&k, &[2, 4], None).await.unwrap();
        assert_eq!(merged.lods[0].chunks.len(), 4);
        assert_eq!(merged.lods[1].chunks.len(), 2);
        assert!(svc.list_chunks(&k, &[6], None).await.is_err());
        if !name.starts_with("precomputed") {
            assert_eq!(
                svc.list_chunks(&k, &[2, 6], None).await.unwrap().lods[0]
                    .chunks
                    .len(),
                2
            );
        }
    }
}
#[tokio::test]
async fn real_hdf5_mesh_matches_scala_chunk_oracles_and_original_fragment_bytes() {
    let svc = service();
    let k = key("real");
    let attrs: Value =
        serde_json::from_slice(include_bytes!("fixtures/meshes/real_attributes.json")).unwrap();
    assert_eq!(
        svc.mapping_name(&k, None).await.unwrap().unwrap(),
        attrs["mapping"].as_str().unwrap()
    );
    let payload = include_bytes!("fixtures/meshes/real_payload.bin");
    for query in attrs["queries"].as_array().unwrap() {
        let id = query["id"].as_i64().unwrap();
        let expected: Value = serde_json::from_slice(
            &std::fs::read(root().join(format!("real_oracle_{id}.json"))).unwrap(),
        )
        .unwrap();
        let info = svc.list_chunks(&k, &[id], None).await.unwrap();
        assert_eq!(compact(&info), expected);
        let chunks = &info.lods[0].chunks;
        for chunk in chunks {
            let req = ChunkRequest {
                byte_offset: chunk.byte_offset,
                byte_size: chunk.byte_size,
                segment_id: None,
            };
            let (bytes, format) = svc.read_chunks(&k, &[req], None).await.unwrap();
            assert_eq!(format, "draco");
            let start = chunk.byte_offset as usize;
            assert_eq!(bytes, &payload[start..start + chunk.byte_size as usize]);
        }
    }
}

#[tokio::test]
async fn empty_requests_and_zero_length_hdf5_reads_keep_native_boundaries() {
    let svc = service();
    let k = key("local");
    assert_eq!(
        svc.read_chunks(&k, &[], None).await.unwrap().0,
        Vec::<u8>::new()
    );
    assert!(
        svc.read_chunks(
            &k,
            &[ChunkRequest {
                byte_offset: 0,
                byte_size: 0,
                segment_id: None
            }],
            None
        )
        .await
        .unwrap()
        .0
        .is_empty()
    );
    let reader = webknossos_datastore::datareaders::hdf5::Hdf5Reader::open(
        &k.attachment.local_path().unwrap(),
    )
    .unwrap();
    let end = reader.dataset_shape("neuroglancer").unwrap()[0] as i64;
    assert!(
        svc.read_chunks(
            &k,
            &[ChunkRequest {
                byte_offset: end,
                byte_size: 0,
                segment_id: None
            }],
            None
        )
        .await
        .is_err()
    );
    assert!(
        svc.read_chunks(
            &k,
            &[ChunkRequest {
                byte_offset: i64::MAX,
                byte_size: 1,
                segment_id: None
            }],
            None
        )
        .await
        .is_err()
    );
}
