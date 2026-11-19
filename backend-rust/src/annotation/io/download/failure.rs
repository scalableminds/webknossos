//! Fox failure helpers.

use axum::http::StatusCode;

use crate::{
    annotation::provider::ProviderError,
    job::submission::{Failure, RunError},
    stores::client::ServiceError,
    stores::tracing_client::TracingStoreError,
};

pub(super) trait RunErrorExt {
    /// `?~> message ~> status` (a lone message when the inner error is Empty).
    fn wrap_status(self, message: &str, status: StatusCode) -> RunError;
}

impl RunErrorExt for RunError {
    fn wrap_status(self, message: &str, status: StatusCode) -> RunError {
        match self {
            RunError::Api(error) => RunError::Api(error),
            RunError::Failure(_) => Failure::with_status(message, status).into(),
        }
    }
}

/// A provider error as Fox failure (infrastructure errors pass through).
pub(super) fn provider_failure(error: ProviderError) -> RunError {
    match error {
        ProviderError::Api(error) => RunError::Api(error),
        ProviderError::Failure(failure) => {
            let mut chain = failure.chain.into_iter().rev();
            let mut built = match chain.next() {
                Some(innermost) => Failure::new(innermost),
                None => {
                    return match failure.status {
                        Some(status) => Failure::with_status(failure.message, status).into(),
                        None => Failure::new(failure.message).into(),
                    };
                }
            };
            for message in chain {
                built = built.wrap(&message);
            }
            built.wrap(&failure.message).into()
        }
        other => Failure::new(other.to_string()).into(),
    }
}

/// RPC failures are Fox failures; an unsuccessful upstream HTTP status is
/// kept as ParamFailure status (RPCRequest `~> result.status`).
pub(super) fn rpc_failure(error: TracingStoreError) -> RunError {
    match &error {
        TracingStoreError::Service(ServiceError::UpstreamStatus(code)) => {
            match StatusCode::from_u16(*code) {
                Ok(status) => Failure::with_status(error.to_string(), status).into(),
                Err(_) => Failure::new(error.to_string()).into(),
            }
        }
        _ => Failure::new(error.to_string()).into(),
    }
}

/// `Fox.empty ?~> message` (or a plain failure).
pub(super) fn fail(message: impl Into<String>) -> RunError {
    Failure::new(message).into()
}

/// `Fox.empty` reaching the controller: 404 Msg.notFound.
pub(super) fn empty() -> RunError {
    Failure::with_status(crate::msg::NOT_FOUND, StatusCode::NOT_FOUND).into()
}

pub(super) fn not_allowed() -> RunError {
    Failure::with_status(crate::msg::NOT_ALLOWED, StatusCode::FORBIDDEN).into()
}
