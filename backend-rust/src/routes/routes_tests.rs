use super::uses_long_rpc;
use axum::http::Method;

#[test]
fn long_rpc_routes_are_exempt() {
    assert!(uses_long_rpc(
        &Method::PUT,
        "/api/annotations/Task/abc/reset"
    ));
    assert!(uses_long_rpc(
        &Method::PUT,
        "/api/v12/annotations/Task/abc/reset"
    ));
    assert!(uses_long_rpc(
        &Method::POST,
        "/api/annotations/a/merge/Task/b"
    ));
    assert!(uses_long_rpc(
        &Method::POST,
        "/api/annotations/Explorational/a/merge/Task/b"
    ));
    assert!(uses_long_rpc(
        &Method::POST,
        "/api/annotations/Explorational/a/duplicate"
    ));
    assert!(uses_long_rpc(
        &Method::POST,
        "/api/datasets/d/createExplorational"
    ));
    assert!(!uses_long_rpc(
        &Method::GET,
        "/api/annotations/Task/abc/reset"
    ));
    assert!(!uses_long_rpc(
        &Method::PATCH,
        "/api/annotations/Task/abc/finish"
    ));
    assert!(!uses_long_rpc(
        &Method::POST,
        "/api/vx/annotations/a/merge/Task/b"
    ));
}
