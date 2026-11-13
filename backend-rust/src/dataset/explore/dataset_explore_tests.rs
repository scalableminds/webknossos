use super::*;

#[test]
fn credential_uris_and_folder_paths_follow_scala() {
    assert_eq!(
        credential_uri("s3://bucket/a.zarr/.zattrs")
            .unwrap()
            .as_str(),
        "s3://bucket/a.zarr/"
    );
    assert_eq!(
        credential_uri("https://h/x/a.zip|zip:inner")
            .unwrap()
            .as_str(),
        "https://h/x/a.zip"
    );
    assert!(credential_uri("no scheme").is_none());
    assert_eq!(split_path("root/a/b/"), ["root", "a", "b"]);
    assert_eq!(split_path("root//b"), ["root", "", "b"]);
    assert_eq!(split_path(""), [""]);
}
