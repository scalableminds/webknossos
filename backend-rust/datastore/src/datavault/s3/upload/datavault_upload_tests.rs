use super::*;
#[test]
fn multipart_limits_bound_part_count_and_accept_large_parts_without_allocation() {
    assert_eq!(part_size(0).unwrap(), PART_BYTES);
    assert_eq!(part_size(PART_BYTES * MAX_PARTS).unwrap(), PART_BYTES);
    assert_eq!(
        part_size(MAX_PART_BYTES * MAX_PARTS).unwrap(),
        MAX_PART_BYTES
    );
    assert!(part_size(MAX_PART_BYTES * MAX_PARTS + 1).is_err());
}
