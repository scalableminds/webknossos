//! Pure explorational tracing initialization (TI1).
//!
//! Ports `AnnotationService.createTracingForExplorational` / `createVolumeTracing`
//! and `AnnotationLayerPrecedence` (combineLargestSegmentIdsByPrecedence,
//! adaptSkeletonTracing, adaptVolumeTracing, old-precedence-layer selection and
//! property extraction) without any I/O. Remote steps stay with the caller (TI2):
//!
//! 1. resolve the datastore (`Msg.DataStore.notFoundForDataset`), the usable
//!    data source (`dataset_source::load`) and the tracing store;
//! 2. [`precedence_fetch_request`] → fetch that tracing (skeleton:
//!    `GET /tracings/skeleton/{id}?annotationId&version`, long timeout; volume:
//!    `GET /tracings/volume/{id}?annotationId&version`, no data zip) →
//!    [`RedundantTracingProperties::extract`]. Scala runs this before the
//!    type-specific steps, so its errors win over fallback-layer errors;
//! 3. skeleton: [`build_skeleton_tracing`]; volume: [`plan_volume_tracing`]
//!    (fallback/mag validation), then — only when
//!    [`VolumeTracingPlan::segment_index_lookup`] is `Some(layer)` — the datastore
//!    RPC `GET /data/datasets/{datasetId}/layers/{layer}/hasSegmentIndex`
//!    (JSON boolean, 1 minute cache in Scala), then [`VolumeTracingPlan::build`];
//! 4. [`adapt_skeleton_tracing`] / [`adapt_volume_tracing`] with step 2's result.
//!
//! `created_timestamp` is an explicit input (Scala: `System.currentTimeMillis()`)
//! so the output is deterministic.
// TI2 wires the routes that call this API; until then only tests use it.
#![allow(dead_code)]

use std::fmt;

use serde::{Deserialize, Deserializer, Serialize, Serializer, de::Error as _};
use serde_json::{Map, Value, json};

use crate::{
    annotation_provider::{AnnotationLayer, AnnotationLayerType},
    dataset_source::{self, Axis, Category, DataSource, Layer},
    id::ObjectId,
    proto::datastore::{
        AdditionalAxisProto, AdditionalCoordinateProto, BoundingBoxProto, Id32WithBool,
        NamedBoundingBoxProto, SkeletonTracing, SkeletonUserStateProto, Vec2IntProto,
        Vec3DoubleProto, Vec3IntProto, VolumeTracing, VolumeUserStateProto,
        volume_tracing::ElementClassProto,
    },
};

/// AnnotationLayer.defaultSkeletonLayerName.
pub(crate) const DEFAULT_SKELETON_LAYER_NAME: &str = "Skeleton";
/// AnnotationLayer.defaultVolumeLayerName.
pub(crate) const DEFAULT_VOLUME_LAYER_NAME: &str = "Volume";
/// Msg.Annotation.Volume.magRestrictionsTooTight.
pub(crate) const MAG_RESTRICTIONS_TOO_TIGHT: &str =
    "Mag restrictions are too tight, resulting annotation has no magnifications.";
/// Msg.Annotation.fetchOldPrecedenceLayerNeedsAnnotationId.
pub(crate) const FETCH_OLD_PRECEDENCE_LAYER_NEEDS_ANNOTATION_ID: &str =
    "Annotation id is required to fetch old precedence layer.";
/// Msg.Annotation.createTracingsFailed (createExplorationalFor's `?~>`).
pub(crate) const CREATE_TRACINGS_FAILED: &str = "Could not set up annotation layers.";
/// Msg.DataStore.notFoundForDataset.
pub(crate) const DATA_STORE_NOT_FOUND_FOR_DATASET: &str =
    "Data store for dataset could not be found or accessed.";

/// SkeletonTracingDefaults.zoomLevel.
const SKELETON_DEFAULT_ZOOM_LEVEL: f64 = 2.0;
/// VolumeTracingDefaults.zoomLevel.
const VOLUME_DEFAULT_ZOOM_LEVEL: f64 = 1.0;
/// VolumeTracingDefaults.elementClass.
const VOLUME_DEFAULT_ELEMENT_CLASS: &str = "uint32";
/// VolumeTracingDefaults.largestSegmentId (fresh layer without fallback).
const VOLUME_DEFAULT_LARGEST_SEGMENT_ID: Option<i64> = Some(0);
/// ElementClass.segmentationElementClasses.
const SEGMENTATION_ELEMENT_CLASSES: &[&str] = &[
    "uint8", "uint16", "uint32", "uint64", "int8", "int16", "int32", "int64",
];

// ---------------------------------------------------------------- errors

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TracingInitError {
    /// getFallbackLayer found no segmentation layer with this name. Scala's
    /// Fox is Empty (no own message); callers attach their `?~>` context.
    FallbackLayerNotFound(String),
    /// Msg.Annotation.Volume.largestSegmentIdExceedsRange (`-1` when unset).
    LargestSegmentIdExceedsRange {
        largest_segment_id: i64,
        element_class: String,
    },
    /// Msg.Annotation.Volume.magRestrictionsTooTight.
    MagRestrictionsTooTight,
    /// ElementClass.toProto failure (unreachable after fallback validation).
    UnsupportedElementClass(String),
    /// Msg.Annotation.fetchOldPrecedenceLayerNeedsAnnotationId.
    PrecedenceLayerNeedsAnnotationId,
}

impl TracingInitError {
    /// The Scala failure message; `None` for an Empty Fox.
    pub(crate) fn message(&self) -> Option<String> {
        match self {
            Self::FallbackLayerNotFound(_) => None,
            Self::LargestSegmentIdExceedsRange {
                largest_segment_id,
                element_class,
            } => Some(format!(
                "The largest segment id {largest_segment_id} specified for the annotation layer exceeds the range of its data type “{element_class}”."
            )),
            Self::MagRestrictionsTooTight => Some(MAG_RESTRICTIONS_TOO_TIGHT.to_owned()),
            Self::UnsupportedElementClass(element_class) => Some(format!(
                "Unsupported element class {element_class} for ElementClassProto"
            )),
            Self::PrecedenceLayerNeedsAnnotationId => {
                Some(FETCH_OLD_PRECEDENCE_LAYER_NEEDS_ANNOTATION_ID.to_owned())
            }
        }
    }
}

impl fmt::Display for TracingInitError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.message() {
            Some(message) => f.write_str(&message),
            None => f.write_str("Empty"),
        }
    }
}

impl std::error::Error for TracingInitError {}

// ---------------------------------------------------------------- parameters

/// AnnotationLayer.defaultNameForType.
pub(crate) fn default_name_for_type(typ: AnnotationLayerType) -> &'static str {
    match typ {
        AnnotationLayerType::Skeleton => DEFAULT_SKELETON_LAYER_NAME,
        AnnotationLayerType::Volume => DEFAULT_VOLUME_LAYER_NAME,
    }
}

/// AnnotationLayerType JSON (Json.formatEnum: exact names).
fn layer_type_json(typ: AnnotationLayerType) -> &'static str {
    default_name_for_type(typ)
}

/// `MagRestrictions` (JsonAutoFormat: both fields optional, `None` omitted).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct MagRestrictions {
    pub min: Option<i32>,
    pub max: Option<i32>,
}

impl MagRestrictions {
    pub(crate) fn is_allowed(&self, mag: [i32; 3]) -> bool {
        let max_dim = max_dim(mag);
        self.min.unwrap_or(0) <= max_dim && self.max.unwrap_or(i32::MAX) >= max_dim
    }

    pub(crate) fn filter_allowed(&self, mags: &[[i32; 3]]) -> Vec<[i32; 3]> {
        mags.iter()
            .copied()
            .filter(|m| self.is_allowed(*m))
            .collect()
    }

    pub(crate) fn from_json(value: &Value) -> Result<Self, String> {
        let object = value
            .as_object()
            .ok_or("magRestrictions: expected object")?;
        Ok(Self {
            min: optional_int(object, "min").map_err(|e| format!("magRestrictions.{e}"))?,
            max: optional_int(object, "max").map_err(|e| format!("magRestrictions.{e}"))?,
        })
    }

