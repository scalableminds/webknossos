//! AnnotationIOController.upload (`POST /annotations/upload`): creates one
//! Explorational annotation from uploaded NML files and zips (NMLs plus volume
//! data / editable-mapping edge zips).
//!
//! Multipart body: every file part (any field name) in request order and the
//! data parts `createGroupForEachFile` (`== "true"`), `datasetId`,
//! `description`, `fallbackEditPosition` (`Vec3Int.fromUriLiteral`),
//! `fallbackEditRotation` (`Vec3Double.fromUriLiteral`) and
//! `fallbackZoomLevel` (`toDoubleOpt`); the first value of each counts.
//!
//! Scala order: fallbacks (invalid → `Fox.empty`, 404 Msg.notFound) →
//! extraction (`useZipName = true`) → wrapOrPrefixGroups → no success →
//! returnError (400 message list) → name / description / wkUrl →
//! findDatasetForUploadedAnnotations → usableDataSourceFor →
//! adaptVolumeTracingsToFallbackLayer (datastore lookup always, hasSegmentIndex
//! RPC per volume layer with a fallback layer) → tracing store →
//! mergeAndSaveVolumeLayers → mergeAndSaveSkeletonLayers →
//! saveAnnotationProto → insert (layers with `AnnotationLayerStatistics.unknown`
//! = `{}`) → analytics `upload_annotation`. The response is
//! `{"annotation":{"typ":"Explorational","id":…},"messages":[{"success":…}]}`.
//!
//! The database insert is the last step, so every RPC failure leaves no rows
//! (tracing-store data written before the failure is orphaned, as in Scala).
//!
//! Body limit: Play buffers multipart files on disk up to `maxDiskBuffer = 1G`
//! (application.conf); this router raises the crate-wide default to 1 GiB for
//! this route only. Unlike Play, the parts are held in memory.
use std::collections::HashMap;
use std::io::{Cursor, Write};

use axum::{
    Json, Router,
    body::Bytes,
    extract::{
        DefaultBodyLimit, FromRequestParts, Multipart, State, multipart::MultipartRejection,
    },
    http::{StatusCode, request::Parts},
    response::{IntoResponse, Response},
    routing::post,
};
use chrono::{DateTime, Utc};
use serde_json::{Map, json};
use sqlx::PgPool;

use crate::{
    AppState,
    annotation_create::{self, DatasetFacts, UsableSource},
    annotation_duplicate::{NewAnnotation, insert_annotation},
    annotation_provider::{
        AnnotationLayer, AnnotationLayerType, AnnotationProvider, FoxFailure, ProviderError,
    },
    annotation_upload_service::{
        ExtractionLimits, MSG_UPLOAD_SUCCESS, MultiNmlParseResult, PgDatasetLookup,
        extract_from_files, find_dataset_for_uploaded_annotations, return_error, upload_metadata,
        wrap_or_prefix_groups,
    },
    application_info::MiscState,
    auth::AuthUser,
    dataset_source::{Category, DataSource, Layer},
    error::{ApiError, ApiResult},
    id::ObjectId,
    nml_parser::{NmlParseResult, SharedParsingParameters, UploadedVolumeLayer},
    proto::{
        AnnotationLayerProto, AnnotationLayerTypeProto, AnnotationProto, BoundingBoxProto,
        SkeletonTracing, Vec3DoubleProto, Vec3IntProto, VolumeTracing,
    },
    service_clients::{ServiceClients, ServiceError},
    tracing_initialization::{
        DEFAULT_SKELETON_LAYER_NAME, DEFAULT_VOLUME_LAYER_NAME,
        combine_largest_segment_ids_by_precedence, data_source_bounding_box,
        element_class_to_proto, mags_for_volume_tracing,
    },
    tracingstore_client::{TracingStoreClient, VolumeSaveDataSource},
};

/// Play `parser.maxDiskBuffer` (multipart files).
const PLAY_MAX_DISK_BUFFER: usize = 1024 * 1024 * 1024;

/// Rust-only: Play rejects malformed multipart bodies before the action runs.
const MULTIPART_INVALID: &str = "Could not parse multipart request.";
/// Msg.notFound (Fox.empty of an unparsable fallback value).
const RESOURCE_NOT_FOUND: &str = "Could not find or access the requested resource.";
const DUPLICATE_FALLBACK_LAYER: &str = "Cannot save annotation with multiple volume layers that have the same fallback segmentation layer.";
const MULTIPLE_MULTI_LAYER: &str =
    "Cannot merge multiple annotations that each have multiple volume layers.";
