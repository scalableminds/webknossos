
use super::*;

#[test]
fn formats_amz_date() {
    let t = SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_440_938_160);
    assert_eq!(amz_date(t), "20150830T123600Z");
    assert_eq!(amz_date(SystemTime::UNIX_EPOCH), "19700101T000000Z");
}

#[test]
fn encodes_like_aws() {
    assert_eq!(uri_encode("a b/c~*", false), "a%20b/c~%2A");
    assert_eq!(uri_encode("a/b", true), "a%2Fb");
    assert_eq!(uri_encode("ሴ", true), "%E1%88%B4");
}

#[test]
fn env_credentials() {
    let env = |pairs: &'static [(&'static str, &'static str)]| {
        move |name: &str| {
            pairs
                .iter()
                .find(|(k, _)| *k == name)
                .map(|(_, v)| v.to_string())
        }
    };
    assert!(AwsCredentials::from_env_vars(env(&[])).is_none());
    let creds = AwsCredentials::from_env_vars(env(&[
        ("AWS_ACCESS_KEY", "id"),
        ("AWS_SECRET_KEY", "S3CR3T"),
        ("AWS_SESSION_TOKEN", "tok"),
    ]))
    .unwrap()
    .unwrap();
    assert_eq!(creds.access_key_id, "id");
    assert_eq!(creds.session_token.as_deref(), Some("tok"));
    assert!(!format!("{creds:?}").contains("S3CR3T"));
    assert!(
        AwsCredentials::from_env_vars(env(&[("AWS_ACCESS_KEY_ID", "id")]))
            .unwrap()
            .is_err()
    );
}
