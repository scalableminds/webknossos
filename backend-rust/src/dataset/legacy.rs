//! Dataset response compatibility for API versions 10–15.
use axum::{
    Json, Router,
    body::{Body, to_bytes},
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
    routing::get,
};
use serde_json::Value;

use crate::{
    AppState,
    auth::OptionalAuthUser,
    dataset::routes::ListQuery,
    error::{ApiError, ApiResult},
    extract::Query,
    state::JobsEnabled,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/datasets", get(list))
        // LegacyApiController.listDatasets wraps its success result in addRemoteOriginHeaders.
        .layer(axum::middleware::map_response(
            crate::util::cors::remote_origin_headers_on_success,
        ))
}

async fn list(
    State(state): State<AppState>,
    OptionalAuthUser(user): OptionalAuthUser,
    Query(mut query): Query<ListQuery>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
) -> ApiResult<Json<Vec<Value>>> {
    // This parameter is only part of the latest compact API contract.
    query.include_annotation_count = None;
    let rows = crate::dataset::routes::list_rows(&state.pool, user.as_ref(), &query).await?;
    let mut values = Vec::with_capacity(rows.len());
    for row in rows {
        values.push(if query.compact == Some(true) {
            serde_json::to_value(row).map_err(|_| ApiError::internal())?
        } else {
            crate::dataset::routes::full_json(&state.pool, user.as_ref(), &row.id, jobs_enabled)
                .await?
        });
    }
    if let Some(user) = user {
        crate::dataset::dataset_dao::touch_user_last_activity(&state.pool, user.id).await?;
    }
    Ok(Json(values))
}

/// Apply only to legacy dataset read/list routes. Other bigint fields retain
/// their native representation, matching LegacyApiController.
pub(crate) async fn downgrade_response(request: Request, next: Next) -> Response {
    let response = next.run(request).await;
    if response.status() != StatusCode::OK {
        return response;
    }
    let (mut parts, body) = response.into_parts();
    let bytes = match to_bytes(body, usize::MAX).await {
        Ok(bytes) => bytes,
        Err(_) => return ApiError::internal().into_response(),
    };
    let mut value: Value = match serde_json::from_slice(&bytes) {
        Ok(value) => value,
        Err(_) => return ApiError::internal().into_response(),
    };
    downgrade_segment_ids(&mut value);
    let bytes = match serde_json::to_vec(&value) {
        Ok(bytes) => bytes,
        Err(_) => return ApiError::internal().into_response(),
    };
    parts.headers.remove(axum::http::header::CONTENT_LENGTH);
    Response::from_parts(parts, Body::from(bytes))
}

fn downgrade_segment_ids(value: &mut Value) {
    match value {
        Value::Array(values) => values.iter_mut().for_each(downgrade_segment_ids),
        Value::Object(fields) => {
            for (key, value) in fields {
                if key == "largestSegmentId"
                    && value["customJsonEncoding"] == "bigint"
                    && let Some(number) =
                        value["value"].as_str().and_then(|s| s.parse::<u64>().ok())
                    && number <= 9_007_199_254_740_991
                {
                    *value = Value::from(number);
                } else {
                    downgrade_segment_ids(value);
                }
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod dataset_legacy_tests;