const MULTIPLE_EDITABLE_MAPPINGS: &str =
    "Cannot merge multiple annotations with editable mapping (proofreading) edges.";
/// Msg.Annotation.uploadEditableMappingIncompleteInformation.
const EDITABLE_MAPPING_INCOMPLETE: &str =
    "Could not store editable mapping, either file or baseMappingName is missing.";
/// VolumeTracingDefaults.elementClass.
const VOLUME_DEFAULT_ELEMENT_CLASS: &str = "uint32";

pub fn router(_jobs_enabled: bool) -> Router<AppState> {
    Router::new()
        .route("/annotations/upload", post(upload))
        .layer(DefaultBodyLimit::max(PLAY_MAX_DISK_BUFFER))
}

// ---------------------------------------------------------------------------
// Request plumbing
// ---------------------------------------------------------------------------

struct Services {
    provider: AnnotationProvider,
    clients: ServiceClients,
    tracing_store: TracingStoreClient,
    misc: MiscState,
}

fn extension<T: Clone + Send + Sync + 'static>(parts: &Parts) -> ApiResult<T> {
    parts
        .extensions
        .get::<T>()
        .cloned()
        .ok_or_else(ApiError::internal)
}

impl<S: Send + Sync> FromRequestParts<S> for Services {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Self::Rejection> {
        Ok(Self {
            provider: extension(parts)?,
            clients: extension(parts)?,
            tracing_store: extension(parts)?,
            misc: extension(parts)?,
        })
    }
}

/// Play's `MultipartFormData`: file parts (with a file name) in request order
/// and data parts by name.
struct MultipartBody {
    files: Vec<(String, Bytes)>,
    data_parts: HashMap<String, Vec<String>>,
}

impl MultipartBody {
    /// `dataParts.get(name).flatMap(_.headOption)`.
    fn first(&self, name: &str) -> Option<&str> {
        self.data_parts
            .get(name)
            .and_then(|values| values.first())
            .map(String::as_str)
    }
}

async fn read_multipart(
    multipart: Result<Multipart, MultipartRejection>,
) -> ApiResult<MultipartBody> {
    let invalid = || ApiError::bad_request(MULTIPART_INVALID);
    let mut multipart = multipart.map_err(|_| invalid())?;
    let mut body = MultipartBody {
        files: Vec::new(),
        data_parts: HashMap::new(),
    };
    let field_error = |error: axum::extract::multipart::MultipartError| {
        if error.status() == StatusCode::PAYLOAD_TOO_LARGE {
            ApiError::new(StatusCode::PAYLOAD_TOO_LARGE, "Request Entity Too Large")
        } else {
            invalid()
        }
    };
    while let Some(field) = multipart.next_field().await.map_err(field_error)? {
        let name = field.name().unwrap_or_default().to_owned();
        match field.file_name().map(str::to_owned) {
            Some(file_name) => {
                let bytes = field.bytes().await.map_err(field_error)?;
                body.files.push((file_name, bytes));
            }
            None => {
                let text = field.text().await.map_err(field_error)?;
                body.data_parts.entry(name).or_default().push(text);
            }
        }
    }
    Ok(body)
}

// ---------------------------------------------------------------------------
// Fallback parameters (Vec3Int / Vec3Double.fromUriLiteral, toDoubleOpt)
// ---------------------------------------------------------------------------

/// `java.lang.Double.parseDouble` for decimal literals: surrounding
/// whitespace (chars <= ' ') trimmed, optional `f`/`F`/`d`/`D` suffix,
/// `NaN` and `[+-]Infinity`. Hexadecimal floating literals are not supported.
fn java_parse_double(raw: &str) -> Option<f64> {
    let s = raw.trim_matches(|c: char| c <= ' ');
    match s {
        "NaN" | "+NaN" | "-NaN" => return Some(f64::NAN),
        "Infinity" | "+Infinity" => return Some(f64::INFINITY),
        "-Infinity" => return Some(f64::NEG_INFINITY),
        _ => {}
    }
    let s = s
        .strip_suffix(['f', 'F', 'd', 'D'])
        .filter(|rest| !rest.is_empty())
        .unwrap_or(s);
    let valid = !s.is_empty()
        && s.bytes()
            .all(|b| b.is_ascii_digit() || matches!(b, b'.' | b'e' | b'E' | b'+' | b'-'));
    if !valid {
        return None;
    }
    s.parse::<f64>().ok()
}

