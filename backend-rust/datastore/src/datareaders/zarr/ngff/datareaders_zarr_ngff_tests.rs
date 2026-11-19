use super::*;
use serde_json::json;

#[test]
fn parses_and_writes_v0_4() {
    let json = json!({
        "multiscales": [{
            "version": "0.4", "name": "img",
            "axes": [{"name": "c", "type": "channel"}, {"name": "z", "type": "space", "unit": "micrometer"},
                     {"name": "y", "type": "space", "unit": "µm"}, {"name": "x", "type": "space"}],
            "datasets": [{"path": "0", "coordinateTransformations": [{"type": "scale", "scale": [1.0, 0.5, 0.5, 0.5]}]}]
        }],
        "omero": {"channels": [{"color": "FF0000", "window": {"min": 0, "max": 255, "start": 0, "end": 100}}]}
    });
    let metadata: NgffMetadata = serde_json::from_value(json).unwrap();
    let axes = &metadata.multiscales[0].axes;
    assert!(axes[0].length_unit().is_err());
    assert_eq!(axes[1].length_unit().unwrap(), Some(LengthUnit::Micrometer));
    assert_eq!(axes[3].length_unit().unwrap(), Some(LengthUnit::Nanometer));
    // fields with Scala defaults are required (plain Json.format)
    assert!(serde_json::from_value::<NgffMultiscalesItem>(json!({"datasets": []})).is_err());
    let v05: NgffMetadataV0_5 = serde_json::from_value(json!({
        "version": "0.5",
        "multiscales": [{"axes": [], "datasets": []}]
    }))
    .unwrap();
    assert_eq!(v05.multiscales[0].as_v0_4().version, "0.5");
}

#[test]
fn generated_metadata_matches_scala_shape() {
    let voxel_size = VoxelSize::from_factor_with_default_unit(Vec3Double::new(11.0, 11.0, 24.0));
    let metadata = NgffMetadata::from_name_voxel_size_and_mags(
        "color",
        &voxel_size,
        &[Vec3Int::new(1, 1, 1), Vec3Int::new(2, 2, 1)],
        None,
    );
    assert_eq!(
        serde_json::to_value(&metadata).unwrap(),
        json!({"multiscales": [{"version": "0.4", "name": "color", "axes": [
                {"name": "c", "type": "channel"},
                {"name": "x", "type": "space", "unit": "nanometer"},
                {"name": "y", "type": "space", "unit": "nanometer"},
                {"name": "z", "type": "space", "unit": "nanometer"}],
              "datasets": [
                {"path": "1", "coordinateTransformations": [{"type": "scale", "scale": [1.0, 11.0, 11.0, 24.0]}]},
                {"path": "2-2-1", "coordinateTransformations": [{"type": "scale", "scale": [1.0, 22.0, 22.0, 24.0]}]}]}]})
    );
    let axes = [AdditionalAxis {
        name: "time".into(),
        bounds: vec![0, 3],
        index: 0,
    }];
    let v05 = NgffMetadataV0_5::from_name_voxel_size_and_mags(
        "seg",
        &voxel_size,
        &[],
        Some(&axes),
        "0.5",
    );
    let names: Vec<&str> = v05.multiscales[0]
        .axes
        .iter()
        .map(|a| a.name.as_str())
        .collect();
    // Additional axes keep their names and get the custom type (no longer `t0` space axes).
    assert_eq!(names, ["c", "time", "x", "y", "z"]);
    assert_eq!(
        serde_json::to_value(&v05.multiscales[0].axes[1]).unwrap(),
        json!({"name": "time", "type": "custom"})
    );
}
