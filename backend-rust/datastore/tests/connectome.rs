use serde_json::Value;
use std::{path::PathBuf, sync::Arc};
use webknossos_datastore::{
    AppState,
    config::DatastoreConfig,
    models::{DataSourceId, LayerAttachment, LayerAttachmentDataformat, UPath},
    services::connectome::{ConnectomeFileKey, ConnectomeService, Direction, scala_set_order},
};
fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/connectomes")
}
fn service() -> ConnectomeService {
    let state = AppState::new(DatastoreConfig::defaults(std::path::Path::new("/srv/wk")));
    ConnectomeService::new(state.data_vaults, Arc::clone(&state.chunk_contents_cache))
}
fn key(name: &str) -> ConnectomeFileKey {
    ConnectomeFileKey {
        source: DataSourceId::new("ds", "org"),
        layer: "seg".into(),
        attachment: LayerAttachment {
            name: name.into(),
            path: UPath::parse(root().join(name).to_str().unwrap()).unwrap(),
            data_format: if name.starts_with("zarr") {
                LayerAttachmentDataformat::Zarr3
            } else {
                LayerAttachmentDataformat::Hdf5
            },
            credential_id: None,
        },
    }
}
#[test]
fn set_order_matches_actual_scala_small_champ_and_collision_sets() {
    let data: Value =
        serde_json::from_slice(&std::fs::read(root().join("set_order_oracle.json")).unwrap())
            .unwrap();
    for sample in data.as_array().unwrap() {
        let ids = sample["ids"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_i64().unwrap())
            .collect::<Vec<_>>();
        let expected = sample["order"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_i64().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(scala_set_order(&ids), expected, "{ids:?}");
    }
}
#[tokio::test]
async fn hdf5_and_zarr_tables_match_actual_scala_connectome_service() {
    let oracle: Value =
        serde_json::from_slice(&std::fs::read(root().join("scala_oracle.json")).unwrap()).unwrap();
    let svc = service();
    let selected = oracle["selected"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_i64().unwrap())
        .collect::<Vec<_>>();
    for name in [
        "contiguous.hdf5",
        "chunked_v1.hdf5",
        "chunked_v4.hdf5",
        "zarr3",
        "numeric.hdf5",
        "zarr_numeric",
    ] {
        let oracle = match name {
            "zarr3" => serde_json::from_slice::<Value>(
                &std::fs::read(root().join("scala_zarr_oracle.json")).unwrap(),
            )
            .unwrap(),
            "numeric.hdf5" => serde_json::from_slice::<Value>(
                &std::fs::read(root().join("scala_numeric_oracle.json")).unwrap(),
            )
            .unwrap(),
            "zarr_numeric" => serde_json::from_slice::<Value>(
                &std::fs::read(root().join("scala_zarr_numeric_oracle.json")).unwrap(),
            )
            .unwrap(),
            _ => oracle.clone(),
        };
        let key = key(name);
        assert_eq!(
            svc.mapping_name(&key, None).await.unwrap(),
            "connectome_mapping"
        );
        for case in oracle["synapses"].as_array().unwrap() {
            let ids = case["ids"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_i64().unwrap())
                .collect::<Vec<_>>();
            let actual = svc.synapses(&key, &ids, None).await.unwrap();
            assert_eq!(
                serde_json::to_value(actual).unwrap(),
                case["value"],
                "{name}: {ids:?}"
            );
        }
        assert_eq!(
            serde_json::to_value(svc.positions(&key, &selected, None).await.unwrap()).unwrap(),
            oracle["positions"],
            "{name}"
        );
        for (dir, field) in [(Direction::Src, "src"), (Direction::Dst, "dst")] {
            assert_eq!(
                serde_json::to_value(svc.partners(&key, &selected, dir, None).await.unwrap())
                    .unwrap(),
                oracle[field],
                "{name}"
            );
        }
        let actual = serde_json::to_value(svc.types(&key, &selected, None).await.unwrap()).unwrap();
        let expected = oracle["types"].clone();
        assert_eq!(actual, expected, "{name}");
        for case in oracle["boundaries"].as_array().unwrap() {
            let actual = svc
                .partners(&key, &[case["id"].as_i64().unwrap()], Direction::Dst, None)
                .await;
            assert_eq!(
                actual.is_ok(),
                case["ok"].as_bool().unwrap(),
                "{name}: {case}"
            );
            if let Ok(value) = actual {
                assert_eq!(serde_json::to_value(value).unwrap(), case["value"]);
            }
        }
    }
}
#[tokio::test]
async fn empty_queries_preserve_scala_opening_and_missing_dataset_behavior() {
    let svc = service();
    let empty = key("empty.hdf5");
    assert!(svc.synapses(&empty, &[], None).await.unwrap().is_empty());
    assert!(
        svc.synapses(&empty, &[123, 123], None)
            .await
            .unwrap()
            .iter()
            .all(|r| r.r#in.is_empty() && r.out.is_empty())
    );
    assert!(svc.positions(&empty, &[], None).await.unwrap().is_empty());
    assert!(
        svc.types(&empty, &[], None)
            .await
            .unwrap()
            .synapse_types
            .is_empty()
    );
    assert!(
        svc.partners(&empty, &[], Direction::Src, None)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(svc.positions(&empty, &[0], None).await.is_err());
    let missing = key("absent.hdf5");
    assert!(svc.synapses(&missing, &[], None).await.unwrap().is_empty());
    assert!(svc.positions(&missing, &[], None).await.is_err());
    for name in ["contiguous.hdf5", "chunked_v4.hdf5"] {
        assert!(svc.positions(&key(name), &[-1], None).await.is_err());
        assert!(
            svc.partners(&key(name), &[1000], Direction::Dst, None)
                .await
                .is_err()
        );
    }
}
#[tokio::test]
async fn hdf5_handle_cache_is_bounded_to_thirty_and_scoped() {
    let svc = service();
    let source = DataSourceId::new("ds", "org");
    for n in 0..31 {
        let mut k = key("contiguous.hdf5");
        k.attachment.name = format!("attachment{n}");
        assert_eq!(
            svc.mapping_name(&k, None).await.unwrap(),
            "connectome_mapping"
        );
    }
    assert_eq!(
        svc.clear_caches(&DataSourceId::new("other", "org"), None),
        0
    );
    assert_eq!(svc.clear_caches(&source, Some("other")), 0);
    assert_eq!(svc.clear_caches(&source, Some("seg")), 30);
    assert_eq!(svc.clear_caches(&source, None), 0);
}
#[tokio::test]
async fn numeric_storage_preserves_jhdf5_rejections_and_zarr_long_array_casts() {
    use webknossos_datastore::datareaders::hdf5::Hdf5Reader;
    let reader = Hdf5Reader::open(&root().join("numeric.hdf5")).unwrap();
    assert_eq!(
        reader.uint64_values("float_whole", 0, 999, None).unwrap(),
        [0, 1, 7, 1u64 << 63]
    );
    assert!(
        reader
            .uint64_values("float_fractional", 0, 999, None)
            .is_err()
    );
    assert!(reader.uint64_values("float_special", 0, 999, None).is_err());
    let svc = service();
    assert!(
        svc.synapses(&key("zarr_numeric"), &[4, 2], None)
            .await
            .is_err()
    );
    assert!(
        !svc.synapses(&key("numeric.hdf5"), &[4, 2], None)
            .await
            .unwrap()[0]
            .out
            .is_empty()
    );
}
