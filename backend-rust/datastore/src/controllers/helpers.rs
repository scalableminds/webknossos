//! Shared Play-style controller binders, JSON schema validation and state views.
use crate::{
    AppState,
    access::{AccessResult, AccessTokenService, TokenContext, UserAccessRequest},
    error::{DsError, DsResult},
    models::{StaticLayer, UsableDataSource},
    services::DatasetCache,
};
use axum::{
    Json,
    extract::{FromRef, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::Value;
use std::{collections::HashMap, sync::Arc};

pub(crate) fn dataset_id(literal: &str) -> DsResult<String> {
    let candidate = literal.rsplit('-').next().unwrap_or(literal);
    if candidate.len() == 24 && candidate.bytes().all(|b| b.is_ascii_hexdigit()) {
        Ok(candidate.to_ascii_lowercase())
    } else {
        Err(DsError::binding(format!(
            "Cannot parse URI path parameter datasetId with value “{literal}” as ObjectId."
        )))
    }
}

/// Access checks plus the dataset cache: what a route needs to resolve a readable layer.
#[derive(Clone)]
pub(crate) struct DatasetLayers {
    pub(crate) access: AccessTokenService,
    pub(crate) datasets: DatasetCache,
}

impl FromRef<AppState> for DatasetLayers {
    fn from_ref(state: &AppState) -> Self {
        Self {
            access: state.access.clone(),
            datasets: state.datasets.clone(),
        }
    }
}

impl DatasetLayers {
    /// Checks read access to the dataset `id`, then loads it with its layer `layer`
    /// (`404` if either is missing).
    pub(crate) async fn readable(
        &self,
        tc: &TokenContext,
        id: &str,
        layer: &str,
    ) -> AccessResult<(Arc<UsableDataSource>, Arc<StaticLayer>)> {
        let id = dataset_id(id)?;
        self.access
            .validate_access(UserAccessRequest::read_dataset(&id), tc)
            .await?;
        Ok(self
            .datasets
            .get_with_layer(&id, layer)
            .await
            .map_err(|e| e.with_param_status(StatusCode::NOT_FOUND))?)
    }
}

pub(crate) fn validated_body<T>(
    body: Result<Json<Value>, JsonRejection>,
    parse: impl FnOnce(&Value) -> crate::models::JsResult<T>,
) -> Result<T, Box<Response>> {
    let Json(value) = body.map_err(|e| Box::new(crate::binding_errors::json_rejection(e)))?;
    parse(&value).map_err(|e| {
        Box::new(crate::binding_errors::mark_bypass(
            (StatusCode::BAD_REQUEST, Json(e.to_play_json())).into_response(),
        ))
    })
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
            .ok_or_else(|| DsError::binding(format!("Missing parameter: {key}")))
    }
    pub(crate) fn int(&self, key: &str) -> DsResult<i32> {
        let v = self.required(key)?;
        v.parse().map_err(|_| {
            DsError::binding(format!(
                "Cannot parse parameter {key} as Int: For input string: \"{v}\""
            ))
        })
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
                        DsError::binding(format!(
                            "Cannot parse parameter {key} as Boolean: should be true, false, 0 or 1"
                        ))
                    }),
                }
            }
        }
    }
}
