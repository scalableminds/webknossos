//! Play's `ExtendedController.addRemoteOriginHeaders`.
use axum::{
    http::{HeaderValue, header},
    response::Response,
};

/// Adds the headers to every response (controllers with `allowRemoteOrigin = true`).
pub(crate) async fn remote_origin_headers(mut response: Response) -> Response {
    let headers = response.headers_mut();
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    headers.insert(
        header::ACCESS_CONTROL_MAX_AGE,
        HeaderValue::from_static("600"),
    );
    response
}

/// Adds the headers to successful responses only (actions that wrap their `Ok` result).
pub(crate) async fn remote_origin_headers_on_success(response: Response) -> Response {
    if response.status().is_success() {
        remote_origin_headers(response).await
    } else {
        response
    }
}
