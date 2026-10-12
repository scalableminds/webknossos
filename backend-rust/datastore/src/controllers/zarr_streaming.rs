//! ZarrStreamingController: wk layers streamed as Zarr v2 (`/zarr`) and v3 (`/zarr3`,
//! `/zarr3_experimental`), for datasets and for annotation private links (volume annotation
//! layers are proxied to the tracingstore; other layers come from the annotation's dataset).
//!
//! Play `defaultErrorCode` is `NOT_FOUND` for this controller: failures without an explicit status
//! answer 404 (applied by [`not_found_by_default`]).
use axum::{
    Router,
    extract::{Path, Request, State},
    http::{HeaderValue, StatusCode, header},
    middleware::{self, Next},
    response::{Html, IntoResponse, Response},
    routing::get,
};
use serde_json::{Value, json};

use crate::{
    AppState,
    access::{AccessResult, TokenContext, UserAccessRequest},
    controller,
    datareaders::zarr::{
        FILENAME_DOT_ZARRAY, ZarrHeader,
        ngff::{
            FILENAME_DOT_ZATTRS, FILENAME_DOT_ZGROUP, NgffGroupHeader, NgffMetadata,
            NgffMetadataV0_5,
        },
    },
    error::{DsError, DsResult},
    models::{
        BUCKET_LENGTH, FILENAME_DATASOURCE_PROPERTIES_JSON, StaticLayer, UsableDataSource, Vec3Int,
        data_requests::{
            Cuboid, DataServiceDataRequest, DataServiceRequestSettings, VoxelPosition,
        },
        json::PlayValue,
    },
    services::zarr_streaming::{
        FILENAME_ZARR_JSON, convert_layer_to_zarr_layer, directory_html, parse_dot_coordinates,
        reorder_additional_axes, zarr3_array_header_json,
    },
};

use super::helpers::dataset_id;
use crate::models::annotation::AnnotationSource;

const SOURCE_NOT_FOUND: &str =
    "Data source not found on data store server. It may still be initializing.";
const CHUNK_LOADING_ERROR: &str = "Failed to load zarr chunk for streaming.";

