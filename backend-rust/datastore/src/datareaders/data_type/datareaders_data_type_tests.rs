use super::*;

#[test]
fn names_roundtrip_and_sizes() {
    for &t in ArrayDataType::ALL {
        assert_eq!(ArrayDataType::from_name(t.as_str()), Some(t));
    }
    assert_eq!(ArrayDataType::from_name("uint8"), None);
    assert_eq!(ArrayDataType::U2.bytes_per_element(), 2);
    assert_eq!(ArrayDataType::Bool.bytes_per_element(), 1);
    assert_eq!(ArrayDataType::from_wkw_type_id(3), Some(ArrayDataType::U4));
    assert_eq!(ArrayDataType::Bool.to_wkw_id(), None);
    assert_eq!(
        ArrayDataType::from_element_class(ElementClass::Uint24),
        (ArrayDataType::U1, 3)
    );
}

#[test]
fn java_number_narrowing() {
    assert_eq!(JavaNumber::Long(255).byte_value(), -1);
    assert_eq!(JavaNumber::Long(65535).short_value(), -1);
    assert_eq!(JavaNumber::Long((1 << 32) - 1).int_value(), -1);
    assert_eq!(JavaNumber::Float(f32::MAX).long_value(), i64::MAX);
    assert_eq!(JavaNumber::Float(f32::NAN).int_value(), 0);
    assert_eq!(JavaNumber::Double(300.7).byte_value(), 44);
    assert_eq!(JavaNumber::Double(-1e20).short_value(), 0); // int saturates to MIN, low 16 bits 0
    assert_eq!(JavaNumber::Float(0.1).double_value(), f64::from(0.1f32));
}

#[test]
fn number_json_reads() {
    use serde_json::json;
    assert_eq!(JavaNumber::from_json(&json!(5)), Some(JavaNumber::Long(5)));
    assert_eq!(
        JavaNumber::from_json(&json!(5.0)),
        Some(JavaNumber::Long(5))
    );
    assert_eq!(
        JavaNumber::from_json(&json!(0.1)),
        Some(JavaNumber::Float(0.1))
    );
    assert_eq!(
        JavaNumber::from_json(&json!(18446744073709551615u64)),
        Some(JavaNumber::Float(1.8446744e19))
    );
    assert_eq!(JavaNumber::from_json(&json!("x")), None);
    assert_eq!(
        FillValue::from_json(&json!("NaN")),
        Some(FillValue::String("NaN".into()))
    );
    assert_eq!(FillValue::from_json(&json!(null)), None);
}