/// `Vec3Int.fromUriLiteral`: `(\d+),(\d+),(\d+)` (whole string), each
/// `Integer.parseInt`.
fn parse_vec3_int(raw: &str) -> Option<Vec3IntProto> {
    let parts: Vec<&str> = raw.split(',').collect();
    if parts.len() != 3
        || parts
            .iter()
            .any(|p| p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit()))
    {
        return None;
    }
    let parse = |p: &str| p.parse::<i32>().ok();
    Some(Vec3IntProto {
        x: parse(parts[0])?,
        y: parse(parts[1])?,
        z: parse(parts[2])?,
    })
}

/// `Vec3Double.fromUriLiteral`: `s.trim.split(",")` (Java drops trailing empty
/// strings), every element `parseDouble`, at least three elements.
fn parse_vec3_double(raw: &str) -> Option<Vec3DoubleProto> {
    let trimmed = raw.trim_matches(|c: char| c <= ' ');
    let mut parts: Vec<&str> = trimmed.split(',').collect();
    while parts.len() > 1 && parts.last() == Some(&"") {
        parts.pop();
    }
    let values = parts
        .into_iter()
        .map(java_parse_double)
        .collect::<Option<Vec<f64>>>()?;
    (values.len() >= 3).then(|| Vec3DoubleProto {
        x: values[0],
        y: values[1],
        z: values[2],
    })
}

/// `Fox.runOptional(raw)(parse(_).toFox)`: an unparsable value is Fox.empty.
fn parse_optional<T>(raw: Option<&str>, parse: impl Fn(&str) -> Option<T>) -> ApiResult<Option<T>> {
    raw.map(|value| {
        parse(value).ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, RESOURCE_NOT_FOUND))
    })
    .transpose()
}

// ---------------------------------------------------------------------------
// Fox failures
// ---------------------------------------------------------------------------

fn failure(message: impl Into<String>, status: Option<StatusCode>) -> ProviderError {
    ProviderError::Failure(FoxFailure {
        message: message.into(),
        chain: Vec::new(),
        status,
    })
}

/// RPC failures keep an unsuccessful upstream status (RPCRequest
/// `~> result.status`); transport failures default to 400.
fn service_failure(error: ServiceError) -> ProviderError {
    let status = match error {
        ServiceError::UpstreamStatus(code) => StatusCode::from_u16(code).ok(),
        _ => None,
    };
    failure(error.to_string(), status)
}

// ---------------------------------------------------------------------------
// adaptVolumeTracingsToFallbackLayer
// ---------------------------------------------------------------------------

fn bbox_proto(bbox: &[i32; 6]) -> BoundingBoxProto {
    BoundingBoxProto {
        top_left: Vec3IntProto {
            x: bbox[0],
            y: bbox[1],
            z: bbox[2],
        },
        width: bbox[3],
        height: bbox[4],
        depth: bbox[5],
    }
}

/// BoundingBox.isEmpty of `boundingBoxFromProto`.
fn bbox_proto_is_empty(bbox: &BoundingBoxProto) -> bool {
    bbox.width <= 0 || bbox.height <= 0 || bbox.depth <= 0
}

/// The first StaticSegmentationLayer named like the tracing's fallback layer.
fn fallback_layer_for<'a>(source: &'a DataSource, tracing: &VolumeTracing) -> Option<&'a Layer> {
    let name = tracing.fallback_layer.as_deref()?;
    source
        .layers
        .iter()
        .find(|layer| layer.category == Category::Segmentation && layer.name == name)
}

