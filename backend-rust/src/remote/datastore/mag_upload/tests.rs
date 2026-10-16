use super::*;

#[test]
fn mag_locator_reads_scalar_vector_paths_and_axis_order() {
    let parsed = parse_mag_locator(&json!({"mag": 2, "path": "s3://b/x/../y", "axisOrder": {"x": 1, "y": 2, "c": 0}, "channelIndex": 3, "credentials": null})).unwrap();
    assert_eq!(parsed.mag, [2, 2, 2]);
    assert_eq!(parsed.path.as_deref(), Some("s3://b/y"));
    assert_eq!(parsed.axis_order, Some(json!({"x": 1, "y": 2, "c": 0})));
    assert_eq!(parsed.channel_index, Some(3));
    let vector = parse_mag_locator(&json!({"mag": [4, 4, 1], "path": null})).unwrap();
    assert_eq!((vector.mag, vector.path), ([4, 4, 1], None));
    for invalid in [
        json!({"mag": [1, 1]}),
        json!({"mag": 1, "axisOrder": {"x": 1}}),
        json!({"mag": 1, "path": 3}),
        json!({"mag": 1.5}),
        json!([1, 1, 1]),
    ] {
        assert!(parse_mag_locator(&invalid).is_err(), "{invalid}");
    }
    assert_eq!(vec3_display([4, 4, 1]), "(4, 4, 1)");
    assert_eq!(max_dim([4, 8, 1]), 8);
}
