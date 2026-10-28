//! Scala `CuboidTestSuite`.
use super::*;

fn cuboid(x: i32, mag: Vec3Int, width: i32, height: i32, depth: i32) -> Cuboid {
    Cuboid {
        top_left: VoxelPosition::new(Vec3Int::new(x, 0, 0), mag).unwrap(),
        width,
        height,
        depth,
    }
}

fn at_origin(width: i32, height: i32, depth: i32) -> Cuboid {
    cuboid(0, Vec3Int::ones(), width, height, depth)
}

#[test]
fn accepts_regular_dimensions() {
    assert!(at_origin(512, 512, 512).has_valid_dimensions());
    assert_eq!(at_origin(512, 512, 512).volume().unwrap(), 512 * 512 * 512);
}

#[test]
fn rejects_volumes_that_overflow_int() {
    assert!(!at_origin(2048, 2048, 1024).has_valid_dimensions());
    assert!(!at_origin(65536, 65536, 1).has_valid_dimensions());
    assert!(!at_origin(i32::MAX, i32::MAX, i32::MAX).has_valid_dimensions());
}

#[test]
fn rejects_non_positive_dimensions() {
    assert!(!at_origin(0, 32, 32).has_valid_dimensions());
    assert!(!at_origin(32, -1, 32).has_valid_dimensions());
    assert!(!at_origin(i32::MIN, i32::MIN, 1).has_valid_dimensions());
}

#[test]
fn rejects_elongated_cuboids_exceeding_the_per_axis_limit() {
    assert!(at_origin(Cuboid::MAX_AXIS_LENGTH, 1, 1).has_valid_dimensions());
    assert!(!at_origin(Cuboid::MAX_AXIS_LENGTH + 1, 1, 1).has_valid_dimensions());
    assert!(!at_origin(512 * 512 * 512, 1, 1).has_valid_dimensions());
}

#[test]
fn rejects_bottom_right_corners_that_overflow_int() {
    assert!(!cuboid(i32::MAX - 10, Vec3Int::ones(), 32, 32, 32).has_valid_dimensions());
    assert!(!cuboid(0, Vec3Int::new(1 << 20, 1, 1), 4096, 1, 1).has_valid_dimensions());
    assert!(!cuboid(i32::MIN, Vec3Int::new(1 << 21, 1, 1), 2047, 1, 1).has_valid_dimensions());
}

#[test]
fn invalid_dimensions_fail_with_the_scala_message() {
    for invalid in [
        at_origin(0, 1, 1),
        at_origin(30001, 1, 1),
        cuboid(i32::MAX - 10, Vec3Int::ones(), 32, 32, 32),
    ] {
        assert_eq!(
            invalid.volume().unwrap_err().message,
            "Invalid cuboid dimensions (each must be > 0 and <= 30000, volume must be <= 512³)."
        );
        assert!(invalid.buckets().is_err());
    }
}
