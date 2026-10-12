use axum::{Router, body::Body, http::Request, routing::get};
use http_body_util::BodyExt;
use serde::Deserialize;
use tower::ServiceExt;
use webknossos_backend::{
    extract::{Json, Path, Query},
    id::{ObjectId, PathObjectId},
};

#[derive(Deserialize)]
struct IdField {
    id: ObjectId,
}

#[tokio::test]
async fn path_prefixes_do_not_change_json_query_or_layer_name_binding() {
    let app = Router::new()
        .route(
            "/ids/{id}",
            get(async |Path(id): Path<PathObjectId>| id.to_string()),
        )
        .route(
            "/ids/{id}/layers/{name}",
            get(async |Path((id, name)): Path<(PathObjectId, String)>| format!("{id}/{name}")),
        )
        .route(
            "/ids",
            get(async |Query(value): Query<IdField>| value.id.to_string())
                .post(async |Json(value): Json<IdField>| value.id.to_string()),
        );
    let upper = "ABCDEF012345ABCDEF012345";
    let lower = upper.to_ascii_lowercase();
    for (method, uri, body, status, expected) in [
        (
            "GET",
            format!("/ids/readable-prefix-{upper}"),
            String::new(),
            200,
            lower.clone(),
        ),
        (
            "GET",
            format!("/ids/{upper}"),
            String::new(),
            200,
            lower.clone(),
        ),
        (
            "GET",
            format!("/ids/label-{upper}/layers/keep-{upper}"),
            String::new(),
            200,
            format!("{lower}/keep-{upper}"),
        ),
        (
            "GET",
            format!("/ids?id={upper}"),
            String::new(),
            200,
            lower.clone(),
        ),
        (
            "GET",
            format!("/ids?id=label-{upper}"),
            String::new(),
            400,
            String::new(),
        ),
        (
            "POST",
            "/ids".to_owned(),
            format!(r#"{{"id":"{upper}"}}"#),
            200,
            lower,
        ),
        (
            "POST",
            "/ids".to_owned(),
            format!(r#"{{"id":"label-{upper}"}}"#),
            400,
            String::new(),
        ),
        (
            "GET",
            format!("/ids/{upper}-"),
            String::new(),
            400,
            String::new(),
        ),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(&uri)
                    .header("content-type", "application/json")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status().as_u16(), status, "{method} {uri}");
        if status == 200 {
            assert_eq!(
                response.into_body().collect().await.unwrap().to_bytes(),
                expected
            );
        }
    }
}
