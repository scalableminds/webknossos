//! Shared Play-style controller binders and JSON schema validation.
use crate::error::{DsError, DsResult};
use axum::{
    Json,
    extract::rejection::JsonRejection,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::Value;
use std::collections::HashMap;

pub(crate) fn dataset_id(literal: &str) -> DsResult<String> {
    let candidate = literal.rsplit('-').next().unwrap_or(literal);
    if candidate.len() == 24 && candidate.bytes().all(|b| b.is_ascii_hexdigit()) {
        Ok(candidate.to_ascii_lowercase())
    } else {
        Err(DsError::failure(format!(
            "Cannot parse URI path parameter datasetId with value “{literal}” as ObjectId."
        )))
    }
}

pub(crate) fn validated_body<T>(
    body: Result<Json<Value>, JsonRejection>,
    parse: impl FnOnce(&Value) -> crate::models::JsResult<T>,
) -> Result<T, Box<Response>> {
    let Json(value) = body.map_err(|e| Box::new(e.into_response()))?;
    parse(&value)
        .map_err(|e| Box::new((StatusCode::BAD_REQUEST, Json(e.to_play_json())).into_response()))
}

pub(crate) struct QueryFields(pub(crate) HashMap<String, String>);
impl QueryFields {
    pub(crate) fn new(raw: Option<String>) -> Self {
        let mut fields = HashMap::new();
        if let Some(raw) = raw {
            for (k, v) in url::form_urlencoded::parse(raw.as_bytes()) {
                // Play binds the first query value, including duplicate fields.
                fields
                    .entry(k.into_owned())
                    .or_insert_with(|| v.into_owned());
            }
        }
        Self(fields)
    }
    pub(crate) fn required(&self, key: &str) -> DsResult<&str> {
        self.0
            .get(key)
            .map(String::as_str)
            .ok_or_else(|| DsError::failure(format!("Missing parameter: {key}")))
    }
    pub(crate) fn int(&self, key: &str) -> DsResult<i32> {
        let v = self.required(key)?;
        v.parse()
            .map_err(|_| DsError::failure(format!("Cannot parse parameter {key} as Int: '{v}'")))
    }
    pub(crate) fn bool_or_false(&self, key: &str) -> DsResult<bool> {
        match self.0.get(key).map(String::as_str) {
            None => Ok(false),
            Some(v) => {
                let trimmed = v.trim();
                match trimmed {
                    "true" => Ok(true),
                    "false" => Ok(false),
                    _ => trimmed.parse::<i32>().map(|v| v != 0).map_err(|_| {
                        DsError::failure(format!(
                            "Cannot parse parameter {key} as Boolean: should be true, false, 0 or 1"
                        ))
                    }),
                }
            }
        }
    }
}
