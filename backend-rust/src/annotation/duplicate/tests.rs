use super::*;

#[test]
fn bounding_box_union_matches_scala() {
    assert_eq!(
        bbox_union(&[0, 0, 0, 10, 10, 10], &[5, -5, 2, 10, 10, 1]),
        [0, -5, 0, 15, 15, 10]
    );
}