    pub(crate) fn to_json(self) -> Value {
        let mut object = Map::new();
        if let Some(min) = self.min {
            object.insert("min".into(), json!(min));
        }
        if let Some(max) = self.max {
            object.insert("max".into(), json!(max));
        }
        Value::Object(object)
    }
}

/// `AnnotationLayerParameters` (tracingstore `AnnotationUpdateActions.scala`,
/// `Json.using[WithDefaultValues].format`): `typ` required; Option fields read
/// missing/null as `None`; `autoFallbackLayer` reads missing/null as `false`;
/// writes omit `None` and always include `autoFallbackLayer`.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct AnnotationLayerParameters {
    pub typ: AnnotationLayerType,
    pub fallback_layer_name: Option<String>,
    pub auto_fallback_layer: bool,
    pub mapping_name: Option<String>,
    pub mag_restrictions: Option<MagRestrictions>,
    pub name: Option<String>,
    /// Parsed for validation only; createTracingForExplorational ignores it.
    pub additional_axes: Option<Vec<Axis>>,
}

impl AnnotationLayerParameters {
    /// getNameWithDefault.
    pub(crate) fn name_with_default(&self) -> String {
        self.name
            .clone()
            .unwrap_or_else(|| default_name_for_type(self.typ).to_owned())
    }

    pub(crate) fn from_json(value: &Value) -> Result<Self, String> {
        let object = value.as_object().ok_or("expected object")?;
        let typ = match object.get("typ").and_then(Value::as_str) {
            Some("Skeleton") => AnnotationLayerType::Skeleton,
            Some("Volume") => AnnotationLayerType::Volume,
            Some(_) => return Err("typ: invalid enum value".into()),
            None => return Err("typ: missing or not a string".into()),
        };
        let auto_fallback_layer = match present(object, "autoFallbackLayer") {
            None => false,
            Some(value) => value
                .as_bool()
                .ok_or("autoFallbackLayer: expected boolean")?,
        };
        Ok(Self {
            typ,
            fallback_layer_name: optional_string(object, "fallbackLayerName")?,
            auto_fallback_layer,
            mapping_name: optional_string(object, "mappingName")?,
            mag_restrictions: present(object, "magRestrictions")
                .map(MagRestrictions::from_json)
                .transpose()?,
            name: optional_string(object, "name")?,
            additional_axes: present(object, "additionalAxes")
                .map(|axes| {
                    axes.as_array()
                        .ok_or("additionalAxes: expected array")?
                        .iter()
                        .map(additional_axis_from_json)
                        .collect::<Result<Vec<_>, String>>()
                })
                .transpose()?,
        })
    }

    pub(crate) fn to_json(&self) -> Value {
        let mut object = Map::new();
        object.insert("typ".into(), json!(layer_type_json(self.typ)));
        if let Some(name) = &self.fallback_layer_name {
            object.insert("fallbackLayerName".into(), json!(name));
        }
        object.insert("autoFallbackLayer".into(), json!(self.auto_fallback_layer));
        if let Some(name) = &self.mapping_name {
            object.insert("mappingName".into(), json!(name));
        }
        if let Some(restrictions) = &self.mag_restrictions {
            object.insert("magRestrictions".into(), restrictions.to_json());
        }
        if let Some(name) = &self.name {
            object.insert("name".into(), json!(name));
        }
        if let Some(axes) = &self.additional_axes {
            let axes: Vec<Value> = axes
                .iter()
                .map(|a| json!({"name": a.name, "bounds": a.bounds, "index": a.index}))
                .collect();
            object.insert("additionalAxes".into(), Value::Array(axes));
        }
        Value::Object(object)
    }
}

impl<'de> Deserialize<'de> for AnnotationLayerParameters {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = Value::deserialize(deserializer)?;
        Self::from_json(&value).map_err(D::Error::custom)
    }
}

impl Serialize for AnnotationLayerParameters {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.to_json().serialize(serializer)
    }
}

fn present<'a>(object: &'a Map<String, Value>, key: &str) -> Option<&'a Value> {
    object.get(key).filter(|v| !v.is_null())
}

fn optional_string(object: &Map<String, Value>, key: &str) -> Result<Option<String>, String> {
    present(object, key)
        .map(|v| {
            v.as_str()
                .map(str::to_owned)
                .ok_or_else(|| format!("{key}: expected string"))
        })
        .transpose()
}

fn optional_int(object: &Map<String, Value>, key: &str) -> Result<Option<i32>, String> {
    present(object, key)
        .map(|v| dataset_source::int(v).map_err(|_| format!("{key}: expected int")))
        .transpose()
}

