
use super::*;
use crate::datareaders::data_type::JavaNumber;
use serde_json::json;

#[test]
fn parses_typical_zarray_with_defaults() {
    let header = ZarrHeader::from_json(&json!({
        "zarr_format": 2, "shape": [1, 100, 200, 50], "chunks": [1, 32, 32, 32],
        "compressor": {"id": "blosc", "cname": "lz4", "clevel": 5, "shuffle": 1, "blocksize": 0},
        "dtype": "<u2", "fill_value": null, "filters": null, "order": "C"
    }))
    .unwrap();
    assert_eq!(header.resolved_data_type(), ArrayDataType::U2);
    assert_eq!(header.byte_order(), ByteOrder::LittleEndian);
    assert_eq!(header.dimension_separator(), DimensionSeparator::Dot);
    assert_eq!(header.fill_value_number(), JavaNumber::Long(0));
    assert_eq!(header.order(), ArrayOrder::C);
    assert_eq!(header.compressor().unwrap().id(), "blosc");
    assert_eq!(header.bytes_per_chunk(), 32 * 32 * 32 * 2);
    assert_eq!(header.voxel_offset(), &[0, 0, 0, 0]);
}

#[test]
fn dtype_byte_orders_and_fill_values() {
    let base = |dtype: &str, fill: Value| {
        ZarrHeader::from_json(&json!({
            "zarr_format": 2, "shape": [4], "chunks": [2], "dtype": dtype,
            "fill_value": fill, "order": "F", "dimension_separator": "/"
        }))
        .unwrap()
    };
    let h = base(">i2", json!("Infinity"));
    assert_eq!(h.byte_order(), ByteOrder::BigEndian);
    assert_eq!(h.fill_value_number(), JavaNumber::Long(65535));
    assert_eq!(h.dimension_separator(), DimensionSeparator::Slash);
    assert_eq!(
        base("f4", json!("NaN")).fill_value_number(),
        JavaNumber::Long(0)
    );
    assert_eq!(base("f4", json!("NaN")).byte_order(), ByteOrder::BigEndian);
    assert_eq!(base("|u1", json!(3)).byte_order(), ByteOrder::LittleEndian);
    assert_eq!(
        base("<f8", json!("-Infinity")).fill_value_number(),
        JavaNumber::Double(f64::MIN)
    );
    assert_eq!(
        base("<f8", json!(0.5)).fill_value_number(),
        JavaNumber::Float(0.5)
    );
    assert!(base("bool", json!("true")).fill_value_boolean());
    assert!(base("<c16", json!(0)).check_data_type().is_err());
}

#[test]
fn json_errors_and_lazy_compressor_errors() {
    let error = ZarrHeader::from_json(
        &json!({"zarr_format": 2, "shape": [4], "chunks": [2], "dtype": "u1"}),
    )
    .unwrap_err();
    assert_eq!(
        error.message,
        r#"Validating Json Failed: {"obj.order":[{"msg":["error.path.missing"],"args":[]}]}"#
    );
    let header = ZarrHeader::from_json(&json!({
        "zarr_format": 2, "shape": [4], "chunks": [2], "dtype": "u1", "order": "C",
        "compressor": {"id": "lzma"}
    }))
    .unwrap();
    assert_eq!(
        header.compressor().unwrap_err().message,
        "Compressor id:'lzma' not supported."
    );
}

#[test]
fn writes_like_scala() {
    let header = ZarrHeader::from_layer(
        ElementClass::Uint24,
        None,
        &BoundingBox::new(Vec3Int::new(10, 0, 0), 100, 64, 32),
        Vec3Int::new(2, 2, 1),
    );
    assert_eq!(
        serde_json::to_string(&header.to_json()).unwrap(),
        r#"{"dtype":"|u1","fill_value":0,"zarr_format":2,"order":"F","chunks":[3,32,32,32],"compressor":null,"filters":null,"shape":[3,55,32,32],"dimension_separator":"."}"#
    );
}
