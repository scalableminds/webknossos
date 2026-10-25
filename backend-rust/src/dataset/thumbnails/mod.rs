//! DatasetController.layerThumbnail / datasetThumbnail with ThumbnailService's
//! parameter selection, the PostgreSQL thumbnail cache and datastore RPC.
use axum::{
    Extension, Router,
    extract::State,
    http::{HeaderName, HeaderValue, header},
    response::{IntoResponse, Response},
    routing::get,
};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::{
    AppState,
    auth::OptionalAuthUser,
    error::{ApiError, ApiResult},
    extract::{Path, Query},
    stores::client::ServiceClients,
    util::id::{ObjectId, PathObjectId},
};
use webknossos_common::{datasource::StaticLayer, geometry::Vec3Int, json::read_i32};

const DEFAULT_SIZE: i32 = 400;
const MAX_SIZE: i32 = 4000;
/// Whole-dataset thumbnails use an empty layer name: the column is in the key.
const DATASET_LAYER_SENTINEL: &str = "";
const JPEG: &str = "image/jpeg";

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/datasets/{datasetId}/layers/{layer}/thumbnail",
            get(layer_thumbnail),
        )
        .route("/datasets/{datasetId}/thumbnail", get(dataset_thumbnail))
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThumbnailQuery {
    w: Option<i32>,
    h: Option<i32>,
    mapping_name: Option<String>,
    sharing_token: Option<String>,
}

fn clamp_size(value: Option<i32>) -> i32 {
    value.unwrap_or(DEFAULT_SIZE).clamp(1, MAX_SIZE)
}

/// Scala answers with addRemoteOriginHeaders and an explicit public cache
/// header. The root middleware keeps an explicitly set Cache-Control.
fn image_response(image: Vec<u8>) -> Response {
    (
        [
            (header::CONTENT_TYPE, HeaderValue::from_static(JPEG)),
            (
                header::CACHE_CONTROL,
                HeaderValue::from_static("public, max-age=86400"),
            ),
            (
                header::ACCESS_CONTROL_ALLOW_ORIGIN,
                HeaderValue::from_static("*"),
            ),
            (
                HeaderName::from_static("access-control-max-age"),
                HeaderValue::from_static("600"),
            ),
        ],
        image,
    )
        .into_response()
}

async fn require_read(
    state: &AppState,
    user: Option<&crate::auth::AuthUser>,
    id: &ObjectId,
    sharing_token: Option<&str>,
) -> ApiResult<()> {
    if !crate::dataset::access::can_read(&state.pool, user, id, sharing_token).await? {
        return Err(ApiError::not_found(if user.is_some() {
            crate::msg::dataset::not_found(id)
        } else {
            crate::msg::dataset::not_found_consider_login(id)
        }));
    }
    Ok(())
}

async fn cached(
    state: &AppState,
    id: &ObjectId,
    layer: &str,
    width: i32,
    height: i32,
    mapping: Option<&str>,
) -> ApiResult<Option<Vec<u8>>> {
    // Scala's cleanup job deletes rows older than ten days; filtering here keeps
    // that expiry without depending on the periodic job having run.
    Ok(sqlx::query_scalar(
        "SELECT image FROM webknossos.dataset_thumbnails WHERE _dataset=$1 AND dataLayerName=$2 AND width=$3 AND height=$4 AND mappingName=$5 AND created > NOW() - INTERVAL '10 days'",
    )
    .bind(id.as_str())
    .bind(layer)
    .bind(width)
    .bind(height)
    .bind(mapping.unwrap_or(""))
    .fetch_optional(&state.pool)
    .await?)
}

#[derive(sqlx::FromRow)]
struct DatasetRow {
    is_usable: bool,
    has_voxel_size: bool,
    store_url: Option<String>,
    cache_version: i32,
    default_configuration: Option<Value>,
    admin_configuration: Option<Value>,
}

/// A rendered data layer (StaticLayer reads).
fn parse_layer(layer: &Value) -> ApiResult<StaticLayer> {
    StaticLayer::from_json(layer).map_err(|_| ApiError::internal())
}

