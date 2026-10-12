//! HTTP API versioning, mirroring Scala `ApiVersioning` + `datastore.versioned.routes`.
//!
//! - `^/(api|data|tracings)/v(\d+)` outside `[10, 16]` → `404` JSON (`DsRequestHandler`).
//! - `/data/v{10..16}/…` aliases the latest routes (`-> /v16/ datastore.latest.Routes`, …), so the
//!   prefix is stripped before routing and the requested version is kept as a request extension.
//! - Exception: paths Scala routes to `DSLegacyApiController` for that version are NOT rewritten,
//!   so they can never reach a latest-version handler with an incompatible contract. They stay at
//!   `/data/v{n}/…` where the dedicated legacy adapters are registered.

/// Scala `ApiVersioning.CURRENT_API_VERSION`.
pub const CURRENT_API_VERSION: u64 = 16;
/// Scala `ApiVersioning.OLDEST_SUPPORTED_API_VERSION`.
pub const OLDEST_SUPPORTED_API_VERSION: u64 = 10;

/// The API version a request was made with (latest when unversioned).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RequestedApiVersion(pub u64);

/// Version digits from `^/(?:api|data|tracings)/v(\d+)` (the digits as written, possibly huge).
pub fn requested_version_digits(path: &str) -> Option<&str> {
    let rest = ["/api/v", "/data/v", "/tracings/v"]
        .iter()
        .find_map(|prefix| path.strip_prefix(prefix))?;
    let end = rest
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(rest.len());
    (end > 0).then(|| &rest[..end])
}

/// `None` if the requested version is supported (or the path is unversioned), otherwise Scala's
/// `invalidApiVersionMessage`. Versions that overflow `u64` are reported as unsupported (Scala
/// would fail with a `NumberFormatException` and answer 500).
pub fn invalid_version_message(path: &str) -> Option<String> {
    let digits = requested_version_digits(path)?;
    let supported = digits
        .parse::<u64>()
        .is_ok_and(|v| (OLDEST_SUPPORTED_API_VERSION..=CURRENT_API_VERSION).contains(&v));
    (!supported).then(|| {
        let shown = digits.trim_start_matches('0');
        let shown = if shown.is_empty() { "0" } else { shown };
        format!(
            "This WEBKNOSSOS instance does not support the requested HTTP API version. Client requested {shown} but must be at least {OLDEST_SUPPORTED_API_VERSION} and at most {CURRENT_API_VERSION}."
        )
    })
}

/// For a supported `/data/v{n}/rest` path that aliases the latest routes, returns `(n, "/data/rest")`.
pub fn latest_alias(method: &str, path: &str) -> Option<(u64, String)> {
    let after = path.strip_prefix("/data/v")?;
    let (digits, rest) = after.split_once('/')?;
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let version: u64 = digits.parse().ok()?;
    if !(OLDEST_SUPPORTED_API_VERSION..=CURRENT_API_VERSION).contains(&version) {
        return None;
    }
    // The unversioned chunk compatibility route must not become a latest-version alias.
    if (version >= 14 && rest == "datasets" && matches!(method, "GET" | "HEAD" | "POST"))
        || is_legacy_override(version, method, rest)
    {
        return None;
    }
    Some((version, format!("/data/{rest}")))
}

/// Routes declared before `-> /v{n}/ datastore.latest.Routes` in `datastore.versioned.routes`.
fn is_legacy_override(version: u64, method: &str, rest: &str) -> bool {
    let method = if method == "HEAD" { "GET" } else { method };
    let segments: Vec<&str> = rest.split('/').collect();
    const PROPS: &str = "datasource-properties.json";
    let is_zarr = |s: &str| matches!(s, "zarr" | "zarr3" | "zarr3_experimental");
    let datasource_properties = method == "GET"
        && match segments.as_slice() {
            ["datasets", _, "proxy", props] => *props == PROPS,
            [zarr, _, props] => is_zarr(zarr) && *props == PROPS,
            ["annotations", zarr, _, props] => is_zarr(zarr) && *props == PROPS,
            _ => false,
        };
    let upload = version <= 13
        && matches!(
            (method, segments.as_slice()),
            ("GET" | "POST", ["datasets"])
                | ("GET", ["datasets", "unfinishedUploads"])
                | ("POST", ["datasets", "finishUpload" | "reserveUpload"])
        );
    let manual_upload = version == 10
        && method == "POST"
        && segments.as_slice() == ["datasets", "reserveManualUpload"];
    version <= 14 && (datasource_properties || upload || manual_upload)
}

#[cfg(test)]
mod tests {
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
}
