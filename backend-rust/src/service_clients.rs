//! Bounded HTTP calls to the existing datastore/tracing-store services.
//! Service URLs, tokens and upstream response bodies never enter error output.
use std::{fmt, time::Duration};

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use futures_util::StreamExt;
use reqwest::{Client, Method, redirect::Policy};
use serde::de::DeserializeOwned;
use serde_json::Value;
use subtle::ConstantTimeEq;
use url::Url;

use crate::{error::ApiError, id::ObjectId};

/// `ExtendedController.protobufMimeType`, sent by `RPCRequest.postProto`.
pub const PROTOBUF_CONTENT_TYPE: &str = "application/x-protobuf";

#[derive(Clone)]
pub struct ServiceClientConfig {
    pub request_timeout: Duration,
    pub connect_timeout: Duration,
    pub max_response_bytes: usize,
    pub rpc_token: String,
}

impl Default for ServiceClientConfig {
    fn default() -> Self {
        let mut random = [0_u8; 16];
        getrandom::fill(&mut random).expect("Operating system random generator unavailable");
        Self {
            request_timeout: Duration::from_secs(30),
            connect_timeout: Duration::from_secs(5),
            max_response_bytes: 64 * 1024 * 1024,
            rpc_token: URL_SAFE_NO_PAD.encode(random),
        }
    }
}

impl fmt::Debug for ServiceClientConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ServiceClientConfig")
            .field("request_timeout", &self.request_timeout)
            .field("connect_timeout", &self.connect_timeout)
            .field("max_response_bytes", &self.max_response_bytes)
            .field("rpc_token", &"[redacted]")
            .finish()
    }
}

#[derive(Clone)]
pub struct ServiceClients {
    client: Client,
    config: ServiceClientConfig,
}

impl fmt::Debug for ServiceClients {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ServiceClients")
            .field("config", &self.config)
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServiceError {
    InvalidConfiguration,
    InvalidBaseUrl,
    Timeout,
    Connection,
    Transport,
    Redirect,
    UpstreamStatus(u16),
    ResponseTooLarge,
    InvalidJson,
}

impl fmt::Display for ServiceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::InvalidConfiguration => "Invalid service client configuration.",
            Self::InvalidBaseUrl => "Invalid configured service URL.",
            Self::Timeout => "Service request timed out.",
            Self::Connection => "Service connection unavailable.",
            Self::Transport => "Service request failed.",
            Self::Redirect => "Service redirect was rejected.",
            Self::UpstreamStatus(_) => "Service returned an unsuccessful status.",
            Self::ResponseTooLarge => "Service response exceeds the configured limit.",
            Self::InvalidJson => "Service returned an invalid JSON response.",
        };
        f.write_str(message)
    }
}
impl std::error::Error for ServiceError {}

impl From<ServiceError> for ApiError {
    fn from(error: ServiceError) -> Self {
        use axum::http::StatusCode;
        let status = match error {
            ServiceError::Timeout => StatusCode::GATEWAY_TIMEOUT,
            ServiceError::Connection => StatusCode::SERVICE_UNAVAILABLE,
            ServiceError::InvalidConfiguration | ServiceError::InvalidBaseUrl => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
            // RPCRequest preserves unsuccessful upstream HTTP status. Never
            // include upstream bytes or reqwest's URL-bearing error text.
            ServiceError::UpstreamStatus(code) => {
                StatusCode::from_u16(code).unwrap_or(StatusCode::BAD_GATEWAY)
            }
            _ => StatusCode::BAD_GATEWAY,
        };
        Self::new(status, error.to_string())
    }
}

#[derive(Clone)]
pub struct ServiceResponse {
    pub bytes: Vec<u8>,
    pub content_type: Option<String>,
}

impl fmt::Debug for ServiceResponse {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ServiceResponse")
            .field("byte_count", &self.bytes.len())
            .field("has_content_type", &self.content_type.is_some())
            .finish()
    }
}