/// AdditionalAxis JsonAutoFormat (no bounds-length check, unlike data sources).
fn additional_axis_from_json(value: &Value) -> Result<Axis, String> {
    let object = value.as_object().ok_or("additionalAxes: expected object")?;
    let name = object
        .get("name")
        .and_then(Value::as_str)
        .ok_or("additionalAxes.name: expected string")?
        .to_owned();
    let bounds = object
        .get("bounds")
        .and_then(Value::as_array)
        .ok_or("additionalAxes.bounds: expected array")?
        .iter()
        .map(|b| {
            dataset_source::int(b).map_err(|_| "additionalAxes.bounds: expected int".to_owned())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let index = object
        .get("index")
        .ok_or("additionalAxes.index: missing")
        .and_then(|v| dataset_source::int(v).map_err(|_| "additionalAxes.index: expected int"))?;
    Ok(Axis {
        name,
        bounds,
        index,
    })
}

// ---------------------------------------------------------------- geometry

/// Vec3Int.maxDim.
fn max_dim(mag: [i32; 3]) -> i32 {
    mag[0].max(mag[1]).max(mag[2])
}

/// BoundingBox.bottomRight (JVM Int wrapping).
fn bottom_right(bbox: &[i32; 6]) -> [i32; 3] {
    [
        bbox[0].wrapping_add(bbox[3]),
        bbox[1].wrapping_add(bbox[4]),
        bbox[2].wrapping_add(bbox[5]),
    ]
}

/// BoundingBox.union (pairwise).
fn bbox_union(a: &[i32; 6], b: &[i32; 6]) -> [i32; 6] {
    let (br_a, br_b) = (bottom_right(a), bottom_right(b));
    let x = a[0].min(b[0]);
    let y = a[1].min(b[1]);
    let z = a[2].min(b[2]);
    [
        x,
        y,
        z,
        br_a[0].max(br_b[0]).wrapping_sub(x),
        br_a[1].max(br_b[1]).wrapping_sub(y),
        br_a[2].max(br_b[2]).wrapping_sub(z),
    ]
}

/// UsableDataSource.boundingBox: BoundingBox.union of all layer boxes
/// (BoundingBox.empty for no layers).
pub(crate) fn data_source_bounding_box(data_source: &DataSource) -> [i32; 6] {
    let mut boxes = data_source.layers.iter().map(|l| l.bounding_box);
    match boxes.next() {
        Some(first) => boxes.fold(first, |acc, b| bbox_union(&acc, &b)),
        None => [0; 6],
    }
}

/// BoundingBox.center: `topLeft.move(bottomRight).scale(0.5f)`, i.e. Int→Float,
/// times 0.5f, truncating (saturating) Float→Int.
fn bbox_center(bbox: &[i32; 6]) -> [i32; 3] {
    let br = bottom_right(bbox);
    let half = |a: i32, b: i32| (a.wrapping_add(b) as f32 * 0.5f32) as i32;
    [
        half(bbox[0], br[0]),
        half(bbox[1], br[1]),
        half(bbox[2], br[2]),
    ]
}

/// UsableDataSource.center.
pub(crate) fn data_source_center(data_source: &DataSource) -> [i32; 3] {
    bbox_center(&data_source_bounding_box(data_source))
}

fn vec3_int_proto(v: [i32; 3]) -> Vec3IntProto {
    Vec3IntProto {
        x: v[0],
        y: v[1],
        z: v[2],
    }
}

fn bbox_proto(bbox: &[i32; 6]) -> BoundingBoxProto {
    BoundingBoxProto {
        top_left: vec3_int_proto([bbox[0], bbox[1], bbox[2]]),
        width: bbox[3],
        height: bbox[4],
        depth: bbox[5],
    }
}

fn zero_rotation() -> Vec3DoubleProto {
    Vec3DoubleProto {
        x: 0.0,
        y: 0.0,
        z: 0.0,
    }
}

/// Java `String.hashCode` (UTF-16 code units, wrapping).
fn java_string_hash(value: &str) -> i32 {
    value.encode_utf16().fold(0i32, |h, unit| {
        h.wrapping_mul(31).wrapping_add(i32::from(unit))
    })
}

fn axis_bound(axis: &Axis, index: usize) -> i32 {
    // Data-source parsing guarantees two bounds (Scala would throw otherwise).
    axis.bounds.get(index).copied().unwrap_or(0)
}

/// AdditionalAxis.merge (UsableDataSource.additionalAxesUnion): per name the
/// first-seen index and the min lower / max upper bound. The result order
/// reproduces iteration of Scala 2.13's `mutable.HashMap[String, _]` (buckets by
/// `h ^ (h >>> 16)` masked to the table size, ascending signed hash within a
/// bucket, growth to double size whenever `size + 1 >= 0.75 * capacity` before
/// each `update`).
pub(crate) fn additional_axes_union(data_source: &DataSource) -> Option<Vec<Axis>> {
    let mut entries: Vec<(String, i32, i32, i32)> = Vec::new();
    let mut capacity: usize = 16;
    for axes in data_source
        .layers
        .iter()
        .filter_map(|l| l.additional_axes.as_ref())
    {
        for axis in axes {
            if entries.len() + 1 >= capacity * 3 / 4 {
                capacity *= 2;
            }
            let (lower, upper) = (axis_bound(axis, 0), axis_bound(axis, 1));
            match entries.iter_mut().find(|e| e.0 == axis.name) {
                Some(entry) => {
                    entry.2 = entry.2.min(lower);
                    entry.3 = entry.3.max(upper);
                }
                None => entries.push((axis.name.clone(), axis.index, lower, upper)),
            }
        }
    }
    if entries.is_empty() {
        return None;
    }
    let improved = |name: &str| {
        let h = java_string_hash(name);
        h ^ ((h as u32) >> 16) as i32
    };
    let mask = (capacity - 1) as i32;
    // Stable sort keeps insertion order for equal hashes, like the bucket lists.
    entries.sort_by_key(|e| {
        let hash = improved(&e.0);
        (hash & mask, hash)
    });
    Some(
        entries
            .into_iter()
            .map(|(name, index, lower, upper)| Axis {
                name,
                bounds: vec![lower, upper],
                index,
            })
            .collect(),
    )
}

/// AdditionalAxis.toProto.
pub(crate) fn additional_axes_to_proto(axes: Option<&[Axis]>) -> Vec<AdditionalAxisProto> {
    axes.unwrap_or_default()
        .iter()
        .map(|axis| AdditionalAxisProto {
            name: axis.name.clone(),
            index: axis.index,
            bounds: Vec2IntProto {
                x: axis_bound(axis, 0),
                y: axis_bound(axis, 1),
            },
        })
        .collect()
}

// ---------------------------------------------------------------- element class / mags

/// ElementClass.largestSegmentIdIsInRange.
pub(crate) fn largest_segment_id_is_in_range(
    largest_segment_id: Option<i64>,
    element_class: &str,
) -> bool {
    if !SEGMENTATION_ELEMENT_CLASSES.contains(&element_class) {
        return false;
    }
    let Some(id) = largest_segment_id else {
        return true;
    };
    let max = match element_class {
        // Every Long bit pattern is a valid non-negative uint64 value.
        "uint64" => return true,
        "uint8" => Some((1i64 << 8) - 1),
        "int8" => Some(i64::from(i8::MAX)),
        "uint16" => Some((1i64 << 16) - 1),
        "int16" => Some(i64::from(i16::MAX)),
        "uint32" => Some((1i64 << 32) - 1),
        "int32" => Some(i64::from(i32::MAX)),
        "int64" => Some(i64::MAX),
        _ => None,
    };
    id >= 0 && max.is_none_or(|max| id <= max)
}

/// ElementClass.toProto.
pub(crate) fn element_class_to_proto(
    element_class: &str,
) -> Result<ElementClassProto, TracingInitError> {
    Ok(match element_class {
        "uint8" => ElementClassProto::Uint8,
        "uint16" => ElementClassProto::Uint16,
        "uint24" => ElementClassProto::Uint24,
        "uint32" => ElementClassProto::Uint32,
        "uint64" => ElementClassProto::Uint64,
        "int8" => ElementClassProto::Int8,
        "int16" => ElementClassProto::Int16,
        "int32" => ElementClassProto::Int32,
        "int64" => ElementClassProto::Int64,
        other => return Err(TracingInitError::UnsupportedElementClass(other.to_owned())),
    })
}

/// AnnotationLayerPrecedence.combineLargestSegmentIdsByPrecedence.
pub(crate) fn combine_largest_segment_ids_by_precedence(
    from_nml: Option<i64>,
    from_fallback_layer: Option<Option<i64>>,
) -> Option<i64> {
    if from_nml.is_some() {
        from_nml
    } else if let Some(from_fallback) = from_fallback_layer {
        from_fallback
    } else {
        VOLUME_DEFAULT_LARGEST_SEGMENT_ID
    }
}

fn layer_mags(layer: &Layer) -> Vec<[i32; 3]> {
    layer.mags.iter().map(|m| m.mag).collect()
}

fn distinct(mags: impl IntoIterator<Item = [i32; 3]>) -> Vec<[i32; 3]> {
    let mut result: Vec<[i32; 3]> = Vec::new();
    for mag in mags {
        if !result.contains(&mag) {
            result.push(mag);
        }
    }
    result
}

/// VolumeTracingMags.magsForVolumeTracing.
pub(crate) fn mags_for_volume_tracing(
    data_source: &DataSource,
    fallback_layer: Option<&Layer>,
) -> Vec<[i32; 3]> {
    let mut mags = match fallback_layer {
        Some(layer) => layer_mags(layer),
        None => {
            let union = distinct(data_source.layers.iter().flat_map(layer_mags));
            let max_dims = union.iter().map(|m| max_dim(*m)).collect::<Vec<_>>();
            let distinct_max_dims = max_dims
                .iter()
                .enumerate()
                .all(|(i, d)| !max_dims[..i].contains(d));
            if distinct_max_dims {
                union
            } else {
                // Scala maxBy: the first layer with the most mags.
                let mut template: Option<&Layer> = None;
                for layer in &data_source.layers {
                    if template.is_none_or(|t| layer.mags.len() > t.mags.len()) {
                        template = Some(layer);
                    }
                }
                template.map(layer_mags).map(distinct).unwrap_or_default()
            }
        }
    };
    mags.sort_by_key(|m| max_dim(*m));
    mags
}

// ---------------------------------------------------------------- builders

/// The dataset facts createTracingForExplorational reads.
#[derive(Clone, Copy, Debug)]
pub(crate) struct ExplorationalDataset<'a> {
    /// `datasetService.usableDataSourceFor(dataset)`.
    pub data_source: &'a DataSource,
    /// `dataset.name` (skeleton `datasetName`; volume uses the data source's directory name).
    pub dataset_name: &'a str,
    /// `dataset._organization`.
    pub organization_id: &'a str,
}

/// The tracing createTracingForExplorational returns.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum InitialTracing {
    Skeleton(SkeletonTracing),
    Volume(VolumeTracing),
}

impl InitialTracing {
    pub(crate) fn layer_type(&self) -> AnnotationLayerType {
        match self {
            Self::Skeleton(_) => AnnotationLayerType::Skeleton,
            Self::Volume(_) => AnnotationLayerType::Volume,
        }
    }

    /// `tracing.toByteArray` (createTracing callback response body).
    pub(crate) fn encode_to_vec(&self) -> Vec<u8> {
        use prost::Message;
        match self {
            Self::Skeleton(tracing) => tracing.encode_to_vec(),
            Self::Volume(tracing) => tracing.encode_to_vec(),
        }
    }
}

/// createLayersForExplorational's layer name: the requested name, else the
/// volume's fallback layer name, else AnnotationLayer.defaultNameForType.
pub(crate) fn layer_name(params: &AnnotationLayerParameters, tracing: &InitialTracing) -> String {
    if let Some(name) = &params.name {
        return name.clone();
    }
    match tracing {
        InitialTracing::Skeleton(_) => default_name_for_type(params.typ).to_owned(),
        InitialTracing::Volume(volume) => volume
            .fallback_layer
            .clone()
            .unwrap_or_else(|| default_name_for_type(params.typ).to_owned()),
    }
}