pub fn router() -> Router<AppState> {
    let routes = Router::new()
        // Zarr v2
        .route("/data/zarr/{datasetId}", get(source_dir::<2>))
        .route("/data/zarr/{datasetId}/", get(source_dir::<2>))
        .route("/data/zarr/{datasetId}/.zgroup", get(z_group_root))
        .route(
            "/data/zarr/{datasetId}/datasource-properties.json",
            get(data_source::<2>),
        )
        .route(
            "/data/zarr/{datasetId}/{dataLayerName}",
            get(layer_dir::<2>),
        )
        .route(
            "/data/zarr/{datasetId}/{dataLayerName}/",
            get(layer_dir::<2>),
        )
        .route(
            "/data/zarr/{datasetId}/{dataLayerName}/.zattrs",
            get(z_attrs),
        )
        .route(
            "/data/zarr/{datasetId}/{dataLayerName}/.zgroup",
            get(z_group_layer),
        )
        .route(
            "/data/zarr/{datasetId}/{dataLayerName}/{mag}",
            get(mag_dir::<2>),
        )
        .route(
            "/data/zarr/{datasetId}/{dataLayerName}/{mag}/",
            get(mag_dir::<2>),
        )
        .route(
            "/data/zarr/{datasetId}/{dataLayerName}/{mag}/.zarray",
            get(z_array),
        )
        .route(
            "/data/zarr/{datasetId}/{dataLayerName}/{mag}/{coordinates}",
            get(raw_cube),
        )
        // Zarr v3
        .route("/data/zarr3/{datasetId}", get(source_dir::<3>))
        .route("/data/zarr3/{datasetId}/", get(source_dir::<3>))
        .route(
            "/data/zarr3/{datasetId}/datasource-properties.json",
            get(data_source::<3>),
        )
        .route(
            "/data/zarr3/{datasetId}/{dataLayerName}",
            get(layer_dir::<3>),
        )
        .route(
            "/data/zarr3/{datasetId}/{dataLayerName}/",
            get(layer_dir::<3>),
        )
        .route(
            "/data/zarr3/{datasetId}/{dataLayerName}/zarr.json",
            get(zarr_json_layer),
        )
        .route(
            "/data/zarr3/{datasetId}/{dataLayerName}/{mag}",
            get(mag_dir::<3>),
        )
        .route(
            "/data/zarr3/{datasetId}/{dataLayerName}/{mag}/",
            get(mag_dir::<3>),
        )
        .route(
            "/data/zarr3/{datasetId}/{dataLayerName}/{mag}/zarr.json",
            get(zarr_json_mag),
        )
        .route(
            "/data/zarr3/{datasetId}/{dataLayerName}/{mag}/{coordinates}",
            get(raw_cube),
        )
        // Zarr v3, legacy experimental prefix
        .route("/data/zarr3_experimental/{datasetId}", get(source_dir::<3>))
        .route(
            "/data/zarr3_experimental/{datasetId}/",
            get(source_dir::<3>),
        )
        .route(
            "/data/zarr3_experimental/{datasetId}/datasource-properties.json",
            get(data_source::<3>),
        )
        .route(
            "/data/zarr3_experimental/{datasetId}/{dataLayerName}",
            get(layer_dir::<3>),
        )
        .route(
            "/data/zarr3_experimental/{datasetId}/{dataLayerName}/",
            get(layer_dir::<3>),
        )
        .route(
            "/data/zarr3_experimental/{datasetId}/{dataLayerName}/zarr.json",
            get(zarr_json_layer),
        )
        .route(
            "/data/zarr3_experimental/{datasetId}/{dataLayerName}/{mag}",
            get(mag_dir::<3>),
        )
        .route(
            "/data/zarr3_experimental/{datasetId}/{dataLayerName}/{mag}/",
            get(mag_dir::<3>),
        )
        .route(
            "/data/zarr3_experimental/{datasetId}/{dataLayerName}/{mag}/zarr.json",
            get(zarr_json_mag),
        )
        .route(
            "/data/zarr3_experimental/{datasetId}/{dataLayerName}/{mag}/{coordinates}",
            get(raw_cube),
        )
        // Annotation private links
        .route("/data/annotations/zarr/{accessTokenOrId}", get(private_source_dir::<2>))
        .route("/data/annotations/zarr/{accessTokenOrId}/", get(private_source_dir::<2>))
        .route("/data/annotations/zarr/{accessTokenOrId}/.zgroup", get(private_z_group_root))
        .route("/data/annotations/zarr/{accessTokenOrId}/datasource-properties.json", get(private_data_source::<2>))
        .route("/data/annotations/zarr/{accessTokenOrId}/{dataLayerName}", get(private_layer_dir::<2>))
        .route("/data/annotations/zarr/{accessTokenOrId}/{dataLayerName}/", get(private_layer_dir::<2>))
        .route("/data/annotations/zarr/{accessTokenOrId}/{dataLayerName}/.zattrs", get(private_z_attrs))
        .route("/data/annotations/zarr/{accessTokenOrId}/{dataLayerName}/.zgroup", get(private_z_group_layer))
        .route("/data/annotations/zarr/{accessTokenOrId}/{dataLayerName}/{mag}", get(private_mag_dir::<2>))
        .route("/data/annotations/zarr/{accessTokenOrId}/{dataLayerName}/{mag}/", get(private_mag_dir::<2>))
        .route("/data/annotations/zarr/{accessTokenOrId}/{dataLayerName}/{mag}/.zarray", get(private_z_array))
        .route("/data/annotations/zarr/{accessTokenOrId}/{dataLayerName}/{mag}/{coordinates}", get(private_raw_cube))
        .route("/data/annotations/zarr3/{accessTokenOrId}", get(private_source_dir::<3>))
        .route("/data/annotations/zarr3/{accessTokenOrId}/", get(private_source_dir::<3>))
        .route("/data/annotations/zarr3/{accessTokenOrId}/datasource-properties.json", get(private_data_source::<3>))
        .route("/data/annotations/zarr3/{accessTokenOrId}/{dataLayerName}", get(private_layer_dir::<3>))
        .route("/data/annotations/zarr3/{accessTokenOrId}/{dataLayerName}/", get(private_layer_dir::<3>))
        .route("/data/annotations/zarr3/{accessTokenOrId}/{dataLayerName}/zarr.json", get(private_zarr_json_layer))
        .route("/data/annotations/zarr3/{accessTokenOrId}/{dataLayerName}/{mag}", get(private_mag_dir::<3>))
        .route("/data/annotations/zarr3/{accessTokenOrId}/{dataLayerName}/{mag}/", get(private_mag_dir::<3>))
        .route("/data/annotations/zarr3/{accessTokenOrId}/{dataLayerName}/{mag}/zarr.json", get(private_zarr_json_mag))
        .route("/data/annotations/zarr3/{accessTokenOrId}/{dataLayerName}/{mag}/{coordinates}", get(private_raw_cube))
        .route("/data/annotations/zarr3_experimental/{accessTokenOrId}", get(private_source_dir::<3>))
        .route("/data/annotations/zarr3_experimental/{accessTokenOrId}/", get(private_source_dir::<3>))
        .route("/data/annotations/zarr3_experimental/{accessTokenOrId}/datasource-properties.json", get(private_data_source::<3>))
        .route("/data/annotations/zarr3_experimental/{accessTokenOrId}/{dataLayerName}", get(private_layer_dir::<3>))
        .route("/data/annotations/zarr3_experimental/{accessTokenOrId}/{dataLayerName}/", get(private_layer_dir::<3>))
        .route("/data/annotations/zarr3_experimental/{accessTokenOrId}/{dataLayerName}/zarr.json", get(private_zarr_json_layer))
        .route("/data/annotations/zarr3_experimental/{accessTokenOrId}/{dataLayerName}/{mag}", get(private_mag_dir::<3>))
        .route("/data/annotations/zarr3_experimental/{accessTokenOrId}/{dataLayerName}/{mag}/", get(private_mag_dir::<3>))
        .route("/data/annotations/zarr3_experimental/{accessTokenOrId}/{dataLayerName}/{mag}/zarr.json", get(private_zarr_json_mag))
        .route("/data/annotations/zarr3_experimental/{accessTokenOrId}/{dataLayerName}/{mag}/{coordinates}", get(private_raw_cube))
        .route_layer(middleware::from_fn(not_found_by_default));
    controller(routes, true)
}