/// DatasetConfigurationService.getDatasetViewConfigurationForDataset without a
/// user: dataset default ++ admin, plus `layers` with per-layer default ++ admin.
fn view_configuration(dataset: &DatasetRow, layers: &[Value]) -> Map<String, Value> {
    let mut result = Map::new();
    for configuration in [&dataset.default_configuration, &dataset.admin_configuration] {
        if let Some(Value::Object(configuration)) = configuration {
            result.extend(configuration.clone());
        }
    }
    let mut layer_configurations = Map::new();
    for layer in layers {
        let mut merged = Map::new();
        for key in ["defaultViewConfiguration", "adminViewConfiguration"] {
            if let Some(Value::Object(configuration)) = layer.get(key) {
                merged.extend(configuration.clone());
            }
        }
        if let Some(name) = layer["name"].as_str() {
            layer_configurations.insert(name.to_owned(), Value::Object(merged));
        }
    }
    result.insert("layers".to_owned(), Value::Object(layer_configurations));
    result
}

struct Config<'a>(&'a Map<String, Value>);

impl Config<'_> {
    fn layer(&self, name: &str, key: &str) -> Option<&Value> {
        self.0.get("layers")?.get(name)?.get(key)
    }
    fn position(&self) -> Option<Vec3Int> {
        self.0
            .get("position")
            .and_then(|position| Vec3Int::from_json(position).ok())
    }
    fn zoom(&self) -> f64 {
        self.0.get("zoom").and_then(Value::as_f64).unwrap_or(1.0)
    }
    fn intensity_range(&self, name: &str) -> Option<(f64, f64)> {
        let range = self.layer(name, "intensityRange")?.as_array()?;
        Some((range.first()?.as_f64()?, range.get(1)?.as_f64()?))
    }
    /// ThumbnailColorSettings → Color(r/255d, …).toHtml, including the
    /// truncating `(r / 255d * 255).toInt` and Java's `%02x` on negative ints.
    fn color(&self, name: &str) -> Option<(String, bool)> {
        let color = self.layer(name, "color")?.as_array()?;
        let channel = |index: usize| -> Option<String> {
            let value = read_i32(color.get(index)?).ok()?;
            let scaled = (f64::from(value) / 255.0 * 255.0) as i32;
            Some(format!("{:02x}", scaled as u32))
        };
        let html = format!("#{}{}{}", channel(0)?, channel(1)?, channel(2)?);
        let inverted = self
            .layer(name, "isInverted")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        Some((html, inverted))
    }
    fn mapping_name(&self, name: &str) -> Option<String> {
        self.layer(name, "mapping")?
            .as_object()?
            .get("name")?
            .as_str()
            .map(str::to_owned)
    }
    fn opacity(&self, name: &str, is_segmentation: bool, has_color_layers: bool) -> f64 {
        let default = if !is_segmentation {
            100.0
        } else if has_color_layers {
            20.0
        } else {
            60.0
        };
        self.layer(name, "alpha")
            .and_then(Value::as_f64)
            .unwrap_or(default)
    }
    fn is_disabled(&self, name: &str) -> bool {
        self.layer(name, "isDisabled")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    }
    fn color_layer_order(&self) -> Vec<String> {
        self.0
            .get("colorLayerOrder")
            .and_then(Value::as_array)
            .and_then(|order| {
                order
                    .iter()
                    .map(|v| v.as_str().map(str::to_owned))
                    .collect::<Option<Vec<_>>>()
            })
            .unwrap_or_default()
    }
    fn blend_mode(&self) -> String {
        self.0
            .get("blendMode")
            .and_then(Value::as_str)
            .unwrap_or("Additive")
            .to_owned()
    }
}

fn center_and_zoom(
    config: &Config,
    layers: &[StaticLayer],
    fallback: &StaticLayer,
) -> (Vec3Int, f64) {
    let intersection = layers.split_first().and_then(|(first, rest)| {
        rest.iter()
            .try_fold(first.bounding_box, |accumulated, layer| {
                accumulated.intersection(&layer.bounding_box)
            })
    });
    let center = config
        .position()
        .or_else(|| intersection.map(|b| b.center()))
        .unwrap_or_else(|| fallback.bounding_box.center());
    (center, config.zoom())
}

/// First mag (in stored order) whose largest dimension is closest to the zoom.
fn mag_for_zoom(layer: &StaticLayer, zoom: f64) -> Option<Vec3Int> {
    layer.resolutions().into_iter().min_by(|a, b| {
        let distance = |mag: Vec3Int| (f64::from(mag.max_dim()) - zoom).abs();
        distance(*a)
            .partial_cmp(&distance(*b))
            .unwrap_or(std::cmp::Ordering::Equal)
    })
}

