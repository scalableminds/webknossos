//! SegmentStatisticsController: index queries, statistics files and bucket-based statistics.
use axum::{
    Json, Router,
    extract::{Path, State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde_json::{Value, json};

use crate::{
    AppState,
    access::{AccessResult, TokenContext, UserAccessRequest},
    controller,
    datareaders::RequestedAdditionalCoordinate,
    error::{DsError, DsResult},
    models::{
        BUCKET_LENGTH, StaticLayer, UsableDataSource, Vec3Int,
        datasource::{read_unsigned_long, unsigned_long_envelope},
        json::{Fields, JsError, JsResult, read_i64, read_list, read_string},
    },
    services::segment_index::{
        SegmentIndexService, segment_ids_for_agglomerate_id_if_needed,
        top_lefts_to_target_mag_buckets,
    },
    services::{
        agglomerate::AgglomerateService,
        segment_statistics_file::{
            StatisticsFileService, combined_covariance, rescale_volume, weighted_center,
        },
    },
};

use super::helpers::{dataset_id, validated_body};

pub fn router() -> Router<AppState> {
    controller(
        Router::new()
            .route(
                "/data/datasets/{datasetId}/layers/{dataLayerName}/hasSegmentIndex",
                get(has_segment_index),
            )
            .route(
                "/data/datasets/{datasetId}/layers/{dataLayerName}/segmentIndex",
                post(query_segment_index),
            )
            .route(
                "/data/datasets/{datasetId}/layers/{dataLayerName}/segmentIndex/{segmentId}",
                post(segment_index),
            )
            .route("/data/datasets/{datasetId}/layers/{dataLayerName}/segmentStatisticsFile",get(statistics_file_info))
            .route("/data/datasets/{datasetId}/layers/{dataLayerName}/segmentStatistics/volume",post(segment_volume))
            .route("/data/datasets/{datasetId}/layers/{dataLayerName}/segmentStatistics/boundingBox",post(segment_bounding_box))
            .route("/data/datasets/{datasetId}/layers/{dataLayerName}/segmentStatistics/covarianceMatrix",post(segment_covariance))
            .route("/data/datasets/{datasetId}/layers/{dataLayerName}/segmentStatistics/maxDistance",post(segment_max_distance))
            .route("/data/datasets/{datasetId}/layers/{dataLayerName}/segmentStatistics/centerOfMass",post(segment_center))
            .route("/data/datasets/{datasetId}/layers/{dataLayerName}/segmentStatistics/sphericity",post(segment_sphericity))
            .route("/data/datasets/{datasetId}/layers/{dataLayerName}/segmentStatistics/surfaceArea",post(segment_surface_area)),
        true,
    )
}

async fn layer(
    state: &AppState,
    tc: &TokenContext,
    id: &str,
    layer: &str,
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
        .get_with_layer(&id, layer)
        .await
        .map_err(|e| e.with_status(StatusCode::NOT_FOUND))?)
}

async fn has_segment_index(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((id, layer_name)): Path<(String, String)>,
) -> AccessResult<Json<bool>> {
    let (source, layer) = layer(&state, &tc, &id, &layer_name).await?;
    Ok(Json(
        SegmentIndexService::look_up(&source.id, &layer).is_ok(),
    ))
}

/// Scala `GetSegmentIndexParameters` / `GetMultipleSegmentIndexParameters` (fields used here).
struct Parameters {
    segment_ids: Vec<u64>,
    mag: Vec3Int,
    cube_size: Vec3Int,
    mapping_name: Option<String>,
    editable_mapping_tracing_id: Option<String>,
    annotation_version: Option<i64>,
}

fn read_parameters(json: &Value, multiple: bool) -> JsResult<Parameters> {
    read_parameters_mode(json, multiple, multiple)
}
fn read_parameters_mode(
    json: &Value,
    multiple: bool,
    allow_editable: bool,
) -> JsResult<Parameters> {
    let mut f = Fields::new(json);
    let segment_ids = if multiple {
        f.req("segmentIds", |v| read_list(v, read_unsigned_long))
    } else {
        Ok(Vec::new())
    };
    let positive_vec = |v: &Value| {
        let v = Vec3Int::from_json(v)?;
        if v.x <= 0 || v.y <= 0 || v.z <= 0 {
            return Err(JsError::new("Components must be positive."));
        }
        Ok(v)
    };
    let mag = f.req("mag", positive_vec);
    let cube_size = if multiple {
        Ok(Vec3Int::new(1, 1, 1))
    } else {
        f.req("cubeSize", positive_vec)
    };
    let _additional = f.opt("additionalCoordinates", |v| {
        read_list(v, RequestedAdditionalCoordinate::from_json)
    });
    let mapping_name = f.opt("mappingName", read_string);
    let editable = if allow_editable {
        f.opt("editableMappingTracingId", read_string)
    } else {
        Ok(None)
    };
    let annotation_version = f.opt("annotationVersion", read_i64);
    f.finish()?;
    Ok(Parameters {
        segment_ids: segment_ids?,
        mag: mag?,
        cube_size: cube_size?,
        mapping_name: mapping_name?,
        editable_mapping_tracing_id: editable?,
        annotation_version: annotation_version?,
    })
}

#[allow(clippy::too_many_arguments)]
async fn bucket_positions(
    state: &AppState,
    tc: &TokenContext,
    source: &UsableDataSource,
    layer: &StaticLayer,
    params: &Parameters,
    editable: Option<&str>,
    segment_or_agglomerate: i64,
    omit_missing: bool,
) -> DsResult<Vec<Vec3Int>> {
    let key = SegmentIndexService::look_up(&source.id, layer)?;
    let segment_ids = segment_ids_for_agglomerate_id_if_needed(
        &state.agglomerates,
        &state.wk_client,
        &state.tracingstore,
        &source.id,
        layer,
        params.mapping_name.as_deref(),
        editable,
        params.annotation_version,
        segment_or_agglomerate,
        None,
        omit_missing,
        tc,
    )
    .await?;
    let top_lefts = state
        .segment_index
        .read_segment_indices(&key, &segment_ids, tc.user_token.as_deref())
        .await?;
    Ok(top_lefts_to_target_mag_buckets(&top_lefts, params.mag))
}

async fn segment_index(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((id, layer_name, segment)): Path<(String, String, String)>,
    body: Result<Json<Value>, JsonRejection>,
) -> AccessResult<Response> {
    let params = match validated_body(body, |v| read_parameters(v, false)) {
        Ok(params) => params,
        Err(response) => return Ok(*response),
    };
    let (source, layer) = layer(&state, &tc, &id, &layer_name).await?;
    let segment: i64 = segment.parse().map_err(|_| {
        DsError::from_exception(format!(
            "java.lang.NumberFormatException: For input string: \"{segment}\""
        ))
    })?;
    // Key lookup precedes the mapping lookup in Scala.
    SegmentIndexService::look_up(&source.id, &layer)?;
    let buckets =
        bucket_positions(&state, &tc, &source, &layer, &params, None, segment, false).await?;
    let cube = params.cube_size;
    let mut positions: Vec<Vec3Int> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for bucket in buckets {
        let scaled = bucket.scale(BUCKET_LENGTH) / cube;
        if seen.insert(scaled) {
            positions.push(scaled);
        }
    }
    let positions: Vec<Vec3Int> = positions.into_iter().map(|p| p * cube).collect();
    Ok(Json(positions).into_response())
}

async fn query_segment_index(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((id, layer_name)): Path<(String, String)>,
    body: Result<Json<Value>, JsonRejection>,
) -> AccessResult<Response> {
    let params = match validated_body(body, |v| read_parameters(v, true)) {
        Ok(params) => params,
        Err(response) => return Ok(*response),
    };
    let (source, layer) = layer(&state, &tc, &id, &layer_name).await?;
    SegmentIndexService::look_up(&source.id, &layer)?;
    let mut result = Vec::new();
    for segment in &params.segment_ids {
        let positions = bucket_positions(
            &state,
            &tc,
            &source,
            &layer,
            &params,
            params.editable_mapping_tracing_id.as_deref(),
            *segment as i64,
            true,
        )
        .await?;
        result.push(json!({"segmentId": unsigned_long_envelope(*segment), "positions": positions}));
    }
    Ok(Json(result).into_response())
}

async fn statistics_file_info(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((id, name)): Path<(String, String)>,
) -> AccessResult<Json<Value>> {
    let (source, layer) = layer(&state, &tc, &id, &name).await?;
    if layer
        .attachments
        .as_ref()
        .and_then(|a| a.segment_statistics.as_ref())
        .is_none()
    {
        return Ok(Json(json!([])));
    }
    let key = StatisticsFileService::look_up(&source.id, &layer)?;
    let info = state
        .statistics_file
        .infos(&key, &layer, tc.user_token.as_deref())
        .await?;
    Ok(Json(json!([info])))
}

#[derive(Clone, Copy)]
enum Metric {
    Volume,
    BoundingBox,
    Covariance,
    MaxDistance,
    Center,
    Sphericity,
}
impl Metric {
    fn name(self) -> &'static str {
        match self {
            Self::Volume => "volumes",
            Self::Covariance => "covariance_matrix",
            Self::MaxDistance => "max_distances",
            Self::Center => "center_of_mass",
            Self::Sphericity => "sphericities",
            Self::BoundingBox => unreachable!("bounding boxes use the index"),
        }
    }
    fn remaps(self) -> bool {
        matches!(self, Self::Volume | Self::Covariance | Self::Center)
    }
}
fn rows_json(metric: Metric, rows: Vec<Vec<f32>>) -> Value {
    match metric {
        Metric::Center => json!(rows),
        Metric::Covariance => json!(
            rows.into_iter()
                .map(|row| row.as_chunks::<3>().0.to_vec())
                .collect::<Vec<_>>()
        ),
        _ => json!(rows.into_iter().map(|row| row[0]).collect::<Vec<_>>()),
    }
}
async fn from_statistics_file(
    state: &AppState,
    tc: &TokenContext,
    source: &UsableDataSource,
    layer: &StaticLayer,
    params: &Parameters,
    metric: Metric,
) -> DsResult<Value> {
    let token = tc.user_token.as_deref();
    let key = StatisticsFileService::look_up(&source.id, layer)?;
    let remap = state
        .statistics_file
        .check_compatible(
            &key,
            layer,
            params.mag,
            params.mapping_name.as_deref(),
            metric.remaps(),
            token,
        )
        .await?;
    let ids = params
        .segment_ids
        .iter()
        .map(|id| *id as i64)
        .collect::<Vec<_>>();
    let (file_mag, _) = state
        .statistics_file
        .mag_and_mapping(&key, layer, token)
        .await?;
    if !remap {
        return if matches!(metric, Metric::Volume) {
            let volumes = state
                .statistics_file
                .volumes(&key, &ids, token)
                .await?
                .into_iter()
                .map(|v| rescale_volume(v, file_mag, params.mag))
                .collect::<DsResult<Vec<_>>>()?;
            Ok(json!(volumes))
        } else {
            Ok(rows_json(
                metric,
                state
                    .statistics_file
                    .float_rows(&key, metric.name(), &ids, token)
                    .await?,
            ))
        };
    }
    let mut values = Vec::new();
    // Each agglomerate read batches its segments; avoid multiplying fan-out here.
    for id in ids {
        let ids = segment_ids_for_agglomerate_id_if_needed(
            &state.agglomerates,
            &state.wk_client,
            &state.tracingstore,
            &source.id,
            layer,
            params.mapping_name.as_deref(),
            None,
            params.annotation_version,
            id,
            None,
            false,
            tc,
        )
        .await?;
        let volumes = state.statistics_file.volumes(&key, &ids, token).await?;
        if matches!(metric, Metric::Volume) {
            let sum = volumes.iter().fold(0i64, |n, v| n.wrapping_add(*v));
            values.push(json!(rescale_volume(sum, file_mag, params.mag)?));
        } else {
            let volumes = volumes
                .into_iter()
                .map(|v| rescale_volume(v, file_mag, Vec3Int::ones()))
                .collect::<DsResult<Vec<_>>>()?;
            let centers = state
                .statistics_file
                .float_rows(&key, "center_of_mass", &ids, token)
                .await?;
            if matches!(metric, Metric::Center) {
                values.push(json!(
                    weighted_center(&centers, &volumes)?.map(|v| v as f32)
                ));
            } else {
                let matrices = state
                    .statistics_file
                    .float_rows(&key, "covariance_matrix", &ids, token)
                    .await?;
                values.push(json!(combined_covariance(&matrices, &centers, &volumes)?));
            }
        }
    }
    Ok(json!(values))
}
async fn statistics(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((id, name)): Path<(String, String)>,
    body: Result<Json<Value>, JsonRejection>,
    metric: Metric,
) -> AccessResult<Response> {
    let params = match validated_body(body, |v| read_parameters_mode(v, true, false)) {
        Ok(p) => p,
        Err(response) => return Ok(*response),
    };
    let (source, layer) = layer(&state, &tc, &id, &name).await?;
    if !matches!(metric, Metric::BoundingBox) {
        let from_file = from_statistics_file(&state, &tc, &source, &layer, &params, metric).await;
        match from_file {
            Ok(values) => return Ok(statistics_json(values)),
            Err(error) if !matches!(metric, Metric::Volume) => return Err(error.into()),
            // Scala falls back on both absent and incompatible/corrupt statistics files.
            Err(_) => {}
        }
    }
    let key = SegmentIndexService::look_up(&source.id, &layer)?;
    let mapping = params
        .mapping_name
        .as_deref()
        .map(|m| AgglomerateService::look_up(&source.id, &layer, m))
        .transpose()?;
    let mut values = Vec::new();
    for segment in params.segment_ids {
        if matches!(metric, Metric::Volume) {
            values.push(json!(
                state
                    .index_statistics
                    .volume(
                        &id,
                        &layer,
                        &key,
                        mapping.as_ref(),
                        segment as i64,
                        params.mag,
                        tc.user_token.as_deref()
                    )
                    .await?
            ));
        } else {
            values.push(json!(
                state
                    .index_statistics
                    .bounding_box(
                        &id,
                        &layer,
                        &key,
                        mapping.as_ref(),
                        segment as i64,
                        params.mag,
                        tc.user_token.as_deref()
                    )
                    .await?
            ));
        }
    }
    Ok(statistics_json(json!(values)))
}
fn statistics_json(values: Value) -> Response {
    (
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        crate::models::json::compact(&values),
    )
        .into_response()
}
macro_rules! statistics_handler {
    ($handler:ident,$metric:ident) => {
        async fn $handler(
            state: State<AppState>,
            tc: TokenContext,
            path: Path<(String, String)>,
            body: Result<Json<Value>, JsonRejection>,
        ) -> AccessResult<Response> {
            statistics(state, tc, path, body, Metric::$metric).await
        }
    };
}
statistics_handler!(segment_volume, Volume);
statistics_handler!(segment_bounding_box, BoundingBox);
statistics_handler!(segment_covariance, Covariance);
statistics_handler!(segment_max_distance, MaxDistance);
statistics_handler!(segment_center, Center);
statistics_handler!(segment_sphericity, Sphericity);