impl ServiceClients {
    pub fn new(config: ServiceClientConfig) -> Result<Self, ServiceError> {
        if config.request_timeout.is_zero()
            || config.connect_timeout.is_zero()
            || config.max_response_bytes == 0
            || config.rpc_token.is_empty()
            || config.rpc_token.chars().any(char::is_whitespace)
        {
            return Err(ServiceError::InvalidConfiguration);
        }
        // Play WS follows redirects. Restrict them to the original origin and
        // a finite hop count so the service RPC secret cannot cross origins.
        let client = Client::builder()
            .timeout(config.request_timeout)
            .connect_timeout(config.connect_timeout)
            .redirect(Policy::custom(|attempt| {
                if attempt.previous().len() >= 10
                    || attempt
                        .previous()
                        .first()
                        .is_some_and(|original| original.origin() != attempt.url().origin())
                {
                    attempt.error("Service redirect rejected")
                } else {
                    attempt.follow()
                }
            }))
            .build()
            .map_err(|_| ServiceError::InvalidConfiguration)?;
        Ok(Self { client, config })
    }

    /// Compare every byte without revealing secret prefixes in timing or logs.
    pub fn rpc_token_matches(&self, candidate: &str) -> bool {
        self.config
            .rpc_token
            .as_bytes()
            .ct_eq(candidate.as_bytes())
            .into()
    }

    fn target_url(
        &self,
        base: &str,
        segments: &[&str],
        query: &[(&str, String)],
        token: Option<&str>,
    ) -> Result<Url, ServiceError> {
        let mut url = Url::parse(base).map_err(|_| ServiceError::InvalidBaseUrl)?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || query.iter().any(|(key, _)| *key == "token")
        {
            return Err(ServiceError::InvalidBaseUrl);
        }
        url.path_segments_mut()
            .map_err(|_| ServiceError::InvalidBaseUrl)?
            .pop_if_empty()
            .extend(segments);
        {
            let mut pairs = url.query_pairs_mut();
            if let Some(token) = token {
                pairs.append_pair("token", token);
            }
            for (key, value) in query {
                pairs.append_pair(key, value);
            }
        }
        if url.query() == Some("") {
            url.set_query(None);
        }
        Ok(url)
    }

    pub async fn request(
        &self,
        method: Method,
        base: &str,
        segments: &[&str],
        query: &[(&str, String)],
        body: Option<&Value>,
    ) -> Result<ServiceResponse, ServiceError> {
        let url = self.target_url(base, segments, query, Some(&self.config.rpc_token))?;
        let mut request = self.client.request(method, url);
        if let Some(body) = body {
            request = request.json(body);
        }
        self.send(request).await
    }

    /// Like `request`, but authenticates with a caller-supplied (user) token
    /// instead of the process RPC token, as WKRemoteDataStoreClient.exploreRemoteDataset does.
    pub async fn request_with_token(
        &self,
        method: Method,
        base: &str,
        segments: &[&str],
        query: &[(&str, String)],
        token: &str,
        body: Option<&Value>,
    ) -> Result<ServiceResponse, ServiceError> {
        let url = self.target_url(base, segments, query, Some(token))?;
        let mut request = self.client.request(method, url);
        if let Some(body) = body {
            request = request.json(body);
        }
        self.send(request).await
    }

    /// Like `request`, but with a raw byte body and an explicit `Content-Type`
    /// (RPCRequest.postProto & co, see `PROTOBUF_CONTENT_TYPE`). The process
    /// RPC token is attached as `token` query parameter.
    pub async fn request_bytes(
        &self,
        method: Method,
        base: &str,
        segments: &[&str],
        query: &[(&str, String)],
        content_type: &str,
        body: Vec<u8>,
    ) -> Result<ServiceResponse, ServiceError> {
        let content_type = reqwest::header::HeaderValue::from_str(content_type)
            .map_err(|_| ServiceError::InvalidConfiguration)?;
        let url = self.target_url(base, segments, query, Some(&self.config.rpc_token))?;
        let request = self
            .client
            .request(method, url)
            .header(reqwest::header::CONTENT_TYPE, content_type)
            .body(body);
        self.send(request).await
    }

