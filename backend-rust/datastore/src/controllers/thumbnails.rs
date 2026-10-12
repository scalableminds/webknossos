//! BinaryDataController thumbnail entrypoints (`layerThumbnail`, `datasetThumbnail`).
use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{Path, RawQuery, State, rejection::JsonRejection},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde_json::Value;

use crate::{
    AppState,
    access::{AccessResult, TokenContext, UserAccessRequest},
    controller,
    error::{DsError, DsResult},
    models::{
        StaticLayer, UsableDataSource, Vec3Int,
        data_requests::{
            Cuboid, DataServiceDataRequest, DataServiceRequestSettings, VoxelPosition,
        },
        json::{Fields, JsResult, read_bool, read_f64, read_i32, read_list, read_string},
    },
    services::{
        BinaryDataService,
        agglomerate::AgglomerateService,
        find_data::{FindDataTarget, create_histogram},
        thumbnail::{self, Color, Image, RenderParameters},
    },
};

use super::helpers::{QueryFields, dataset_id, validated_body};

const SOURCE_NOT_FOUND: &str =
    "Data source not found on data store server. It may still be initializing.";
const JPEG: &str = "image/jpeg";

pub fn router() -> Router<AppState> {
    controller(
        Router::new()
            .route(
                "/data/datasets/{datasetId}/layers/{dataLayerName}/layerThumbnail",
                get(layer_thumbnail),
            )
            .route(
                "/data/datasets/{datasetId}/datasetThumbnail",
                post(dataset_thumbnail),
            ),
        true,
    )
}

/// One layer's cutout: Scala `DatasetThumbnailLayerParameters` (also the query of
/// `layerThumbnail`, where `opacity` does not exist).
struct LayerParameters {
    data_layer_name: String,
    x: i32,
    y: i32,
    z: i32,
    mag: String,
    width: i32,
    height: i32,
    mapping_name: Option<String>,
    intensity_min: Option<f64>,
    intensity_max: Option<f64>,
    color: Option<String>,
    invert_color: Option<bool>,
    opacity: f64,
}

impl LayerParameters {
    fn from_json(json: &Value) -> JsResult<Self> {
        let mut f = Fields::new(json);
        let data_layer_name = f.req("dataLayerName", read_string);
        let x = f.req("x", read_i32);
        let y = f.req("y", read_i32);
        let z = f.req("z", read_i32);
        let mag = f.req("mag", read_string);
        let width = f.req("width", read_i32);
        let height = f.req("height", read_i32);
        let mapping_name = f.opt("mappingName", read_string);
        let intensity_min = f.opt("intensityMin", read_f64);
        let intensity_max = f.opt("intensityMax", read_f64);
        let color = f.opt("color", read_string);
        let invert_color = f.opt("invertColor", read_bool);
        let opacity = f.req("opacity", read_f64);
        f.finish()?;
        Ok(Self {
            data_layer_name: data_layer_name?,
            x: x?,
            y: y?,
            z: z?,
            mag: mag?,
            width: width?,
            height: height?,
            mapping_name: mapping_name?,
            intensity_min: intensity_min?,
            intensity_max: intensity_max?,
            color: color?,
            invert_color: invert_color?,
            opacity: opacity?,
        })
    }
}

/// Scala `DatasetThumbnailRequest`.
struct DatasetThumbnailRequest {
    width: i32,
    height: i32,
    layers: Vec<LayerParameters>,
    blend_mode: String,
}

impl DatasetThumbnailRequest {
    fn from_json(json: &Value) -> JsResult<Self> {
        let mut f = Fields::new(json);
        let width = f.req("width", read_i32);
        let height = f.req("height", read_i32);
        let layers = f.req("layers", |v| read_list(v, LayerParameters::from_json));
        let blend_mode = f.req("blendMode", read_string);
        f.finish()?;
        Ok(Self {
            width: width?,
            height: height?,
            layers: layers?,
            blend_mode: blend_mode?,
        })
    }
}