/// Java Math.round(double).toInt: round half up, saturate to long, wrap to int.
fn java_round_to_int(value: f64) -> i32 {
    let rounded = (value + 0.5).floor();
    (if rounded.is_nan() { 0 } else { rounded as i64 }) as i32
}

/// Java's Double.toString, used for RPC query parameters (shared, JDK-verified).
pub(crate) fn java_double_string(value: f64) -> String {
    webknossos_common::java_format::java_double(value)
}

async fn load_dataset(state: &AppState, id: &ObjectId) -> ApiResult<DatasetRow> {
    sqlx::query_as(
        "SELECT d.isUsable AS is_usable, d.voxelSizeFactor IS NOT NULL AS has_voxel_size, s.url AS store_url, d.thumbnailCacheVersion AS cache_version, d.defaultViewConfiguration AS default_configuration, d.adminViewConfiguration AS admin_configuration FROM webknossos.datasets_ d LEFT JOIN webknossos.dataStores_ s ON s.name = trim(d._dataStore) WHERE d._id = $1",
    )
    .bind(id.as_str())
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::not_found(crate::msg::dataset::not_found(id)))
}

/// DatasetService.usableDataSourceFor: unusable datasets fail before layers load.
async fn usable_layers(
    state: &AppState,
    id: &ObjectId,
    dataset: &DatasetRow,
) -> ApiResult<Vec<Value>> {
    if !dataset.is_usable {
        return Err(ApiError::bad_request(crate::msg::dataset::not_usable(id)));
    }
    if !dataset.has_voxel_size {
        return Err(ApiError::bad_request(
            crate::msg::dataset::data_source::USABLE_BUT_NO_VOXEL_SIZE,
        ));
    }
    crate::dataset::routes::full_layers(&state.pool, id).await
}

fn store_url(dataset: &DatasetRow) -> ApiResult<&str> {
    dataset
        .store_url
        .as_deref()
        .ok_or_else(|| ApiError::bad_request(crate::msg::data_store::NOT_FOUND))
}

struct ThumbnailRecord<'a> {
    layer: &'a str,
    width: i32,
    height: i32,
    mapping: Option<&'a str>,
    mag: Vec3Int,
    bounding_box: [i32; 6],
}

/// Upsert only if no cache clear or admin configuration change happened since
/// parameters were selected; the row lock orders this against concurrent clears.
async fn store(
    state: &AppState,
    id: &ObjectId,
    version: i32,
    record: ThumbnailRecord<'_>,
    image: &[u8],
) -> ApiResult<()> {
    let mut transaction = state.pool.begin().await?;
    let current: Option<i32> = sqlx::query_scalar(
        "SELECT thumbnailCacheVersion FROM webknossos.datasets WHERE _id=$1 AND NOT isDeleted FOR SHARE",
    )
    .bind(id.as_str())
    .fetch_optional(&mut *transaction)
    .await?;
    if current != Some(version) {
        return Ok(());
    }
    let [x, y, z, width, height, depth] = record.bounding_box.map(f64::from);
    let [mx, my, mz] = record.mag.to_array().map(f64::from);
    sqlx::query(
        r#"INSERT INTO webknossos.dataset_thumbnails
          (_dataset, dataLayerName, width, height, mappingName, image, mimetype, mag, mag1BoundingBox, created)
        VALUES ($1, $2, $3, $4, $5, $6, $7, ROW($8, $9, $10)::webknossos.VECTOR3,
          ROW($11, $12, $13, $14, $15, $16)::webknossos.BOUNDING_BOX, NOW())
        ON CONFLICT (_dataset, dataLayerName, width, height, mappingName) DO UPDATE SET
          image = EXCLUDED.image, mimetype = EXCLUDED.mimetype, mag = EXCLUDED.mag,
          mag1BoundingBox = EXCLUDED.mag1BoundingBox, created = EXCLUDED.created"#,
    )
    .bind(id.as_str())
    .bind(record.layer)
    .bind(record.width)
    .bind(record.height)
    .bind(record.mapping.unwrap_or(""))
    .bind(image)
    .bind(JPEG)
    .bind(mx)
    .bind(my)
    .bind(mz)
    .bind(x)
    .bind(y)
    .bind(z)
    .bind(width)
    .bind(height)
    .bind(depth)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(())
}