/// adaptPropertiesToFallbackLayer without the RPC: `has_segment_index` is
/// the `canHaveSegmentIndex` answer (`true` without fallback layer).
fn adapt_properties(
    tracing: &VolumeTracing,
    source: &DataSource,
    fallback: Option<&Layer>,
    has_segment_index: bool,
) -> Result<VolumeTracing, ProviderError> {
    let bounding_box = if bbox_proto_is_empty(&tracing.bounding_box) {
        bbox_proto(
            &fallback
                .map(|layer| layer.bounding_box)
                .unwrap_or_else(|| data_source_bounding_box(source)),
        )
    } else {
        tracing.bounding_box
    };
    let element_class = element_class_to_proto(
        fallback
            .map(|layer| layer.element_class.as_str())
            .unwrap_or(VOLUME_DEFAULT_ELEMENT_CLASS),
    )
    .map_err(|error| failure(error.to_string(), None))?;
    let largest_segment_id = combine_largest_segment_ids_by_precedence(
        // ScalaPB uint64 carries the Long bit pattern.
        tracing.largest_segment_id.map(|id| id as i64),
        fallback.map(|layer| layer.largest_segment_id),
    );
    Ok(VolumeTracing {
        bounding_box,
        element_class: element_class as i32,
        fallback_layer: fallback.map(|layer| layer.name.clone()),
        largest_segment_id: largest_segment_id.map(|id| id as u64),
        mags: mags_for_volume_tracing(source, fallback)
            .into_iter()
            .map(|[x, y, z]| Vec3IntProto { x, y, z })
            .collect(),
        has_segment_index: Some(has_segment_index),
        ..tracing.clone()
    })
}

/// adaptVolumeTracingsToFallbackLayer: the datastore is looked up even when no
/// volume layer was uploaded (`DataStore.notFoundForDataset`); layers are
/// adapted serially, with `hasSegmentIndex` RPCs only for layers whose
/// fallback layer exists in the data source.
async fn adapt_volume_layers(
    pool: &PgPool,
    services: &Services,
    dataset: &DatasetFacts,
    source: &UsableSource,
    groups: Vec<Vec<UploadedVolumeLayer>>,
) -> Result<Vec<Vec<UploadedVolumeLayer>>, ProviderError> {
    let data_store_url = annotation_create::data_store_url(pool, dataset).await?;
    let mut adapted_groups = Vec::with_capacity(groups.len());
    for group in groups {
        let mut adapted = Vec::with_capacity(group.len());
        for mut layer in group {
            let fallback = fallback_layer_for(&source.source, &layer.tracing);
            let has_segment_index = match fallback {
                Some(fallback) => services
                    .clients
                    .has_segment_index(&data_store_url, &dataset.id, &fallback.name)
                    .await
                    .map_err(service_failure)?,
                None => true,
            };
            layer.tracing =
                adapt_properties(&layer.tracing, &source.source, fallback, has_segment_index)?;
            adapted.push(layer);
        }
        adapted_groups.push(adapted);
    }
    Ok(adapted_groups)
}

// ---------------------------------------------------------------------------
// Tracing-store RPC helpers (the RPCs themselves are in TracingStoreClient)
// ---------------------------------------------------------------------------

/// saveEditableMappingIfPresent: nothing to save → 0; only one of zip / base
/// mapping name → `uploadEditableMappingIncompleteInformation`; otherwise
/// `TracingStoreClient::save_editable_mapping` (number of saved versions).
async fn save_editable_mapping_if_present(
    services: &Services,
    url: &str,
    annotation_id: &ObjectId,
    tracing_id: &str,
    edges_zip: Option<&Bytes>,
    base_mapping_name: Option<&str>,
    start_version: i64,
) -> Result<i64, ProviderError> {
    match (edges_zip, base_mapping_name) {
        (Some(zip), Some(base_mapping_name)) => services
            .tracing_store
            .save_editable_mapping(
                url,
                annotation_id,
                tracing_id,
                base_mapping_name,
                start_version,
                zip.to_vec(),
            )
            .await
            .map_err(service_failure),
        (None, None) => Ok(0),
        _ => Err(failure(EDITABLE_MAPPING_INCOMPLETE, None)),
    }
}

/// `ZipIO.zipToTempFile(files)`: one entry per present data zip, in order.
/// Scala names entries after the (unique) temp files; the tracing store
/// ignores entry names, here they are `{index}_{last path component}`.
fn pack_volume_data_zips(zips: &[(&str, &Bytes)]) -> Result<Vec<u8>, ProviderError> {
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .large_file(true);
    for (index, (location, data)) in zips.iter().enumerate() {
        let base = location.rsplit('/').next().unwrap_or(location);
        writer
            .start_file(format!("{index}_{base}"), options)
            .map_err(|_| ApiError::internal())?;
        writer.write_all(data).map_err(|_| ApiError::internal())?;
    }
    let cursor = writer.finish().map_err(|_| ApiError::internal())?;
    Ok(cursor.into_inner())
}

