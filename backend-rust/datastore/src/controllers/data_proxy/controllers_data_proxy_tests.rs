use super::*;

#[test]
fn raw_tail_keeps_encoding_and_nested_segments() {
    let uri: Uri = "/data/datasets/a/proxy/layers/l/mags/1-1-1/x%2Fy/0.0.0?token=t"
        .parse()
        .unwrap();
    assert_eq!(raw_tail(&uri, 8), "x%2Fy/0.0.0");
}

fn validation_error(path: &str) -> Option<String> {
    validate_path(path).err().map(|error| error.to_string())
}

#[test]
fn validates_decoded_paths_like_scala() {
    assert!(validate_path("0/0/0").is_ok());
    assert!(validate_path("c/0.0.0").is_ok());
    // Other escapes may be part of real object keys; `+` stays literal.
    assert!(validate_path("a%20b/c+d").is_ok());
    assert!(validate_path("%C3%A4/0").is_ok());
    let dots = Some("path must not contain “..”".to_owned());
    assert_eq!(validation_error("a/../b"), dots);
    assert_eq!(validation_error("%2e%2e/b"), dots);
    // Escapes are case-insensitive.
    assert_eq!(validation_error("%2E%2E/b"), dots);
    assert_eq!(validation_error(".%2e/b"), dots);
    let leading_slash = Some("path must not start with “/”".to_owned());
    assert_eq!(validation_error("/etc"), leading_slash);
    assert_eq!(validation_error("%2fetc"), leading_slash);
    assert_eq!(validation_error("%2Fetc"), leading_slash);
    let backslash = Some("path must not contain “\\”".to_owned());
    assert_eq!(validation_error("a\\b"), backslash);
    assert_eq!(validation_error("a%5Cb"), backslash);
}

#[test]
fn rejects_double_encoded_traversal_and_invalid_escapes() {
    let encoded = Some("path must not contain encoded “.”, “/” or “\\”".to_owned());
    assert_eq!(validation_error("%252e%252e/b"), encoded);
    assert_eq!(validation_error("a%252Fb"), encoded);
    assert_eq!(validation_error("a%255cb"), encoded);
    let invalid = Some("path is not validly encoded".to_owned());
    assert_eq!(validation_error("a%zzb"), invalid);
    assert_eq!(validation_error("a%2"), invalid);
    assert_eq!(validation_error("a%"), invalid);
}
