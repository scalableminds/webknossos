use super::*;
#[test]
fn folder_names_preserve_scala_contract() {
    for name in ["", "a", "A ß 💡", "a\\b"] {
        assert!(validate_name(name).is_ok());
    }
    assert!(validate_name("a/b").is_err());
}
#[test]
fn metadata_duplicate_keys_and_invalid_shapes_are_rejected() {
    assert!(
        validate_metadata(&[json!({"key":"a","value":1}), json!({"key":"b","value":2})]).is_ok()
    );
    assert!(validate_metadata(&[json!({"key":"a"}), json!({"key":"a"})]).is_err());
    assert!(validate_metadata(&[json!(3)]).is_err());
    assert!(validate_metadata(&[json!({"key":3})]).is_err());
}