struct SurfaceParameters {
    mag: Vec3Int,
    ids: Vec<u64>,
    mapping: Option<String>,
    coordinates: Option<Vec<RequestedAdditionalCoordinate>>,
    mesh: Option<String>,
}
fn surface_parameters(value: &Value) -> JsResult<SurfaceParameters> {
    let mut f = Fields::new(value);
    let mag = f.req("mag", Vec3Int::from_json);
    let ids = f.req("segmentIds", |v| read_list(v, read_unsigned_long));
    let mapping = f.opt("mappingName", read_string);
    let coordinates = f.opt("additionalCoordinates", |v| {
        read_list(v, RequestedAdditionalCoordinate::from_json)
    });
    let mesh = f.opt("meshFileName", read_string);
    // Scala parses this field but its surface-area fallback intentionally constructs version=None.
    let _version = f.opt("annotationVersion", read_i64);
    f.finish()?;
    Ok(SurfaceParameters {
        mag: mag?,
        ids: ids?,
        mapping: mapping?,
        coordinates: coordinates?,
        mesh: mesh?,
    })
}
async fn segment_surface_area(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((id, name)): Path<(String, String)>,
    body: Result<Json<Value>, JsonRejection>,
) -> AccessResult<Response> {
    use crate::services::{
        ad_hoc_mesh::MappingType, full_mesh::FullMeshRequest, mesh_file::MeshFileService,
    };
    let p = match validated_body(body, surface_parameters) {
        Ok(p) => p,
        Err(r) => return Ok(*r),
    };
    let (source, layer) = layer(&state, &tc, &id, &name).await?;
    let id = dataset_id(&id)?;
    let token = tc.user_token.as_deref();
    let from_file = async {
        let key = StatisticsFileService::look_up(&source.id, &layer)?;
        state
            .statistics_file
            .check_compatible(&key, &layer, p.mag, p.mapping.as_deref(), false, token)
            .await?;
        let ids = p.ids.iter().map(|id| *id as i64).collect::<Vec<_>>();
        let rows = state
            .statistics_file
            .float_rows(&key, "surfaces", &ids, token)
            .await?;
        Ok::<_, DsError>(rows.into_iter().map(|r| r[0]).collect::<Vec<_>>())
    }
    .await;
    let values = if let Ok(values) = from_file {
        values
    } else {
        let mesh = if let Some(mesh) = p.mesh.as_deref() {
            let key = MeshFileService::look_up(&source.id, &layer, mesh)?;
            let mapping = state.mesh_files.mapping_name(&key, token).await?;
            if mapping == p.mapping {
                Some(mesh.to_owned())
            } else {
                None
            }
        } else {
            None
        };
        let mut values = Vec::new();
        for segment in p.ids {
            let request = FullMeshRequest {
                mesh_file_name: mesh.clone(),
                lod: None,
                segment_id: segment,
                mapping_name: p.mapping.clone(),
                mapping_type: p.mapping.as_ref().map(|_| MappingType::Agglomerate),
                editable_mapping_tracing_id: None,
                annotation_version: None,
                mag: Some(p.mag),
                seed_position: None,
                additional_coordinates: p.coordinates.clone(),
            };
            values.push(
                state
                    .full_mesh
                    .cached_surface_area(
                        &state,
                        &id,
                        &source,
                        std::sync::Arc::clone(&layer),
                        &request,
                        &tc,
                    )
                    .await
                    .map_err(|e| e.wrap("Could not load full segment mesh."))?,
            );
        }
        values
    };
    Ok(Json(values).into_response())
}
