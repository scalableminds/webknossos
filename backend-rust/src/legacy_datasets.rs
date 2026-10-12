//! Dataset response compatibility for API versions 10–15.
use axum::{
    Extension, Json, Router,
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
    datasets::{self, DatasetFeatures, ListQuery},
    error::{ApiError, ApiResult},
    extract::Query,
};

pub fn router(jobs_enabled: bool) -> Router<AppState> {
    Router::new()
        .route("/datasets", get(list))
        .layer(Extension(DatasetFeatures { jobs_enabled }))
}

async fn list(
    State(state): State<AppState>,
    OptionalAuthUser(user): OptionalAuthUser,
    Query(mut query): Query<ListQuery>,
    Extension(features): Extension<DatasetFeatures>,
) -> ApiResult<Json<Vec<Value>>> {
    // This parameter is only part of the latest compact API contract.
    query.include_annotation_count = None;
    let rows = datasets::list_values(&state.pool, user.as_ref(), &query).await?;
    let result = if query.compact == Some(true) {
        rows
    } else {
        let mut values = Vec::with_capacity(rows.len());
        for row in rows {
            let id = row["id"].as_str().ok_or_else(ApiError::internal)?;
            values.push(
                datasets::full_json(&state.pool, user.as_ref(), id, features.jobs_enabled).await?,
            );
        }
        values
    };
    if let Some(user) = user {
        sqlx::query("UPDATE webknossos.users SET lastActivity = NOW() WHERE _id = $1")
            .bind(user.id)
            .execute(&state.pool)
            .await?;
    }
    Ok(Json(result))
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
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn legacy_segment_ids_preserve_unsafe_uint64_and_other_envelopes() {
        let envelope = |value: &str| json!({"customJsonEncoding":"bigint","value":value});
        let mut value = json!({"dataSource":{"dataLayers":[
            {"largestSegmentId":envelope("9007199254740991")},
            {"largestSegmentId":envelope("9007199254740992")},
            {"largestSegmentId":envelope("18446744073709551615")},
            {"largestSegmentId":envelope("-1")},
            {"largestSegmentId":envelope("18446744073709551616")},
            {"largestSegmentId":12},
            {"other":envelope("42")}
        ]}});
        downgrade_segment_ids(&mut value);
        assert_eq!(
            value["dataSource"]["dataLayers"][0]["largestSegmentId"],
            json!(9_007_199_254_740_991_u64)
        );
        for (index, number) in [
            (1, "9007199254740992"),
            (2, "18446744073709551615"),
            (3, "-1"),
            (4, "18446744073709551616"),
        ] {
            assert_eq!(
                value["dataSource"]["dataLayers"][index]["largestSegmentId"],
                envelope(number)
            );
        }
        assert_eq!(value["dataSource"]["dataLayers"][5]["largestSegmentId"], 12);
        assert_eq!(
            value["dataSource"]["dataLayers"][6]["other"],
            envelope("42")
        );
    }
}
