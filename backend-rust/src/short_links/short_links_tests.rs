use super::*;
#[test]
fn short_links_are_confined_to_configured_origin_and_path() {
    let base = Url::parse("https://example.org/wk").unwrap();
    for valid in [
        "https://example.org/wk/",
        "https://example.org/wk/a?x=1#section",
    ] {
        assert!(validate_link(&base, valid).is_ok());
    }
    for invalid in [
        "https://example.org/wk",
        "https://example.org.attacker.test/wk",
        "https://example.org.attacker.test/wk/",
        "http://example.org/wk",
        "https://example.org/wk2",
        "https://example.org/wk/../other",
        "https://user@example.org/wk",
        "//example.org/wk",
    ] {
        assert!(validate_link(&base, invalid).is_err(), "{invalid}");
    }
}

#[test]
fn short_links_require_uri_prefix_with_slash_regardless_of_configured_trailing_slash() {
    for base in ["https://example.org", "https://example.org/"] {
        let base = Url::parse(base).unwrap();
        assert!(validate_link(&base, "https://example.org/").is_ok());
        assert!(validate_link(&base, "https://example.org/annotations/abc").is_ok());
        // Prefix spoofing: starts with the URI, but is a different host.
        assert!(validate_link(&base, "https://example.org.evil.com").is_err());
        assert!(validate_link(&base, "https://example.org.evil.com/x").is_err());
        assert!(validate_link(&base, "https://example.org@evil.com/x").is_err());
    }
    let base = Url::parse("https://example.org/wk/").unwrap();
    assert!(validate_link(&base, "https://example.org/wk/x").is_ok());
    assert!(validate_link(&base, "https://example.org/wk").is_err());
    assert!(validate_link(&base, "https://example.org/wkx").is_err());
}
