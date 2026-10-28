use super::*;

#[test]
fn configuration_defaults_follow_application_conf() {
    let config = config_from_values(&HashMap::new()).unwrap();
    assert!(!config.enabled);
    assert_eq!(
        config.provider_url,
        "http://localhost:8080/auth/realms/master/"
    );
    assert_eq!(config.client_id, "myclient");
    assert_eq!(config.client_secret.as_deref(), Some("myClientSecret"));
    assert_eq!(config.scope, "openid profile email");
    assert!(config.sso_key.is_empty());
    let values = HashMap::from([
        ("WK_OIDC_ENABLED".to_owned(), "true".to_owned()),
        ("WK_OIDC_CLIENT_SECRET".to_owned(), String::new()),
        ("WK_SSO_KEY".to_owned(), "k".to_owned()),
    ]);
    let config = config_from_values(&values).unwrap();
    assert!(config.enabled && config.client_secret.is_none());
    assert!(!format!("{config:?}").contains("\"k\""));
    let invalid = HashMap::from([("WK_OIDC_ENABLED".to_owned(), "yes".to_owned())]);
    assert!(config_from_values(&invalid).is_err());
}

#[test]
fn url_encoding_matches_java_url_encoder() {
    assert_eq!(
        java_url_encode("openid profile email"),
        "openid+profile+email"
    );
    assert_eq!(
        java_url_encode("http://a/b?c=d&e*f-g.h_i~"),
        "http%3A%2F%2Fa%2Fb%3Fc%3Dd%26e*f-g.h_i%7E"
    );
}

#[test]
fn lenient_base64_matches_commons_codec() {
    assert_eq!(decode_base64_lenient("bm9uY2U9YQ=="), b"nonce=a");
    assert_eq!(decode_base64_lenient("bm9uY2U9YQ"), b"nonce=a");
    assert_eq!(decode_base64_lenient("bm9u\nY2U9YQ=="), b"nonce=a");
}

#[test]
fn audience_accepts_string_or_array() {
    let claims = |aud: Value| json!({ "aud": aud }).as_object().unwrap().clone();
    assert!(audience_contains(&claims(json!("c")), "c"));
    assert!(audience_contains(&claims(json!(["x", "c"])), "c"));
    assert!(!audience_contains(&claims(json!("x")), "c"));
    assert!(!audience_contains(&Map::new(), "c"));
}
