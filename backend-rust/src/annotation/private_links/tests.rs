use super::*;
#[test]
fn expiry_accepts_scala_instant_formats_and_rejects_invalid_values() {
    for value in [
        json!(1577836800000_i64),
        json!("1577836800000"),
        json!("2020-01-01T00:00:00.000Z"),
    ] {
        let p: Parameters = serde_json::from_value(
            json!({"annotation":"000000000000000000000001","expirationDateTime":value}),
        )
        .unwrap();
        assert_eq!(p.expiration.unwrap().timestamp_millis(), 1577836800000);
    }
    for value in [json!(true), json!("tomorrow"), json!([]), json!(1.5)] {
        assert!(
            serde_json::from_value::<Parameters>(
                json!({"annotation":"000000000000000000000001","expirationDateTime":value})
            )
            .is_err()
        );
    }
}
#[test]
fn tokens_are_unique_and_match_url_safe_twelve_byte_encoding() {
    let tokens: std::collections::HashSet<_> = (0..1000).map(|_| token().unwrap()).collect();
    assert_eq!(tokens.len(), 1000);
    assert!(tokens.iter().all(|token| {
        token.len() == 16
            && token
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    }));
}