async fn layer_thumbnail(
    State(state): State<AppState>,
    OptionalAuthUser(user): OptionalAuthUser,
    Path((id, layer_name)): Path<(PathObjectId, String)>,
    Query(query): Query<ThumbnailQuery>,
    Extension(clients): Extension<ServiceClients>,
) -> ApiResult<Response> {
    require_read(&state, user.as_ref(), &id, query.sharing_token.as_deref()).await?;
    let width = clamp_size(query.w);
    let height = clamp_size(query.h);
    let requested_mapping = query.mapping_name.as_deref();
    if let Some(image) = cached(&state, &id, &layer_name, width, height, requested_mapping).await? {
        return Ok(image_response(image));
    }
    let dataset = load_dataset(&state, &id).await?;
    let raw_layers = usable_layers(&state, &id, &dataset).await?;
    let layers = raw_layers
        .iter()
        .map(parse_layer)
        .collect::<ApiResult<Vec<_>>>()?;
    let layer = layers
        .iter()
        .find(|layer| layer.name == layer_name)
        .ok_or_else(|| ApiError::bad_request(crate::msg::dataset::layer::not_found(&layer_name)))?;
    if layer.mags.is_empty() {
        return Err(ApiError::not_found(crate::msg::dataset::NO_MAGS));
    }
    let configuration = view_configuration(&dataset, &raw_layers);
    let config = Config(&configuration);
    let (center, zoom) = center_and_zoom(&config, &layers, layer);
    let mag = mag_for_zoom(layer, zoom).ok_or_else(ApiError::internal)?;
    if mag.to_array().iter().any(|component| *component <= 0) {
        return Err(ApiError::internal());
    }
    let mag1_width = width.wrapping_mul(mag.x);
    let mag1_height = height.wrapping_mul(mag.y);
    let x = center.x.wrapping_sub(mag1_width / 2);
    let y = center.y.wrapping_sub(mag1_height / 2);
    let z = center.z;
    let mapping = query
        .mapping_name
        .clone()
        .or_else(|| config.mapping_name(&layer_name));
    let intensity = config.intensity_range(&layer_name);
    let color = config.color(&layer_name);
    // Query parameter order and formatting follow WKRemoteDataStoreClient.
    let mut parameters: Vec<(&str, String)> = vec![
        ("mag", mag.to_mag_literal(false)),
        ("x", x.to_string()),
        ("y", y.to_string()),
        ("z", z.to_string()),
        ("width", width.to_string()),
        ("height", height.to_string()),
    ];
    if let Some(mapping) = &mapping {
        parameters.push(("mappingName", mapping.clone()));
    }
    if let Some((min, max)) = intensity {
        parameters.push(("intensityMin", java_double_string(min)));
        parameters.push(("intensityMax", java_double_string(max)));
    }
    if let Some((html, inverted)) = &color {
        parameters.push(("color", html.clone()));
        parameters.push(("invertColor", inverted.to_string()));
    }
    let response = clients
        .request(
            Method::GET,
            store_url(&dataset)?,
            &[
                "data",
                "datasets",
                id.as_str(),
                "layers",
                &layer_name,
                "layerThumbnail",
            ],
            &parameters,
            None,
        )
        .await?;
    store(
        &state,
        &id,
        dataset.cache_version,
        ThumbnailRecord {
            layer: &layer_name,
            width,
            height,
            mapping: mapping.as_deref(),
            mag,
            bounding_box: [x, y, z, mag1_width, mag1_height, 1],
        },
        &response.bytes,
    )
    .await?;
    Ok(image_response(response.bytes))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LayerParameters {
    data_layer_name: String,
    x: i32,
    y: i32,
    z: i32,
    mag: String,
    width: i32,
    height: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    mapping_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    intensity_min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    intensity_max: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    invert_color: Option<bool>,
    opacity: f64,
}

/// ThumbnailService.selectLayersToRender: ordered enabled color layers plus the
/// alphabetically first segmentation layer, falling back to all renderable.
fn layers_to_render<'a>(config: &Config, layers: &'a [StaticLayer]) -> Vec<&'a StaticLayer> {
    let select = |candidates: Vec<&'a StaticLayer>| -> Vec<&'a StaticLayer> {
        let order = config.color_layer_order();
        let mut colors: Vec<&StaticLayer> = candidates
            .iter()
            .copied()
            .filter(|l| !l.is_segmentation())
            .collect();
        // Stable sort, like Scala's sortBy.
        colors.sort_by_key(|layer| {
            order
                .iter()
                .position(|name| *name == layer.name)
                .unwrap_or(i32::MAX as usize)
        });
        let segmentation = candidates
            .iter()
            .copied()
            .filter(|l| l.is_segmentation())
            .min_by(|a, b| a.name.cmp(&b.name));
        colors.extend(segmentation);
        colors
    };
    let renderable: Vec<&StaticLayer> = layers.iter().filter(|l| !l.mags.is_empty()).collect();
    let enabled = select(
        renderable
            .iter()
            .copied()
            .filter(|l| !config.is_disabled(&l.name))
            .collect(),
    );
    if enabled.is_empty() {
        select(renderable)
    } else {
        enabled
    }
}

