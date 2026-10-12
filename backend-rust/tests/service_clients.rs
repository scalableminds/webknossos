use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    Router,
    body::{Body, to_bytes},
    extract::{Request, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::any,
};
use serde_json::{Value, json};
use webknossos_backend::service_clients::{ServiceClientConfig, ServiceClients, ServiceError};

#[derive(Clone, Default)]
struct Observations {
    requests: Arc<Mutex<Vec<(String, String, Value)>>>,
    redirect_target: Option<String>,
}

async fn handler(State(observations): State<Observations>, request: Request) -> Response {
    let method = request.method().to_string();
    let uri = request.uri().to_string();
    let path = request.uri().path().to_owned();
    let bytes = to_bytes(request.into_body(), 1024 * 1024).await.unwrap();
    let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    observations
        .requests
        .lock()
        .unwrap()
        .push((method.clone(), uri.clone(), body.clone()));
    if path.ends_with("/slow") {
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
    if path.ends_with("/cross-origin") {
        return (
            StatusCode::FOUND,
            [(
                header::LOCATION,
                observations.redirect_target.as_deref().unwrap(),
            )],
        )
            .into_response();
    }
    if path.ends_with("/redirect") {
        return (StatusCode::FOUND, [(header::LOCATION, "/rpc/json")]).into_response();
    }
    if path.ends_with("/loop") {
        return (StatusCode::FOUND, [(header::LOCATION, "/rpc/loop")]).into_response();
    }
    if path.ends_with("/status") {
        return (StatusCode::IM_A_TEAPOT, "do-not-expose-response-secret").into_response();
    }
    if path.ends_with("/bad-json") {
        return "do-not-expose-json-secret".into_response();
    }
    if path.ends_with("/stream") {
        let stream = futures_util::stream::iter([Ok::<_, std::io::Error>("123456"), Ok("789012")]);
        return Body::from_stream(stream).into_response();
    }
    if path.ends_with("/empty") {
        return StatusCode::NO_CONTENT.into_response();
    }
    axum::Json(json!({"method":method,"uri":uri,"body":body})).into_response()
}

async fn server(
    redirect_target: Option<String>,
) -> (String, Observations, tokio::task::JoinHandle<()>) {
    let state = Observations {
        redirect_target,
        ..Default::default()
    };
    let router = Router::new()
        .route("/rpc/{*path}", any(handler))
        .with_state(state.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    (format!("http://{address}/rpc/"), state, task)
}

fn client(timeout: Duration, maximum: usize) -> ServiceClients {
    ServiceClients::new(ServiceClientConfig {
        request_timeout: timeout,
        connect_timeout: timeout,
        max_response_bytes: maximum,
        rpc_token: "rpc-secret-for-tests".to_owned(),
    })
    .unwrap()
}

#[tokio::test]
async fn real_http_requests_encode_paths_queries_json_and_keep_tokens_out_of_debug() {
    let (base, observations, server) = server(None).await;
    let client = client(Duration::from_secs(2), 8192);
    let value: Value = client
        .post_json(
            &base,
            &["collect", "layer/a $é"],
            &[("mappingName", "value +&".to_owned())],
            &json!({"payload":"real-body"}),
        )
        .await
        .unwrap();
    assert_eq!(value["method"], "POST");
    assert_eq!(value["body"], json!({"payload":"real-body"}));
    let uri = value["uri"].as_str().unwrap();
    assert!(uri.contains("layer%2Fa%20$%C3%A9"), "{uri}");
    assert!(uri.contains("mappingName=value+%2B%26"), "{uri}");
    assert!(uri.contains("token=rpc-secret-for-tests"));
    let response = client
        .request(reqwest::Method::DELETE, &base, &["empty"], &[], None)
        .await
        .unwrap();
    assert!(response.bytes.is_empty());
    assert_eq!(observations.requests.lock().unwrap().len(), 2);
    assert!(client.rpc_token_matches("rpc-secret-for-tests"));
    assert!(!client.rpc_token_matches("rpc-secret-for-test"));
    assert!(!client.rpc_token_matches("wrong"));
    assert!(!format!("{client:?}").contains("rpc-secret-for-tests"));
    assert!(!format!("{response:?}").contains("real-body"));
    server.abort();
}

#[tokio::test]
async fn timeouts_non_success_and_malformed_json_have_typed_sanitized_errors() {
    let (base, _, server) = server(None).await;
    let client = client(Duration::from_millis(40), 8192);
    let error = client
        .get_json::<Value>(&base, &["slow"], &[])
        .await
        .unwrap_err();
    assert_eq!(error, ServiceError::Timeout);
    let error = client
        .get_json::<Value>(&base, &["status"], &[])
        .await
        .unwrap_err();
    assert_eq!(error, ServiceError::UpstreamStatus(418));
    assert!(!error.to_string().contains("secret"));
    let error = client
        .get_json::<Value>(&base, &["bad-json"], &[])
        .await
        .unwrap_err();
    assert_eq!(error, ServiceError::InvalidJson);
    assert!(!error.to_string().contains("secret"));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let unavailable = format!("http://{}/", listener.local_addr().unwrap());
    drop(listener);
    assert_eq!(
        client
            .get_json::<Value>(&unavailable, &["json"], &[])
            .await
            .unwrap_err(),
        ServiceError::Connection
    );
    server.abort();
}

#[tokio::test]
async fn chunked_and_declared_responses_are_bounded_and_redirects_never_cross_origins() {
    let (target, target_observations, target_server) = server(None).await;
    let (base, _, server) = server(Some(format!("{target}json?token=rpc-secret-for-tests"))).await;
    let small = client(Duration::from_secs(2), 8);
    assert_eq!(
        small
            .request(reqwest::Method::GET, &base, &["stream"], &[], None)
            .await
            .unwrap_err(),
        ServiceError::ResponseTooLarge
    );
    assert_eq!(
        small
            .get_json::<Value>(&base, &["json"], &[])
            .await
            .unwrap_err(),
        ServiceError::ResponseTooLarge
    );
    let client = client(Duration::from_secs(2), 8192);
    let result: Value = client.get_json(&base, &["redirect"], &[]).await.unwrap();
    assert_eq!(result["uri"], "/rpc/json");
    assert_eq!(
        client
            .get_json::<Value>(&base, &["cross-origin"], &[])
            .await
            .unwrap_err(),
        ServiceError::Redirect
    );
    assert!(target_observations.requests.lock().unwrap().is_empty());
    assert_eq!(
        client
            .get_json::<Value>(&base, &["loop"], &[])
            .await
            .unwrap_err(),
        ServiceError::Redirect
    );
    for invalid in [
        "file:///private/path",
        "http://user:password@localhost",
        "http://localhost/?secret=token",
        "http://localhost/#fragment",
    ] {
        assert_eq!(
            client
                .get_json::<Value>(invalid, &["json"], &[])
                .await
                .unwrap_err(),
            ServiceError::InvalidBaseUrl
        );
    }
    server.abort();
    target_server.abort();
}

// ---- TI2a: protobuf-body requests and hasSegmentIndex ---------------------

type RawObservation = (String, String, Option<String>, Vec<u8>);

async fn raw_server(
    status: StatusCode,
    response: &'static str,
) -> (String, Arc<Mutex<Vec<RawObservation>>>) {
    let observed: Arc<Mutex<Vec<RawObservation>>> = Arc::default();
    let state = observed.clone();
    let router = Router::new().route(
        "/{*path}",
        any(move |request: Request| {
            let state = state.clone();
            async move {
                let method = request.method().to_string();
                let uri = request.uri().to_string();
                let content_type = request
                    .headers()
                    .get(header::CONTENT_TYPE)
                    .map(|v| v.to_str().unwrap().to_owned());
                let bytes = to_bytes(request.into_body(), 1024 * 1024).await.unwrap();
                state
                    .lock()
                    .unwrap()
                    .push((method, uri, content_type, bytes.to_vec()));
                (status, response)
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    (format!("http://{address}"), observed)
}

#[tokio::test]
async fn request_bytes_attaches_token_content_type_and_exact_body() {
    let (base, observed) = raw_server(StatusCode::OK, "ok").await;
    let client = client(Duration::from_secs(2), 1024);
    let body = vec![0x08, 0x00, 0xff, 0x0a, 0x00];
    let response = client
        .request_bytes(
            reqwest::Method::POST,
            &base,
            &["tracings", "skeleton", "save"],
            &[("newTracingId", "a b&c".to_owned())],
            webknossos_backend::service_clients::PROTOBUF_CONTENT_TYPE,
            body.clone(),
        )
        .await
        .unwrap();
    assert_eq!(response.bytes, b"ok");
    let (method, uri, content_type, received) = observed.lock().unwrap()[0].clone();
    assert_eq!(method, "POST");
    assert_eq!(
        uri,
        "/tracings/skeleton/save?token=rpc-secret-for-tests&newTracingId=a+b%26c"
    );
    assert_eq!(content_type.as_deref(), Some("application/x-protobuf"));
    assert_eq!(received, body);

    // A token query key from the caller and invalid header values are rejected
    // before any request is sent.
    assert_eq!(
        client
            .request_bytes(
                reqwest::Method::POST,
                &base,
                &["x"],
                &[("token", "other".to_owned())],
                "application/x-protobuf",
                Vec::new(),
            )
            .await
            .unwrap_err(),
        ServiceError::InvalidBaseUrl
    );
    assert_eq!(
        client
            .request_bytes(
                reqwest::Method::POST,
                &base,
                &["x"],
                &[],
                "bad\nvalue",
                Vec::new(),
            )
            .await
            .unwrap_err(),
        ServiceError::InvalidConfiguration
    );
    assert_eq!(observed.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn request_bytes_maps_upstream_status_without_exposing_body() {
    let (base, _) = raw_server(StatusCode::CONFLICT, "do-not-expose").await;
    let error = client(Duration::from_secs(2), 1024)
        .request_bytes(
            reqwest::Method::POST,
            &base,
            &["save"],
            &[],
            "application/x-protobuf",
            vec![1],
        )
        .await
        .unwrap_err();
    assert_eq!(error, ServiceError::UpstreamStatus(409));
    assert!(!error.to_string().contains("do-not-expose"));
}

#[tokio::test]
async fn has_segment_index_gets_json_boolean_from_layer_path() {
    let dataset_id = webknossos_backend::id::ObjectId::parse("0123456789abcdef01234567").unwrap();
    let client = client(Duration::from_secs(2), 1024);
    for (response, expected) in [("true", true), ("false", false)] {
        let (base, observed) = raw_server(StatusCode::OK, response).await;
        assert_eq!(
            client
                .has_segment_index(&base, &dataset_id, "segmentation layer")
                .await
                .unwrap(),
            expected
        );
        let (method, uri, _, body) = observed.lock().unwrap()[0].clone();
        assert_eq!(method, "GET");
        assert_eq!(
            uri,
            "/data/datasets/0123456789abcdef01234567/layers/segmentation%20layer/hasSegmentIndex?token=rpc-secret-for-tests"
        );
        assert!(body.is_empty());
    }
    let (base, _) = raw_server(StatusCode::OK, "\"yes\"").await;
    assert_eq!(
        client
            .has_segment_index(&base, &dataset_id, "segmentation")
            .await,
        Err(ServiceError::InvalidJson)
    );
    let (base, _) = raw_server(StatusCode::NOT_FOUND, "missing").await;
    assert_eq!(
        client
            .has_segment_index(&base, &dataset_id, "segmentation")
            .await,
        Err(ServiceError::UpstreamStatus(404))
    );
}
