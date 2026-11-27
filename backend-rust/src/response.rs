//! Typed JSON bodies shared across routes: Play's `messages` envelope (`JsonOk(msg)`,
//! `JsonBadRequest(msg)`) on its own or next to a response body.

use axum::Json;
use serde::Serialize;

/// One entry of Play's `messages` array: `{"success": "…"}` or `{"error": "…"}`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Message {
    Success(String),
    Error(String),
}

/// `{"messages": [...]}`.
#[derive(Debug, Serialize)]
pub struct Messages {
    pub messages: Vec<Message>,
}

impl Messages {
    /// Play `JsonOk(message)`.
    pub fn success(text: impl Into<String>) -> Json<Self> {
        Json(Self {
            messages: vec![Message::Success(text.into())],
        })
    }
}

/// A response body with Play's success message added: `{...body, "messages": [...]}`.
#[derive(Debug, Serialize)]
pub struct WithMessages<T> {
    #[serde(flatten)]
    pub body: T,
    pub messages: Vec<Message>,
}

impl<T> WithMessages<T> {
    /// Play `JsonOk(Json.toJson(body), message)`.
    pub fn success(body: T, text: impl Into<String>) -> Json<Self> {
        Json(Self {
            body,
            messages: vec![Message::Success(text.into())],
        })
    }
}

#[cfg(test)]
mod response_tests;
