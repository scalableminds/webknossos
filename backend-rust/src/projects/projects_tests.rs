use super::*;
#[test]
fn project_name_contract() {
    for name in ["", "ab", "a b", "äbc", "abc.def", "abc/def"] {
        assert!(validate_name(name).is_err(), "{name}");
    }
    for name in ["abc", "Project-1", "project_2"] {
        assert!(validate_name(name).is_ok(), "{name}");
    }
}