/// Play `defaultErrorCode = NOT_FOUND`: no handler of this controller sets an explicit 400, so
/// every 400 is a failure that took the controller default. A `datasetId` that is not an ObjectId
/// fails in Play's route binder before the action runs and keeps its 400 (private-link routes
/// take a plain String).
async fn not_found_by_default(request: Request, next: Next) -> Response {
    // ["", "data", "zarr…", datasetId, …] or ["", "data", "annotations", "zarr…", token, …]
    let mut segments = request.uri().path().split('/').skip(2);
    let binder_ok = match segments.next() {
        Some("annotations") => true,
        _ => segments.next().is_some_and(|id| dataset_id(id).is_ok()),
    };
    let mut response = next.run(request).await;
    if binder_ok && response.status() == StatusCode::BAD_REQUEST {
        *response.status_mut() = StatusCode::NOT_FOUND;
    }
    response
}

/// JSON rendered like Play/Jackson (whole doubles without `.0`).
fn play_json(value: &Value) -> Response {
    let body = serde_json::to_vec(&PlayValue(value)).expect("JSON values serialize");
    (
        [(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        )],
        body,
    )
        .into_response()
}

fn to_value(value: impl serde::Serialize) -> DsResult<Value> {
    serde_json::to_value(value).map_err(DsError::from_exception)
}

async fn authorize(state: &AppState, tc: &TokenContext, id: &str) -> AccessResult<String> {
    let id = dataset_id(id)?;
    state
        .access
        .validate_access(UserAccessRequest::read_dataset(&id), tc)
        .await?;
    Ok(id)
}

async fn layer_or_not_found(
    state: &AppState,
    id: &str,
    layer: &str,
) -> DsResult<(
    std::sync::Arc<UsableDataSource>,
    std::sync::Arc<StaticLayer>,
)> {
    state
        .datasets
        .get_with_layer(id, layer)
        .await
        .map_err(|e| e.wrap(SOURCE_NOT_FOUND).with_status(StatusCode::NOT_FOUND))
}

