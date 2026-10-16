use super::*;
use serde_json::json;

#[test]
fn element_class_helpers() {
    assert_eq!(ElementClass::Uint24.bytes_per_element(), 3);
    assert_eq!(ElementClass::Uint24.num_channels(), 3);
    assert_eq!(ElementClass::Double.bytes_per_element(), 8);
    assert_eq!(ElementClass::Int64.encode_as_byte(), 10);
    assert_eq!(
        ElementClass::Uint24.to_channel_and_zarr_string(),
        (3, "|u1")
    );
    let in_range = ElementClass::largest_segment_id_is_in_range;
    assert!(in_range(ElementClass::Uint8, Some(255)));
    assert!(!in_range(ElementClass::Uint8, Some(256)));
    assert!(in_range(ElementClass::Int8, Some(127)));
    assert!(!in_range(ElementClass::Int8, Some(128)));
    assert!(in_range(ElementClass::Uint32, Some(4294967295)));
    assert!(!in_range(ElementClass::Int32, Some(1 << 31)));
    assert!(in_range(ElementClass::Uint64, Some(u64::MAX)));
    assert!(!in_range(ElementClass::Int64, Some(u64::MAX)));
    assert!(in_range(ElementClass::Int64, Some(i64::MAX as u64)));
    assert!(!in_range(ElementClass::Uint32, Some(u64::MAX)));
    assert!(!in_range(ElementClass::Float, None));
    assert!(!in_range(ElementClass::Uint24, Some(1)));
    assert!(in_range(ElementClass::Uint16, None));
}

#[test]
fn enum_json() {
    assert_eq!(
        ElementClass::from_json(&json!("uint24")),
        Ok(ElementClass::Uint24)
    );
    assert_eq!(
        ElementClass::from_json(&json!("uint128")),
        Err(JsError::new("error.expected.validenumvalue"))
    );
    assert_eq!(
        ElementClass::from_json(&json!(3)),
        Err(JsError::new("error.expected.enumstring"))
    );
    assert_eq!(
        DataFormat::from_json(&json!("neuroglancerPrecomputed")),
        Ok(DataFormat::NeuroglancerPrecomputed)
    );
    assert_eq!(
        LengthUnit::from_json(&json!("µm")),
        Ok(LengthUnit::Micrometer)
    );
    assert_eq!(LengthUnit::from_json(&json!("Å")), Ok(LengthUnit::Angstrom));
    assert_eq!(
        serde_json::to_string(&LengthUnit::Micrometer).unwrap(),
        "\"micrometer\""
    );
    for (index, (unit, ..)) in LENGTH_UNITS.iter().enumerate() {
        assert_eq!(*unit as usize, index);
    }
    assert_eq!(
        serde_json::from_value::<CoordinateTransformationType>(json!("thin_plate_spline")).unwrap(),
        CoordinateTransformationType::ThinPlateSpline
    );
}
