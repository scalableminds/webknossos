use super::*;

#[test]
fn sam_payload_layout_matches_scala_buffer() {
    let parameters = MaskParameters {
        mag: [1, 1, 1],
        surrounding_bounding_box: Value::Null,
        additional_coordinates: None,
        interaction_type: Interaction::Point,
        selection_top_left_x: None,
        selection_top_left_y: None,
        selection_bottom_right_x: None,
        selection_bottom_right_y: None,
        point_x: Some(3),
        point_y: Some(-1),
    };
    let payload = mask_request(
        &[9, 9],
        "float",
        &parameters,
        [4, 5, 6],
        (Some(1.5), Some(2.0)),
    );
    let mut expected = vec![5, 1];
    expected.extend(1.5_f32.to_le_bytes());
    expected.extend(2.0_f32.to_le_bytes());
    expected.push(1);
    expected.extend(3_i32.to_le_bytes());
    expected.extend((-1_i32).to_le_bytes());
    for v in [4_i32, 5, 6] {
        expected.extend(v.to_le_bytes());
    }
    expected.extend([9, 9]);
    assert_eq!(payload, expected);
}