/// `Vec3Int.fromMagLiteral(mag, allowScalar = true)` + `containsMag`, both `~> NOT_FOUND`.
fn existing_mag(layer: &StaticLayer, layer_name: &str, mag: &str) -> DsResult<Vec3Int> {
    let parsed = Vec3Int::from_mag_literal(mag, true).ok_or_else(|| {
        DsError::failure(format!("Invalid mag “{mag}”. Please use “x-y-z”."))
            .with_status(StatusCode::NOT_FOUND)
    })?;
    if !layer.contains_mag(parsed) {
        return Err(DsError::failure(format!(
            "Data layer “{layer_name}” does not have mag “{mag}”."
        ))
        .with_status(StatusCode::NOT_FOUND));
    }
    Ok(parsed)
}

fn html(body: String) -> Response {
    Html(body).into_response()
}

fn source_dir_entries<const V: u8>() -> Vec<String> {
    let mut entries = vec![FILENAME_DATASOURCE_PROPERTIES_JSON.to_owned()];
    if V == 2 {
        entries.push(FILENAME_DOT_ZGROUP.to_owned());
    }
    entries
}

async fn source_dir<const V: u8>(
    State(state): State<AppState>,
    tc: TokenContext,
    Path(id): Path<String>,
) -> AccessResult<Response> {
    let id = authorize(&state, &tc, &id).await?;
    let source = state
        .datasets
        .get_by_id(&id)
        .await
        .map_err(|e| e.wrap(SOURCE_NOT_FOUND).with_status(StatusCode::NOT_FOUND))?;
    let mut entries = source_dir_entries::<V>();
    entries.extend(source.data_layers.iter().map(|l| l.name.clone()));
    Ok(html(directory_html("Datastore", &id, &entries)))
}

fn z_group_json() -> Response {
    play_json(&json!(NgffGroupHeader { zarr_format: 2 }))
}

async fn z_group_root(
    State(state): State<AppState>,
    tc: TokenContext,
    Path(id): Path<String>,
) -> AccessResult<Response> {
    authorize(&state, &tc, &id).await?;
    Ok(z_group_json())
}

async fn z_group_layer(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((id, _layer)): Path<(String, String)>,
) -> AccessResult<Response> {
    authorize(&state, &tc, &id).await?;
    Ok(z_group_json())
}

/// Scala `convertLayerToZarrLayer` for every layer, as a JSON array.
fn zarr_layers(layers: &[StaticLayer], zarr_version: u8) -> DsResult<Vec<Value>> {
    layers
        .iter()
        .map(|l| to_value(&convert_layer_to_zarr_layer(l, zarr_version)?))
        .collect()
}

/// Scala `UsableDataSource(id, layers, scale)` JSON with already serialized layers.
fn zarr_source_json(source: &UsableDataSource, layers: Vec<Value>) -> DsResult<Value> {
    let mut value = to_value(UsableDataSource {
        data_layers: Vec::new(),
        default_view_configuration: None,
        status_opt: None,
        ..source.clone()
    })?;
    value["dataLayers"] = Value::Array(layers);
    Ok(value)
}

async fn data_source<const V: u8>(
    State(state): State<AppState>,
    tc: TokenContext,
    Path(id): Path<String>,
) -> AccessResult<Response> {
    let id = authorize(&state, &tc, &id).await?;
    let source = state
        .datasets
        .get_by_id(&id)
        .await
        .map_err(|e| e.with_status(StatusCode::NOT_FOUND))?;
    let layers = zarr_layers(&source.data_layers, V)?;
    Ok(play_json(&zarr_source_json(&source, layers)?))
}

async fn layer_dir<const V: u8>(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((id, layer_name)): Path<(String, String)>,
) -> AccessResult<Response> {
    let id = authorize(&state, &tc, &id).await?;
    Ok(layer_dir_inner(&state, &id, &layer_name, V).await?)
}

async fn layer_dir_inner(
    state: &AppState,
    id: &str,
    layer_name: &str,
    zarr_version: u8,
) -> DsResult<Response> {
    let (_, layer) = layer_or_not_found(state, id, layer_name).await?;
    let mut entries: Vec<String> = if zarr_version == 2 {
        vec![FILENAME_DOT_ZATTRS.into(), FILENAME_DOT_ZGROUP.into()]
    } else {
        vec![FILENAME_ZARR_JSON.into()]
    };
    entries.extend(layer.sorted_mags().iter().map(|m| m.to_mag_literal(true)));
    Ok(html(directory_html(
        "Datastore",
        &format!("{id}/{layer_name}"),
        &entries,
    )))
}

