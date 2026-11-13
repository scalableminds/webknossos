//! Keep extractor errors in the API's JSON error envelope.
use crate::error::ApiError;
use axum::{
    extract::{
        FromRequest, FromRequestParts, Multipart, Request,
        multipart::{MultipartError, MultipartRejection},
    },
    http::{StatusCode, request::Parts},
};
use serde::de::DeserializeOwned;
use std::collections::HashMap;

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
                    crate::msg::request::INVALID_JSON_BODY,
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
            .map_err(|_| ApiError::bad_request(crate::msg::request::INVALID_PATH))
    }
}
impl<S: Send + Sync, T: DeserializeOwned> FromRequestParts<S> for Query<T> {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        axum::extract::Query::<T>::from_request_parts(parts, state)
            .await
            .map(|v| Self(v.0))
            .map_err(|_| ApiError::bad_request(crate::msg::request::INVALID_QUERY))
    }
}

/// Play's `MultipartFormData`: file parts (with a file name) in request order
/// and data parts by name.
pub(crate) struct MultipartBody {
    pub files: Vec<(String, axum::body::Bytes)>,
    pub data_parts: HashMap<String, Vec<String>>,
}

impl MultipartBody {
    /// `dataParts.get(name).flatMap(_.headOption)`.
    pub fn first(&self, name: &str) -> Option<&str> {
        self.data_parts
            .get(name)
            .and_then(|values| values.first())
            .map(String::as_str)
    }
}

/// Buffers a multipart body; malformed input is a 400 with `invalid_message`,
/// an oversized one Play's 413.
pub(crate) async fn read_multipart(
    multipart: Result<Multipart, MultipartRejection>,
    invalid_message: &'static str,
) -> Result<MultipartBody, ApiError> {
    let invalid = || ApiError::bad_request(invalid_message);
    let mut multipart = multipart.map_err(|_| invalid())?;
    let mut body = MultipartBody {
        files: Vec::new(),
        data_parts: HashMap::new(),
    };
    let field_error = |error: MultipartError| {
        if error.status() == StatusCode::PAYLOAD_TOO_LARGE {
            ApiError::new(
                StatusCode::PAYLOAD_TOO_LARGE,
                crate::msg::request::ENTITY_TOO_LARGE,
            )
        } else {
            invalid()
        }
    };
    while let Some(field) = multipart.next_field().await.map_err(field_error)? {
        let name = field.name().unwrap_or_default().to_owned();
        match field.file_name().map(str::to_owned) {
            Some(file_name) => {
                let bytes = field.bytes().await.map_err(field_error)?;
                body.files.push((file_name, bytes));
            }
            None => {
                let text = field.text().await.map_err(field_error)?;
                body.data_parts.entry(name).or_default().push(text);
            }
        }
    }
    Ok(body)
}
