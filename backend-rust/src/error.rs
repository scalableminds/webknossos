use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;

pub type ApiResult<T> = Result<T, ApiError>;

#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub message: String,
}

impl ApiError {
    pub fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }
    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, message)
    }
    /// Play's `ErrorHandler.onNotAuthenticated` (also silhouette's secured error handler).
    pub fn unauthorized() -> Self {
        Self::new(
            StatusCode::UNAUTHORIZED,
            crate::msg::user::NOT_AUTHENTICATED,
        )
    }
    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new(StatusCode::FORBIDDEN, message)
    }
    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, message)
    }
    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new(StatusCode::CONFLICT, message)
    }
    pub fn internal() -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, "Internal server error.")
    }
    pub fn service_unavailable(message: impl Into<String>) -> Self {
        Self::new(StatusCode::SERVICE_UNAVAILABLE, message)
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}
impl std::error::Error for ApiError {}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(json!({"messages": [{"error": self.message}]})),
        )
            .into_response()
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(error: sqlx::Error) -> Self {
        match error {
            sqlx::Error::RowNotFound => Self::not_found(crate::msg::request::RESOURCE_NOT_FOUND),
            sqlx::Error::PoolTimedOut | sqlx::Error::PoolClosed => {
                Self::service_unavailable(crate::msg::request::DATABASE_UNAVAILABLE)
            }
            sqlx::Error::Database(ref db) => {
                // PostgreSQL details can contain tokens, personal data and submitted values.
                let code = db.code();
                match code.as_deref() {
                    // Play answers every SQL failure with 400 (and the raw SQL text, which Rust withholds).
                    Some("23505") => {
                        Self::bad_request("A resource with these values already exists.")
                    }
                    Some("23503") => {
                        Self::bad_request("A related resource is missing or still in use.")
                    }
                    Some("23514" | "23502" | "22P02" | "22003" | "22008") => {
                        Self::bad_request(crate::msg::request::INVALID_RESOURCE_VALUES)
                    }
                    Some("40001" | "40P01") => {
                        Self::conflict("Concurrent modification; retry the request.")
                    }
                    _ => {
                        tracing::error!(
                            sqlstate = code.as_deref().unwrap_or("unknown"),
                            "Database request failed"
                        );
                        Self::internal()
                    }
                }
            }
            _ => {
                tracing::error!("Database operation failed");
                Self::internal()
            }
        }
    }
}