async fn z_attrs(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((id, layer_name)): Path<(String, String)>,
) -> AccessResult<Response> {
    let id = authorize(&state, &tc, &id).await?;
    Ok(z_attrs_inner(&state, &id, &layer_name).await?)
}

async fn z_attrs_inner(state: &AppState, id: &str, layer_name: &str) -> DsResult<Response> {
    let (source, layer) = layer_or_not_found(state, id, layer_name).await?;
    let header = NgffMetadata::from_name_voxel_size_and_mags(
        layer_name,
        &source.scale,
        &layer.sorted_mags(),
    );
    Ok(play_json(&to_value(&header)?))
}

async fn zarr_json_layer(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((id, layer_name)): Path<(String, String)>,
) -> AccessResult<Response> {
    let id = authorize(&state, &tc, &id).await?;
    Ok(zarr_json_layer_inner(&state, &id, &layer_name).await?)
}

async fn zarr_json_layer_inner(state: &AppState, id: &str, layer_name: &str) -> DsResult<Response> {
    let (source, layer) = layer_or_not_found(state, id, layer_name).await?;
    let ngff = NgffMetadataV0_5::from_name_voxel_size_and_mags(
        layer_name,
        &source.scale,
        &layer.sorted_mags(),
        layer.additional_axes.as_ref().map_or(0, Vec::len),
        "0.5",
    );
    // Scala `NgffZarr3GroupHeader` writes.
    let group =
        json!({"zarr_format": 3, "node_type": "group", "attributes": {"ome": to_value(&ngff)?}});
    Ok(play_json(&group))
}

async fn mag_dir<const V: u8>(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((id, layer_name, mag)): Path<(String, String, String)>,
) -> AccessResult<Response> {
    let id = authorize(&state, &tc, &id).await?;
    Ok(mag_dir_inner(&state, &id, &layer_name, &mag, V).await?)
}

async fn mag_dir_inner(
    state: &AppState,
    id: &str,
    layer_name: &str,
    mag: &str,
    zarr_version: u8,
) -> DsResult<Response> {
    let (_, layer) = state
        .datasets
        .get_with_layer(id, layer_name)
        .await
        .map_err(|e| e.with_status(StatusCode::NOT_FOUND))?;
    existing_mag(&layer, layer_name, mag)?;
    let entry = if zarr_version == 2 {
        FILENAME_DOT_ZARRAY
    } else {
        FILENAME_ZARR_JSON
    };
    Ok(html(directory_html(
        "Datastore",
        &format!("{id}/{layer_name}/{mag}"),
        &[entry.to_owned()],
    )))
}

async fn z_array(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((id, layer_name, mag)): Path<(String, String, String)>,
) -> AccessResult<Response> {
    let id = authorize(&state, &tc, &id).await?;
    Ok(z_array_inner(&state, &id, &layer_name, &mag).await?)
}

async fn z_array_inner(
    state: &AppState,
    id: &str,
    layer_name: &str,
    mag: &str,
) -> DsResult<Response> {
    let (_, layer) = layer_or_not_found(state, id, layer_name).await?;
    let mag = existing_mag(&layer, layer_name, mag)?;
    let header = ZarrHeader::from_layer(
        layer.element_class,
        layer.additional_axes.as_deref(),
        &layer.bounding_box,
        mag,
    );
    Ok(play_json(&header.to_json()))
}

async fn zarr_json_mag(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((id, layer_name, mag)): Path<(String, String, String)>,
) -> AccessResult<Response> {
    let id = authorize(&state, &tc, &id).await?;
    Ok(zarr_json_mag_inner(&state, &id, &layer_name, &mag).await?)
}

async fn zarr_json_mag_inner(
    state: &AppState,
    id: &str,
    layer_name: &str,
    mag: &str,
) -> DsResult<Response> {
    let (_, layer) = layer_or_not_found(state, id, layer_name).await?;
    let mag = existing_mag(&layer, layer_name, mag)?;
    Ok(play_json(&zarr3_array_header_json(&layer, mag)))
}

async fn raw_cube(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((id, layer_name, mag, coordinates)): Path<(String, String, String, String)>,
) -> AccessResult<Response> {
    let id = authorize(&state, &tc, &id).await?;
    Ok(raw_cube_inner(&state, &tc, &id, &layer_name, &mag, &coordinates).await?)
}