// ---------------------------------------------------------------------------
// mergeAndSaveVolumeLayers / mergeAndSaveSkeletonLayers
// ---------------------------------------------------------------------------

fn has_duplicate_fallback_layer(layers: &[UploadedVolumeLayer]) -> bool {
    let names: Vec<&str> = layers
        .iter()
        .filter_map(|layer| layer.tracing.fallback_layer.as_deref())
        .collect();
    names
        .iter()
        .enumerate()
        .any(|(index, name)| names[..index].contains(name))
}

/// The merge rules of mergeAndSaveVolumeLayers, checked before any RPC.
fn check_volume_merge_rules(groups: &[Vec<UploadedVolumeLayer>]) -> Result<(), ProviderError> {
    if groups
        .iter()
        .any(|group| has_duplicate_fallback_layer(group))
    {
        return Err(failure(DUPLICATE_FALLBACK_LAYER, None));
    }
    if groups.len() > 1 && groups.iter().any(|group| group.len() > 1) {
        return Err(failure(MULTIPLE_MULTI_LAYER, None));
    }
    if groups.len() > 1
        && groups
            .iter()
            .flatten()
            .any(|layer| layer.edited_mapping_edges_location.is_some())
    {
        return Err(failure(MULTIPLE_EDITABLE_MAPPINGS, None));
    }
    Ok(())
}

/// mergeAndSaveVolumeLayers: the new volume layers and the
/// earliestAccessibleVersion of the annotation.
async fn merge_and_save_volume_layers(
    services: &Services,
    url: &str,
    annotation_id: &ObjectId,
    groups: &[Vec<UploadedVolumeLayer>],
    parsed: &MultiNmlParseResult,
    source: &UsableSource,
    dataset_id: &ObjectId,
) -> Result<(Vec<AnnotationLayer>, i64), ProviderError> {
    if groups.is_empty() {
        return Ok((Vec::new(), 0));
    }
    check_volume_merge_rules(groups)?;
    if groups.len() == 1 {
        // One annotation uploaded: keep its layers separate.
        let mut start_version = 1_i64;
        let mut saved_any_editable_mapping_versions = false;
        let mut layers = Vec::with_capacity(groups[0].len());
        for (index, uploaded) in groups[0].iter().enumerate() {
            // TracingId.generate.
            let tracing_id = uuid::Uuid::new_v4().to_string();
            let saved_versions = save_editable_mapping_if_present(
                services,
                url,
                annotation_id,
                &tracing_id,
                parsed.editable_mapping_edges_zip_for(uploaded),
                uploaded.edited_mapping_base_mapping_name.as_deref(),
                start_version,
            )
            .await?;
            start_version += saved_versions;
            if saved_versions > 0 {
                saved_any_editable_mapping_versions = true;
            }
            let mapping_name = if uploaded.edited_mapping_edges_location.is_some() {
                Some(tracing_id.clone())
            } else {
                uploaded.tracing.mapping_name.clone()
            };
            let tracing = VolumeTracing {
                mapping_name,
                ..uploaded.tracing.clone()
            };
            services
                .tracing_store
                .save_volume_tracing(
                    url,
                    annotation_id,
                    &tracing_id,
                    &tracing,
                    VolumeSaveDataSource {
                        store: services.provider.data_sources(),
                        data_source: &source.rendered,
                        dataset_id,
                    },
                )
                .await
                .map_err(service_failure)?;
            if let Some(data) = parsed.data_zip_for(uploaded) {
                // saveVolumeTracing's initial data with empty mag restrictions.
                services
                    .tracing_store
                    .upload_volume_initial_data(
                        url,
                        annotation_id,
                        &tracing_id,
                        None,
                        None,
                        data.to_vec(),
                    )
                    .await
                    .map_err(service_failure)?;
            }
            layers.push(AnnotationLayer {
                tracing_id,
                typ: AnnotationLayerType::Volume,
                name: uploaded
                    .name
                    .clone()
                    .unwrap_or_else(|| format!("{DEFAULT_VOLUME_LAYER_NAME}{index}")),
            });
        }
        // Only editable-mapping uploads write update actions whose history
        // stays inaccessible.
        let earliest_accessible_version = if saved_any_editable_mapping_versions {
            start_version
        } else {
            0
        };
        return Ok((layers, earliest_accessible_version));
    }
    // Several annotations with at most one volume layer each and no editable
    // mappings: merge into one `Volume` layer.
    let flat: Vec<UploadedVolumeLayer> = groups.iter().flatten().cloned().collect();
    let data_zips: Vec<(&str, &Bytes)> = flat
        .iter()
        .filter_map(|layer| {
            parsed
                .data_zip_for(layer)
                .map(|data| (layer.data_zip_location.as_str(), data))
        })
        .collect();
    let tracing_id = uuid::Uuid::new_v4().to_string();
    let tracings: Vec<VolumeTracing> = flat.iter().map(|layer| layer.tracing.clone()).collect();
    // mergeVolumeTracingsByContents; the data zips are packed up front (an
    // in-memory zip that cannot fail in practice) instead of after the
    // initializeForMerge RPC.
    let packed = pack_volume_data_zips(&data_zips)?;
    services
        .tracing_store
        .merge_volume_tracings_by_contents(
            url,
            annotation_id,
            &tracing_id,
            &tracings,
            packed,
            VolumeSaveDataSource {
                store: services.provider.data_sources(),
                data_source: &source.rendered,
                dataset_id,
            },
        )
        .await
        .map_err(service_failure)?;
    Ok((
        vec![AnnotationLayer {
            tracing_id,
            typ: AnnotationLayerType::Volume,
            name: DEFAULT_VOLUME_LAYER_NAME.to_owned(),
        }],
        0,
    ))
}

