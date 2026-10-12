//! A mock WEBKNOSSOS main application that records every RPC and answers via a closure.
#![allow(dead_code)]

use std::{
    net::SocketAddr,
    path::Path,
    sync::{Arc, Mutex},
};

use axum::{
    Router,
    body::Bytes,
    http::{HeaderMap, Method, StatusCode, Uri, header},
    response::{IntoResponse, Response},
};
use webknossos_datastore::config::{DatastoreConfig, Secret};

pub const KEY: &str = "secret-ds-key";

#[derive(Clone, Debug)]
pub struct Call {
    pub method: String,
    pub path: String,
    pub query: Vec<(String, String)>,
    pub content_type: Option<String>,
    pub body: Vec<u8>,
}

impl Call {
    pub fn json(&self) -> serde_json::Value {
        serde_json::from_slice(&self.body).unwrap()
    }

    pub fn query_value(&self, name: &str) -> Option<String> {
        self.query
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, v)| v.clone())
    }
}

pub struct Reply {
    status: StatusCode,
    content_type: &'static str,
    body: Vec<u8>,
}

impl Reply {
    pub fn json(status: StatusCode, body: serde_json::Value) -> Self {
        Self {
            status,
            content_type: "application/json",
            body: serde_json::to_vec(&body).unwrap(),
        }
    }

    pub fn text(status: StatusCode, body: &str) -> Self {
        Self {
            status,
            content_type: "text/plain",
            body: body.as_bytes().to_vec(),
        }
    }
}

type Handler = Arc<dyn Fn(&Call) -> Reply + Send + Sync>;

pub struct MockWk {
    addr: SocketAddr,
    calls: Arc<Mutex<Vec<Call>>>,
}

impl MockWk {
    pub async fn start(handler: impl Fn(&Call) -> Reply + Send + Sync + 'static) -> Self {
        let calls: Arc<Mutex<Vec<Call>>> = Arc::default();
        let handler: Handler = Arc::new(handler);
        let recorded = calls.clone();
        let app = Router::new().fallback(
            move |method: Method, uri: Uri, headers: HeaderMap, body: Bytes| {
                let recorded = recorded.clone();
                let handler = handler.clone();
                async move {
                    let call = Call {
                        method: method.to_string(),
                        path: uri.path().to_owned(),
                        query: uri
                            .query()
                            .map(|q| {
                                url::form_urlencoded::parse(q.as_bytes())
                                    .map(|(n, v)| (n.into_owned(), v.into_owned()))
                                    .collect()
                            })
                            .unwrap_or_default(),
                        content_type: headers
                            .get(header::CONTENT_TYPE)
                            .map(|v| v.to_str().unwrap().to_owned()),
                        body: body.to_vec(),
                    };
                    let reply = handler(&call);
                    recorded.lock().unwrap().push(call);
                    let response: Response = (
                        reply.status,
                        [(header::CONTENT_TYPE, reply.content_type)],
                        reply.body,
                    )
                        .into_response();
                    response
                }
            },
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        Self { addr, calls }
    }

    pub fn uri(&self) -> String {
        format!("http://{}", self.addr)
    }

    pub fn calls(&self) -> Vec<Call> {
        self.calls.lock().unwrap().clone()
    }

    /// Default datastore config pointing at this mock (name `test-ds`, key [`KEY`]).
    pub fn config(&self) -> DatastoreConfig {
        let mut config = DatastoreConfig::defaults(Path::new("/srv/wk"));
        config.name = "test-ds".into();
        config.key = Secret::new(KEY);
        config.webknossos.uri = self.uri();
        config
    }
}