async fn raw_cube_inner(
    state: &AppState,
    tc: &TokenContext,
    id: &str,
    layer_name: &str,
    mag: &str,
    coordinates: &str,
) -> DsResult<Response> {
    let (source, layer) = state
        .datasets
        .get_with_layer(id, layer_name)
        .await
        .map_err(|e| e.with_status(StatusCode::SERVICE_UNAVAILABLE))?;
    let axes = reorder_additional_axes(layer.additional_axes.as_deref().unwrap_or_default());
    // Coordinate and mag failures stay 404: neuroglancer probes `:layer/:mag/.zattrs`.
    let (x, y, z, additional_coordinates) =
        parse_dot_coordinates(coordinates, &axes).map_err(|e| {
            e.wrap(format!(
                "Invalid chunk coordinates {coordinates}. Expected dot-separated coordinates like “c.<additional_axes.>x.y.z”."
            ))
            .with_status(StatusCode::NOT_FOUND)
        })?;
    let mag = existing_mag(&layer, layer_name, mag)?;
    let cube = BUCKET_LENGTH;
    // Scala Int arithmetic wraps.
    let top_left = Vec3Int::new(
        x.wrapping_mul(cube).wrapping_mul(mag.x),
        y.wrapping_mul(cube).wrapping_mul(mag.y),
        z.wrapping_mul(cube).wrapping_mul(mag.z),
    );
    let request = DataServiceDataRequest {
        dataset_id: Some(id.to_owned()),
        data_source_id: Some(source.id.clone()),
        data_layer: layer,
        cuboid: Cuboid::new(VoxelPosition::new(top_left, mag)?, Vec3Int::full(cube)),
        settings: DataServiceRequestSettings {
            additional_coordinates,
            ..Default::default()
        },
    };
    let result = state
        .binary_data
        .handle_data_requests(&[request], tc.user_token.as_deref())
        .await;
    if !result.missing_indices.is_empty() || !result.failed_indices.is_empty() {
        return Err(
            DsError::failure(CHUNK_LOADING_ERROR).with_status(StatusCode::INTERNAL_SERVER_ERROR)
        );
    }
    Ok(octet_stream(result.data))
}

fn octet_stream(data: Vec<u8>) -> Response {
    ([(header::CONTENT_TYPE, "application/octet-stream")], data).into_response()
}

// ---- annotation private links ------------------------------------------------------------------

/// Scala `remoteWebknossosClient.getAnnotationSource(accessToken) ~> NOT_FOUND`.
async fn annotation_source(
    state: &AppState,
    access_token: &str,
    tc: &TokenContext,
) -> DsResult<AnnotationSource> {
    let value = state
        .wk_client
        .get_annotation_source(access_token, tc)
        .await
        .map_err(|e| e.with_status(StatusCode::NOT_FOUND))?;
    AnnotationSource::from_json(value)
}

/// Token context for tracingstore requests: the private link itself when access goes through it.
fn relevant_token_context(
    source: &AnnotationSource,
    access_token: &str,
    tc: &TokenContext,
) -> TokenContext {
    if source.access_via_private_link {
        TokenContext::new(Some(access_token.to_owned()))
    } else {
        tc.clone()
    }
}

/// Scala `ifIsAnnotationLayerOrElse`: the annotation layer (with the relevant token context) if
/// the name is one of the annotation's layers, otherwise the dataset branch.
enum LayerTarget {
    Annotation {
        tracing_id: String,
        tracing_store_url: String,
        tc: TokenContext,
    },
    Dataset {
        dataset_id: String,
    },
}

async fn layer_target(
    state: &AppState,
    access_token: &str,
    layer_name: &str,
    tc: &TokenContext,
) -> DsResult<LayerTarget> {
    let source = annotation_source(state, access_token, tc).await?;
    Ok(match source.annotation_layer(layer_name) {
        Some(layer) => LayerTarget::Annotation {
            tracing_id: layer.tracing_id.clone(),
            tracing_store_url: source.tracing_store_url.clone(),
            tc: relevant_token_context(&source, access_token, tc),
        },
        None => LayerTarget::Dataset {
            dataset_id: source.dataset_id.clone(),
        },
    })
}

