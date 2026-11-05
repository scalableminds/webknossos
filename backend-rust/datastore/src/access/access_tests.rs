use super::*;
use axum::http::Request;
use serde_json::json;

fn parts(uri: &str, header: Option<&str>) -> Parts {
    let mut builder = Request::get(uri);
    if let Some(value) = header {
        builder = builder.header("X-Auth-Token", value);
    }
    builder.body(()).unwrap().into_parts().0
}

#[test]
fn token_comes_from_query_then_header() {
    let tc = TokenContext::from_parts(&parts("/x?a=1&token=q%20t&token=second", Some("h")));
    assert_eq!(tc.user_token.as_deref(), Some("q t"));
    let tc = TokenContext::from_parts(&parts("/x?a=1", Some("h")));
    assert_eq!(tc.user_token.as_deref(), Some("h"));
    let tc = TokenContext::from_parts(&parts("/x", None));
    assert_eq!(tc.user_token, None);
    let tc = TokenContext::from_parts(&parts("/x?token=", Some("h")));
    assert_eq!(tc.user_token.as_deref(), Some(""));
}

#[test]
fn access_request_json_matches_play_format() {
    assert_eq!(
        serde_json::to_value(UserAccessRequest::read_dataset("abc")).unwrap(),
        json!({"resourceId": "abc", "resourceType": "dataset", "mode": "read"})
    );
    assert_eq!(
        serde_json::to_value(UserAccessRequest::webknossos()).unwrap(),
        json!({"resourceType": "webknossos", "mode": "administrate"})
    );
    assert_eq!(
        serde_json::to_value(UserAccessRequest::download_job_export("j")).unwrap(),
        json!({"resourceId": "j", "resourceType": "jobExport", "mode": "read"})
    );
    let answer: UserAccessAnswer =
        serde_json::from_value(json!({"granted": false, "msg": null})).unwrap();
    assert_eq!(
        answer,
        UserAccessAnswer {
            granted: false,
            msg: None
        }
    );
}
