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
        attachment::AttachmentFileKey,
        mesh::file::{ChunkRequest, MeshFileService},
        mesh::manifest::{Manifest, MeshChunk, MeshLod, SegmentMeshLookup, from_segment_lookups},
    },
};
fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/meshes")
}
fn key(name: &str) -> AttachmentFileKey {
    let (path, format) = if name == "local" || name == "real" {
        (root().join(format!("{name}.hdf5")), "hdf5")
    } else if name == "zarr3" {
        (root().join(name), "zarr3")
    } else {
        (root().join(name), "neuroglancerPrecomputed")
    };
    AttachmentFileKey {
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
        let mut info = from_segment_lookups(
            vec![SegmentMeshLookup {
                segment_id: u64::MAX,
                lods: Some(lods),
            }],
            "draco".into(),
            if mode == "local" {
                [1.; 3]
            } else {
                [1. / 1024.; 3]
            },
        )
        .unwrap();
        assert_eq!(info.segment_ids_without_mesh, Some(vec![]));
        info.segment_ids_without_mesh = None;
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
        let mut info = svc.list_chunks(&k, &[-1], true, None).await.unwrap();
        assert_eq!(info.segment_ids_without_mesh, Some(vec![]));
        info.segment_ids_without_mesh = None;
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
        let merged = svc.list_chunks(&k, &[2, 4], true, None).await.unwrap();
        assert_eq!(merged.lods[0].chunks.len(), 4);
        assert_eq!(merged.lods[1].chunks.len(), 2);
        assert_eq!(merged.segment_ids_without_mesh, Some(vec![]));
        // Segment 6 has no entry: a failure only if no requested segment has one.
        let error = svc.list_chunks(&k, &[6], true, None).await.unwrap_err();
        assert_eq!(
            error.message,
            format!("Zero mesh chunks for segment 6 in mesh file “{name}”.")
        );
        let partial = svc.list_chunks(&k, &[2, 6, 6], true, None).await.unwrap();
        assert_eq!(partial.lods[0].chunks.len(), 2);
        assert_eq!(partial.segment_ids_without_mesh, Some(vec![6]));
        let none = svc.list_chunks(&k, &[6, 7], false, None).await.unwrap();
        assert!(none.lods.is_empty(), "{name}");
        assert_eq!(none.segment_ids_without_mesh, Some(vec![6, 7]));
        assert_eq!(
            compact(&none),
            compact(json!({
                "meshFormat":"draco",
                "lods":[],
                "chunkScale":none.chunk_scale,
                "segmentIdsWithoutMesh":[
                    {"customJsonEncoding":"bigint","value":"6"},
                    {"customJsonEncoding":"bigint","value":"7"}
                ]
            }))
        );
    }
}
fn lod(segment_ids: &[u64]) -> MeshLod {
    let chunks = segment_ids
        .iter()
        .map(|id| MeshChunk {
            position: [0.; 3],
            byte_offset: *id as i64 * 10,
            byte_size: 10,
            unmapped_segment_id: *id,
        })
        .collect();
    MeshLod {
        chunks,
        transform: vec![
            vec![1., 0., 0., 0.],
            vec![0., 1., 0., 0.],
            vec![0., 0., 1., 0.],
        ],
    }
}
/// Scala `WebknossosSegmentInfoTestSuite`.
#[test]
fn segment_lookups_list_segments_without_entry_or_chunks_as_without_mesh() {
    let lookup = |segment_id, lods| SegmentMeshLookup { segment_id, lods };
    let info = from_segment_lookups(
        vec![
            lookup(1, Some(vec![lod(&[1])])),
            lookup(2, None),
            lookup(3, Some(vec![lod(&[])])),
            lookup(2, None),
        ],
        "draco".into(),
        [1.; 3],
    )
    .unwrap();
    assert_eq!(info.lods.len(), 1);
    assert_eq!(
        info.lods[0]
            .chunks
            .iter()
            .map(|c| c.byte_offset)
            .collect::<Vec<_>>(),
        vec![10]
    );
    assert_eq!(info.segment_ids_without_mesh, Some(vec![2, 3]));
    // Lookups without any lod still produce an (empty) info instead of Scala's old `Empty`.
    let empty = from_segment_lookups(vec![lookup(5, None)], "draco".into(), [1.; 3]).unwrap();
    assert!(empty.lods.is_empty());
    assert_eq!(empty.segment_ids_without_mesh, Some(vec![5]));
    // Scala `transpose` rejects segments with different lod counts.
    assert!(
        from_segment_lookups(
            vec![
                lookup(1, Some(vec![lod(&[1])])),
                lookup(4, Some(vec![lod(&[4]), lod(&[4])])),
            ],
            "draco".into(),
            [1.; 3],
        )
        .is_err()
    );
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
        let mut info = svc.list_chunks(&k, &[id], true, None).await.unwrap();
        info.segment_ids_without_mesh = None;
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
