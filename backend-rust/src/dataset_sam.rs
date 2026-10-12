//! POST /datasets/{id}/layers/{layer}/segmentAnythingMask (WKRemoteSegmentAnythingClient).
use axum::{
    Extension, Router,
    extract::State,
    http::{HeaderValue, header},
    response::{IntoResponse, Response},
    routing::post,
};
use reqwest::Method;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{
    AppState,
    auth::AuthUser,
    dataset_lifecycle,
    dataset_options::DatasetRouteConfig,
    dataset_source,
    error::{ApiError, ApiResult},
    extract::{Json as RequestJson, Path, Query},
    id::PathObjectId,
    service_clients::ServiceClients,
};

pub fn router(config: DatasetRouteConfig) -> Router<AppState> {
    Router::new()
        .route(
            "/datasets/{datasetId}/layers/{layer}/segmentAnythingMask",
            post(segment_anything_mask),
        )
        .layer(Extension(config))
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct IntensityQuery {
    intensity_min: Option<f32>,
    intensity_max: Option<f32>,
}

#[derive(Deserialize, PartialEq, Eq, Clone, Copy)]
enum Interaction {
    #[serde(rename = "BOUNDING_BOX")]
    BoundingBox,
    #[serde(rename = "POINT")]
    Point,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MaskParameters {
    mag: [i32; 3],
    surrounding_bounding_box: Value,
    additional_coordinates: Option<Vec<Value>>,
    interaction_type: Interaction,
    selection_top_left_x: Option<i32>,
    selection_top_left_y: Option<i32>,
    selection_bottom_right_x: Option<i32>,
    selection_bottom_right_y: Option<i32>,
    point_x: Option<i32>,
    point_y: Option<i32>,
}

fn element_class_byte(element_class: &str) -> u8 {
    match element_class {
        "uint8" => 0,
        "uint16" => 1,
        "uint24" => 2,
        "uint32" => 3,
        "uint64" => 4,
        "float" => 5,
        "double" => 6,
        "int8" => 7,
        "int16" => 8,
        "int32" => 9,
        _ => 10,
    }
}

/// MathUtils.ceilDiv with JVM Int overflow semantics (never panics).
fn ceil_div(num: i32, divisor: i32) -> i32 {
    let sign = num.signum() * divisor.signum();
    sign.wrapping_mul(
        num.wrapping_abs()
            .wrapping_add(divisor.wrapping_abs())
            .wrapping_sub(1),
    )
    .wrapping_div(divisor.wrapping_abs())
}

/// The SAM request payload: little-endian metadata header followed by the image.
fn mask_request(
    image: &[u8],
    element_class: &str,
    parameters: &MaskParameters,
    shape: [i32; 3],
    intensity: (Option<f32>, Option<f32>),
) -> Vec<u8> {
    let mut buffer = Vec::with_capacity(image.len() + 64);
    buffer.push(element_class_byte(element_class));
    buffer.push(u8::from(intensity.0.is_some() && intensity.1.is_some()));
    buffer.extend_from_slice(&intensity.0.unwrap_or(0.0).to_le_bytes());
    buffer.extend_from_slice(&intensity.1.unwrap_or(0.0).to_le_bytes());
    if parameters.interaction_type == Interaction::BoundingBox {
        buffer.push(0);
        for value in [
            parameters.selection_top_left_x,
            parameters.selection_top_left_y,
            parameters.selection_bottom_right_x,
            parameters.selection_bottom_right_y,
        ] {
            buffer.extend_from_slice(&value.unwrap_or(0).to_le_bytes());
        }
    } else {
        buffer.push(1);
        for value in [parameters.point_x, parameters.point_y] {
            buffer.extend_from_slice(&value.unwrap_or(0).to_le_bytes());
        }
    }
    for dimension in shape {
        buffer.extend_from_slice(&dimension.to_le_bytes());
    }
    buffer.extend_from_slice(image);
    buffer
}

async fn segment_anything_mask(
    State(state): State<AppState>,
    user: AuthUser,
    Path((id, layer_name)): Path<(PathObjectId, String)>,
    Query(query): Query<IntensityQuery>,
    Extension(config): Extension<DatasetRouteConfig>,
    Extension(clients): Extension<ServiceClients>,
    RequestJson(parameters): RequestJson<MaskParameters>,
) -> ApiResult<Response> {
    let bbox = dataset_source::bounding_box(&parameters.surrounding_bounding_box)
        .map_err(dataset_source::invalid_body)?;
    if let Some(coordinates) = &parameters.additional_coordinates
        && !coordinates.iter().all(|c| {
            c["name"].is_string()
                && c.get("value")
                    .is_some_and(|v| dataset_source::int(v).is_ok())
        })
    {
        return Err(ApiError::bad_request("Invalid JSON request body."));
    }
    if !config.segment_anything_enabled {
        return Err(ApiError::bad_request(
            "AI-based quick select is not enabled for this WEBKNOSSOS instance.",
        ));
    }
    if config.segment_anything.uri.is_empty() {
        return Err(ApiError::bad_request("No URI for SAM server configured."));
    }
    let record = dataset_lifecycle::require_readable(&state, &user, &id).await?;
    if !record.is_usable {
        return Err(ApiError::bad_request(format!(
            "Dataset “{id}” is not imported or incomplete."
        )));
    }
    let source = dataset_source::load(&state.pool, id.as_str()).await?;
    let layer = source
        .layers
        .iter()
        .find(|l| l.name == layer_name)
        .ok_or_else(|| ApiError::bad_request("Dataset has no data layers."))?;
    let store_url = record.store_url()?;
    let mag = parameters.mag;
    if mag.iter().any(|m| *m <= 0) {
        return Err(ApiError::bad_request("Invalid JSON request body."));
    }
    // BoundingBox./ : floor-less Int division for topLeft, ceilDiv for the size.
    let size: [i32; 3] = std::array::from_fn(|i| ceil_div(bbox[i + 3], mag[i]));
    let mut sorted = size;
    sorted.sort_unstable();
    let size_text = format!("({}, {}, {})", size[0], size[1], size[2]);
    if !(sorted[2] <= 1024 && sorted[1] <= 1024) {
        return Err(ApiError::bad_request(format!(
            "Target-mag selected bbox must be smaller than 1024×1024×depth (or transposed), got {size_text}"
        )));
    }
    if sorted[0] > 50 {
        return Err(ApiError::bad_request(
            "Target-mag selected bbox depth must be at most 50",
        ));
    }
    if sorted[2] != sorted[1] {
        return Err(ApiError::bad_request(format!(
            "Target-mag selected bbox must equally sized long edges, got {size_text}"
        )));
    }
    if parameters.interaction_type == Interaction::BoundingBox
        && !(parameters.selection_top_left_x.is_some()
            && parameters.selection_top_left_y.is_some()
            && parameters.selection_bottom_right_x.is_some()
            && parameters.selection_bottom_right_y.is_some())
    {
        return Err(ApiError::bad_request(
            "Missing selectionTopLeft and selectionBottomRight parameters for bounding box interaction.",
        ));
    }
    if parameters.interaction_type == Interaction::Point
        && !(parameters.point_x.is_some() && parameters.point_y.is_some())
    {
        return Err(ApiError::bad_request(
            "Missing pointX and pointY parameters for point interaction.",
        ));
    }
    let mut cuboid = json!({"position": [bbox[0], bbox[1], bbox[2]], "cubeSize": size, "mag": mag});
    if let Some(coordinates) = &parameters.additional_coordinates {
        cuboid["additionalCoordinates"] = json!(coordinates);
    }
    let data = clients
        .request(
            Method::POST,
            store_url,
            &[
                "data",
                "datasets",
                id.as_str(),
                "layers",
                &layer.name,
                "readData",
            ],
            &[],
            Some(&cuboid),
        )
        .await
        .map_err(|error| {
            tracing::warn!(%error, "Loading SAM input data failed");
            ApiError::bad_request("Could not get image data to send to SAM server.")
        })?;
    if matches!(layer.element_class.as_str(), "float" | "double")
        && !(query.intensity_min.is_some() && query.intensity_max.is_some())
    {
        return Err(ApiError::bad_request(
            "For float and double data, a supplied intensity range is required.",
        ));
    }
    let payload = mask_request(
        &data.bytes,
        &layer.element_class,
        &parameters,
        size,
        (query.intensity_min, query.intensity_max),
    );
    let sam = &config.segment_anything;
    let auth = (!sam.user.is_empty()).then_some((sam.user.as_str(), sam.password.as_str()));
    let mask = clients
        .post_bytes_external(&sam.uri, &["predict"], auth, payload)
        .await
        .map_err(|error| {
            tracing::warn!(%error, "SAM mask request failed");
            ApiError::bad_request("Could not get image mask from SAM server.")
        })?;
    Ok((
        [(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/octet-stream"),
        )],
        mask.bytes,
    )
        .into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sam_payload_layout_matches_scala_buffer() {
        let parameters = MaskParameters {
            mag: [1, 1, 1],
            surrounding_bounding_box: Value::Null,
            additional_coordinates: None,
            interaction_type: Interaction::Point,
            selection_top_left_x: None,
            selection_top_left_y: None,
            selection_bottom_right_x: None,
            selection_bottom_right_y: None,
            point_x: Some(3),
            point_y: Some(-1),
        };
        let payload = mask_request(
            &[9, 9],
            "float",
            &parameters,
            [4, 5, 6],
            (Some(1.5), Some(2.0)),
        );
        let mut expected = vec![5, 1];
        expected.extend(1.5_f32.to_le_bytes());
        expected.extend(2.0_f32.to_le_bytes());
        expected.push(1);
        expected.extend(3_i32.to_le_bytes());
        expected.extend((-1_i32).to_le_bytes());
        for v in [4_i32, 5, 6] {
            expected.extend(v.to_le_bytes());
        }
        expected.extend([9, 9]);
        assert_eq!(payload, expected);
        assert_eq!(ceil_div(7, 2), 4);
        assert_eq!(ceil_div(-7, 2), -4);
        assert_eq!(ceil_div(i32::MAX, 2), i32::MIN / 2);
        assert_eq!(ceil_div(i32::MIN, 3), 715_827_882);
    }
}