/// Play `QueryStringBindable[Option[Double]]`.
fn opt_f64(q: &QueryFields, key: &str) -> DsResult<Option<f64>> {
    q.0.get(key)
        .map(|v| {
            v.trim().parse::<f64>().map_err(|_| {
                DsError::failure(format!(
                    "Cannot parse parameter {key} as Double: For input string: \"{v}\""
                ))
            })
        })
        .transpose()
}

/// Agglomerate mappings of HDF5 files cannot be applied yet (DS5 HDF5 reader); fail instead of
/// rendering the zero fallback Scala only uses for genuinely failed reads.
fn ensure_mapping_supported(
    source: &UsableDataSource,
    layer: &StaticLayer,
    mapping: Option<&str>,
    mag: Vec3Int,
) -> DsResult<()> {
    if let Some(mapping) = mapping
        && layer.is_segmentation()
        && mag.max_dim() <= BinaryDataService::MAX_MAG_FOR_AGGLOMERATE_MAPPING
        && let Ok(key) = AgglomerateService::look_up(&source.id, layer, mapping)
    {
        AgglomerateService::supports(&key)?;
    }
    Ok(())
}

/// Scala `resolveIntensityRange`: explicit bounds, none for segmentations, else the histogram's
/// overall min/max (histogram failures are ignored).
async fn resolve_intensity_range(
    state: &AppState,
    id: &str,
    source: &UsableDataSource,
    layer: &Arc<StaticLayer>,
    min: Option<f64>,
    max: Option<f64>,
    token: Option<&str>,
) -> Option<(f64, f64)> {
    if let (Some(min), Some(max)) = (min, max) {
        return Some((min, max));
    }
    if layer.is_segmentation() {
        return None;
    }
    let target = FindDataTarget {
        dataset_id: id,
        data_source_id: &source.id,
        layer,
    };
    let histograms = create_histogram(&state.binary_data, &target, token)
        .await
        .ok()
        .filter(|h| !h.is_empty())?;
    let min = histograms
        .iter()
        .map(|h| h.min)
        .fold(f64::INFINITY, f64::min);
    let max = histograms
        .iter()
        .map(|h| h.max)
        .fold(f64::NEG_INFINITY, f64::max);
    (min < max).then_some((min, max))
}

/// Fetches and renders one layer (Scala `standaloneLayerThumbnail` body and
/// `datasetThumbnailLayerImage`). Returns whether the layer is a segmentation.
async fn render_layer(
    state: &AppState,
    tc: &TokenContext,
    id: &str,
    p: &LayerParameters,
    output: Option<(usize, usize)>,
    preserve_alpha: bool,
) -> DsResult<(bool, Image)> {
    let (source, layer) = state
        .datasets
        .get_with_layer(id, &p.data_layer_name)
        .await
        .map_err(|e| e.wrap(SOURCE_NOT_FOUND).with_status(StatusCode::NOT_FOUND))?;
    let mag = Vec3Int::from_mag_literal(&p.mag, false)
        .ok_or_else(|| DsError::failure(format!("Invalid mag “{}”. Please use “x-y-z”.", p.mag)))?;
    ensure_mapping_supported(&source, &layer, p.mapping_name.as_deref(), mag)?;
    let request = DataServiceDataRequest {
        dataset_id: Some(id.to_owned()),
        data_source_id: Some(source.id.clone()),
        data_layer: Arc::clone(&layer),
        cuboid: Cuboid::new(
            VoxelPosition::new(Vec3Int::new(p.x, p.y, p.z), mag)?,
            Vec3Int::new(p.width, p.height, 1),
        ),
        settings: DataServiceRequestSettings {
            applied_agglomerate: p.mapping_name.clone(),
            ..Default::default()
        },
    };
    let token = tc.user_token.as_deref();
    let data = state
        .binary_data
        .handle_data_requests(&[request], token)
        .await
        .data;
    let range = resolve_intensity_range(
        state,
        id,
        &source,
        &layer,
        p.intensity_min,
        p.intensity_max,
        token,
    )
    .await;
    let is_segmentation = layer.is_segmentation();
    let params = RenderParameters {
        element_class: layer.element_class,
        intensity_range: range,
        is_segmentation,
        color: p.color.as_deref().and_then(Color::from_html),
        invert_color: p.invert_color.unwrap_or(false),
        preserve_alpha,
        opacity: p.opacity,
    };
    let (width, height) = (p.width as usize, p.height as usize);
    let image = tokio::task::spawn_blocking(move || {
        thumbnail::image_for(&data, width, height, &params).map(|image| match output {
            Some((w, h)) => thumbnail::resize_if_needed(image, w, h),
            None => image,
        })
    })
    .await
    .map_err(DsError::from_exception)??;
    Ok((is_segmentation, image))
}

