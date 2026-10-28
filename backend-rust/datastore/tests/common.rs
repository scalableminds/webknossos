#![allow(dead_code)]

use std::path::Path;

use axum::{
    Router,
    body::Body,
    http::{HeaderMap, Request, StatusCode},
};
use http_body_util::BodyExt;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};
use tower::ServiceExt;
use webknossos_datastore::{AppState, config::DatastoreConfig};

pub fn state_with_redis_port(port: u16) -> AppState {
    let mut config = DatastoreConfig::defaults(Path::new("/srv/wk"));
    config.redis.address = "127.0.0.1".into();
    config.redis.port = port;
    config.name = "test-ds".into();
    AppState::new(config)
}

/// A one-trick Redis: reads the PING command of every connection and answers `reply`
/// (or never answers when `reply` is `None`).
pub async fn fake_redis(reply: Option<&'static [u8]>) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            tokio::spawn(async move {
                let mut buffer = [0u8; 14];
                if socket.read_exact(&mut buffer).await.is_err() {
                    return;
                }
                assert_eq!(&buffer, b"*1\r\n$4\r\nPING\r\n");
                match reply {
                    Some(reply) => {
                        let _ = socket.write_all(reply).await;
                    }
                    None => tokio::time::sleep(std::time::Duration::from_secs(5)).await,
                }
            });
        }
    });
    port
}

/// A port on which nothing listens.
pub async fn closed_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    listener.local_addr().unwrap().port()
}

pub async fn send(router: Router, request: Request<Body>) -> (StatusCode, HeaderMap, Vec<u8>) {
    let response = router.oneshot(request).await.unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    (status, headers, body.to_vec())
}

pub async fn get(router: Router, path: &str) -> (StatusCode, HeaderMap, Vec<u8>) {
    send(router, Request::get(path).body(Body::empty()).unwrap()).await
}

pub fn json(body: &[u8]) -> serde_json::Value {
    serde_json::from_slice(body).unwrap()
}

pub fn header<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).map(|v| v.to_str().unwrap())
}