/// `SkeletonTracingDefaults.createInstance.copy(datasetName, editPosition =
/// center, organizationId, additionalAxes = additionalAxesUnion)` (not yet adapted).
pub(crate) fn build_skeleton_tracing(
    dataset: &ExplorationalDataset<'_>,
    created_timestamp: i64,
) -> SkeletonTracing {
    let axes = additional_axes_union(dataset.data_source);
    SkeletonTracing {
        dataset_name: dataset.dataset_name.to_owned(),
        trees: Vec::new(),
        created_timestamp,
        bounding_box: None,
        active_node_id: None,
        edit_position: vec3_int_proto(data_source_center(dataset.data_source)),
        edit_rotation: zero_rotation(),
        zoom_level: SKELETON_DEFAULT_ZOOM_LEVEL,
        version: 0,
        user_bounding_box: None,
        tree_groups: Vec::new(),
        user_bounding_boxes: Vec::new(),
        organization_id: Some(dataset.organization_id.to_owned()),
        edit_position_additional_coordinates: Vec::new(),
        additional_axes: additional_axes_to_proto(axes.as_deref()),
        stored_with_external_tree_bodies: None,
        user_states: Vec::new(),
    }
}

/// A validated volume layer awaiting the fallback layer's segment-index check.
#[derive(Clone, Debug)]
pub(crate) struct VolumeTracingPlan<'a> {
    dataset: ExplorationalDataset<'a>,
    fallback_layer: Option<&'a Layer>,
    mags: Vec<[i32; 3]>,
    mapping_name: Option<String>,
}

/// The first StaticSegmentationLayer (getAutoFallbackLayerName).
fn auto_fallback_layer_name(data_source: &DataSource) -> Option<&str> {
    data_source
        .layers
        .iter()
        .find(|l| l.category == Category::Segmentation)
        .map(|l| l.name.as_str())
}

/// getFallbackLayer: first segmentation layer with that name, validated range.
fn fallback_layer<'a>(
    data_source: &'a DataSource,
    name: &str,
) -> Result<&'a Layer, TracingInitError> {
    let layer = data_source
        .layers
        .iter()
        .find(|l| l.name == name && l.category == Category::Segmentation)
        .ok_or_else(|| TracingInitError::FallbackLayerNotFound(name.to_owned()))?;
    if !largest_segment_id_is_in_range(layer.largest_segment_id, &layer.element_class) {
        return Err(TracingInitError::LargestSegmentIdExceedsRange {
            largest_segment_id: layer.largest_segment_id.unwrap_or(-1),
            element_class: layer.element_class.clone(),
        });
    }
    Ok(layer)
}

/// The Volume branch of createTracingForExplorational up to (excluding) the
/// hasSegmentIndexFile RPC: fallback-layer choice and validation, then mags
/// restricted by `magRestrictions` (empty → MagRestrictionsTooTight).
pub(crate) fn plan_volume_tracing<'a>(
    dataset: &ExplorationalDataset<'a>,
    params: &AnnotationLayerParameters,
) -> Result<VolumeTracingPlan<'a>, TracingInitError> {
    let data_source = dataset.data_source;
    let auto_name = if params.auto_fallback_layer {
        auto_fallback_layer_name(data_source)
    } else {
        None
    };
    let name = params.fallback_layer_name.as_deref().or(auto_name);
    let fallback = name
        .map(|name| fallback_layer(data_source, name))
        .transpose()?;
    let restrictions = params.mag_restrictions.unwrap_or_default();
    let mags = restrictions.filter_allowed(&mags_for_volume_tracing(data_source, fallback));
    if mags.is_empty() {
        return Err(TracingInitError::MagRestrictionsTooTight);
    }
    Ok(VolumeTracingPlan {
        dataset: *dataset,
        fallback_layer: fallback,
        mags,
        mapping_name: params.mapping_name.clone(),
    })
}

impl VolumeTracingPlan<'_> {
    /// Layer name for `WKRemoteDataStoreClient.hasSegmentIndexFile(datasetId, name)`;
    /// `None` means no RPC (hasSegmentIndex is then `true`).
    pub(crate) fn segment_index_lookup(&self) -> Option<&str> {
        self.fallback_layer.map(|l| l.name.as_str())
    }

    /// createVolumeTracing's VolumeTracing (not yet adapted). The flag is
    /// ignored without fallback layer.
    pub(crate) fn build(
        &self,
        fallback_layer_has_segment_index: bool,
        created_timestamp: i64,
    ) -> Result<VolumeTracing, TracingInitError> {
        let data_source = self.dataset.data_source;
        let fallback = self.fallback_layer;
        let element_class = element_class_to_proto(
            fallback
                .map(|l| l.element_class.as_str())
                .unwrap_or(VOLUME_DEFAULT_ELEMENT_CLASS),
        )?;
        let bounding_box = fallback
            .map(|l| l.bounding_box)
            .unwrap_or_else(|| data_source_bounding_box(data_source));
        let axes = match fallback {
            Some(layer) => layer.additional_axes.clone(),
            None => additional_axes_union(data_source),
        };
        let largest_segment_id =
            combine_largest_segment_ids_by_precedence(None, fallback.map(|l| l.largest_segment_id));
        Ok(VolumeTracing {
            active_segment_id: None,
            bounding_box: bbox_proto(&bounding_box),
            created_timestamp,
            dataset_name: data_source.directory_name.clone(),
            edit_position: vec3_int_proto(data_source_center(data_source)),
            edit_rotation: zero_rotation(),
            element_class: element_class as i32,
            fallback_layer: fallback.map(|l| l.name.clone()),
            // ScalaPB uint64 carries the Long bit pattern.
            largest_segment_id: largest_segment_id.map(|id| id as u64),
            version: 0,
            zoom_level: VOLUME_DEFAULT_ZOOM_LEVEL,
            user_bounding_box: None,
            user_bounding_boxes: Vec::new(),
            organization_id: Some(self.dataset.organization_id.to_owned()),
            mags: self.mags.iter().copied().map(vec3_int_proto).collect(),
            segments: Vec::new(),
            mapping_name: self.mapping_name.clone(),
            has_editable_mapping: None,
            segment_groups: Vec::new(),
            has_segment_index: Some(fallback.is_none() || fallback_layer_has_segment_index),
            edit_position_additional_coordinates: Vec::new(),
            additional_axes: additional_axes_to_proto(axes.as_deref()),
            mapping_is_locked: None,
            volume_bucket_data_has_changed: Some(false),
            unused_hide_unregistered_segments: None,
            user_states: Vec::new(),
        })
    }
}

// ---------------------------------------------------------------- precedence

/// The single tracing TI2 must fetch before building (fetchOldPrecedenceLayer).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PrecedenceFetchRequest {
    pub annotation_id: ObjectId,
    pub tracing_id: String,
    pub layer_name: String,
    pub typ: AnnotationLayerType,
    /// `previousVersion` (createTracing callback); `None` → latest.
    pub version: Option<i64>,
}

/// Java `String.compareTo` (UTF-16 code unit order).
fn java_string_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

/// selectLayerWithPrecedence: skeleton layers first, then volume layers; the
/// smallest tracing id (first on ties). `None` for an empty list.
pub(crate) fn select_layer_with_precedence(layers: &[AnnotationLayer]) -> Option<&AnnotationLayer> {
    let min_of = |typ: AnnotationLayerType| {
        layers
            .iter()
            .filter(|l| l.typ == typ)
            .fold(None, |best: Option<&AnnotationLayer>, l| match best {
                Some(b) if java_string_cmp(&l.tracing_id, &b.tracing_id).is_ge() => Some(b),
                _ => Some(l),
            })
    };
    min_of(AnnotationLayerType::Skeleton).or_else(|| min_of(AnnotationLayerType::Volume))
}

