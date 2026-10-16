use super::*;

#[test]
fn multiset_difference_matches_scala_diff() {
    let left = ["a", "b", "a", "c"].map(String::from);
    let right = ["a", "c"].map(String::from);
    assert_eq!(multiset_difference(&left, &right), ["b", "a"]);
}