fn jpeg_response(bytes: Vec<u8>) -> Response {
    ([(header::CONTENT_TYPE, JPEG)], bytes).into_response()
}

async fn layer_thumbnail(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((id, layer_name)): Path<(String, String)>,
    RawQuery(raw): RawQuery,
) -> AccessResult<Response> {
    let id = dataset_id(&id)?;
    let q = QueryFields::new(raw);
    let params = LayerParameters {
        data_layer_name: layer_name,
        x: q.int("x")?,
        y: q.int("y")?,
        z: q.int("z")?,
        width: q.int("width")?,
        height: q.int("height")?,
        mag: q.required("mag")?.to_owned(),
        mapping_name: q.0.get("mappingName").cloned(),
        intensity_min: opt_f64(&q, "intensityMin")?,
        intensity_max: opt_f64(&q, "intensityMax")?,
        color: q.0.get("color").cloned(),
        invert_color: q
            .0
            .contains_key("invertColor")
            .then(|| q.bool_or_false("invertColor"))
            .transpose()?,
        opacity: 100.0,
    };
    state
        .access
        .validate_access(UserAccessRequest::read_dataset(&id), &tc)
        .await?;
    thumbnail::validate_dimensions(params.width, params.height)?;
    let (_, image) = render_layer(&state, &tc, &id, &params, None, false).await?;
    let jpeg = tokio::task::spawn_blocking(move || thumbnail::to_jpeg(&image))
        .await
        .map_err(DsError::from_exception)??;
    Ok(jpeg_response(jpeg))
}

async fn dataset_thumbnail(
    State(state): State<AppState>,
    tc: TokenContext,
    Path(id): Path<String>,
    body: Result<Json<Value>, JsonRejection>,
) -> AccessResult<Response> {
    let id = dataset_id(&id)?;
    let request = match validated_body(body, DatasetThumbnailRequest::from_json) {
        Ok(request) => request,
        Err(response) => return Ok(*response),
    };
    state
        .access
        .validate_access(UserAccessRequest::read_dataset(&id), &tc)
        .await?;
    thumbnail::validate_dimensions(request.width, request.height)?;
    for layer in &request.layers {
        thumbnail::validate_dimensions(layer.width, layer.height)?;
    }
    let output = (request.width as usize, request.height as usize);
    let mut colors = Vec::new();
    let mut segmentations = Vec::new();
    for layer in &request.layers {
        let (is_segmentation, image) =
            render_layer(&state, &tc, &id, layer, Some(output), true).await?;
        if is_segmentation {
            segmentations.push(image);
        } else {
            colors.push(image);
        }
    }
    let blend_mode = request.blend_mode;
    let jpeg = tokio::task::spawn_blocking(move || {
        let composite =
            thumbnail::blend_layers(&colors, &segmentations, &blend_mode, output.0, output.1);
        thumbnail::to_jpeg(&composite)
    })
    .await
    .map_err(DsError::from_exception)??;
    Ok(jpeg_response(jpeg))
}