/// fetchOldPrecedenceLayer without the RPC: `Ok(None)` for no existing layers.
pub(crate) fn precedence_fetch_request(
    existing_annotation_id: Option<&ObjectId>,
    existing_layers: &[AnnotationLayer],
    previous_version: Option<i64>,
) -> Result<Option<PrecedenceFetchRequest>, TracingInitError> {
    if existing_layers.is_empty() {
        return Ok(None);
    }
    let annotation_id = existing_annotation_id
        .ok_or(TracingInitError::PrecedenceLayerNeedsAnnotationId)?
        .clone();
    // Non-empty input always has a precedence layer.
    let layer = select_layer_with_precedence(existing_layers)
        .ok_or(TracingInitError::PrecedenceLayerNeedsAnnotationId)?;
    Ok(Some(PrecedenceFetchRequest {
        annotation_id,
        tracing_id: layer.tracing_id.clone(),
        layer_name: layer.name.clone(),
        typ: layer.typ,
        version: previous_version,
    }))
}

/// The tracing returned for a [`PrecedenceFetchRequest`] (decoded per `typ`).
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum FetchedPrecedenceTracing {
    Skeleton(SkeletonTracing),
    Volume(VolumeTracing),
}

/// RedundantTracingProperties.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct RedundantTracingProperties {
    pub edit_position: Vec3IntProto,
    pub edit_rotation: Vec3DoubleProto,
    pub zoom_level: f64,
    pub user_bounding_boxes: Vec<NamedBoundingBoxProto>,
    pub edit_position_additional_coordinates: Vec<AdditionalCoordinateProto>,
    /// userId → boundingBoxVisibilities as Scala's `toMap`: one entry per user
    /// at its first position, holding the last occurrence's value.
    pub user_state_bounding_box_visibilities: Vec<(String, Vec<Id32WithBool>)>,
}

impl RedundantTracingProperties {
    /// extractPrecedenceProperties.
    pub(crate) fn extract(fetched: &FetchedPrecedenceTracing) -> Self {
        let (position, rotation, zoom, boxes, user_box, coordinates, states) = match fetched {
            FetchedPrecedenceTracing::Skeleton(s) => (
                &s.edit_position,
                &s.edit_rotation,
                s.zoom_level,
                &s.user_bounding_boxes,
                &s.user_bounding_box,
                &s.edit_position_additional_coordinates,
                s.user_states
                    .iter()
                    .map(|u| (u.user_id.clone(), u.bounding_box_visibilities.clone()))
                    .collect::<Vec<_>>(),
            ),
            FetchedPrecedenceTracing::Volume(v) => (
                &v.edit_position,
                &v.edit_rotation,
                v.zoom_level,
                &v.user_bounding_boxes,
                &v.user_bounding_box,
                &v.edit_position_additional_coordinates,
                v.user_states
                    .iter()
                    .map(|u| (u.user_id.clone(), u.bounding_box_visibilities.clone()))
                    .collect::<Vec<_>>(),
            ),
        };
        let mut user_bounding_boxes = boxes.clone();
        user_bounding_boxes.extend(user_box.iter().map(|bbox| NamedBoundingBoxProto {
            id: 0,
            name: None,
            is_visible: None,
            color: None,
            bounding_box: *bbox,
        }));
        let mut visibilities: Vec<(String, Vec<Id32WithBool>)> = Vec::new();
        for (user_id, value) in states {
            match visibilities.iter_mut().find(|(id, _)| *id == user_id) {
                Some(entry) => entry.1 = value,
                None => visibilities.push((user_id, value)),
            }
        }
        Self {
            edit_position: *position,
            edit_rotation: *rotation,
            zoom_level: zoom,
            user_bounding_boxes,
            edit_position_additional_coordinates: coordinates.clone(),
            user_state_bounding_box_visibilities: visibilities,
        }
    }

    fn visibilities_for(&self, user_id: &str) -> Option<&Vec<Id32WithBool>> {
        self.user_state_bounding_box_visibilities
            .iter()
            .find(|(id, _)| id == user_id)
            .map(|(_, v)| v)
    }

    /// Precedence users without a state in the new tracing, in map order.
    fn missing_users<'s>(
        &'s self,
        existing: impl Fn(&str) -> bool + 's,
    ) -> impl Iterator<Item = &'s (String, Vec<Id32WithBool>)> + 's {
        self.user_state_bounding_box_visibilities
            .iter()
            .filter(move |(id, _)| !existing(id))
    }
}

/// adaptSkeletonTracing.
pub(crate) fn adapt_skeleton_tracing(
    mut tracing: SkeletonTracing,
    properties: Option<&RedundantTracingProperties>,
) -> SkeletonTracing {
    let Some(p) = properties else {
        return tracing;
    };
    tracing.edit_position = p.edit_position;
    tracing.edit_rotation = p.edit_rotation;
    tracing.zoom_level = p.zoom_level;
    tracing.user_bounding_boxes = p.user_bounding_boxes.clone();
    tracing.edit_position_additional_coordinates = p.edit_position_additional_coordinates.clone();
    for state in &mut tracing.user_states {
        if let Some(visibilities) = p.visibilities_for(&state.user_id) {
            state.bounding_box_visibilities = visibilities.clone();
        }
    }
    let existing: Vec<String> = tracing
        .user_states
        .iter()
        .map(|u| u.user_id.clone())
        .collect();
    let new_states: Vec<SkeletonUserStateProto> = p
        .missing_users(|id| existing.iter().any(|e| e == id))
        .map(|(user_id, visibilities)| SkeletonUserStateProto {
            user_id: user_id.clone(),
            active_node_id: None,
            tree_group_expanded_states: Vec::new(),
            bounding_box_visibilities: visibilities.clone(),
            tree_visibilities: Vec::new(),
        })
        .collect();
    tracing.user_states.extend(new_states);
    tracing
}

/// adaptVolumeTracing.
pub(crate) fn adapt_volume_tracing(
    mut tracing: VolumeTracing,
    properties: Option<&RedundantTracingProperties>,
) -> VolumeTracing {
    let Some(p) = properties else {
        return tracing;
    };
    tracing.edit_position = p.edit_position;
    tracing.edit_rotation = p.edit_rotation;
    tracing.zoom_level = p.zoom_level;
    tracing.user_bounding_boxes = p.user_bounding_boxes.clone();
    tracing.edit_position_additional_coordinates = p.edit_position_additional_coordinates.clone();
    for state in &mut tracing.user_states {
        if let Some(visibilities) = p.visibilities_for(&state.user_id) {
            state.bounding_box_visibilities = visibilities.clone();
        }
    }
    let existing: Vec<String> = tracing
        .user_states
        .iter()
        .map(|u| u.user_id.clone())
        .collect();
    let new_states: Vec<VolumeUserStateProto> = p
        .missing_users(|id| existing.iter().any(|e| e == id))
        .map(|(user_id, visibilities)| VolumeUserStateProto {
            user_id: user_id.clone(),
            active_segment_id: None,
            segment_group_expanded_states: Vec::new(),
            bounding_box_visibilities: visibilities.clone(),
            segment_visibilities: Vec::new(),
        })
        .collect();
    tracing.user_states.extend(new_states);
    tracing
}

