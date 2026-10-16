
use super::*;

#[test]
fn version_detection_matches_scala_regex() {
    assert_eq!(requested_version_digits("/data/v12/health"), Some("12"));
    assert_eq!(requested_version_digits("/api/v3"), Some("3"));
    assert_eq!(requested_version_digits("/tracings/v99x"), Some("99"));
    assert_eq!(requested_version_digits("/data/volumes"), None);
    assert_eq!(requested_version_digits("/data/health"), None);
    assert_eq!(requested_version_digits("/other/v12/x"), None);
}

#[test]
fn invalid_versions_get_scala_message() {
    assert_eq!(invalid_version_message("/data/v16/health"), None);
    assert_eq!(invalid_version_message("/data/v10/health"), None);
    assert_eq!(invalid_version_message("/data/health"), None);
    assert_eq!(
        invalid_version_message("/data/v9/health").unwrap(),
        "This WEBKNOSSOS instance does not support the requested HTTP API version. Client requested 9 but must be at least 10 and at most 16."
    );
    assert!(invalid_version_message("/data/v17/health").is_some());
    assert!(invalid_version_message("/api/v99999999999999999999999/x").is_some());
}

#[test]
fn latest_aliases_strip_the_version() {
    assert_eq!(
        latest_alias("GET", "/data/v16/health"),
        Some((16, "/data/health".into()))
    );
    assert_eq!(
        latest_alias("GET", "/data/v12/datasets/abc/layers/color/data"),
        Some((12, "/data/datasets/abc/layers/color/data".into()))
    );
    // Newer than v14: datasource-properties.json is served by the latest handlers.
    assert_eq!(
        latest_alias("GET", "/data/v15/zarr/abc/datasource-properties.json"),
        Some((15, "/data/zarr/abc/datasource-properties.json".into()))
    );
    assert_eq!(latest_alias("GET", "/data/v16"), None);
    assert_eq!(latest_alias("GET", "/data/v9/health"), None);
    assert_eq!(latest_alias("GET", "/data/v1x/health"), None);
}

#[test]
fn legacy_overrides_are_not_aliased() {
    for (method, path) in [
        ("GET", "/data/v14/zarr/abc/datasource-properties.json"),
        (
            "GET",
            "/data/v14/zarr3_experimental/abc/datasource-properties.json",
        ),
        (
            "GET",
            "/data/v14/annotations/zarr3/tok/datasource-properties.json",
        ),
        (
            "GET",
            "/data/v10/datasets/abc/proxy/datasource-properties.json",
        ),
        ("POST", "/data/v13/datasets"),
        ("GET", "/data/v11/datasets"),
        ("POST", "/data/v12/datasets/reserveUpload"),
        ("POST", "/data/v13/datasets/finishUpload"),
        ("GET", "/data/v10/datasets/unfinishedUploads"),
        ("POST", "/data/v10/datasets/reserveManualUpload"),
    ] {
        assert_eq!(latest_alias(method, path), None, "{method} {path}");
    }
    assert!(latest_alias("POST", "/data/v14/datasets/reserveUpload").is_some());
    assert!(latest_alias("POST", "/data/v11/datasets/reserveManualUpload").is_some());
}
