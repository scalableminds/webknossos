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
use axum::extract::FromRef;
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
use serde_json::{Map, json};
use sqlx::PgPool;

use crate::{
    AppState,
    annotation::create::{DatasetFacts, UsableSource},
    annotation::duplicate::{NewAnnotation, insert_annotation},
    annotation::io::upload_service::{
        ExtractionLimits, MSG_UPLOAD_SUCCESS, MultiNmlParseResult, PgDatasetLookup,
        extract_from_files, find_dataset_for_uploaded_annotations, return_error, upload_metadata,
        wrap_or_prefix_groups,
    },
    annotation::nml::parser::{NmlParseResult, SharedParsingParameters, UploadedVolumeLayer},
    annotation::provider::{
        AnnotationLayer, AnnotationLayerType, AnnotationProvider, ProviderError,
    },
    annotation::tracing_initialization::{
        DEFAULT_SKELETON_LAYER_NAME, DEFAULT_VOLUME_LAYER_NAME, VOLUME_DEFAULT_ELEMENT_CLASS,
        combine_largest_segment_ids_by_precedence, element_class_to_proto,
        layer_largest_segment_id, mags_for_volume_tracing,
    },
    auth::AuthUser,
    dataset::source::{StaticLayer, UsableDataSource},
    error::{ApiError, ApiResult},
    extract::extension,
    extract::read_multipart,
    proto::{
        AnnotationLayerProto, AnnotationLayerTypeProto, AnnotationProto, BoundingBoxProto,
        SkeletonTracing, Vec3DoubleProto, Vec3IntProto, VolumeTracing,
    },
    stores::client::ServiceClients,
    stores::tracing_client::{TracingStoreClient, VolumeSaveDataSource},
    system::application_info::MiscState,
    util::id::ObjectId,
    util::instant::now_millis,
};
use webknossos_common::geometry::Vec3Int;

/// Play `parser.maxDiskBuffer` (multipart files).
const PLAY_MAX_DISK_BUFFER: usize = 1024 * 1024 * 1024;

/// Rust-only: Play rejects malformed multipart bodies before the action runs.
const MULTIPART_INVALID: &str = "Could not parse multipart request.";
const DUPLICATE_FALLBACK_LAYER: &str = "Cannot save annotation with multiple volume layers that have the same fallback segmentation layer.";
const MULTIPLE_MULTI_LAYER: &str =
    "Cannot merge multiple annotations that each have multiple volume layers.";
const MULTIPLE_EDITABLE_MAPPINGS: &str =
    "Cannot merge multiple annotations with editable mapping (proofreading) edges.";
/// Msg.Annotation.uploadEditableMappingIncompleteInformation.
const EDITABLE_MAPPING_INCOMPLETE: &str =
    "Could not store editable mapping, either file or baseMappingName is missing.";

pub fn router() -> Router<AppState> {
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

impl<S: Send + Sync> FromRequestParts<S> for Services
where
    MiscState: FromRef<S>,
{
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        Ok(Self {
            provider: extension(parts)?,
            clients: extension(parts)?,
            tracing_store: extension(parts)?,
            misc: MiscState::from_ref(state),
        })
    }
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

/// `Vec3Int.fromUriLiteral`.
fn parse_vec3_int(raw: &str) -> Option<Vec3IntProto> {
    Vec3Int::from_uri_literal(raw).map(Vec3IntProto::from)
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
        parse(value).ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, crate::msg::NOT_FOUND))
    })
    .transpose()
}

// ---------------------------------------------------------------------------
// Fox failures
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// adaptVolumeTracingsToFallbackLayer
// ---------------------------------------------------------------------------

/// BoundingBox.isEmpty of `boundingBoxFromProto`.
fn bbox_proto_is_empty(bbox: &BoundingBoxProto) -> bool {
    bbox.width <= 0 || bbox.height <= 0 || bbox.depth <= 0
}

/// The first StaticSegmentationLayer named like the tracing's fallback layer.
fn fallback_layer_for<'a>(
    source: &'a UsableDataSource,
    tracing: &VolumeTracing,
) -> Option<&'a StaticLayer> {
    let name = tracing.fallback_layer.as_deref()?;
    source
        .segmentation_layers()
        .find(|layer| layer.name == name)
}

