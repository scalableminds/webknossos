use super::*;
#[test]
fn short_links_are_confined_to_configured_origin_and_path() {
    let base = Url::parse("https://example.org/wk").unwrap();
    for valid in [
        "https://example.org/wk",
        "https://example.org/wk/a?x=1#section",
    ] {
        assert!(validate_link(&base, valid).is_ok());
    }
    for invalid in [
        "https://example.org.attacker.test/wk",
        "http://example.org/wk",
        "https://example.org/wk2",
        "https://example.org/wk/../other",
        "https://user@example.org/wk",
        "//example.org/wk",
    ] {
        assert!(validate_link(&base, invalid).is_err(), "{invalid}");
    }
}