/// mergeAndSaveSkeletonLayers: all skeletons merged into one `Skeleton` layer.
async fn merge_and_save_skeleton_layers(
    services: &Services,
    url: &str,
    skeletons: &[&SkeletonTracing],
) -> Result<Vec<AnnotationLayer>, ProviderError> {
    if skeletons.is_empty() {
        return Ok(Vec::new());
    }
    let tracing_id = uuid::Uuid::new_v4().to_string();
    services
        .tracing_store
        .merge_skeleton_tracings_by_contents(url, &tracing_id, skeletons)
        .await
        .map_err(service_failure)?;
    Ok(vec![AnnotationLayer {
        tracing_id,
        typ: AnnotationLayerType::Skeleton,
        name: DEFAULT_SKELETON_LAYER_NAME.to_owned(),
    }])
}

fn layer_type_proto(typ: AnnotationLayerType) -> AnnotationLayerTypeProto {
    match typ {
        AnnotationLayerType::Skeleton => AnnotationLayerTypeProto::Skeleton,
        AnnotationLayerType::Volume => AnnotationLayerTypeProto::Volume,
    }
}

/// Instant.now (millisecond precision).
fn now_millis() -> DateTime<Utc> {
    DateTime::from_timestamp_millis(Utc::now().timestamp_millis()).unwrap_or_else(Utc::now)
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

/// POST /annotations/upload
async fn upload(
    State(state): State<AppState>,
    user: AuthUser,
    services: Services,
    multipart: Result<Multipart, MultipartRejection>,
) -> ApiResult<Response> {
    let pool = &state.pool;
    let body = read_multipart(multipart).await?;
    // Scala reads `dataParts("createGroupForEachFile")` with Map.apply, which
    // throws (500) when the part is missing; treated as false here.
    let create_group_for_each_file = body.first("createGroupForEachFile") == Some("true");
    let overwriting_dataset_id = body.first("datasetId").map(str::to_owned);
    let overwriting_description = body.first("description").map(str::to_owned);
    let fallback_edit_position =
        parse_optional(body.first("fallbackEditPosition"), parse_vec3_int)?;
    let fallback_edit_rotation =
        parse_optional(body.first("fallbackEditRotation"), parse_vec3_double)?;
    let fallback_zoom_level = parse_optional(body.first("fallbackZoomLevel"), java_parse_double)?;

    let parsed = extract_from_files(
        body.files,
        SharedParsingParameters {
            overwriting_dataset_id,
            user_organization_id: user.organization_id.clone(),
            is_task_upload: false,
            fallback_edit_position,
            fallback_edit_rotation,
            fallback_zoom_level,
        },
        true,
        ExtractionLimits::default(),
        &PgDatasetLookup {
            pool: pool.clone(),
            user_id: user.id.clone(),
        },
    )
    .await?;
    let wrapped = wrap_or_prefix_groups(parsed.parse_results.clone(), create_group_for_each_file);
    let successes: Vec<NmlParseResult> = wrapped.into_iter().filter(|r| r.succeeded()).collect();
    if successes.is_empty() {
        return Ok(return_error(&parsed.parse_results));
    }
    let (name, nml_description, wk_url) = upload_metadata(&successes);
    let description = overwriting_description.unwrap_or(nml_description);
    let parse_successes = successes
        .iter()
        .map(NmlParseResult::to_success)
        .collect::<Result<Vec<_>, String>>()
        .map_err(ApiError::bad_request)?;
    let skeletons: Vec<&SkeletonTracing> = parse_successes
        .iter()
        .map(|success| &success.skeleton_tracing)
        .collect();
    let volume_groups_raw: Vec<Vec<UploadedVolumeLayer>> = parse_successes
        .iter()
        .map(|success| success.volume_layers.clone())
        .filter(|layers| !layers.is_empty())
        .collect();
    let dataset_ids: Vec<&str> = parse_successes
        .iter()
        .map(|success| success.dataset_id.as_str())
        .collect();
    let volumes_flat: Vec<&UploadedVolumeLayer> = volume_groups_raw.iter().flatten().collect();
    let dataset_ref = find_dataset_for_uploaded_annotations(
        pool,
        &user.id,
        &services.misc.0.config.public_uri,
        &skeletons,
        &volumes_flat,
        &dataset_ids,
        &wk_url,
    )
    .await?;
    let dataset_id = ObjectId::parse(&dataset_ref.id)?;
    let dataset = annotation_create::find_dataset(pool, &dataset_id)
        .await?
        .ok_or_else(ApiError::internal)?;

    let annotation_id = ObjectId::new();
    let layers_and_version = async {
        let source = annotation_create::usable_data_source(pool, &dataset).await?;
        let volume_groups =
            adapt_volume_layers(pool, &services, &dataset, &source, volume_groups_raw).await?;
        let url = annotation_create::tracing_store_url(pool).await?;
        let (volume_layers, earliest_accessible_version) = merge_and_save_volume_layers(
            &services,
            &url,
            &annotation_id,
            &volume_groups,
            &parsed,
            &source,
            &dataset.id,
        )
        .await?;
        let skeleton_layers = merge_and_save_skeleton_layers(&services, &url, &skeletons).await?;
        let layers: Vec<AnnotationLayer> =
            skeleton_layers.into_iter().chain(volume_layers).collect();
        let proto = AnnotationProto {
            description: description.clone(),
            version: 0,
            annotation_layers: layers
                .iter()
                .map(|layer| AnnotationLayerProto {
                    tracing_id: layer.tracing_id.clone(),
                    name: layer.name.clone(),
                    typ: layer_type_proto(layer.typ) as i32,
                })
                .collect(),
            earliest_accessible_version,
            ..Default::default()
        };
        services
            .tracing_store
            .save_annotation_proto(&url, &annotation_id, &proto)
            .await
            .map_err(service_failure)?;
        Ok::<_, ProviderError>(layers)
    }
    .await;
    let layers = layers_and_version.map_err(ApiError::from)?;

    // annotationDAO.insertOne: row + layers (AnnotationLayerStatistics.unknown).
    let mut transaction = pool.begin().await?;
    insert_annotation(
        &mut transaction,
        &NewAnnotation {
            id: &annotation_id,
            dataset_id: dataset.id.as_str(),
            task_id: None,
            owner_id: &user.id,
            description: &description,
            name: name.as_deref().unwrap_or(""),
            annotation_type: "Explorational",
            visibility: "Internal",
            collaboration_mode: "OwnerOnly",
            created: now_millis(),
        },
        &layers,
    )
    .await?;
    transaction.commit().await?;

    // analyticsService.track(UploadAnnotationEvent(user, annotation)).
    let mut properties = Map::new();
    properties.insert("annotation_id".into(), annotation_id.as_str().into());
    crate::analytics::track(
        &state,
        &services.misc,
        &user,
        "upload_annotation".into(),
        properties,
    );
    Ok(Json(json!({
        "annotation": {"typ": "Explorational", "id": annotation_id.as_str()},
        "messages": [{"success": MSG_UPLOAD_SUCCESS}],
    }))
    .into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fallback_literals_follow_scala_parsers() {
        assert_eq!(
            parse_vec3_int("1,22,333"),
            Some(Vec3IntProto {
                x: 1,
                y: 22,
                z: 333
            })
        );
        for invalid in [
            "",
            "1,2",
            "1,2,3,4",
            "-1,2,3",
            " 1,2,3",
            "1,2,99999999999",
            "1.0,2,3",
        ] {
            assert_eq!(parse_vec3_int(invalid), None, "{invalid}");
        }
        assert_eq!(
            parse_vec3_double(" 1.5, 2 ,3e1,"),
            Some(Vec3DoubleProto {
                x: 1.5,
                y: 2.0,
                z: 30.0
            })
        );
        assert_eq!(parse_vec3_double("1,2,3,4").map(|v| v.z), Some(3.0));
        for invalid in ["1,2", "1,,2,3", "a,b,c", "inf,1,2"] {
            assert_eq!(parse_vec3_double(invalid), None, "{invalid}");
        }
        assert_eq!(java_parse_double("2.5d"), Some(2.5));
        assert_eq!(java_parse_double("-Infinity"), Some(f64::NEG_INFINITY));
        assert_eq!(java_parse_double("infinity"), None);
        assert_eq!(java_parse_double(""), None);
    }

    fn layer(fallback: Option<&str>, edges: bool) -> UploadedVolumeLayer {
        UploadedVolumeLayer {
            tracing: VolumeTracing {
                fallback_layer: fallback.map(str::to_owned),
                ..Default::default()
            },
            data_zip_location: "upload-0/data.zip".into(),
            name: None,
            edited_mapping_edges_location: edges.then(|| "edges.zip".to_owned()),
            edited_mapping_base_mapping_name: None,
        }
    }

    fn message(result: Result<(), ProviderError>) -> Option<String> {
        result.err().map(|error| error.to_string())
    }

    #[test]
    fn volume_merge_rules_in_scala_order() {
        assert_eq!(message(check_volume_merge_rules(&[])), None);
        assert_eq!(
            message(check_volume_merge_rules(&[vec![
                layer(Some("seg"), false),
                layer(None, true),
                layer(None, false),
            ]])),
            None
        );
        assert_eq!(
            message(check_volume_merge_rules(&[vec![
                layer(Some("seg"), false),
                layer(Some("seg"), false),
            ]]))
            .as_deref(),
            Some(DUPLICATE_FALLBACK_LAYER)
        );
        assert_eq!(
            message(check_volume_merge_rules(&[
                vec![layer(None, false), layer(None, false)],
                vec![layer(None, false)],
            ]))
            .as_deref(),
            Some(MULTIPLE_MULTI_LAYER)
        );
        assert_eq!(
            message(check_volume_merge_rules(&[
                vec![layer(None, true)],
                vec![layer(None, false)],
            ]))
            .as_deref(),
            Some(MULTIPLE_EDITABLE_MAPPINGS)
        );
    }

    #[test]
    fn packed_data_zips_keep_order() {
        let a = Bytes::from_static(b"first");
        let b = Bytes::from_static(b"second");
        let packed =
            pack_volume_data_zips(&[("upload-0/data_a.zip", &a), ("upload-1/x/data_a.zip", &b)])
                .unwrap();
        let mut archive = zip::ZipArchive::new(Cursor::new(packed)).unwrap();
        assert_eq!(archive.len(), 2);
        let names: Vec<String> = (0..2)
            .map(|i| archive.by_index(i).unwrap().name().unwrap().into_owned())
            .collect();
        assert_eq!(names, ["0_data_a.zip", "1_data_a.zip"]);
        let mut content = String::new();
        std::io::Read::read_to_string(&mut archive.by_index(1).unwrap(), &mut content).unwrap();
        assert_eq!(content, "second");
    }
}
