use super::*;

#[test]
fn escape_html_matches_twirl() {
    assert_eq!(
        escape_html(r#"<a href="x">Tom & 'Jerry'</a>"#),
        "&lt;a href=&quot;x&quot;&gt;Tom &amp; &#x27;Jerry&#x27;&lt;/a&gt;"
    );
}

#[test]
fn hex_is_lowercase_and_padded() {
    assert_eq!(hex(&[0, 1, 0xab, 0xff]), "0001abff");
}
