use super::*;

#[test]
fn creation_matches_supported_schemes_and_optional_input_semantics() {
    let http = Url::parse("https://example.test/data").unwrap();
    assert!(
        matches!(CredentialInput::for_uri(&http, Some("alice"), None), Some(CredentialInput::HttpBasicAuth { password, .. }) if password.is_empty())
    );
    assert!(
        matches!(CredentialInput::for_uri(&http, Some(""), Some("secret")), Some(CredentialInput::HttpToken { token_value, .. }) if token_value == "secret")
    );
    assert!(CredentialInput::for_uri(&http, None, None).is_none());
    let s3 = Url::parse("s3://bucket/data").unwrap();
    assert!(CredentialInput::for_uri(&s3, Some("key"), None).is_none());
    assert!(CredentialInput::for_uri(&s3, None, Some("secret")).is_none());
    assert!(matches!(
        CredentialInput::for_uri(&s3, Some(""), Some("")),
        Some(CredentialInput::S3AccessKey { .. })
    ));
    let gs = Url::parse("gs://bucket/data").unwrap();
    assert!(CredentialInput::for_uri(&gs, None, Some("malformed json")).is_none());
    assert!(
        matches!(CredentialInput::for_uri(&gs, None, Some("null")), Some(CredentialInput::GoogleServiceAccount { secret_json, .. }) if secret_json.is_null())
    );
    assert!(
        CredentialInput::for_uri(
            &Url::parse("file:///data").unwrap(),
            Some("user"),
            Some("secret")
        )
        .is_none()
    );
}

#[test]
fn debug_never_contains_credential_values() {
    let credential = CredentialInput::HttpBasicAuth {
        name: "https://secret-url.test".into(),
        username: "secret-user".into(),
        password: "secret-password".into(),
    };
    let debug = format!("{credential:?}");
    for secret in ["secret-url", "secret-user", "secret-password"] {
        assert!(!debug.contains(secret));
    }
}
