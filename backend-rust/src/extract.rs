//! Keep extractor errors in the API's JSON error envelope.
use crate::error::ApiError;
use axum::{
    extract::{FromRequest, FromRequestParts, Request},
    http::request::Parts,
};
use serde::de::DeserializeOwned;

pub struct Json<T>(pub T);
pub struct Path<T>(pub T);
pub struct Query<T>(pub T);

impl<S: Send + Sync, T: DeserializeOwned> FromRequest<S> for Json<T> {
    type Rejection = ApiError;
    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        axum::Json::<T>::from_request(req, state)
            .await
            .map(|v| Self(v.0))
            .map_err(|e| {
                ApiError::new(
                    if e.status() == axum::http::StatusCode::UNPROCESSABLE_ENTITY {
                        axum::http::StatusCode::BAD_REQUEST
                    } else {
                        e.status()
                    },
                    "Invalid JSON request body.",
                )
            })
    }
}
impl<S: Send + Sync, T: DeserializeOwned + Send> FromRequestParts<S> for Path<T> {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        axum::extract::Path::<T>::from_request_parts(parts, state)
            .await
            .map(|v| Self(v.0))
            .map_err(|_| ApiError::bad_request("Invalid path parameters."))
    }
}
impl<S: Send + Sync, T: DeserializeOwned> FromRequestParts<S> for Query<T> {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        axum::extract::Query::<T>::from_request_parts(parts, state)
            .await
            .map(|v| Self(v.0))
            .map_err(|_| ApiError::bad_request("Invalid query parameters."))
    }
}
