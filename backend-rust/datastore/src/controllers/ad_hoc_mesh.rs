use super::helpers::{dataset_id, validated_body};
use crate::{
    AppState,
    access::{AccessResult, TokenContext, UserAccessRequest},
    controller,
    datareaders::RequestedAdditionalCoordinate,
    models::{
        JsResult, Vec3Double, Vec3Int,
        data_requests::{Cuboid, VoxelPosition},
        datasource::read_unsigned_long,
        json::{Fields, read_bool, read_i64, read_list, read_string},
    },
    services::ad_hoc_mesh::{AdHocMeshRequest, MappingType},
};
use axum::{
    Json, Router,
    extract::{Path, State, rejection::JsonRejection},
    http::{HeaderValue, header},
    response::{IntoResponse, Response},
    routing::post,
};
use serde_json::Value;
pub fn router() -> Router<AppState> {
    controller(
        Router::new().route(
            "/data/datasets/{datasetId}/layers/{dataLayerName}/adHocMesh",
            post(generate),
        ),
        true,
    )
}
struct Request {
    position: Vec3Int,
    mag: Vec3Int,
    shape: Vec3Int,
    segment: u64,
    scale: Vec3Double,
    mapping: Option<String>,
    mapping_type: Option<MappingType>,
    coordinates: Option<Vec<RequestedAdditionalCoordinate>>,
    version: Option<i64>,
    neighbors: bool,
}
fn parse(value: &Value) -> JsResult<Request> {
    let mut f = Fields::new(value);
    let position = f.req("position", Vec3Int::from_json);
    let mag = f.req("mag", Vec3Int::from_json);
    let shape = f.req("cubeSize", Vec3Int::from_json);
    let segment = f.req("segmentId", read_unsigned_long);
    let scale = f.req("voxelSizeFactorInUnit", Vec3Double::from_json);
    let mapping = f.opt("mapping", read_string);
    let mapping_type = f.opt("mappingType", MappingType::from_json);
    let coordinates = f.opt("additionalCoordinates", |v| {
        read_list(v, RequestedAdditionalCoordinate::from_json)
    });
    let version = f.opt("annotationVersion", read_i64);
    let neighbors = f.with_default("findNeighbors", true, read_bool);
    f.finish()?;
    Ok(Request {
        position: position?,
        mag: mag?,
        shape: shape?,
        segment: segment?,
        scale: scale?,
        mapping: mapping?,
        mapping_type: mapping_type?,
        coordinates: coordinates?,
        version: version?,
        neighbors: neighbors?,
    })
}
async fn generate(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((id, name)): Path<(String, String)>,
    body: Result<Json<Value>, JsonRejection>,
) -> AccessResult<Response> {
    let request = match validated_body(body, parse) {
        Ok(p) => p,
        Err(r) => return Ok(*r),
    };
    let id = dataset_id(&id)?;
    state
        .access
        .validate_access(UserAccessRequest::read_dataset(&id), &tc)
        .await?;
    let (source, layer) = state
        .datasets
        .get_with_layer(&id, &name)
        .await
        .map_err(|e| e.with_status(axum::http::StatusCode::NOT_FOUND))?;
    let cuboid = Cuboid::new(
        VoxelPosition::new(request.position, request.mag)?,
        request.shape,
    );
    let (vertices, neighbors) = state
        .ad_hoc_mesh
        .generate(
            AdHocMeshRequest {
                dataset_id: Some(id),
                data_source_id: Some(source.id.clone()),
                layer,
                cuboid,
                segment_id: request.segment,
                voxel_size_factor: request.scale,
                mapping: request.mapping,
                mapping_type: request.mapping_type,
                additional_coordinates: request.coordinates,
                annotation_version: request.version,
                find_neighbors: request.neighbors,
            },
            tc.user_token.as_deref(),
        )
        .await?;
    let bytes: Vec<u8> = vertices.into_iter().flat_map(f32::to_le_bytes).collect();
    let mut response =
        ([(header::CONTENT_TYPE, "application/octet-stream")], bytes).into_response();
    response.headers_mut().insert(
        "neighbors",
        HeaderValue::from_str(&format!(
            "[{}]",
            neighbors
                .iter()
                .map(i32::to_string)
                .collect::<Vec<_>>()
                .join(", ")
        ))
        .expect("numeric neighbors"),
    );
    response.headers_mut().insert(
        header::ACCESS_CONTROL_EXPOSE_HEADERS,
        HeaderValue::from_static("NEIGHBORS"),
    );
    Ok(response)
}
