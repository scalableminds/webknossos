//! RequestHandler's asset routes: `/assets`, `/images` and `/wasm` from the built frontend
//! (Play's `Assets.at("/public", path)`), with Play's `play.assets.cache` directives. Like Play's
//! Assets, a precompressed `<file>.gz` is preferred when the client accepts gzip.
use axum::{
    body::Body,
    extract::Request,
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use tower_http::services::ServeDir;

use super::{CONTENT_SECURITY_POLICY, MainView};

const STATIC_PREFIXES: [&str; 3] = ["/assets/", "/images/", "/wasm/"];
/// `play.assets.cache."/public/assets"`: vite content-hashes every file in `public/assets`.
const IMMUTABLE: &str = "public, max-age=31536000, immutable";
/// `play.assets.defaultCache` (Play's default), also for the unhashed `/assets/docs`.
const DEFAULT_CACHE: &str = "public, max-age=3600";

pub(crate) fn is_static_path(path: &str) -> bool {
    STATIC_PREFIXES
        .iter()
        .any(|prefix| path.starts_with(prefix))
}

/// `play.assets.cache`: the most specific configured prefix wins.
pub(crate) fn cache_control(path: &str) -> &'static str {
    if path.starts_with("/assets/") && !path.starts_with("/assets/docs/") {
        IMMUTABLE
    } else {
        DEFAULT_CACHE
    }
}

/// Play's `^(/assets/).*(worker.js).*$` on the request URI: "worker", any one character, "js".
/// Written for the old bundler's `*.worker.js` names; vite's `*.worker-<hash>.js` never match, so
/// in practice workers get no CSP header from Play either. Kept as is for parity.
fn needs_csp(path_and_query: &str) -> bool {
    let Some(rest) = path_and_query.strip_prefix("/assets/") else {
        return false;
    };
    rest.match_indices("worker").any(|(index, _)| {
        let mut after = rest[index + "worker".len()..].chars();
        after.next().is_some_and(|c| c != '\n') && after.as_str().starts_with("js")
    })
}

/// The file under the public directory; `None` (JSON 404) when there is none.
pub(crate) async fn serve(main_view: &MainView, request: Request) -> Option<Response> {
    let path = request.uri().path().to_owned();
    let path_and_query = request
        .uri()
        .path_and_query()
        .map_or_else(|| path.clone(), |value| value.as_str().to_owned());
    let mut service = ServeDir::new(&main_view.config().public_dir)
        .append_index_html_on_directories(false)
        .precompressed_gzip();
    let response = match service.try_call(request).await {
        Ok(response) => response,
        Err(error) => {
            tracing::warn!(%error, "Could not read a static frontend file");
            return Some(StatusCode::INTERNAL_SERVER_ERROR.into_response());
        }
    };
    if response.status() == StatusCode::NOT_FOUND {
        return None;
    }
    let mut response = response.map(Body::new);
    if response.status().is_success() || response.status() == StatusCode::NOT_MODIFIED {
        let headers = response.headers_mut();
        headers.insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static(cache_control(&path)),
        );
        if needs_csp(&path_and_query) {
            headers.insert(
                header::CONTENT_SECURITY_POLICY,
                HeaderValue::from_static(CONTENT_SECURITY_POLICY),
            );
        }
    }
    Some(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_directives_follow_play_config() {
        assert_eq!(cache_control("/assets/main-abc123.js"), IMMUTABLE);
        assert_eq!(cache_control("/assets/docs/index.html"), DEFAULT_CACHE);
        assert_eq!(cache_control("/images/og-image.png"), DEFAULT_CACHE);
        assert_eq!(cache_control("/wasm/x.wasm"), DEFAULT_CACHE);
    }

    #[test]
    fn workers_get_the_csp_header() {
        assert!(needs_csp("/assets/compress.worker.js"));
        assert!(needs_csp("/assets/compress.worker.js.map"));
        assert!(needs_csp("/assets/main.js?worker.js"));
        // vite's hashed worker names do not match Play's pattern.
        assert!(!needs_csp("/assets/compress.worker-DxjpqJU_.js"));
        assert!(!needs_csp("/assets/main.js"));
        assert!(!needs_csp("/images/worker.js"));
    }

    #[test]
    fn static_prefixes() {
        assert!(is_static_path("/assets/a.js"));
        assert!(is_static_path("/wasm/a.wasm"));
        assert!(!is_static_path("/assets"));
        assert!(!is_static_path("/dashboard"));
    }
}
