use super::owner_reopen_window_open;
#[test]
fn owner_reopen_window_includes_the_extra_ten_seconds_and_closes_after() {
    assert!(owner_reopen_window_open(0, 0, 30));
    assert!(owner_reopen_window_open(39_999, 0, 30));
    assert!(owner_reopen_window_open(40_000, 0, 30));
    assert!(!owner_reopen_window_open(40_001, 0, 30));
    assert!(owner_reopen_window_open(70_000, 0, 60));
    assert!(!owner_reopen_window_open(70_001, 0, 60));
    assert!(owner_reopen_window_open(0, 0, -10));
    assert!(!owner_reopen_window_open(1, 0, -10));
}