async fn private_source_dir<const V: u8>(
    State(state): State<AppState>,
    tc: TokenContext,
    Path(access_token): Path<String>,
) -> AccessResult<Response> {
    // Scala: no `~> NOT_FOUND` here, but the controller default is 404 anyway.
    let source = annotation_source(&state, &access_token, &tc).await?;
    let data_source = state
        .datasets
        .get_by_id(&source.dataset_id)
        .await
        .map_err(|e| e.wrap(SOURCE_NOT_FOUND).with_status(StatusCode::NOT_FOUND))?;
    let annotation_names: Vec<String> = source.volume_layers().map(|l| l.name.clone()).collect();
    let mut entries = source_dir_entries::<V>();
    entries.extend(annotation_names.iter().cloned());
    entries.extend(
        data_source
            .data_layers
            .iter()
            .map(|l| l.name.clone())
            .filter(|n| !annotation_names.contains(n)),
    );
    Ok(html(directory_html(
        "Combined datastore and tracingstore directory",
        &access_token,
        &entries,
    )))
}

async fn private_data_source<const V: u8>(
    State(state): State<AppState>,
    tc: TokenContext,
    Path(access_token): Path<String>,
) -> AccessResult<Response> {
    let source = annotation_source(&state, &access_token, &tc).await?;
    let relevant_tc = relevant_token_context(&source, &access_token, &tc);
    let volume_layers: Vec<_> = source.volume_layers().collect();
    let data_source = state
        .datasets
        .get_by_id(&source.dataset_id)
        .await
        .map_err(|e| e.wrap(SOURCE_NOT_FOUND).with_status(StatusCode::NOT_FOUND))?;
    let remaining: Vec<StaticLayer> = data_source
        .data_layers
        .iter()
        .filter(|l| !volume_layers.iter().any(|v| v.name == l.name))
        .cloned()
        .collect();
    let mut layers = zarr_layers(&remaining, V)?;
    for layer in volume_layers {
        let raw = state
            .tracingstore
            .volume_layer_as_zarr_layer(
                &source.tracing_store_url,
                &layer.tracing_id,
                Some(&layer.name),
                V,
                &relevant_tc,
            )
            .await?;
        // Scala reads a `StaticSegmentationLayer` and writes it back.
        let parsed = StaticLayer::from_json(&raw)
            .map_err(|e| DsError::failure(e.validation_failure_message()))?;
        layers.push(to_value(&parsed)?);
    }
    Ok(play_json(&zarr_source_json(&data_source, layers)?))
}

async fn private_z_group_root(
    State(state): State<AppState>,
    tc: TokenContext,
    Path(access_token): Path<String>,
) -> AccessResult<Response> {
    Ok(private_z_group_inner(&state, &tc, &access_token, "").await?)
}

async fn private_z_group_layer(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((access_token, layer_name)): Path<(String, String)>,
) -> AccessResult<Response> {
    Ok(private_z_group_inner(&state, &tc, &access_token, &layer_name).await?)
}

async fn private_z_group_inner(
    state: &AppState,
    tc: &TokenContext,
    access_token: &str,
    layer_name: &str,
) -> DsResult<Response> {
    match layer_target(state, access_token, layer_name, tc).await? {
        LayerTarget::Annotation {
            tracing_id,
            tracing_store_url,
            tc,
        } => Ok(play_json(
            &state
                .tracingstore
                .z_group(&tracing_store_url, &tracing_id, &tc)
                .await?,
        )),
        LayerTarget::Dataset { .. } => Ok(z_group_json()),
    }
}

async fn private_layer_dir<const V: u8>(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((access_token, layer_name)): Path<(String, String)>,
) -> AccessResult<Response> {
    Ok(
        match layer_target(&state, &access_token, &layer_name, &tc).await? {
            LayerTarget::Annotation {
                tracing_id,
                tracing_store_url,
                tc,
            } => {
                let entries = state
                    .tracingstore
                    .layer_directory_contents(&tracing_store_url, &tracing_id, V, &tc)
                    .await?;
                html(directory_html("Tracingstore", &tracing_id, &entries))
            }
            LayerTarget::Dataset { dataset_id } => {
                layer_dir_inner(&state, &dataset_id, &layer_name, V).await?
            }
        },
    )
}