async fn dataset_thumbnail(
    State(state): State<AppState>,
    OptionalAuthUser(user): OptionalAuthUser,
    Path(id): Path<PathObjectId>,
    Query(query): Query<ThumbnailQuery>,
    Extension(clients): Extension<ServiceClients>,
) -> ApiResult<Response> {
    require_read(&state, user.as_ref(), &id, query.sharing_token.as_deref()).await?;
    let width = clamp_size(query.w);
    let height = clamp_size(query.h);
    if let Some(image) = cached(&state, &id, DATASET_LAYER_SENTINEL, width, height, None).await? {
        return Ok(image_response(image));
    }
    let dataset = load_dataset(&state, &id).await?;
    let raw_layers = usable_layers(&state, &id, &dataset).await?;
    if raw_layers.is_empty() {
        return Err(ApiError::not_found(crate::msg::dataset::NO_LAYERS));
    }
    let layers = raw_layers
        .iter()
        .map(parse_layer)
        .collect::<ApiResult<Vec<_>>>()?;
    let configuration = view_configuration(&dataset, &raw_layers);
    let config = Config(&configuration);
    let to_render = layers_to_render(&config, &layers);
    let first = *to_render
        .first()
        .ok_or_else(|| ApiError::not_found(crate::msg::dataset::NO_MAGS))?;
    let has_color_layers = to_render.iter().any(|l| !l.is_segmentation());
    let (center, zoom) = center_and_zoom(&config, &layers, first);
    let mag1_width = java_round_to_int(f64::from(width) * zoom);
    let mag1_height = java_round_to_int(f64::from(height) * zoom);
    let x = center.x.wrapping_sub(mag1_width / 2);
    let y = center.y.wrapping_sub(mag1_height / 2);
    let mut parameters = Vec::new();
    for layer in &to_render {
        let mag = mag_for_zoom(layer, zoom).ok_or_else(ApiError::internal)?;
        if mag.to_array().iter().any(|component| *component <= 0) {
            return Err(ApiError::internal());
        }
        let intensity = config.intensity_range(&layer.name);
        let color = config.color(&layer.name);
        parameters.push(LayerParameters {
            data_layer_name: layer.name.clone(),
            x,
            y,
            z: center.z,
            mag: mag.to_mag_literal(false),
            width: (mag1_width / mag.x).max(1),
            height: (mag1_height / mag.y).max(1),
            mapping_name: config.mapping_name(&layer.name),
            intensity_min: intensity.map(|r| r.0),
            intensity_max: intensity.map(|r| r.1),
            color: color.as_ref().map(|c| c.0.clone()),
            invert_color: color.as_ref().map(|c| c.1),
            opacity: config.opacity(&layer.name, layer.is_segmentation(), has_color_layers),
        });
    }
    let body = json!({
        "width": width,
        "height": height,
        "layers": parameters,
        "blendMode": config.blend_mode(),
    });
    let response = clients
        .request(
            Method::POST,
            store_url(&dataset)?,
            &["data", "datasets", id.as_str(), "datasetThumbnail"],
            &[],
            Some(&body),
        )
        .await?;
    store(
        &state,
        &id,
        dataset.cache_version,
        ThumbnailRecord {
            layer: DATASET_LAYER_SENTINEL,
            width,
            height,
            mapping: None,
            mag: Vec3Int::ones(),
            bounding_box: [x, y, center.z, mag1_width, mag1_height, 1],
        },
        &response.bytes,
    )
    .await?;
    Ok(image_response(response.bytes))
}

#[cfg(test)]
mod tests;
