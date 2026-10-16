
use super::*;

#[test]
fn signed_and_unsigned_bins_match_scala() {
    let h = calculate_histogram_values(&[0, 1, 255, 128], ElementClass::Uint8).unwrap();
    assert_eq!(h[0].element_counts[1], 1);
    assert_eq!(h[0].element_counts[255], 1);
    assert_eq!(h[0].element_counts[128], 1);
    assert_eq!(h[0].element_counts[0], 0);
    assert_eq!((h[0].min, h[0].max), (0.0, 255.0));

    let h = calculate_histogram_values(&[0xff, 0x7f], ElementClass::Int8).unwrap();
    assert_eq!(h[0].element_counts[127], 1); // -1
    assert_eq!(h[0].element_counts[255], 1); // 127
    assert_eq!((h[0].min, h[0].max), (-128.0, 127.0));

    let data: Vec<u8> = [-1i16, 0x0100, i16::MIN]
        .iter()
        .flat_map(|v| v.to_le_bytes())
        .collect();
    let h = calculate_histogram_values(&data, ElementClass::Uint16).unwrap();
    assert_eq!(h[0].element_counts[255], 1);
    assert_eq!(h[0].element_counts[1], 1);
    assert_eq!(h[0].element_counts[128], 1);
    let h = calculate_histogram_values(&data, ElementClass::Int16).unwrap();
    assert_eq!(h[0].element_counts[127], 1);
    assert_eq!(h[0].element_counts[129], 1);
    assert_eq!(h[0].element_counts[0], 1);
}

#[test]
fn uint24_keeps_zeros_but_clears_bin_zero() {
    let h = calculate_histogram_values(&[0, 5, 255, 0, 5, 1], ElementClass::Uint24).unwrap();
    assert_eq!(h.len(), 3);
    assert_eq!(h[0].element_counts[0], 0);
    assert_eq!(h[1].element_counts[5], 2);
    assert_eq!(h[2].element_counts[255], 1);
    assert_eq!(h[2].element_counts[1], 1);
    assert_eq!((h[0].min, h[0].max), (0.0, 255.0));
}

#[test]
fn float_bins_span_observed_range() {
    let data: Vec<u8> = [0.0f32, f32::NAN, 1.0, 2.0, 3.0]
        .iter()
        .flat_map(|v| v.to_le_bytes())
        .collect();
    let h = calculate_histogram_values(&data, ElementClass::Float).unwrap();
    assert_eq!(h[0].element_counts[0], 1);
    // Java float oracle: (3-1)/((3-1)/255) == 254.99998f, so the maximum lands in bin 254.
    assert_eq!(h[0].element_counts[127], 1);
    assert_eq!(h[0].element_counts[254], 1);
    assert_eq!((h[0].min, h[0].max), (1.0, 3.0));
    // All-zero float data keeps the signed 32-bit default extrema.
    let h = calculate_histogram_values(&[0; 8], ElementClass::Float).unwrap();
    assert_eq!((h[0].min, h[0].max), (-2147483648.0, 2147483647.0));
    assert_eq!(
        serde_json::to_value(&h[0]).unwrap()["min"],
        serde_json::json!(-2147483648i64)
    );
}

#[test]
fn finds_first_non_zero_voxel_x_fastest() {
    let mut data = vec![0u8; 32 * 32 * 32 * 2];
    data[(3 + 2 * 32 + 32 * 32) * 2 + 1] = 7;
    assert_eq!(
        position_of_non_zero_data(&data, Vec3Int::new(64, 0, 32), 2),
        Some(Vec3Int::new(67, 2, 33))
    );
    assert_eq!(
        position_of_non_zero_data(&[0; 8], Vec3Int::new(0, 0, 0), 1),
        None
    );
}
