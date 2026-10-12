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
    pub fn unauthorized() -> Self {
        Self::new(
            StatusCode::UNAUTHORIZED,
            "Authentication required or token invalid.",
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
            sqlx::Error::RowNotFound => Self::not_found("Resource not found."),
            sqlx::Error::PoolTimedOut | sqlx::Error::PoolClosed => {
                Self::service_unavailable("Database unavailable.")
            }
            sqlx::Error::Database(ref db) => {
                // PostgreSQL details can contain tokens, personal data and submitted values.
                let code = db.code();
                match code.as_deref() {
                    Some("23505") => Self::conflict("A resource with these values already exists."),
                    Some("23503") => {
                        Self::conflict("A related resource is missing or still in use.")
                    }
                    Some("23514" | "23502" | "22P02" | "22003" | "22008") => {
                        Self::bad_request("Invalid resource values.")
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
