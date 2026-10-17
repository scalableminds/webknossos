use super::*;

#[test]
fn ceil_div_matches_scala() {
    assert_eq!(ceil_div(7, 2), 4);
    assert_eq!(ceil_div(-7, 2), -4);
    assert_eq!(ceil_div(-3, 2), -2);
    assert_eq!(ceil_div(0, 4), 0);
    assert_eq!(ceil_div(i32::MAX, 2), i32::MIN / 2);
    assert_eq!(ceil_div(i32::MIN, 3), 715_827_882);
}
