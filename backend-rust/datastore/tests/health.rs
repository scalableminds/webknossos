mod common;

use axum::http::StatusCode;
use common::*;
use webknossos_datastore::router;

#[tokio::test]
async fn health_answers_ok_when_redis_answers_pong() {
    let port = fake_redis(Some(b"+PONG\r\n")).await;
    let (status, headers, body) = get(router(state_with_redis_port(port)), "/data/health").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, b"Ok");
    assert_eq!(
        header(&headers, "content-type"),
        Some("text/plain; charset=UTF-8")
    );
    assert_eq!(header(&headers, "cache-control"), Some("no-cache"));
    assert_eq!(header(&headers, "access-control-allow-origin"), Some("*"));
    assert_eq!(header(&headers, "access-control-max-age"), Some("600"));
    assert_eq!(header(&headers, "x-frame-options"), Some("DENY"));
    assert_eq!(
        header(&headers, "x-permitted-cross-domain-policies"),
        Some("master-only")
    );
    assert!(header(&headers, "x-request-id").is_some());
    assert_eq!(header(&headers, "x-content-type-options"), None);
}

#[tokio::test]
async fn versioned_health_aliases_latest_routes() {
    let port = fake_redis(Some(b"+PONG\r\n")).await;
    for path in [
        "/data/v16/health",
        "/data/v15/health",
        "/data/v10/health?token=x",
    ] {
        let (status, _, body) = get(router(state_with_redis_port(port)), path).await;
        assert_eq!(
            (status, body.as_slice()),
            (StatusCode::OK, &b"Ok"[..]),
            "{path}"
        );
    }
}

#[tokio::test]
async fn health_fails_when_redis_is_unreachable() {
    let port = closed_port().await;
    let (status, headers, body) = get(router(state_with_redis_port(port)), "/data/health").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(header(&headers, "access-control-allow-origin"), Some("*"));
    assert_eq!(header(&headers, "cache-control"), Some("no-cache"));
    let body = json(&body);
    let messages = body["messages"].as_array().unwrap();
    assert_eq!(
        messages[0],
        serde_json::json!({"error": "Redis health check failed."})
    );
    let chain = messages[1]["chain"].as_str().unwrap();
    assert!(chain.starts_with("[Server Time "), "{chain}");
    assert!(
        chain.contains(&format!("] Redis access exception on 127.0.0.1:{port}: ")),
        "{chain}"
    );
    assert_eq!(messages.len(), 2);
}

#[tokio::test]
async fn health_fails_on_unexpected_or_error_replies() {
    for (reply, expected) in [
        (
            &b"+PANG\r\n"[..],
            "Redis access failure <~ Unexpected Redis ping reply: PANG",
        ),
        (
            &b"-NOAUTH Authentication required.\r\n"[..],
            "Redis access failure <~ io.lettuce.core.RedisCommandExecutionException: NOAUTH Authentication required.",
        ),
    ] {
        let port = fake_redis(Some(reply)).await;
        let (status, _, body) = get(router(state_with_redis_port(port)), "/data/health").await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        let body = json(&body);
        assert_eq!(body["messages"][0]["error"], "Redis health check failed.");
        let chain = body["messages"][1]["chain"].as_str().unwrap();
        assert!(chain.contains(expected), "{chain}");
    }
}

#[tokio::test]
async fn health_fails_when_redis_does_not_answer_within_a_second() {
    let port = fake_redis(None).await;
    let started = std::time::Instant::now();
    let (status, _, body) = get(router(state_with_redis_port(port)), "/data/health").await;
    assert!(started.elapsed() < std::time::Duration::from_secs(3));
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let chain = json(&body)["messages"][1]["chain"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(
        chain.contains("Redis access failure <~ java.util.concurrent.TimeoutException"),
        "{chain}"
    );
}

#[tokio::test]
async fn health_fails_after_a_recent_internal_error() {
    let port = fake_redis(Some(b"+PONG\r\n")).await;
    let state = state_with_redis_port(port);
    state.health.push("native crash while loading bucket");
    let (status, _, body) = get(router(state), "/data/health").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        json(&body),
        serde_json::json!({"messages": [{"error": "Java Internal Errors detected"}]})
    );
}

#[tokio::test]
async fn request_timeout_answers_like_pekko() {
    let port = fake_redis(None).await;
    let mut config = (*state_with_redis_port(port).config).clone();
    config.http.request_timeout = std::time::Duration::from_millis(200);
    let (status, _, body) = get(
        router(webknossos_datastore::AppState::new(config)),
        "/data/health",
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        String::from_utf8(body).unwrap(),
        "The server was not able to produce a timely response to your request.\r\nPlease try again in a short while!"
    );
}

/// Redis that answers PINGs on each connection until it closes; counts accepted connections.
async fn counting_redis(
    pings_per_connection: usize,
) -> (u16, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let accepted = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counter = accepted.clone();
    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            tokio::spawn(async move {
                for _ in 0..pings_per_connection {
                    let mut buffer = [0u8; 14];
                    if socket.read_exact(&mut buffer).await.is_err() {
                        return;
                    }
                    let _ = socket.write_all(b"+PONG\r\n").await;
                }
            });
        }
    });
    (port, accepted)
}

#[tokio::test]
async fn health_reuses_one_redis_connection() {
    // A connection per check left one TIME_WAIT socket per request and exhausted ephemeral ports
    // under load (differential load phase 2026-10-17); Scala keeps one Lettuce connection.
    let (port, accepted) = counting_redis(usize::MAX).await;
    let app = router(state_with_redis_port(port));
    for _ in 0..3 {
        let (status, _, body) = get(app.clone(), "/data/health").await;
        assert_eq!((status, body.as_slice()), (StatusCode::OK, &b"Ok"[..]));
    }
    assert_eq!(accepted.load(std::sync::atomic::Ordering::SeqCst), 1);
}

#[tokio::test]
async fn health_reconnects_after_redis_closed_the_connection() {
    let (port, accepted) = counting_redis(1).await;
    let app = router(state_with_redis_port(port));
    for _ in 0..3 {
        let (status, _, body) = get(app.clone(), "/data/health").await;
        assert_eq!((status, body.as_slice()), (StatusCode::OK, &b"Ok"[..]));
    }
    assert_eq!(accepted.load(std::sync::atomic::Ordering::SeqCst), 3);
}
