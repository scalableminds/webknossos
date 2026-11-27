use serde_json::json;

use super::*;

#[test]
fn data_sources_parse_scala_variants_and_render() {
    let source = UsableDataSource::from_json(&json!({
        "id": {"name": "ds", "team": "org"},
        "scale": [1, 2, 3.5],
        "dataLayers": [{
            "category": "segmentation", "name": "seg", "dataFormat": "zarr3", "elementClass": "uint32",
            "boundingBox": {"topLeft": [0, 0, 0], "width": 5, "height": 6, "depth": 7},
            "wkwResolutions": [{"resolution": 1, "cubeLength": 1024}, {"resolution": [2, 2, 1], "path": "s3://b/x"}],
            "largestSegmentId": {"customJsonEncoding": "bigint", "value": "18446744073709551615"},
            "mappings": ["b", "a", "b"],
            "defaultViewConfiguration": {},
            "attachments": {"meshes": [{"name": "m", "path": "meshes/m.hdf5", "dataFormat": "hdf5"}]}
        }]
    }))
    .unwrap();
    let layer = &source.data_layers[0];
    assert_eq!(source.scale.unit, LengthUnit::Nanometer);
    assert_eq!(layer.mags[0].mag, Vec3Int::new(1, 1, 1));
    assert_eq!(layer.largest_segment_id(), Some(u64::MAX));
    // Option[Set[String]]: duplicates removed, insertion order kept.
    assert_eq!(
        layer.mappings(),
        Some(&["b".to_owned(), "a".to_owned()][..])
    );
    assert_eq!(layer.default_view_configuration, None);
    assert_eq!(
        layer.attachments.as_ref().unwrap().meshes[0]
            .path
            .to_string(),
        "./meshes/m.hdf5"
    );
    let rendered = serde_json::to_value(&source).unwrap();
    assert_eq!(
        rendered["dataLayers"][0]["largestSegmentId"]["value"],
        "18446744073709551615"
    );
    assert_eq!(
        rendered["dataLayers"][0]["resolutions"],
        json!([[1, 1, 1], [2, 2, 1]])
    );
    assert_eq!(UsableDataSource::from_json(&rendered).unwrap(), source);
    assert!(
        UsableDataSource::from_json(&json!({
            "id": {"name": "x", "team": "y"}, "scale": [1, 1, 1], "dataLayers": [{"category": "mask"}]
        }))
        .is_err()
    );
}

#[test]
fn mag_locators_read_scalar_vector_paths_and_axis_order() {
    let parsed = MagLocator::from_json(&json!({
        "mag": 2, "path": "s3://b/x/../y", "axisOrder": {"x": 1, "y": 2, "c": 0},
        "channelIndex": 3, "credentials": null
    }))
    .unwrap();
    assert_eq!(parsed.mag, Vec3Int::new(2, 2, 2));
    assert_eq!(parsed.path.unwrap().to_string(), "s3://b/y");
    assert_eq!(parsed.axis_order, Some(AxisOrder::new(1, 2, None, Some(0))));
    assert_eq!(parsed.channel_index, Some(3));
    let vector = MagLocator::from_json(&json!({"mag": [4, 4, 1], "path": null})).unwrap();
    assert_eq!((vector.mag, vector.path), (Vec3Int::new(4, 4, 1), None));
    for invalid in [
        json!({"mag": [1, 1]}),
        json!({"mag": 1, "axisOrder": {"x": 1}}),
        json!({"mag": 1, "path": 3}),
        json!({"mag": 1.5}),
        json!([1, 1, 1]),
    ] {
        assert!(MagLocator::from_json(&invalid).is_err(), "{invalid}");
    }
}

#[test]
fn additional_axes_merge_like_scala_hash_map() {
    let axis = |name: &str, bounds: [i32; 2], index: i32| AdditionalAxis {
        name: name.to_owned(),
        bounds: bounds.to_vec(),
        index,
    };
    let a = [axis("t", [2, 5], 3)];
    let b = [axis("t", [0, 4], 9), axis("c", [0, 2], 1)];
    // "c".hashCode = 99 → bucket 3; "t" = 116 → bucket 4.
    assert_eq!(
        AdditionalAxis::merge([Some(&a[..]), Some(&b[..])]),
        Some(vec![axis("c", [0, 2], 1), axis("t", [0, 5], 3)])
    );
    assert_eq!(AdditionalAxis::merge([None, Some(&[][..])]), None);
    assert_eq!(java_string_hash("time"), 3_560_141);
}
