use serde::Serialize;
use serde_json::json;

use super::*;

#[test]
fn messages_render_like_play() {
    let Json(body) = Messages::success("Done.");
    assert_eq!(
        serde_json::to_value(body).unwrap(),
        json!({"messages": [{"success": "Done."}]})
    );
    let error = Messages {
        messages: vec![Message::Error("Nope.".into())],
    };
    assert_eq!(
        serde_json::to_value(error).unwrap(),
        json!({"messages": [{"error": "Nope."}]})
    );
}

#[test]
fn with_messages_flattens_the_body() {
    #[derive(Serialize)]
    struct Body {
        id: &'static str,
    }
    let Json(body) = WithMessages::success(Body { id: "x" }, "Created.");
    assert_eq!(
        serde_json::to_value(body).unwrap(),
        json!({"id": "x", "messages": [{"success": "Created."}]})
    );
}
