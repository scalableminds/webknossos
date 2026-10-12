//! DSMeshController's file list, merged chunk list and opaque chunk-data routes.
use super::helpers::{QueryFields, dataset_id, validated_body};
use crate::{
    AppState,
    access::{AccessResult, TokenContext, UserAccessRequest},
    controller,
    error::DsError,
    models::{
        StaticLayer, UsableDataSource,
        datasource::read_unsigned_long,
        json::{Fields, JsResult, read_i32, read_i64, read_list, read_string},
    },
    services::{
        mesh_file::{ChunkRequest, MeshFileService},
        segment_index::segment_ids_for_agglomerate_id_if_needed,
    },
};
use axum::{
    Json, Router,
    extract::{Path, RawQuery, State, rejection::JsonRejection},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde_json::Value;
pub fn router() -> Router<AppState> {
    controller(
        Router::new()
            .route(
                "/data/datasets/{datasetId}/layers/{dataLayerName}/meshes",
                get(list_files),
            )
            .route(
                "/data/datasets/{datasetId}/layers/{dataLayerName}/meshes/chunks",
                post(list_chunks),
            )
            .route(
                "/data/datasets/{datasetId}/layers/{dataLayerName}/meshes/chunks/data",
                post(read_chunks),
            )
            .route(
                "/data/datasets/{datasetId}/layers/{dataLayerName}/meshes/fullMesh.stl",
                post(full_mesh),
            ),
        true,
    )
}
async fn full_mesh(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((id, name)): Path<(String, String)>,
    body: Result<Json<Value>, JsonRejection>,
) -> AccessResult<Response> {
    use crate::services::full_mesh::{FullMeshRequest, FullMeshService};
    let request = match validated_body(body, FullMeshRequest::from_json) {
        Ok(p) => p,
        Err(r) => return Ok(*r),
    };
    let (source, layer) = layer(&state, &tc, &id, &name).await?;
    let id = dataset_id(&id)?;
    let bytes = FullMeshService::load(&state, &id, &source, layer, &request, &tc)
        .await
        .map_err(|e| e.wrap("Could not load mesh chunk for segment."))?;
    Ok(([(header::CONTENT_TYPE, "application/octet-stream")], bytes).into_response())
}
async fn layer(
    state: &AppState,
    tc: &TokenContext,
    id: &str,
    name: &str,
) -> AccessResult<(
    std::sync::Arc<UsableDataSource>,
    std::sync::Arc<StaticLayer>,
)> {
    let id = dataset_id(id)?;
    state
        .access
        .validate_access(UserAccessRequest::read_dataset(&id), tc)
        .await?;
    Ok(state
        .datasets
        .get_with_layer(&id, name)
        .await
        .map_err(|e| e.with_status(StatusCode::NOT_FOUND))?)
}
fn json_response(value: Value) -> Response {
    (
        [(header::CONTENT_TYPE, "application/json")],
        crate::models::json::compact(&value),
    )
        .into_response()
}
async fn list_files(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((id, name)): Path<(String, String)>,
) -> AccessResult<Response> {
    let (source, layer) = layer(&state, &tc, &id, &name).await?;
    let infos = state
        .mesh_files
        .list(&source.id, &layer, tc.user_token.as_deref())
        .await;
    Ok(json_response(
        serde_json::to_value(infos).map_err(DsError::from_exception)?,
    ))
}
struct ListRequest {
    name: String,
    id: u64,
    version: Option<i64>,
}
fn list_request(value: &Value) -> JsResult<ListRequest> {
    let mut f = Fields::new(value);
    let name = f.req("meshFileName", read_string);
    let id = f.req("segmentId", read_unsigned_long);
    let version = f.opt("annotationVersion", read_i64);
    f.finish()?;
    Ok(ListRequest {
        name: name?,
        id: id?,
        version: version?,
    })
}
async fn list_chunks(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((id, name)): Path<(String, String)>,
    RawQuery(raw): RawQuery,
    body: Result<Json<Value>, JsonRejection>,
) -> AccessResult<Response> {
    let body = match validated_body(body, list_request) {
        Ok(p) => p,
        Err(response) => return Ok(*response),
    };
    let q = QueryFields::new(raw);
    let mapping = q.0.get("targetMappingName").map(String::as_str);
    let editable = q.0.get("editableMappingTracingId").map(String::as_str);
    let (source, layer) = layer(&state, &tc, &id, &name).await?;
    let key = MeshFileService::look_up(&source.id, &layer, &body.name)?;
    let file_mapping = state
        .mesh_files
        .mapping_name(&key, tc.user_token.as_deref())
        .await?;
    let segments = segment_ids_for_agglomerate_id_if_needed(
        &state.agglomerates,
        &state.wk_client,
        &state.tracingstore,
        &source.id,
        &layer,
        mapping,
        editable,
        body.version,
        body.id as i64,
        file_mapping.as_deref(),
        false,
        &tc,
    )
    .await?;
    let info = state
        .mesh_files
        .list_chunks(&key, &segments, tc.user_token.as_deref())
        .await?;
    Ok(json_response(
        serde_json::to_value(info).map_err(DsError::from_exception)?,
    ))
}
struct DataRequest {
    name: String,
    requests: Vec<ChunkRequest>,
}
fn chunk_request(value: &Value) -> JsResult<ChunkRequest> {
    let mut f = Fields::new(value);
    let offset = f.req("byteOffset", read_i64);
    let size = f.req("byteSize", read_i32);
    let segment = f.opt("segmentId", read_unsigned_long);
    f.finish()?;
    Ok(ChunkRequest {
        byte_offset: offset?,
        byte_size: size?,
        segment_id: segment?,
    })
}
fn data_request(value: &Value) -> JsResult<DataRequest> {
    let mut f = Fields::new(value);
    let name = f.req("meshFileName", read_string);
    let requests = f.req("requests", |v| read_list(v, chunk_request));
    f.finish()?;
    Ok(DataRequest {
        name: name?,
        requests: requests?,
    })
}
async fn read_chunks(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((id, name)): Path<(String, String)>,
    body: Result<Json<Value>, JsonRejection>,
) -> AccessResult<Response> {
    let body = match validated_body(body, data_request) {
        Ok(p) => p,
        Err(response) => return Ok(*response),
    };
    let (source, layer) = layer(&state, &tc, &id, &name).await?;
    let key = MeshFileService::look_up(&source.id, &layer, &body.name)?;
    let (bytes, encoding) = state
        .mesh_files
        .read_chunks(&key, &body.requests, tc.user_token.as_deref())
        .await
        .map_err(|e| e.wrap("Could not load mesh chunk for segment."))?;
    let mut response =
        ([(header::CONTENT_TYPE, "application/octet-stream")], bytes).into_response();
    if encoding.contains("gzip") {
        response.headers_mut().insert(
            header::CONTENT_ENCODING,
            header::HeaderValue::from_static("gzip"),
        );
    }
    Ok(response)
}