/// adaptPropertiesToFallbackLayer without the RPC: `has_segment_index` is
/// the `canHaveSegmentIndex` answer (`true` without fallback layer).
fn adapt_properties(
    tracing: &VolumeTracing,
    source: &UsableDataSource,
    fallback: Option<&StaticLayer>,
    has_segment_index: bool,
) -> Result<VolumeTracing, ProviderError> {
    let bounding_box = if bbox_proto_is_empty(&tracing.bounding_box) {
        fallback
            .map(|layer| layer.bounding_box)
            .unwrap_or_else(|| source.bounding_box())
            .into()
    } else {
        tracing.bounding_box
    };
    let element_class = element_class_to_proto(
        fallback.map_or(VOLUME_DEFAULT_ELEMENT_CLASS, |layer| layer.element_class),
    )
    .map_err(|error| ProviderError::failure(error.to_string()))?;
    let largest_segment_id = combine_largest_segment_ids_by_precedence(
        // ScalaPB uint64 carries the Long bit pattern.
        tracing.largest_segment_id.map(|id| id as i64),
        fallback.map(layer_largest_segment_id),
    );
    Ok(VolumeTracing {
        bounding_box,
        element_class: element_class as i32,
        fallback_layer: fallback.map(|layer| layer.name.clone()),
        largest_segment_id: largest_segment_id.map(|id| id as u64),
        mags: mags_for_volume_tracing(source, fallback)
            .into_iter()
            .map(Vec3IntProto::from)
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
    let data_store_url = crate::annotation::create::data_store_url(pool, dataset).await?;
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
                    .map_err(ProviderError::from)?,
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
            .map_err(ProviderError::from),
        (None, None) => Ok(0),
        _ => Err(ProviderError::failure(EDITABLE_MAPPING_INCOMPLETE)),
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
        return Err(ProviderError::failure(DUPLICATE_FALLBACK_LAYER));
    }
    if groups.len() > 1 && groups.iter().any(|group| group.len() > 1) {
        return Err(ProviderError::failure(MULTIPLE_MULTI_LAYER));
    }
    if groups.len() > 1
        && groups
            .iter()
            .flatten()
            .any(|layer| layer.edited_mapping_edges_location.is_some())
    {
        return Err(ProviderError::failure(MULTIPLE_EDITABLE_MAPPINGS));
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
                .map_err(ProviderError::from)?;
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
                    .map_err(ProviderError::from)?;
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
        .map_err(ProviderError::from)?;
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
        .map_err(ProviderError::from)?;
    Ok(vec![AnnotationLayer {
        tracing_id,
        typ: AnnotationLayerType::Skeleton,
        name: DEFAULT_SKELETON_LAYER_NAME.to_owned(),
    }])
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
    let body = read_multipart(multipart, MULTIPART_INVALID).await?;
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
    let dataset_ids: Vec<&ObjectId> = parse_successes
        .iter()
        .map(|success| &success.dataset_id)
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
    let dataset = crate::annotation::create::find_dataset(pool, &dataset_ref.id)
        .await?
        .ok_or_else(ApiError::internal)?;

    let annotation_id = ObjectId::new();
    let layers_and_version = async {
        let source = crate::annotation::create::usable_data_source(pool, &dataset).await?;
        let volume_groups =
            adapt_volume_layers(pool, &services, &dataset, &source, volume_groups_raw).await?;
        let url = crate::annotation::create::tracing_store_url(pool).await?;
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
                    typ: AnnotationLayerTypeProto::from(layer.typ) as i32,
                })
                .collect(),
            earliest_accessible_version,
            ..Default::default()
        };
        services
            .tracing_store
            .save_annotation_proto(&url, &annotation_id, &proto)
            .await
            .map_err(ProviderError::from)?;
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
            dataset_id: &dataset.id,
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
    crate::system::analytics::track(
        &state,
        &services.misc,
        &user,
        "upload_annotation".into(),
        properties,
    );
    Ok(Json(json!({
        "annotation": {"typ": "Explorational", "id": annotation_id},
        "messages": [{"success": MSG_UPLOAD_SUCCESS}],
    }))
    .into_response())
}

#[cfg(test)]
mod tests;
