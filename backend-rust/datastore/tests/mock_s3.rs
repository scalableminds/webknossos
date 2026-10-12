#![allow(dead_code)] // Shared integration fixture; individual harnesses use different fields.
use axum::{
    Router,
    body::Bytes,
    extract::DefaultBodyLimit,
    http::{HeaderMap, Method, StatusCode, Uri},
    response::{IntoResponse, Response},
};
use ring::digest;
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

#[derive(Clone)]
pub struct Call {
    pub method: String,
    pub path: String,
    pub query: HashMap<String, String>,
    pub headers: HeaderMap,
    pub body: Bytes,
}
pub struct Reply {
    pub status: StatusCode,
    pub body: String,
    pub etag: Option<String>,
    pub delay: std::time::Duration,
    pub headers: Vec<(&'static str, String)>,
}
impl Reply {
    pub fn xml(status: StatusCode, body: &str) -> Self {
        Self {
            status,
            body: body.into(),
            etag: None,
            delay: std::time::Duration::ZERO,
            headers: Vec::new(),
        }
    }
    pub fn ok() -> Self {
        Self::xml(StatusCode::OK, "")
    }
    pub fn with(mut self, name: &'static str, value: &str) -> Self {
        self.headers.push((name, value.into()));
        self
    }
    pub fn part() -> Self {
        Self {
            etag: Some("\"part&etag\"".into()),
            ..Self::ok()
        }
    }
}
pub struct MockS3 {
    pub address: String,
    calls: Arc<Mutex<Vec<Call>>>,
    pub puts: Arc<AtomicUsize>,
    pub put_seen: Arc<tokio::sync::Notify>,
    pub changed: Arc<tokio::sync::Notify>,
}
impl MockS3 {
    pub async fn start(handler: impl Fn(&Call) -> Reply + Send + Sync + 'static) -> Self {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let puts = Arc::new(AtomicUsize::new(0));
        let put_seen = Arc::new(tokio::sync::Notify::new());
        let changed = Arc::new(tokio::sync::Notify::new());
        let (seen, events) = (Arc::clone(&put_seen), Arc::clone(&changed));
        let recorded = Arc::clone(&calls);
        let count = Arc::clone(&puts);
        let handler = Arc::new(handler);
        let app = Router::new()
            .fallback(
                move |method: Method, uri: Uri, headers: HeaderMap, body: Bytes| {
                    let (recorded, count, handler, seen, events) = (
                        Arc::clone(&recorded),
                        Arc::clone(&count),
                        Arc::clone(&handler),
                        Arc::clone(&seen),
                        Arc::clone(&events),
                    );
                    async move {
                        if headers.contains_key("authorization") {
                            let expected: String = digest::digest(&digest::SHA256, &body)
                                .as_ref()
                                .iter()
                                .map(|b| format!("{b:02x}"))
                                .collect();
                            assert_eq!(
                                headers
                                    .get("x-amz-content-sha256")
                                    .unwrap()
                                    .to_str()
                                    .unwrap(),
                                expected
                            );
                            assert!(!headers.contains_key("x-auth-token"));
                            if matches!(method, Method::PUT | Method::POST)
                                && headers.contains_key("content-length")
                            {
                                assert_eq!(
                                    headers["content-length"]
                                        .to_str()
                                        .unwrap()
                                        .parse::<usize>()
                                        .unwrap(),
                                    body.len()
                                );
                            }
                        }
                        let call = Call {
                            method: method.to_string(),
                            path: uri.path().into(),
                            query: url::form_urlencoded::parse(
                                uri.query().unwrap_or("").as_bytes(),
                            )
                            .into_owned()
                            .collect(),
                            headers,
                            body,
                        };
                        if method == Method::PUT {
                            count.fetch_add(1, Ordering::SeqCst);
                            seen.notify_one();
                        }
                        let reply = handler(&call);
                        recorded.lock().unwrap().push(call);
                        events.notify_one();
                        tokio::time::sleep(reply.delay).await;
                        let mut response: Response = (reply.status, reply.body).into_response();
                        if let Some(etag) = reply.etag {
                            response.headers_mut().insert("etag", etag.parse().unwrap());
                        }
                        for (name, value) in reply.headers {
                            response.headers_mut().insert(name, value.parse().unwrap());
                        }
                        response
                    }
                },
            )
            .layer(DefaultBodyLimit::disable());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap().to_string();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        Self {
            address,
            calls,
            puts,
            put_seen,
            changed,
        }
    }
    pub fn base(&self) -> String {
        format!("http://{}", self.address)
    }
    pub fn calls(&self) -> Vec<Call> {
        self.calls.lock().unwrap().clone()
    }
}
