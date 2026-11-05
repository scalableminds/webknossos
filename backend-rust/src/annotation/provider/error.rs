//! Fox failures of the provider (`ProviderError`).
use std::fmt;

use axum::http::StatusCode;

use crate::{
    error::ApiError, stores::client::ServiceError, stores::tracing_client::TracingStoreError,
};

/// A Fox `Failure`/`ParamFailure`: exact message, the `?~>` chain below it
/// (outermost first) and the HTTP status of a ParamFailure, if any.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FoxFailure {
    pub message: String,
    pub chain: Vec<String>,
    pub status: Option<StatusCode>,
}

#[derive(Debug)]
pub enum ProviderError {
    /// `Invalid AnnotationType: <typ>` (Fox failure, default 400).
    InvalidType(String),
    /// Saved annotation missing, deleted or not DAO-readable: Msg.Annotation.notFound.
    NotFound,
    /// `Fox.empty` without a message (e.g. a missing project in compound
    /// restrictions). Routes attach their own message; unwrapped it renders
    /// as 404 Msg.notFound.
    Empty,
    /// Fox failure with its exact Scala message and chain.
    Failure(FoxFailure),
    /// Database or other infrastructure failure, passed through unchanged.
    Api(ApiError),
}

impl fmt::Display for ProviderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidType(typ) => write!(f, "Invalid AnnotationType: {typ}"),
            Self::NotFound => f.write_str(crate::msg::annotation::NOT_FOUND),
            Self::Empty => f.write_str(crate::msg::NOT_FOUND),
            Self::Failure(failure) => f.write_str(&failure.message),
            Self::Api(error) => error.fmt(f),
        }
    }
}
impl std::error::Error for ProviderError {}

impl From<ApiError> for ProviderError {
    fn from(error: ApiError) -> Self {
        Self::Api(error)
    }
}
impl From<sqlx::Error> for ProviderError {
    fn from(error: sqlx::Error) -> Self {
        Self::Api(error.into())
    }
}

/// RPC failures are Fox failures; only an unsuccessful upstream HTTP status
/// is kept as ParamFailure status (RPCRequest `~> result.status`).
impl From<ServiceError> for ProviderError {
    fn from(error: ServiceError) -> Self {
        let status = match &error {
            ServiceError::UpstreamStatus(code) => StatusCode::from_u16(*code).ok(),
            _ => None,
        };
        Self::Failure(FoxFailure {
            message: error.to_string(),
            chain: Vec::new(),
            status,
        })
    }
}
impl From<TracingStoreError> for ProviderError {
    fn from(error: TracingStoreError) -> Self {
        match error {
            TracingStoreError::Service(error) => error.into(),
            other @ TracingStoreError::InvalidProtobuf => Self::failure(other.to_string()),
        }
    }
}

impl ProviderError {
    /// A plain Fox failure (`Fox.failure(message)`).
    pub(crate) fn failure(message: impl Into<String>) -> Self {
        Self::Failure(FoxFailure {
            message: message.into(),
            chain: Vec::new(),
            status: None,
        })
    }

    /// Fox `~> status` on a failure (ParamFailure).
    pub(crate) fn with_status(self, status: StatusCode) -> Self {
        match self {
            Self::Failure(failure) => Self::Failure(FoxFailure {
                status: Some(status),
                ..failure
            }),
            other => other,
        }
    }

    /// Fox `?~> message`: Empty becomes a plain failure, failures are chained
    /// below the new message keeping a ParamFailure status. Infrastructure
    /// errors are passed through unchanged.
    pub fn wrap(self, message: &str) -> Self {
        let (chain, status) = match self {
            Self::Api(error) => return Self::Api(error),
            Self::Empty => (Vec::new(), None),
            Self::Failure(FoxFailure {
                message: inner,
                mut chain,
                status,
            }) => {
                chain.insert(0, inner);
                (chain, status)
            }
            other @ (Self::InvalidType(_) | Self::NotFound) => (vec![other.to_string()], None),
        };
        Self::Failure(FoxFailure {
            message: message.to_owned(),
            chain,
            status,
        })
    }

    /// The Fox chain below the top-level message (outermost first).
    pub fn chain(&self) -> &[String] {
        match self {
            Self::Failure(failure) => &failure.chain,
            _ => &[],
        }
    }

    /// Fox semantics with an explicit route status (`~> status`): the status
    /// replaces any ParamFailure status and also applies to failures that
    /// would otherwise default to 400. Infrastructure errors keep their own
    /// status. Use `ApiError::from` for routes without `~>`.
    pub fn into_api_error(self, failure_status: StatusCode) -> ApiError {
        match self {
            Self::Api(error) => error,
            other => ApiError::new(failure_status, other.to_string()),
        }
    }
}

impl From<ProviderError> for ApiError {
    /// Play's default rendering: Failure → 400, ParamFailure → its status,
    /// Empty → 404 Msg.notFound.
    fn from(error: ProviderError) -> Self {
        match error {
            ProviderError::Api(error) => error,
            ProviderError::Empty => ApiError::new(StatusCode::NOT_FOUND, crate::msg::NOT_FOUND),
            ProviderError::Failure(FoxFailure {
                message, status, ..
            }) => ApiError::new(status.unwrap_or(StatusCode::BAD_REQUEST), message),
            other => ApiError::new(StatusCode::BAD_REQUEST, other.to_string()),
        }
    }
}
