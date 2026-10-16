use super::*;

#[test]
fn upaths_normalize_like_scala() {
    for (input, expected) in [
        ("/a/./b/../c/", "/a/c"),
        ("color/1", "./color/1"),
        ("./color//1", "./color/1"),
        ("../x", "./../x"),
        ("", "./"),
        ("file:///srv/a/../b", "/srv/b"),
        ("s3://bucket/a/./b/../c", "s3://bucket/a/c"),
        ("https://host:9000/..", "https://host:9000"),
        ("s3://bucket//double/", "s3://bucket//double/"),
        ("/data/x.zip|zip:/inner/p", "/data/x.zip|zip:inner/p"),
        ("s3://b/x.zip|zip", "s3://b/x.zip|zip"),
    ] {
        assert_eq!(normalize_upath(input).unwrap(), expected, "{input}");
    }
    assert!(normalize_upath("file://relative").is_err());
    assert!(normalize_upath("a.zip|zip:x|zip").is_err());
    assert!(upath_is_local("./a") && upath_is_local("file:///a"));
    assert!(!upath_is_local("s3://b/a.zip|zip:x"));
    assert_eq!(
        upath_join("./binaryData", "org").unwrap(),
        "./binaryData/org"
    );
    assert_eq!(upath_join("/srv/a", "../b").unwrap(), "/srv/b");
    assert_eq!(
        upath_join("s3://bucket/x/", "y/1").unwrap(),
        "s3://bucket/x/y/1"
    );
    assert_eq!(upath_join("/a.zip|zip", "c").unwrap(), "/a.zip|zip:c");
}

#[test]
fn data_sources_parse_scala_variants_and_render() {
    let source = parse_data_source(&json!({
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
    let layer = &source.layers[0];
    assert_eq!(source.unit, "nanometer");
    assert_eq!(layer.mags[0].mag, [1, 1, 1]);
    assert_eq!(layer.largest_segment_id, Some(-1));
    assert_eq!(
        layer.mappings.as_deref(),
        Some(&["a".to_owned(), "b".to_owned()][..])
    );
    assert_eq!(layer.default_view_configuration, None);
    assert_eq!(
        layer.attachments.as_ref().unwrap().meshes[0].path,
        "./meshes/m.hdf5"
    );
    let rendered = data_source_json(&source);
    assert_eq!(
        rendered["dataLayers"][0]["largestSegmentId"]["value"],
        "18446744073709551615"
    );
    assert_eq!(
        rendered["dataLayers"][0]["resolutions"],
        json!([[1, 1, 1], [2, 2, 1]])
    );
    assert_eq!(parse_data_source(&rendered).unwrap(), source);
    assert!(parse_data_source(&json!({"id": {"name": "x", "team": "y"}, "scale": [1, 1, 1], "dataLayers": [{"category": "mask"}]})).is_err());
}
