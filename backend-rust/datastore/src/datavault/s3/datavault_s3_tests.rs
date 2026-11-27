use super::*;

fn uri(s: &str) -> RemoteUri {
    RemoteUri::parse(s).unwrap()
}

#[test]
fn uri_styles_like_scala() {
    let short = uri("s3://my-bucket/a/b/");
    assert_eq!(host_bucket_from_uri(&short).as_deref(), Some("my-bucket"));
    assert_eq!(object_key_from_uri(&short).unwrap(), "a/b/");
    assert!(is_short_style(&short));
    assert!(!is_non_amazon_host(&short));

    let virtual_hosted = uri("s3://bucket.with.dots.s3.us-west-2.amazonaws.com/k/x");
    assert_eq!(
        host_bucket_from_uri(&virtual_hosted).as_deref(),
        Some("bucket.with.dots")
    );
    assert_eq!(object_key_from_uri(&virtual_hosted).unwrap(), "k/x");
    assert_eq!(
        host_bucket_from_uri(&uri("s3://b.s3-us-west-2.amazonaws.com/k")).as_deref(),
        Some("b")
    );
    assert_eq!(
        host_bucket_from_uri(&uri("s3://b.s3.amazonaws.com/k")).as_deref(),
        Some("b")
    );

    let amazon_path = uri("s3://s3.eu-central-1.amazonaws.com/bucket/key/x");
    assert_eq!(
        host_bucket_from_uri(&amazon_path).as_deref(),
        Some("bucket")
    );
    assert_eq!(object_key_from_uri(&amazon_path).unwrap(), "key/x");
    assert!(!is_non_amazon_host(&amazon_path));

    let minio = uri("s3://localhost:9000/bucket/a%20b");
    assert!(is_non_amazon_host(&minio));
    assert_eq!(object_key_from_uri(&minio).unwrap(), "a b");
    assert_eq!(
        uri_literal_for_object_key(&minio, "bucket", "x/"),
        "s3://localhost:9000/bucket/x/"
    );
    assert_eq!(
        uri_literal_for_object_key(&short, "my-bucket", "x/"),
        "s3://my-bucket/x/"
    );
    assert!(is_non_amazon_host(&uri("s3://minio.example.com/bucket")));
    assert_eq!(
        host_bucket_from_uri(&uri("s3://minio.example.com")),
        None,
        "path style without bucket"
    );

    let underscore = uri("s3://my_bucket/key");
    assert_eq!(host_bucket_from_uri(&underscore), None);
    assert_eq!(
        object_key_from_uri(&underscore).unwrap_err().message,
        "Not a valid s3 uri: s3://my_bucket/key"
    );
    assert_eq!(
        object_key_from_upath(&UPath::parse("gs://b/k").unwrap())
            .unwrap_err()
            .message,
        "Remote path has wrong schema for this feature. Expected s3, got gs."
    );
    assert_eq!(
        with_endpoint_host(&short, &aws_endpoint_host(Some("eu-west-1"))),
        "s3://s3.eu-west-1.amazonaws.com/my-bucket/a/b/"
    );
    assert_eq!(aws_endpoint_host(None), "s3.amazonaws.com");
}

#[test]
fn signing_region_like_aws_host_name_utils() {
    assert_eq!(
        parse_signing_region("s3.eu-central-1.wasabisys.com").as_deref(),
        Some("eu-central-1")
    );
    assert_eq!(
        parse_signing_region("bucket.s3-us-west-1.example.org:9000").as_deref(),
        Some("us-west-1")
    );
    assert_eq!(parse_signing_region("localhost:9000"), None);
    assert_eq!(parse_signing_region("fsn1.your-objectstorage.com"), None);
    assert_eq!(parse_signing_region("s3.example"), None);
    assert_eq!(
        parse_signing_region("x.s3.a.s3.b.example").as_deref(),
        Some("b"),
        "greedy prefix: last candidate wins"
    );
}

#[test]
fn virtual_host_compatible_buckets() {
    assert!(is_virtual_host_compatible("my-bucket"));
    assert!(!is_virtual_host_compatible("my.bucket"));
}
