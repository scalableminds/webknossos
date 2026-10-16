
use super::*;

#[test]
fn upath_to_remote_uri() {
    let upath = UPath::parse("s3://bucket/data.zip|zip:a/b").unwrap();
    assert_eq!(
        upath.to_remote_uri().unwrap().as_str(),
        "s3://bucket/data.zip"
    );
    assert_eq!(
        UPath::parse("/a")
            .unwrap()
            .to_remote_uri()
            .unwrap_err()
            .message,
        "Called toRemoteUri on LocalUPath /a"
    );
    assert!(
        UPath::parse("https://host/a b")
            .unwrap()
            .to_remote_uri()
            .is_err()
    );
}

#[test]
fn parses_like_java_uri() {
    let uri = RemoteUri::parse("https://user@example.com:8443/a%20b/c?x=1#f").unwrap();
    assert_eq!(uri.scheme(), "https");
    assert_eq!(uri.authority(), Some("user@example.com:8443"));
    assert_eq!(uri.host(), Some("example.com"));
    assert_eq!(uri.port(), Some(8443));
    assert_eq!(uri.raw_path(), "/a%20b/c");
    assert_eq!(uri.path(), "/a b/c");
    assert_eq!(uri.query(), Some("x=1"));

    let bucket = RemoteUri::parse("gs://my_bucket/obj").unwrap();
    assert_eq!(bucket.authority(), Some("my_bucket"));
    assert_eq!(bucket.host(), None);
    assert_eq!(RemoteUri::parse("s3://bucket").unwrap().path(), "");
    assert_eq!(RemoteUri::parse("s3://bucket/").unwrap().path(), "/");
    assert_eq!(
        RemoteUri::parse("s3://localhost:9000/b/k").unwrap().port(),
        Some(9000)
    );
    assert_eq!(
        RemoteUri::parse("s3://10.0.0.1/b").unwrap().host(),
        Some("10.0.0.1")
    );
    assert_eq!(RemoteUri::parse("s3://123/b").unwrap().host(), None);
}

#[test]
fn rejects_what_java_rejects() {
    assert_eq!(
        RemoteUri::parse("https://host/a b").unwrap_err(),
        "Illegal character in path at index 14: https://host/a b"
    );
    assert_eq!(
        RemoteUri::parse("https://host/a%zz").unwrap_err(),
        "Malformed escape pair at index 14: https://host/a%zz"
    );
    assert!(RemoteUri::parse("://host").is_err());
    assert!(RemoteUri::parse("ht tp://host").is_err());
    assert!(RemoteUri::parse("https://host/{x}").is_err());
}
