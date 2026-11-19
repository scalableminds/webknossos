//! Fox failures with chains.
use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use chrono::Utc;
use serde_json::json;

use crate::error::ApiError;

/// A Play/Fox `Failure`: message, optional HTTP status (`~> CODE`, ParamFailure)
/// and the failure it wraps (`?~>`). Rendered like ExtendedController.asResult:
/// `{"messages": [{"error": message}, {"chain": "[Server Time …] cause <~ …"}]}`.
#[derive(Debug)]
pub(crate) struct Failure {
    message: String,
    pub(super) status: Option<StatusCode>,
    pub(super) cause: Option<Box<Failure>>,
}

impl Failure {
    pub(crate) fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            status: None,
            cause: None,
        }
    }

    pub(crate) fn with_status(message: impl Into<String>, status: StatusCode) -> Self {
        Self {
            status: Some(status),
            ..Self::new(message)
        }
    }

    /// `?~> message`: a ParamFailure keeps its status.
    pub(crate) fn wrap(self, message: &str) -> Self {
        Self {
            message: message.to_owned(),
            status: self.status,
            cause: Some(Box::new(self)),
        }
    }

    /// Formatter.formatFailureChain (ParamFailures append their parameter).
    pub(super) fn format_chain(&self) -> String {
        let mut text = self.message.clone();
        if let Some(status) = self.status {
            text.push(' ');
            text.push_str(&status.as_u16().to_string());
        }
        if let Some(cause) = &self.cause {
            text.push_str(" <~ ");
            text.push_str(&cause.format_chain());
        }
        text
    }
}

/// Either a Fox failure (client error, possibly chained) or a server-side error,
/// which is never wrapped or chained.
#[derive(Debug)]
pub(crate) enum RunError {
    Failure(Failure),
    Api(ApiError),
}

pub(crate) type RunResult<T> = Result<T, RunError>;

impl From<Failure> for RunError {
    fn from(failure: Failure) -> Self {
        Self::Failure(failure)
    }
}

impl From<ApiError> for RunError {
    fn from(error: ApiError) -> Self {
        if error.status.is_client_error() && error.status != StatusCode::UNAUTHORIZED {
            let status = (error.status != StatusCode::BAD_REQUEST).then_some(error.status);
            Self::Failure(Failure {
                message: error.message,
                status,
                cause: None,
            })
        } else {
            Self::Api(error)
        }
    }
}

impl From<sqlx::Error> for RunError {
    fn from(error: sqlx::Error) -> Self {
        Self::Api(error.into())
    }
}

impl RunError {
    /// `?~> message` on a Fox failure; server-side errors stay unwrapped.
    pub(crate) fn wrap(self, message: &str) -> Self {
        match self {
            Self::Failure(failure) => Self::Failure(failure.wrap(message)),
            api => api,
        }
    }
}

impl IntoResponse for RunError {
    fn into_response(self) -> Response {
        match self {
            Self::Api(error) => error.into_response(),
            Self::Failure(failure) => {
                let status = failure.status.unwrap_or(StatusCode::BAD_REQUEST);
                let mut messages = vec![json!({"error": failure.message})];
                if let Some(cause) = &failure.cause {
                    let time = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ");
                    messages.push(json!({
                        "chain": format!("[Server Time {time}] {}", cause.format_chain())
                    }));
                }
                (status, Json(json!({"messages": messages}))).into_response()
            }
        }
    }
}

impl Failure {
    /// `~> CODE` on an existing failure.
    pub(crate) fn with_param(mut self, status: StatusCode) -> Self {
        self.status = Some(status);
        self
    }
}
