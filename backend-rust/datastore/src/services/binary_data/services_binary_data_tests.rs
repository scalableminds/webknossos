use super::*;
use crate::models::{BoundingBox, Vec3Int};

#[test]
fn copy_rows_copies_the_box_rows() {
    // 4×2×1 volume of 1-byte voxels; copy the 2×1×1 box at x=1, y=1.
    let input: Vec<u8> = (0..8).collect();
    let mut out = vec![0; 8];
    let bbox = BoundingBox::new(Vec3Int::new(1, 1, 0), 2, 1, 1);
    copy_rows(&input, &mut out, &bbox, 4, 2, 1).unwrap();
    assert_eq!(out, [0, 0, 0, 0, 0, 5, 6, 0]);
}

#[test]
fn copy_rows_rejects_offsets_before_the_buffer() {
    let input = vec![0u8; 8];
    let mut out = vec![0; 8];
    let bbox = BoundingBox::new(Vec3Int::new(-3, 0, 0), 2, 1, 1);
    assert!(copy_rows(&input, &mut out, &bbox, 4, 2, 1).is_err());
}
