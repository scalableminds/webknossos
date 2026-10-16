use super::owner_wait_elapsed;
#[test]
fn owner_wait_is_strict_minimum_with_the_extra_ten_seconds() {
    assert!(!owner_wait_elapsed(39_999, 0, 30));
    assert!(!owner_wait_elapsed(40_000, 0, 30));
    assert!(owner_wait_elapsed(40_001, 0, 30));
    assert!(!owner_wait_elapsed(70_000, 0, 60));
    assert!(owner_wait_elapsed(70_001, 0, 60));
    assert!(!owner_wait_elapsed(0, 0, -10));
    assert!(owner_wait_elapsed(1, 0, -10));
}