/// createTracingForExplorational after the RPCs: skeleton or volume, adapted
/// to the old precedence layer. `fallback_layer_has_segment_index` is the
/// hasSegmentIndexFile answer (ignored for skeletons / without fallback).
/// Callers that must skip the RPC when no fallback exists use
/// [`plan_volume_tracing`] directly.
pub(crate) fn create_tracing_for_explorational(
    dataset: &ExplorationalDataset<'_>,
    params: &AnnotationLayerParameters,
    old_precedence: Option<&RedundantTracingProperties>,
    fallback_layer_has_segment_index: bool,
    created_timestamp: i64,
) -> Result<InitialTracing, TracingInitError> {
    match params.typ {
        AnnotationLayerType::Skeleton => Ok(InitialTracing::Skeleton(adapt_skeleton_tracing(
            build_skeleton_tracing(dataset, created_timestamp),
            old_precedence,
        ))),
        AnnotationLayerType::Volume => {
            let tracing = plan_volume_tracing(dataset, params)?
                .build(fallback_layer_has_segment_index, created_timestamp)?;
            Ok(InitialTracing::Volume(adapt_volume_tracing(
                tracing,
                old_precedence,
            )))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use prost::Message;

    fn source(layers: Value) -> DataSource {
        dataset_source::parse_data_source(&json!({
            "id": {"name": "dir_name", "team": "org"},
            "dataLayers": layers,
            "scale": [11.24, 11.24, 28.0],
        }))
        .expect("valid data source")
    }

    fn color(name: &str, bbox: Value, mags: Value) -> Value {
        json!({
            "name": name, "category": "color", "dataFormat": "zarr", "boundingBox": bbox,
            "elementClass": "uint8", "mags": mags,
        })
    }

    fn segmentation(name: &str, element_class: &str, largest: Value, mags: Value) -> Value {
        json!({
            "name": name, "category": "segmentation", "dataFormat": "wkw",
            "boundingBox": {"topLeft": [10, 20, 30], "width": 100, "height": 50, "depth": 10},
            "elementClass": element_class, "mags": mags, "largestSegmentId": largest,
            "additionalAxes": [{"name": "t", "bounds": [0, 5], "index": 0}],
        })
    }

    fn mags(list: &[[i32; 3]]) -> Value {
        Value::Array(list.iter().map(|m| json!({"mag": m})).collect())
    }

    fn default_source() -> DataSource {
        source(json!([
            color(
                "color",
                json!({"topLeft": [-5, 0, 0], "width": 3, "height": 101, "depth": 64}),
                mags(&[[4, 4, 2], [1, 1, 1], [2, 2, 1]])
            ),
            segmentation(
                "segmentation",
                "uint32",
                json!(1234),
                mags(&[[2, 2, 1], [1, 1, 1]])
            ),
        ]))
    }

    fn dataset(source: &DataSource) -> ExplorationalDataset<'_> {
        ExplorationalDataset {
            data_source: source,
            dataset_name: "Dataset Name",
            organization_id: "org",
        }
    }

    fn params(value: Value) -> AnnotationLayerParameters {
        AnnotationLayerParameters::from_json(&value).expect("valid params")
    }

    fn v3(x: i32, y: i32, z: i32) -> Vec3IntProto {
        Vec3IntProto { x, y, z }
    }

    #[test]
    fn layer_parameters_json_matches_play_format() {
        let minimal = params(json!({"typ": "Volume"}));
        assert_eq!(minimal.typ, AnnotationLayerType::Volume);
        assert!(!minimal.auto_fallback_layer);
        assert_eq!(minimal.mag_restrictions, None);
        assert_eq!(minimal.name_with_default(), "Volume");
        assert_eq!(
            minimal.to_json(),
            json!({"typ": "Volume", "autoFallbackLayer": false})
        );

        let full = params(json!({
            "typ": "Skeleton", "fallbackLayerName": null, "autoFallbackLayer": null,
            "mappingName": "agglomerate_view_5", "magRestrictions": {"min": 2.0, "max": null},
            "name": "Trees", "additionalAxes": [{"name": "t", "bounds": [0], "index": 1}],
            "unknown": 1,
        }));
        assert_eq!(full.fallback_layer_name, None);
        assert!(!full.auto_fallback_layer);
        assert_eq!(
            full.mag_restrictions,
            Some(MagRestrictions {
                min: Some(2),
                max: None
            })
        );
        assert_eq!(full.name_with_default(), "Trees");
        assert_eq!(full.additional_axes.as_ref().map(Vec::len), Some(1));
        let round_trip: AnnotationLayerParameters =
            serde_json::from_value(serde_json::to_value(&full).unwrap()).unwrap();
        assert_eq!(round_trip, full);
        assert_eq!(
            serde_json::to_value(&full).unwrap()["magRestrictions"],
            json!({"min": 2})
        );

        for invalid in [
            json!({}),
            json!({"typ": "volume"}),
            json!({"typ": "Volume", "autoFallbackLayer": "true"}),
            json!({"typ": "Volume", "magRestrictions": {"min": 1.5}}),
            json!({"typ": "Volume", "magRestrictions": 3}),
            json!({"typ": "Volume", "name": 3}),
            json!({"typ": "Volume", "additionalAxes": [{"name": "t", "bounds": [0, 1]}]}),
            json!([]),
        ] {
            assert!(
                serde_json::from_value::<AnnotationLayerParameters>(invalid.clone()).is_err(),
                "{invalid}"
            );
        }
    }

    #[test]
    fn skeleton_defaults_match_scala() {
        let source = default_source();
        let tracing = build_skeleton_tracing(&dataset(&source), 1_700_000_000_123);
        // Union box: topLeft (-5,0,0), bottomRight (110,101,64) → center trunc((105)/2)=52.
        assert_eq!(data_source_bounding_box(&source), [-5, 0, 0, 115, 101, 64]);
        let expected = SkeletonTracing {
            dataset_name: "Dataset Name".into(),
            trees: vec![],
            created_timestamp: 1_700_000_000_123,
            bounding_box: None,
            active_node_id: None,
            edit_position: v3(52, 50, 32),
            edit_rotation: zero_rotation(),
            zoom_level: 2.0,
            version: 0,
            user_bounding_box: None,
            tree_groups: vec![],
            user_bounding_boxes: vec![],
            organization_id: Some("org".into()),
            edit_position_additional_coordinates: vec![],
            additional_axes: vec![AdditionalAxisProto {
                name: "t".into(),
                index: 0,
                bounds: Vec2IntProto { x: 0, y: 5 },
            }],
            stored_with_external_tree_bodies: None,
            user_states: vec![],
        };
        assert_eq!(tracing, expected);
        let decoded = SkeletonTracing::decode(tracing.encode_to_vec().as_slice()).unwrap();
        assert_eq!(decoded, expected);
        let initial = InitialTracing::Skeleton(tracing);
        assert_eq!(initial.layer_type(), AnnotationLayerType::Skeleton);
        assert_eq!(
            layer_name(&params(json!({"typ": "Skeleton"})), &initial),
            "Skeleton"
        );
    }

    #[test]
    fn center_uses_jvm_float_truncation() {
        // (-5 + -2) * 0.5f = -3.5 → -3 (toward zero); odd positive sums truncate down.
        assert_eq!(bbox_center(&[-5, 0, 1, 3, 3, 2]), [-3, 1, 2]);
        // Int → Float rounding for large coordinates (16777217 is not a float).
        assert_eq!(
            bbox_center(&[16_777_216, 0, 0, 2, 0, 0]),
            [16_777_216, 0, 0]
        );
        assert_eq!(data_source_center(&source(json!([]))), [0, 0, 0]);
    }

    #[test]
    fn volume_without_fallback_uses_data_source_defaults() {
        let source = default_source();
        let p = params(json!({"typ": "Volume", "mappingName": "m"}));
        let plan = plan_volume_tracing(&dataset(&source), &p).unwrap();
        assert_eq!(plan.segment_index_lookup(), None);
        let tracing = plan.build(false, 42).unwrap();
        let expected = VolumeTracing {
            active_segment_id: None,
            bounding_box: bbox_proto(&[-5, 0, 0, 115, 101, 64]),
            created_timestamp: 42,
            dataset_name: "dir_name".into(),
            edit_position: v3(52, 50, 32),
            edit_rotation: zero_rotation(),
            element_class: ElementClassProto::Uint32 as i32,
            fallback_layer: None,
            largest_segment_id: Some(0),
            version: 0,
            zoom_level: 1.0,
            user_bounding_box: None,
            user_bounding_boxes: vec![],
            organization_id: Some("org".into()),
            // Union of all layer mags is distinct per maxDim → sorted by maxDim.
            mags: vec![v3(1, 1, 1), v3(2, 2, 1), v3(4, 4, 2)],
            segments: vec![],
            mapping_name: Some("m".into()),
            has_editable_mapping: None,
            segment_groups: vec![],
            has_segment_index: Some(true),
            edit_position_additional_coordinates: vec![],
            additional_axes: vec![AdditionalAxisProto {
                name: "t".into(),
                index: 0,
                bounds: Vec2IntProto { x: 0, y: 5 },
            }],
            mapping_is_locked: None,
            volume_bucket_data_has_changed: Some(false),
            unused_hide_unregistered_segments: None,
            user_states: vec![],
        };
        assert_eq!(tracing, expected);
        let decoded = VolumeTracing::decode(tracing.encode_to_vec().as_slice()).unwrap();
        assert_eq!(decoded, expected);
        let initial = InitialTracing::Volume(tracing);
        assert_eq!(layer_name(&p, &initial), "Volume");
        assert_eq!(
            VolumeTracing::decode(initial.encode_to_vec().as_slice()).unwrap(),
            expected
        );
    }

    #[test]
    fn volume_with_auto_fallback_uses_segmentation_layer() {
        let source = default_source();
        let p = params(json!({"typ": "Volume", "autoFallbackLayer": true}));
        let plan = plan_volume_tracing(&dataset(&source), &p).unwrap();
        assert_eq!(plan.segment_index_lookup(), Some("segmentation"));
        let tracing = plan.build(false, 7).unwrap();
        assert_eq!(tracing.fallback_layer.as_deref(), Some("segmentation"));
        assert_eq!(tracing.bounding_box, bbox_proto(&[10, 20, 30, 100, 50, 10]));
        assert_eq!(tracing.edit_position, v3(52, 50, 32));
        assert_eq!(tracing.largest_segment_id, Some(1234));
        assert_eq!(tracing.element_class, ElementClassProto::Uint32 as i32);
        assert_eq!(tracing.mags, vec![v3(1, 1, 1), v3(2, 2, 1)]);
        assert_eq!(tracing.has_segment_index, Some(false));
        assert_eq!(plan.build(true, 7).unwrap().has_segment_index, Some(true));
        assert_eq!(tracing.additional_axes.len(), 1);
        let initial = InitialTracing::Volume(tracing);
        assert_eq!(layer_name(&p, &initial), "segmentation");
        let named = params(json!({"typ": "Volume", "autoFallbackLayer": true, "name": "Mine"}));
        assert_eq!(layer_name(&named, &initial), "Mine");

        // Without autoFallbackLayer nothing is chosen; an explicit name wins.
        let none = plan_volume_tracing(&dataset(&source), &params(json!({"typ": "Volume"})));
        assert_eq!(none.unwrap().segment_index_lookup(), None);
        let unset_lsid = self::source(json!([
            segmentation("first", "uint8", json!(255), mags(&[[1, 1, 1]])),
            segmentation("second", "uint64", Value::Null, mags(&[[1, 1, 1]])),
        ]));
        let explicit = params(json!({
            "typ": "Volume", "autoFallbackLayer": true, "fallbackLayerName": "second",
        }));
        let tracing = plan_volume_tracing(&dataset(&unset_lsid), &explicit)
            .unwrap()
            .build(true, 0)
            .unwrap();
        assert_eq!(tracing.fallback_layer.as_deref(), Some("second"));
        assert_eq!(tracing.largest_segment_id, None);
        assert_eq!(tracing.element_class, ElementClassProto::Uint64 as i32);
    }

    #[test]
    fn fallback_layer_errors() {
        let source = source(json!([
            color(
                "color",
                json!({"topLeft": [0, 0, 0], "width": 1, "height": 1, "depth": 1}),
                mags(&[[1, 1, 1]])
            ),
            segmentation("small", "uint8", json!(256), mags(&[[1, 1, 1]])),
            segmentation("signed", "int16", json!(-1), mags(&[[1, 1, 1]])),
            segmentation("unset", "uint16", Value::Null, mags(&[[1, 1, 1]])),
        ]));
        let plan = |name: &str| {
            plan_volume_tracing(
                &dataset(&source),
                &params(json!({"typ": "Volume", "fallbackLayerName": name})),
            )
        };
        for name in ["color", "missing"] {
            let error = plan(name).unwrap_err();
            assert_eq!(error, TracingInitError::FallbackLayerNotFound(name.into()));
            assert_eq!(error.message(), None);
        }
        assert_eq!(
            plan("small").unwrap_err().message().as_deref(),
            Some(
                "The largest segment id 256 specified for the annotation layer exceeds the range of its data type “uint8”."
            )
        );
        assert_eq!(
            plan("signed").unwrap_err(),
            TracingInitError::LargestSegmentIdExceedsRange {
                largest_segment_id: -1,
                element_class: "int16".into()
            }
        );
        assert!(plan("unset").is_ok());

        assert!(largest_segment_id_is_in_range(Some(-5), "uint64"));
        assert!(largest_segment_id_is_in_range(
            Some(i64::from(u32::MAX)),
            "uint32"
        ));
        assert!(!largest_segment_id_is_in_range(Some(1 << 32), "uint32"));
        assert!(largest_segment_id_is_in_range(Some(127), "int8"));
        assert!(!largest_segment_id_is_in_range(Some(128), "int8"));
        assert!(!largest_segment_id_is_in_range(None, "uint24"));
        assert!(!largest_segment_id_is_in_range(None, "float"));
        assert_eq!(
            element_class_to_proto("float")
                .unwrap_err()
                .message()
                .as_deref(),
            Some("Unsupported element class float for ElementClassProto")
        );
        assert_eq!(
            element_class_to_proto("int64").unwrap(),
            ElementClassProto::Int64
        );
    }

    #[test]
    fn mag_restrictions_and_template_layer() {
        let source = default_source();
        let restricted = params(json!({"typ": "Volume", "magRestrictions": {"min": 2, "max": 2}}));
        let tracing = plan_volume_tracing(&dataset(&source), &restricted)
            .unwrap()
            .build(false, 0)
            .unwrap();
        assert_eq!(tracing.mags, vec![v3(2, 2, 1)]);
        let too_tight = params(json!({"typ": "Volume", "magRestrictions": {"min": 8}}));
        let error = plan_volume_tracing(&dataset(&source), &too_tight).unwrap_err();
        assert_eq!(error, TracingInitError::MagRestrictionsTooTight);
        assert_eq!(error.to_string(), MAG_RESTRICTIONS_TOO_TIGHT);
        // Skeletons ignore mag restrictions.
        let skeleton = params(json!({"typ": "Skeleton", "magRestrictions": {"min": 8}}));
        assert!(matches!(
            create_tracing_for_explorational(&dataset(&source), &skeleton, None, false, 0),
            Ok(InitialTracing::Skeleton(_))
        ));

        // 2-2-1 and 2-2-2 share maxDim 2 → first layer with most mags, distinct.
        let conflicting = source_with_layers(&[
            &[[1, 1, 1], [2, 2, 1]],
            &[[1, 1, 1], [2, 2, 2], [2, 2, 2], [8, 8, 8]],
            &[[1, 1, 1], [4, 4, 4], [16, 16, 16]],
        ]);
        assert_eq!(
            mags_for_volume_tracing(&conflicting, None),
            vec![[1, 1, 1], [2, 2, 2], [8, 8, 8]]
        );
        // A fallback layer's mags are used as-is (sorted, not deduplicated).
        let fallback = &conflicting.layers[1];
        assert_eq!(
            mags_for_volume_tracing(&conflicting, Some(fallback)),
            vec![[1, 1, 1], [2, 2, 2], [2, 2, 2], [8, 8, 8]]
        );
    }

    fn source_with_layers(layer_mags: &[&[[i32; 3]]]) -> DataSource {
        source(Value::Array(
            layer_mags
                .iter()
                .enumerate()
                .map(|(i, m)| {
                    color(
                        &format!("c{i}"),
                        json!({"topLeft": [0, 0, 0], "width": 8, "height": 8, "depth": 8}),
                        mags(m),
                    )
                })
                .collect(),
        ))
    }

    #[test]
    fn additional_axes_union_merges_like_scala_hash_map() {
        let mut layer_a = color(
            "a",
            json!({"topLeft": [0, 0, 0], "width": 1, "height": 1, "depth": 1}),
            mags(&[[1, 1, 1]]),
        );
        layer_a["additionalAxes"] = json!([
            {"name": "t", "bounds": [2, 5], "index": 3},
        ]);
        let mut layer_b = layer_a.clone();
        layer_b["name"] = json!("b");
        layer_b["additionalAxes"] = json!([
            {"name": "t", "bounds": [0, 4], "index": 9},
            {"name": "c", "bounds": [0, 2], "index": 1},
        ]);
        let source = source(json!([layer_a, layer_b]));
        // "c".hashCode = 99 → bucket 3; "t" = 116 → bucket 4.
        let axes = additional_axes_union(&source).unwrap();
        assert_eq!(
            axes,
            vec![
                Axis {
                    name: "c".into(),
                    bounds: vec![0, 2],
                    index: 1
                },
                Axis {
                    name: "t".into(),
                    bounds: vec![0, 5],
                    index: 3
                },
            ]
        );
        assert_eq!(java_string_hash("time"), 3_560_141);
        assert_eq!(additional_axes_union(&default_source_without_axes()), None);
        assert!(additional_axes_to_proto(None).is_empty());
    }

    fn default_source_without_axes() -> DataSource {
        source_with_layers(&[&[[1, 1, 1]]])
    }

    fn layer(tracing_id: &str, typ: AnnotationLayerType) -> AnnotationLayer {
        AnnotationLayer {
            tracing_id: tracing_id.into(),
            typ,
            name: format!("{tracing_id}-name"),
        }
    }

    #[test]
    fn precedence_layer_selection() {
        use AnnotationLayerType::{Skeleton, Volume};
        let annotation = ObjectId::parse("0123456789abcdef01234567").unwrap();
        assert_eq!(precedence_fetch_request(None, &[], Some(3)), Ok(None));
        let volumes = [layer("b", Volume), layer("a", Volume)];
        assert_eq!(
            precedence_fetch_request(None, &volumes, None),
            Err(TracingInitError::PrecedenceLayerNeedsAnnotationId)
        );
        let request = precedence_fetch_request(Some(&annotation), &volumes, Some(3))
            .unwrap()
            .unwrap();
        assert_eq!(
            request,
            PrecedenceFetchRequest {
                annotation_id: annotation.clone(),
                tracing_id: "a".into(),
                layer_name: "a-name".into(),
                typ: Volume,
                version: Some(3),
            }
        );
        let mixed = [
            layer("a", Volume),
            layer("z", Skeleton),
            layer("y", Skeleton),
        ];
        assert_eq!(
            select_layer_with_precedence(&mixed).unwrap().tracing_id,
            "y"
        );
        // UTF-16 order: U+FF5E sorts after U+1F600's surrogate pair (0xD83D).
        let unicode = [layer("\u{FF5E}", Skeleton), layer("\u{1F600}", Skeleton)];
        assert_eq!(
            select_layer_with_precedence(&unicode).unwrap().tracing_id,
            "\u{1F600}"
        );
    }

    fn visibility(id: i32, value: bool) -> Id32WithBool {
        Id32WithBool { id, value }
    }

    fn named_box(id: i32) -> NamedBoundingBoxProto {
        NamedBoundingBoxProto {
            id,
            name: Some(format!("box{id}")),
            is_visible: Some(true),
            color: None,
            bounding_box: bbox_proto(&[1, 2, 3, 4, 5, 6]),
        }
    }

    fn precedence_volume() -> VolumeTracing {
        let source = default_source();
        let mut volume = plan_volume_tracing(&dataset(&source), &params(json!({"typ": "Volume"})))
            .unwrap()
            .build(false, 0)
            .unwrap();
        volume.edit_position = v3(7, 8, 9);
        volume.edit_rotation = Vec3DoubleProto {
            x: 90.0,
            y: 0.0,
            z: 1.5,
        };
        volume.zoom_level = 0.75;
        volume.user_bounding_boxes = vec![named_box(3)];
        volume.user_bounding_box = Some(bbox_proto(&[0, 0, 0, 9, 9, 9]));
        volume.edit_position_additional_coordinates = vec![AdditionalCoordinateProto {
            name: "t".into(),
            value: 2,
        }];
        let state = |user: &str, vis: Vec<Id32WithBool>| VolumeUserStateProto {
            user_id: user.into(),
            active_segment_id: Some(5),
            segment_group_expanded_states: vec![],
            bounding_box_visibilities: vis,
            segment_visibilities: vec![],
        };
        volume.user_states = vec![
            state("u1", vec![visibility(3, false)]),
            state("u2", vec![visibility(3, true)]),
            state("u1", vec![visibility(3, true), visibility(0, false)]),
        ];
        volume
    }

    #[test]
    fn old_precedence_properties_adapt_new_tracings() {
        let properties = RedundantTracingProperties::extract(&FetchedPrecedenceTracing::Volume(
            precedence_volume(),
        ));
        assert_eq!(properties.user_bounding_boxes.len(), 2);
        assert_eq!(
            properties.user_bounding_boxes[1],
            NamedBoundingBoxProto {
                id: 0,
                name: None,
                is_visible: None,
                color: None,
                bounding_box: bbox_proto(&[0, 0, 0, 9, 9, 9]),
            }
        );
        // toMap: first position, last value.
        assert_eq!(
            properties.user_state_bounding_box_visibilities,
            vec![
                ("u1".into(), vec![visibility(3, true), visibility(0, false)]),
                ("u2".into(), vec![visibility(3, true)]),
            ]
        );

        let source = default_source();
        let mut skeleton = build_skeleton_tracing(&dataset(&source), 0);
        skeleton.user_states = vec![SkeletonUserStateProto {
            user_id: "u2".into(),
            active_node_id: Some(4),
            tree_group_expanded_states: vec![visibility(1, true)],
            bounding_box_visibilities: vec![],
            tree_visibilities: vec![visibility(9, false)],
        }];
        let adapted = adapt_skeleton_tracing(skeleton.clone(), Some(&properties));
        assert_eq!(adapted.edit_position, v3(7, 8, 9));
        assert_eq!(adapted.edit_rotation.x, 90.0);
        assert_eq!(adapted.zoom_level, 0.75);
        assert_eq!(adapted.user_bounding_boxes, properties.user_bounding_boxes);
        assert_eq!(adapted.edit_position_additional_coordinates.len(), 1);
        assert_eq!(adapted.additional_axes, skeleton.additional_axes);
        assert_eq!(
            adapted.user_states,
            vec![
                SkeletonUserStateProto {
                    user_id: "u2".into(),
                    active_node_id: Some(4),
                    tree_group_expanded_states: vec![visibility(1, true)],
                    bounding_box_visibilities: vec![visibility(3, true)],
                    tree_visibilities: vec![visibility(9, false)],
                },
                SkeletonUserStateProto {
                    user_id: "u1".into(),
                    active_node_id: None,
                    tree_group_expanded_states: vec![],
                    bounding_box_visibilities: vec![visibility(3, true), visibility(0, false)],
                    tree_visibilities: vec![],
                },
            ]
        );
        assert_eq!(adapt_skeleton_tracing(skeleton.clone(), None), skeleton);

        let skeleton_precedence =
            RedundantTracingProperties::extract(&FetchedPrecedenceTracing::Skeleton(adapted));
        let fresh = plan_volume_tracing(&dataset(&source), &params(json!({"typ": "Volume"})))
            .unwrap()
            .build(false, 0)
            .unwrap();
        let volume = adapt_volume_tracing(fresh.clone(), Some(&skeleton_precedence));
        assert_eq!(volume.edit_position, v3(7, 8, 9));
        // The skeleton had no legacy userBoundingBox → no extra id-0 box.
        assert_eq!(volume.user_bounding_boxes, properties.user_bounding_boxes);
        assert_eq!(
            volume
                .user_states
                .iter()
                .map(|s| (s.user_id.as_str(), s.active_segment_id))
                .collect::<Vec<_>>(),
            vec![("u2", None), ("u1", None)]
        );
        assert_eq!(volume.mags, fresh.mags);
        assert_eq!(volume.largest_segment_id, Some(0));
        let decoded = VolumeTracing::decode(volume.encode_to_vec().as_slice()).unwrap();
        assert_eq!(decoded, volume);

        let created = create_tracing_for_explorational(
            &dataset(&source),
            &params(json!({"typ": "Volume"})),
            Some(&skeleton_precedence),
            false,
            0,
        )
        .unwrap();
        assert_eq!(created, InitialTracing::Volume(volume));
    }

    #[test]
    fn combine_largest_segment_ids() {
        assert_eq!(
            combine_largest_segment_ids_by_precedence(Some(5), Some(Some(7))),
            Some(5)
        );
        assert_eq!(
            combine_largest_segment_ids_by_precedence(None, Some(None)),
            None
        );
        assert_eq!(
            combine_largest_segment_ids_by_precedence(None, Some(Some(7))),
            Some(7)
        );
        assert_eq!(
            combine_largest_segment_ids_by_precedence(None, None),
            Some(0)
        );
    }
}
