use super::extract_token;
use axum::http::Request;

#[test]
fn supports_each_transport_and_percent_decodes_legacy_tokens() {
    for request in [
        Request::builder().header("x-auth-token", "abc").body(()),
        Request::builder()
            .header("Authorization", "Bearer abc")
            .body(()),
        Request::builder().uri("/api?token=a%2Bb").body(()),
    ] {
        let (parts, _) = request.unwrap().into_parts();
        assert!(matches!(
            extract_token(&parts).as_deref(),
            Ok("abc" | "a+b")
        ));
    }
}

#[test]
fn rejects_missing_malformed_or_ambiguous_credentials() {
    for request in [
        Request::builder().body(()),
        Request::builder().header("x-auth-token", "").body(()),
        Request::builder()
            .header("Authorization", "Basic abc")
            .body(()),
        Request::builder()
            .header("Authorization", "Bearer ")
            .body(()),
        Request::builder().header("x-auth-token", "a b").body(()),
        Request::builder()
            .header("x-auth-token", "abc")
            .uri("/api?token=other")
            .body(()),
        Request::builder()
            .uri("/api?token=abc&token=other")
            .body(()),
    ] {
        let (parts, _) = request.unwrap().into_parts();
        assert!(extract_token(&parts).is_err());
    }
}
