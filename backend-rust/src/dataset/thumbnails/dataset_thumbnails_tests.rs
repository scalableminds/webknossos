use super::*;

#[test]
fn java_double_formatting_matches_double_to_string() {
    for (value, expected) in [
        (0.0, "0.0"),
        (-0.0, "-0.0"),
        (1.0, "1.0"),
        (255.0, "255.0"),
        (0.5, "0.5"),
        (0.001, "0.001"),
        (0.0001, "1.0E-4"),
        (1234567.0, "1234567.0"),
        (1e7, "1.0E7"),
        (12345678.9, "1.23456789E7"),
        (-3.25, "-3.25"),
        (100.125, "100.125"),
    ] {
        assert_eq!(java_double_string(value), expected, "{value}");
    }
}

#[test]
fn rounding_follows_java_math_round() {
    assert_eq!(java_round_to_int(2.5), 3);
    assert_eq!(java_round_to_int(-2.5), -2);
    assert_eq!(java_round_to_int(f64::NAN), 0);
}

#[test]
fn layers_exceeding_the_datastore_dimension_limit_are_skipped() {
    let layer = |name: &str, width: i32, height: i32| LayerParameters {
        data_layer_name: name.into(),
        x: 0,
        y: 0,
        z: 0,
        mag: "1-1-1".into(),
        width,
        height,
        mapping_name: None,
        intensity_min: None,
        intensity_max: None,
        color: None,
        invert_color: None,
        opacity: 1.0,
    };
    let mut parameters = vec![
        layer("fine", 3001, 400),
        layer("coarse", 3000, 3000),
        layer("tall", 400, 3001),
    ];
    retain_renderable(&mut parameters);
    let names: Vec<_> = parameters
        .iter()
        .map(|p| p.data_layer_name.as_str())
        .collect();
    assert_eq!(names, ["coarse"]);
    parameters.clear();
    retain_renderable(&mut parameters);
    assert!(parameters.is_empty());
}