    /// `WKRemoteDataStoreClient.hasSegmentIndexFile`:
    /// `GET {datastore}/data/datasets/{datasetId}/layers/{layer}/hasSegmentIndex`
    /// with a JSON boolean response. Scala's one-minute `AlfuCache` lives in
    /// the client instance, which `AnnotationService.createVolumeTracing`
    /// constructs anew per call, so it never serves a later request; no
    /// cache is kept here either.
    pub async fn has_segment_index(
        &self,
        datastore_url: &str,
        dataset_id: &ObjectId,
        layer_name: &str,
    ) -> Result<bool, ServiceError> {
        self.get_json(
            datastore_url,
            &[
                "data",
                "datasets",
                dataset_id.as_str(),
                "layers",
                layer_name,
                "hasSegmentIndex",
            ],
            &[],
        )
        .await
    }

    /// POST raw bytes to a third-party service (e.g. the Segment Anything
    /// server). The process RPC token is never attached.
    pub async fn post_bytes_external(
        &self,
        base: &str,
        segments: &[&str],
        basic_auth: Option<(&str, &str)>,
        body: Vec<u8>,
    ) -> Result<ServiceResponse, ServiceError> {
        let url = self.target_url(base, segments, &[], None)?;
        let mut request = self
            .client
            .post(url)
            .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
            .body(body);
        if let Some((user, password)) = basic_auth {
            request = request.basic_auth(user, Some(password));
        }
        self.send(request).await
    }

    async fn send(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<ServiceResponse, ServiceError> {
        let operation = async {
            let response = request.send().await.map_err(map_transport_error)?;
            if !response.status().is_success() {
                return Err(ServiceError::UpstreamStatus(response.status().as_u16()));
            }
            if response
                .content_length()
                .is_some_and(|length| length > self.config.max_response_bytes as u64)
            {
                return Err(ServiceError::ResponseTooLarge);
            }
            let content_type = response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .map(str::to_owned);
            let mut stream = response.bytes_stream();
            let mut bytes = Vec::new();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(map_transport_error)?;
                if chunk.len() > self.config.max_response_bytes.saturating_sub(bytes.len()) {
                    return Err(ServiceError::ResponseTooLarge);
                }
                bytes.extend_from_slice(&chunk);
            }
            Ok(ServiceResponse {
                bytes,
                content_type,
            })
        };
        tokio::time::timeout(self.config.request_timeout, operation)
            .await
            .map_err(|_| ServiceError::Timeout)?
    }

    pub async fn get_json<T: DeserializeOwned>(
        &self,
        base: &str,
        segments: &[&str],
        query: &[(&str, String)],
    ) -> Result<T, ServiceError> {
        let response = self
            .request(Method::GET, base, segments, query, None)
            .await?;
        serde_json::from_slice(&response.bytes).map_err(|_| ServiceError::InvalidJson)
    }

    pub async fn post_json<T: DeserializeOwned>(
        &self,
        base: &str,
        segments: &[&str],
        query: &[(&str, String)],
        body: &Value,
    ) -> Result<T, ServiceError> {
        let response = self
            .request(Method::POST, base, segments, query, Some(body))
            .await?;
        serde_json::from_slice(&response.bytes).map_err(|_| ServiceError::InvalidJson)
    }
}

fn map_transport_error(error: reqwest::Error) -> ServiceError {
    if error.is_timeout() {
        ServiceError::Timeout
    } else if error.is_redirect() {
        ServiceError::Redirect
    } else if error.is_connect() {
        ServiceError::Connection
    } else {
        ServiceError::Transport
    }
}
