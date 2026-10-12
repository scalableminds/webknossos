//! BinaryDataController's four data entrypoints. Dataset authorization precedes cache/data access.
use std::{sync::Arc, time::Instant};

use axum::{
    Json, Router,
    extract::{Path, RawQuery, State, rejection::JsonRejection},
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde_json::{Value, json};

use crate::{
    AppState,
    access::{AccessResult, TokenContext, UserAccessRequest},
    controller,
    error::{DsError, DsResult},
    models::{
        Vec3Int,
        data_requests::{
            Cuboid, DataServiceDataRequest, DataServiceRequestSettings, RawCuboidRequest,
            VoxelPosition, WebknossosDataRequest,
        },
    },
    services::{
        DataResponse,
        find_data::{FindDataTarget, Histogram, create_histogram, find_position_with_data},
    },
};

use super::helpers::{QueryFields, dataset_id, validated_body};

const SOURCE_NOT_FOUND: &str =
    "Data source not found on data store server. It may still be initializing.";

pub fn router() -> Router<AppState> {
    controller(
        Router::new()
            .route(
                "/data/datasets/{datasetId}/layers/{dataLayerName}/data",
                get(raw_get).post(webknossos),
            )
            .route(
                "/data/datasets/{datasetId}/layers/{dataLayerName}/readData",
                post(raw_post),
            )
            .route(
                "/data/datasets/{datasetId}/layers/{dataLayerName}/findData",
                get(find_data),
            )
            .route(
                "/data/datasets/{datasetId}/layers/{dataLayerName}/histogram",
                get(histogram),
            )
            .route(
                "/data/datasets/{datasetId}/layers/{dataLayerName}/mappings/{mappingName}",
                get(mapping_json),
            )
            // Axum captures whole segments; Scala's prefix binders are checked in knossos.
            .route(
                "/data/datasets/{datasetId}/layers/{dataLayerName}/{mag}/{x}/{y}/{z}/bucket.raw",
                get(knossos),
            ),
        true,
    )
}

async fn webknossos(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((id, layer)): Path<(String, String)>,
    body: Result<Json<Value>, JsonRejection>,
) -> AccessResult<Response> {
    let id = dataset_id(&id)?;
    let requests = match validated_body(body, |v| {
        crate::models::json::read_list(v, WebknossosDataRequest::from_json)
    }) {
        Ok(r) => r,
        Err(response) => return Ok(*response),
    };
    state
        .access
        .validate_access(UserAccessRequest::read_dataset(&id), &tc)
        .await?;
    let started = Instant::now();
    let (source, layer) = state
        .datasets
        .get_with_layer(&id, &layer)
        .await
        .map_err(|e| e.wrap(SOURCE_NOT_FOUND).with_status(StatusCode::NOT_FOUND))?;
    let requests = requests
        .iter()
        .map(|r| {
            Ok(DataServiceDataRequest {
                dataset_id: Some(id.clone()),
                data_source_id: Some(source.id.clone()),
                data_layer: Arc::clone(&layer),
                cuboid: r.cuboid()?,
                settings: r.settings(),
            })
        })
        .collect::<DsResult<Vec<_>>>()?;
    let result = state
        .binary_data
        .handle_data_requests(&requests, tc.user_token.as_deref())
        .await;
    if started.elapsed().as_secs() > 10 {
        tracing::info!(dataset=%id, layer=%layer.name, elapsed=?started.elapsed(),
            request_count=requests.len(), "Complete data request was slow");
    }
    Ok(data_response(result))
}

async fn raw_post(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((id, layer)): Path<(String, String)>,
    body: Result<Json<Value>, JsonRejection>,
) -> AccessResult<Response> {
    let id = dataset_id(&id)?;
    let request = match validated_body(body, RawCuboidRequest::from_json) {
        Ok(r) => r,
        Err(response) => return Ok(*response),
    };
    state
        .access
        .validate_access(UserAccessRequest::read_dataset(&id), &tc)
        .await?;
    let (source, layer) = state
        .datasets
        .get_with_layer(&id, &layer)
        .await
        .map_err(|e| e.with_status(StatusCode::NOT_FOUND))?;
    let request = DataServiceDataRequest {
        dataset_id: Some(id),
        data_source_id: Some(source.id.clone()),
        data_layer: layer,
        cuboid: request.cuboid()?,
        settings: request.settings(),
    };
    Ok(data_response(
        state
            .binary_data
            .handle_data_requests(&[request], tc.user_token.as_deref())
            .await,
    ))
}

async fn raw_get(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((id, layer)): Path<(String, String)>,
    RawQuery(raw): RawQuery,
) -> AccessResult<Response> {
    let id = dataset_id(&id)?;
    let q = QueryFields::new(raw);
    let position = Vec3Int::new(q.int("x")?, q.int("y")?, q.int("z")?);
    let size = Vec3Int::new(q.int("width")?, q.int("height")?, q.int("depth")?);
    let literal = q.required("mag")?;
    let half_byte = q.bool_or_false("halfByte")?;
    state
        .access
        .validate_access(UserAccessRequest::read_dataset(&id), &tc)
        .await?;
    let (source, layer) = state
        .datasets
        .get_with_layer(&id, &layer)
        .await
        .map_err(|e| e.with_status(StatusCode::NOT_FOUND))?;
    let mag = Vec3Int::from_mag_literal(literal, false)
        .ok_or_else(|| DsError::failure(format!("Invalid mag “{literal}”. Please use “x-y-z”.")))?;
    let request = DataServiceDataRequest {
        dataset_id: Some(id),
        data_source_id: Some(source.id.clone()),
        data_layer: layer,
        cuboid: Cuboid::new(VoxelPosition::new(position, mag)?, size),
        settings: DataServiceRequestSettings {
            half_byte,
            applied_agglomerate: q.0.get("mappingName").cloned(),
            ..Default::default()
        },
    };
    Ok(data_response(
        state
            .binary_data
            .handle_data_requests(&[request], tc.user_token.as_deref())
            .await,
    ))
}

fn prefixed_int(segment: &str, prefix: &str) -> DsResult<i32> {
    let v = segment
        .strip_prefix(prefix)
        .ok_or_else(DsError::route_not_found)?;
    v.parse().map_err(|_| {
        DsError::failure(format!(
            "Cannot parse URI path parameter {prefix} with value “{v}” as Int."
        ))
    })
}

async fn knossos(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((id, layer, mag, x, y, z)): Path<(String, String, String, String, String, String)>,
    RawQuery(raw): RawQuery,
) -> AccessResult<Response> {
    let id = dataset_id(&id)?;
    let mag = prefixed_int(&mag, "mag")?;
    let index = Vec3Int::new(
        prefixed_int(&x, "x")?,
        prefixed_int(&y, "y")?,
        prefixed_int(&z, "z")?,
    );
    let size = QueryFields::new(raw).int("cubeSize")?;
    state
        .access
        .validate_access(UserAccessRequest::read_dataset(&id), &tc)
        .await?;
    let (source, layer) = state
        .datasets
        .get_with_layer(&id, &layer)
        .await
        .map_err(|e| e.wrap(SOURCE_NOT_FOUND).with_status(StatusCode::NOT_FOUND))?;
    let scale = size
        .checked_mul(mag)
        .ok_or_else(|| DsError::failure("Knossos bucket position overflows Int."))?;
    let coord = |v: i32| {
        v.checked_mul(scale)
            .ok_or_else(|| DsError::failure("Knossos bucket position overflows Int."))
    };
    let position = Vec3Int::new(coord(index.x)?, coord(index.y)?, coord(index.z)?);
    let request = DataServiceDataRequest {
        dataset_id: Some(id),
        data_source_id: Some(source.id.clone()),
        data_layer: layer,
        cuboid: Cuboid::new(
            VoxelPosition::new(position, Vec3Int::full(mag))?,
            Vec3Int::full(size),
        ),
        settings: DataServiceRequestSettings::default(),
    };
    Ok(data_response(
        state
            .binary_data
            .handle_data_requests(&[request], tc.user_token.as_deref())
            .await,
    ))
}

async fn find_data(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((id, layer)): Path<(String, String)>,
) -> AccessResult<Json<Value>> {
    let id = dataset_id(&id)?;
    state
        .access
        .validate_access(UserAccessRequest::read_dataset(&id), &tc)
        .await?;
    let (source, layer) = state
        .datasets
        .get_with_layer(&id, &layer)
        .await
        .map_err(|e| e.wrap(SOURCE_NOT_FOUND).with_status(StatusCode::NOT_FOUND))?;
    let target = FindDataTarget {
        dataset_id: &id,
        data_source_id: &source.id,
        layer: &layer,
    };
    let found =
        find_position_with_data(&state.binary_data, &target, tc.user_token.as_deref()).await;
    Ok(Json(json!({
        "position": found.map(|(position, _)| position),
        "mag": found.map(|(_, mag)| mag),
    })))
}

async fn histogram(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((id, layer_name)): Path<(String, String)>,
) -> AccessResult<Json<Vec<Histogram>>> {
    let id = dataset_id(&id)?;
    state
        .access
        .validate_access(UserAccessRequest::read_dataset(&id), &tc)
        .await?;
    let (source, layer) = state
        .datasets
        .get_with_layer(&id, &layer_name)
        .await
        .map_err(|e| {
            e.wrap(format!(
                "Could not generate histogram data: missing layer “{layer_name}”."
            ))
            .with_status(StatusCode::NOT_FOUND)
        })?;
    let target = FindDataTarget {
        dataset_id: &id,
        data_source_id: &source.id,
        layer: &layer,
    };
    let histograms = create_histogram(&state.binary_data, &target, tc.user_token.as_deref())
        .await
        .map_err(|e| {
            e.wrap(format!(
                "Could not generate histogram data for layer “{layer_name}”."
            ))
        })?;
    Ok(Json(histograms))
}

async fn mapping_json(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((id, layer_name, mapping)): Path<(String, String, String)>,
) -> AccessResult<Response> {
    let id = dataset_id(&id)?;
    state
        .access
        .validate_access(UserAccessRequest::read_dataset(&id), &tc)
        .await?;
    let (source, layer) = state
        .datasets
        .get_with_layer(&id, &layer_name)
        .await
        .map_err(|e| e.wrap(SOURCE_NOT_FOUND).with_status(StatusCode::NOT_FOUND))?;
    if !layer.is_segmentation() {
        // Scala `tryo(dataLayer.asInstanceOf[SegmentationLayer]) ?~> Layer.notFound`.
        return Err(DsError::failure(
            "class StaticColorLayer cannot be cast to class SegmentationLayer",
        )
        .wrap(format!("Could not find layer “{layer_name}” in dataset."))
        .into());
    }
    let bases = state.base_dirs.clone();
    let source_id = source.id.clone();
    let bytes = tokio::task::spawn_blocking(move || {
        crate::services::mapping::load_mapping_bytes(&bases, &source_id, &layer_name, &mapping)
    })
    .await
    .map_err(DsError::from_exception)??;
    Ok(([(header::CONTENT_TYPE, "application/octet-stream")], bytes).into_response())
}

fn format_indices(indices: &[usize]) -> String {
    format!(
        "[{}]",
        indices
            .iter()
            .map(usize::to_string)
            .collect::<Vec<_>>()
            .join(", ")
    )
}

fn data_response(result: DataResponse) -> Response {
    let mut legacy = result.missing_indices.clone();
    legacy.extend(&result.failed_indices);
    legacy.sort_unstable();
    let mut response = (
        [(header::CONTENT_TYPE, "application/octet-stream")],
        result.data,
    )
        .into_response();
    for (name, value) in [
        (
            "empty-bucket-indices",
            format_indices(&result.missing_indices),
        ),
        (
            "failure-bucket-indices",
            format_indices(&result.failed_indices),
        ),
        ("missing-buckets", format_indices(&legacy)),
    ] {
        response.headers_mut().insert(
            name,
            HeaderValue::from_str(&value).expect("numeric index header"),
        );
    }
    response.headers_mut().insert(
        header::ACCESS_CONTROL_EXPOSE_HEADERS,
        HeaderValue::from_static("failure-bucket-indices, empty-bucket-indices, MISSING-BUCKETS"),
    );
    response
}
