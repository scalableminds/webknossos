use super::*;
#[test]
fn script_name_validation_matches_scala_boundaries_and_characters() {
    assert!(validate_name("a").is_err());
    assert!(validate_name("ab").is_ok());
    assert!(validate_name(&"ß".repeat(50)).is_ok());
    assert!(validate_name(&"a".repeat(51)).is_err());
    assert!(validate_name("a-b_c.d ß").is_ok());
    for name in ["éé", "a/b", "a\nb", "💡"] {
        assert!(validate_name(name).is_err());
    }
}
#[test]
fn gist_accepts_existing_http_contract_without_fetching() {
    for gist in [
        "http://gist.github.com/id",
        "HTTPS://example.org/x",
        "https://localhost",
    ] {
        assert!(
            validate(&ScriptParameters {
                name: "ab".into(),
                gist: gist.into(),
                owner: String::new()
            })
            .is_ok()
        );
    }
    for gist in ["", "file:///tmp/x", "javascript:alert(1)", "https://"] {
        assert!(
            validate(&ScriptParameters {
                name: "ab".into(),
                gist: gist.into(),
                owner: String::new()
            })
            .is_err()
        );
    }
}