async fn private_z_attrs(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((access_token, layer_name)): Path<(String, String)>,
) -> AccessResult<Response> {
    Ok(
        match layer_target(&state, &access_token, &layer_name, &tc).await? {
            LayerTarget::Annotation {
                tracing_id,
                tracing_store_url,
                tc,
            } => play_json(
                &state
                    .tracingstore
                    .ome_ngff_header(&tracing_store_url, &tracing_id, &tc)
                    .await?,
            ),
            LayerTarget::Dataset { dataset_id } => {
                z_attrs_inner(&state, &dataset_id, &layer_name).await?
            }
        },
    )
}

async fn private_zarr_json_layer(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((access_token, layer_name)): Path<(String, String)>,
) -> AccessResult<Response> {
    Ok(
        match layer_target(&state, &access_token, &layer_name, &tc).await? {
            LayerTarget::Annotation {
                tracing_id,
                tracing_store_url,
                tc,
            } => play_json(
                &state
                    .tracingstore
                    .zarr_json_group_header(&tracing_store_url, &tracing_id, &tc)
                    .await?,
            ),
            LayerTarget::Dataset { dataset_id } => {
                zarr_json_layer_inner(&state, &dataset_id, &layer_name).await?
            }
        },
    )
}

async fn private_mag_dir<const V: u8>(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((access_token, layer_name, mag)): Path<(String, String, String)>,
) -> AccessResult<Response> {
    Ok(
        match layer_target(&state, &access_token, &layer_name, &tc).await? {
            LayerTarget::Annotation {
                tracing_id,
                tracing_store_url,
                tc,
            } => {
                let entries = state
                    .tracingstore
                    .mag_directory_contents(&tracing_store_url, &tracing_id, &mag, V, &tc)
                    .await?;
                html(directory_html(
                    "Combined Annotation Route",
                    &tracing_id,
                    &entries,
                ))
            }
            LayerTarget::Dataset { dataset_id } => {
                mag_dir_inner(&state, &dataset_id, &layer_name, &mag, V).await?
            }
        },
    )
}

async fn private_z_array(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((access_token, layer_name, mag)): Path<(String, String, String)>,
) -> AccessResult<Response> {
    Ok(
        match layer_target(&state, &access_token, &layer_name, &tc).await? {
            LayerTarget::Annotation {
                tracing_id,
                tracing_store_url,
                tc,
            } => {
                let raw = state
                    .tracingstore
                    .z_array(&tracing_store_url, &tracing_id, &mag, &tc)
                    .await?;
                // Scala reads a `ZarrHeader` and writes it back.
                play_json(&ZarrHeader::from_json(&raw)?.to_json())
            }
            LayerTarget::Dataset { dataset_id } => {
                z_array_inner(&state, &dataset_id, &layer_name, &mag).await?
            }
        },
    )
}

async fn private_zarr_json_mag(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((access_token, layer_name, mag)): Path<(String, String, String)>,
) -> AccessResult<Response> {
    Ok(
        match layer_target(&state, &access_token, &layer_name, &tc).await? {
            LayerTarget::Annotation {
                tracing_id,
                tracing_store_url,
                tc,
            } => play_json(
                &state
                    .tracingstore
                    .zarr_json(&tracing_store_url, &tracing_id, &mag, &tc)
                    .await?,
            ),
            LayerTarget::Dataset { dataset_id } => {
                zarr_json_mag_inner(&state, &dataset_id, &layer_name, &mag).await?
            }
        },
    )
}

async fn private_raw_cube(
    State(state): State<AppState>,
    tc: TokenContext,
    Path((access_token, layer_name, mag, coordinates)): Path<(String, String, String, String)>,
) -> AccessResult<Response> {
    Ok(
        match layer_target(&state, &access_token, &layer_name, &tc).await? {
            LayerTarget::Annotation {
                tracing_id,
                tracing_store_url,
                tc,
            } => octet_stream(
                state
                    .tracingstore
                    .raw_zarr_cube(&tracing_store_url, &tracing_id, &mag, &coordinates, &tc)
                    .await?,
            ),
            LayerTarget::Dataset { dataset_id } => {
                raw_cube_inner(&state, &tc, &dataset_id, &layer_name, &mag, &coordinates).await?
            }
        },
    )
}
