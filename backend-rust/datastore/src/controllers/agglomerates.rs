//! DataSourceController agglomerate-file routes (Scala `AgglomerateService`).
use axum::{
    Json, Router,
    body::Bytes,
    extract::{Path, RawQuery, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use prost::Message;
use std::sync::Arc;

use crate::{
    AppState,
    access::{AccessResult, TokenContext},
    controller,
    error::{DsError, DsResult},
    models::datasource::unsigned_long_envelope,
    proto::ListOfLong,
    services::{agglomerate::AgglomerateService, attachment::AttachmentFileKey},
};

use super::helpers::{DatasetLayers, QueryFields};

const PROTOBUF: &str = "application/x-protobuf";

pub fn router() -> Router<AppState> {
    controller(
        Router::new()
            .route(
                "/data/datasets/{datasetId}/layers/{dataLayerName}/agglomerates",
                get(list_agglomerates),
            )
            .route(
                "/data/datasets/{datasetId}/layers/{dataLayerName}/agglomerates/{mappingName}/tree/{agglomerateId}",
                get(agglomerate_tree),
            )
            .route(
                "/data/datasets/{datasetId}/layers/{dataLayerName}/agglomerates/{mappingName}/skeleton/{agglomerateId}",
                get(agglomerate_tree),
            )
            .route(
                "/data/datasets/{datasetId}/layers/{dataLayerName}/agglomerates/{mappingName}/agglomerateGraph/{agglomerateId}",
                get(agglomerate_graph),
            )
            .route(
                "/data/datasets/{datasetId}/layers/{dataLayerName}/agglomerates/{mappingName}/largestAgglomerateId",
                get(largest_agglomerate_id),
            )
            .route(
                "/data/datasets/{datasetId}/layers/{dataLayerName}/agglomerates/{mappingName}/agglomeratesForSegments",
                post(agglomerates_for_segments),
            )
            .route(
                "/data/datasets/{datasetId}/layers/{dataLayerName}/agglomerates/{mappingName}/positionForSegment",
                get(position_for_segment),
            ),
        true,
    )
}

/// Play `PathBindable[Long]`.
fn path_long(name: &str, value: &str) -> DsResult<i64> {
    value.parse().map_err(|_| {
        DsError::failure(format!(
            "Cannot parse URI path parameter {name} with value “{value}” as Long."
        ))
    })
}

async fn file_key(
    layers: &DatasetLayers,
    tc: &TokenContext,
    id: &str,
    layer_name: &str,
    mapping: &str,
) -> AccessResult<AttachmentFileKey> {
    let (source, layer) = layers.readable(tc, id, layer_name).await?;
    Ok(AgglomerateService::look_up(&source.id, &layer, mapping)?)
}

fn protobuf(bytes: Vec<u8>) -> Response {
    ([(header::CONTENT_TYPE, PROTOBUF)], bytes).into_response()
}

async fn list_agglomerates(
    State(layers): State<DatasetLayers>,
    tc: TokenContext,
    Path((id, layer_name)): Path<(String, String)>,
) -> AccessResult<Json<Vec<String>>> {
    let (_, layer) = layers.readable(&tc, &id, &layer_name).await?;
    Ok(Json(AgglomerateService::list_agglomerate_files(&layer)))
}

async fn agglomerate_tree(
    State(layers): State<DatasetLayers>,
    State(agglomerates): State<Arc<AgglomerateService>>,
    tc: TokenContext,
    Path((id, layer_name, mapping, agglomerate)): Path<(String, String, String, String)>,
) -> AccessResult<Response> {
    let agglomerate = path_long("agglomerateId", &agglomerate)?;
    let key = file_key(&layers, &tc, &id, &layer_name, &mapping).await?;
    let skeleton = agglomerates
        .generate_tree(&key, agglomerate, tc.user_token.as_deref())
        .await
        .map_err(|e| e.wrap("Could not generate agglomerate tree."))?;
    Ok(protobuf(skeleton.encode_to_vec()))
}

async fn agglomerate_graph(
    State(layers): State<DatasetLayers>,
    State(agglomerates): State<Arc<AgglomerateService>>,
    tc: TokenContext,
    Path((id, layer_name, mapping, agglomerate)): Path<(String, String, String, String)>,
) -> AccessResult<Response> {
    let agglomerate = path_long("agglomerateId", &agglomerate)?;
    let key = file_key(&layers, &tc, &id, &layer_name, &mapping).await?;
    let graph = agglomerates
        .generate_agglomerate_graph(&key, agglomerate, tc.user_token.as_deref())
        .await
        .map_err(|e| e.wrap("Could not look up an agglomerate graph for requested agglomerate."))?;
    Ok(protobuf(graph.encode_to_vec()))
}

async fn largest_agglomerate_id(
    State(layers): State<DatasetLayers>,
    State(agglomerates): State<Arc<AgglomerateService>>,
    tc: TokenContext,
    Path((id, layer_name, mapping)): Path<(String, String, String)>,
) -> AccessResult<Json<serde_json::Value>> {
    let key = file_key(&layers, &tc, &id, &layer_name, &mapping).await?;
    let largest = agglomerates
        .largest_agglomerate_id(&key, tc.user_token.as_deref())
        .await?;
    Ok(Json(unsigned_long_envelope(largest as u64)))
}

async fn agglomerates_for_segments(
    State(layers): State<DatasetLayers>,
    State(agglomerates): State<Arc<AgglomerateService>>,
    tc: TokenContext,
    Path((id, layer_name, mapping)): Path<(String, String, String)>,
    body: Bytes,
) -> AccessResult<Response> {
    let Ok(request) = ListOfLong::decode(body) else {
        // Play `validateProto` body parser: rejected before the action, so no Action.fox headers.
        return Ok(crate::binding_errors::mark_bypass(
            (StatusCode::BAD_REQUEST, "Invalid protobuf request body").into_response(),
        ));
    };
    let key = file_key(&layers, &tc, &id, &layer_name, &mapping).await?;
    let segment_ids: Vec<i64> = request.items.iter().map(|i| *i as i64).collect();
    let agglomerate_ids = agglomerates
        .agglomerate_ids_for_segment_ids(&key, &segment_ids, tc.user_token.as_deref())
        .await?;
    // Scala answers with the default (octet-stream) content type here.
    Ok((
        [(header::CONTENT_TYPE, "application/octet-stream")],
        ListOfLong {
            items: agglomerate_ids.iter().map(|a| *a as u64).collect(),
        }
        .encode_to_vec(),
    )
        .into_response())
}

async fn position_for_segment(
    State(layers): State<DatasetLayers>,
    State(agglomerates): State<Arc<AgglomerateService>>,
    tc: TokenContext,
    Path((id, layer_name, mapping)): Path<(String, String, String)>,
    RawQuery(raw): RawQuery,
) -> AccessResult<Json<crate::models::Vec3Int>> {
    let q = QueryFields::new(raw);
    let segment = q.required("segmentId")?;
    let segment: i64 = segment.parse().map_err(|_| {
        DsError::failure(format!(
            "Cannot parse parameter segmentId as Long: For input string: \"{segment}\""
        ))
    })?;
    let key = file_key(&layers, &tc, &id, &layer_name, &mapping).await?;
    let position = agglomerates
        .position_for_segment_id(&key, segment, tc.user_token.as_deref())
        .await
        .map_err(|e| {
            e.wrap(format!(
                "Could not read segment position from agglomerate file “{}”.",
                key.attachment.name
            ))
        })?;
    Ok(Json(position))
}
