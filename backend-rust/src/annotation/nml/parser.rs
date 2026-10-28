//! Pure NML parser mirroring `app/models/annotation/nml/NmlParser.scala`
//! (plus `NmlResults.scala`, `TreeValidator` and `MultiComponentTreeSplitter`).
//!
//! The parser is split in two steps, exactly where Scala interleaves its only
//! database access (`DatasetDAO.findOneByIdOrNameAndOrganization`):
//!
//! 1. [`parse_nml`] turns the raw bytes into [`NmlParsedParameters`] (Scala's
//!    `getParametersFromNML`), including every structural validation, or into a
//!    formatted failure / the "empty file" outcome.
//! 2. The caller validates [`NmlParsedParameters::validated_dataset_id`], looks
//!    up the dataset (see `checkpoints/nml-parser.md`) and calls
//!    [`NmlParsedParameters::into_success`] (Scala's `nmlParametersToResult`).
//!
//! Failure messages are the strings Scala produces after
//! `Formatter.formatFailureChain` (`outer <~ inner`), so callers can store them
//! verbatim in [`NmlParseResult::Failure`].

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};

use quick_xml::XmlVersion;
use quick_xml::events::{BytesStart, Event};
use quick_xml::reader::Reader;

use crate::proto::datastore::volume_tracing::ElementClassProto;
use crate::proto::datastore::{
    AdditionalAxisProto, AdditionalCoordinateProto, BoundingBoxProto, BranchPoint, ColorProto,
    Comment, Edge, MetadataEntryProto, NamedBoundingBoxProto, Node, Segment, SegmentGroup,
    SkeletonTracing, Tree, TreeGroup, Vec2IntProto, Vec3DoubleProto, Vec3IntProto, VolumeTracing,
};
use crate::util::id::ObjectId;

// ---------------------------------------------------------------------------
// Messages (util/src/main/scala/com/scalableminds/util/Msg.scala, object Nml)
// ---------------------------------------------------------------------------

pub const MSG_PARAMETERS_NOT_FOUND: &str = "No parameters section found.";
pub const MSG_DUPLICATE_VOLUME_LAYER_NAMES: &str =
    "Annotations with multiple volume layers must have a unique name for each layer.";
pub const MSG_ADDITIONAL_COORDINATES_NOT_UNIQUE: &str =
    "Additional coordinates do not have unique names.";

fn msg_invalid_elements(name: &str) -> String {
    format!("Invalid {name} elements.")
}
fn msg_invalid_tree_elements(name: &str, tree_id: i32) -> String {
    format!("Invalid {name} in tree {tree_id}.")
}
fn msg_invalid_tree_group_id(id: &str) -> String {
    format!("Invalid tree group id “{id}”.")
}
fn msg_invalid_segment_group_id(id: &str) -> String {
    format!("Invalid segment group id “{id}”.")
}
fn msg_invalid_tree_id(id: &str) -> String {
    format!("Invalid tree id “{id}”.")
}
fn msg_invalid_node_id(label_with_leading_space: &str, id: &str) -> String {
    format!("Invalid{label_with_leading_space} node id “{id}”.")
}
fn msg_invalid_node_id_in_comment(id: &str) -> String {
    format!("Invalid node id “{id}” in comment.")
}
fn msg_invalid_edge(src: &str, dst: &str) -> String {
    format!("Invalid edge “{src}-{dst}”.")
}
fn msg_invalid_node_attribute(name: &str, id: i32) -> String {
    format!("Invalid node {name} for node id {id}.")
}

/// Default zoom level (`SkeletonTracingDefaults.zoomLevel`).
pub const DEFAULT_ZOOM_LEVEL: f64 = 2.0;
const DEFAULT_NODE_RADIUS: f32 = 1.0;
const TASK_BOUNDING_BOX_NAME: &str = "task bounding box";

// ---------------------------------------------------------------------------
// Public data model
// ---------------------------------------------------------------------------

/// `models.annotation.SharedParsingParameters`. `useZipName` is handled by the
/// caller (it only renames results of zipped NMLs) and therefore absent here.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SharedParsingParameters {
    pub overwriting_dataset_id: Option<String>,
    pub user_organization_id: String,
    pub is_task_upload: bool,
    pub fallback_edit_position: Option<Vec3IntProto>,
    pub fallback_edit_rotation: Option<Vec3DoubleProto>,
    pub fallback_zoom_level: Option<f64>,
}

/// Non-deterministic inputs of the Scala parser, injected to keep it pure.
#[derive(Debug, Clone, PartialEq)]
pub struct NmlParseContext {
    /// `System.currentTimeMillis()`: created timestamp of trees without nodes.
    pub now_millis: i64,
    /// `ColorGenerator.getRandomColor`: colour of the task bounding box that is
    /// converted to a user bounding box for non-task uploads.
    pub task_bounding_box_color: ColorProto,
}

impl NmlParseContext {
    /// Context with the current wall-clock time and a random colour.
    pub fn current() -> Self {
        let now_millis = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
            .unwrap_or(0);
        Self {
            now_millis,
            task_bounding_box_color: random_color(),
        }
    }
}

/// `ColorGenerator.getRandomColor`: three uniform components in [0, 1), alpha 1.
pub fn random_color() -> ColorProto {
    let mut bytes = [0u8; 24];
    // Fall back to a fixed colour if the OS RNG is unavailable; the colour is cosmetic.
    if getrandom::fill(&mut bytes).is_err() {
        return ColorProto {
            r: 0.5,
            g: 0.5,
            b: 0.5,
            a: 1.0,
        };
    }
    let component = |chunk: &[u8]| {
        let mut array = [0u8; 8];
        array.copy_from_slice(chunk);
        (u64::from_le_bytes(array) >> 11) as f64 / (1u64 << 53) as f64
    };
    ColorProto {
        r: component(&bytes[0..8]),
        g: component(&bytes[8..16]),
        b: component(&bytes[16..24]),
        a: 1.0,
    }
}

/// `models.annotation.nml.NmlVolumeTag`.
#[derive(Debug, Clone, PartialEq)]
pub struct NmlVolumeTag {
    /// `location` attribute: path of the volume data zip inside the upload.
    pub data_zip_path: String,
    pub fallback_layer_name: Option<String>,
    pub mapping_name: Option<String>,
    pub mapping_is_locked: Option<bool>,
    pub name: Option<String>,
    pub segments: Vec<Segment>,
    pub largest_segment_id: Option<i64>,
    pub segment_groups: Vec<SegmentGroup>,
    pub edited_mapping_edges_location: Option<String>,
    pub edited_mapping_base_mapping_name: Option<String>,
}

/// `models.annotation.nml.NmlParsedParameters`: everything parsed from the
/// file before the dataset lookup.
#[derive(Debug, Clone, PartialEq)]
pub struct NmlParsedParameters {
    /// Raw (unvalidated) dataset id: the overwriting id if given, else the
    /// `experiment/@datasetId` attribute.
    pub dataset_id_opt: Option<String>,
    pub dataset_name: String,
    pub organization_id: String,
    pub description: String,
    pub wk_url: Option<String>,
    pub volumes: Vec<NmlVolumeTag>,
    pub edit_position: Vec3IntProto,
    pub edit_position_additional_coordinates: Vec<AdditionalCoordinateProto>,
    pub edit_rotation: Vec3DoubleProto,
    pub additional_axes: Vec<AdditionalAxisProto>,
    /// Only set for task uploads (`isTaskUpload`).
    pub task_bounding_box: Option<BoundingBoxProto>,
    pub timestamp: i64,
    pub zoom_level: f64,
    pub user_bounding_boxes: Vec<NamedBoundingBoxProto>,
    /// Trees after splitting multi-component trees.
    pub trees: Vec<Tree>,
    pub active_node_id: Option<i32>,
    /// Tree groups after splitting multi-component trees.
    pub tree_groups: Vec<TreeGroup>,
}

/// Dataset found by the caller's lookup (`Dataset._id`, `name`, `_organization`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DatasetRef {
    pub id: ObjectId,
    pub name: String,
    pub organization_id: String,
}

/// `models.annotation.UploadedVolumeLayer`.
#[derive(Debug, Clone, PartialEq)]
pub struct UploadedVolumeLayer {
    pub tracing: VolumeTracing,
    /// `basePath + location`; key into the upload's other (non-NML) files.
    pub data_zip_location: String,
    pub name: Option<String>,
    pub edited_mapping_edges_location: Option<String>,
    pub edited_mapping_base_mapping_name: Option<String>,
}

/// `models.annotation.nml.NmlParseSuccessWithoutFile`.
#[derive(Debug, Clone, PartialEq)]
pub struct NmlParseSuccessWithoutFile {
    pub skeleton_tracing: SkeletonTracing,
    pub volume_layers: Vec<UploadedVolumeLayer>,
    pub dataset_id: ObjectId,
    pub description: String,
    pub wk_url: Option<String>,
}

/// Outcome of [`parse_nml`] (Scala `Box[NmlParsedParameters]`).
#[derive(Debug, Clone, PartialEq)]
pub enum NmlParseOutcome {
    Parsed(Box<NmlParsedParameters>),
    /// Formatted failure chain, ready for [`NmlParseResult::Failure`].
    Failure(String),
    /// Empty document (Scala `Empty` → `NmlParseEmpty`).
    Empty,
}

/// `NmlResults.NmlParseResult`.
#[derive(Debug, Clone, PartialEq)]
pub enum NmlParseResult {
    Success {
        file_name: String,
        success: Box<NmlParseSuccessWithoutFile>,
    },
    Failure {
        file_name: String,
        error: String,
    },
    Empty {
        file_name: String,
    },
}

impl NmlParseResult {
    pub fn file_name(&self) -> &str {
        match self {
            Self::Success { file_name, .. }
            | Self::Failure { file_name, .. }
            | Self::Empty { file_name } => file_name,
        }
    }

    pub fn succeeded(&self) -> bool {
        matches!(self, Self::Success { .. })
    }

    /// `NmlParseResult.description` (only successes carry one).
    pub fn description(&self) -> Option<&str> {
        match self {
            Self::Success { success, .. } => Some(&success.description),
            _ => None,
        }
    }

    /// `withName`: only successes are renamed (used with `useZipName`).
    pub fn with_name(self, name: &str) -> Self {
        match self {
            Self::Success { success, .. } => Self::Success {
                file_name: name.to_owned(),
                success,
            },
            other => other,
        }
    }

    /// `toSuccessBox`, with Scala's messages.
    pub fn to_success(&self) -> Result<&NmlParseSuccessWithoutFile, String> {
        match self {
            Self::Success { success, .. } => Ok(success),
            Self::Failure { file_name, error } => {
                Err(format!("Couldn’t parse file: {file_name}. {error}"))
            }
            Self::Empty { file_name } => Err(format!("Couldn’t parse file: {file_name}")),
        }
    }
}

/// `NmlParseSuccess.fileNameWithoutExtension`.
pub fn file_name_without_extension(file_name: &str) -> &str {
    let split = file_name.len().wrapping_sub(4);
    match (file_name.get(..split), file_name.get(split..)) {
        (Some(stem), Some(extension))
            if extension.eq_ignore_ascii_case(".nml") || extension.eq_ignore_ascii_case(".zip") =>
        {
            stem
        }
        _ => file_name,
    }
}

impl NmlParsedParameters {
    /// `Fox.runOptional(datasetIdOpt)(ObjectId.fromString)`: validates the raw
    /// dataset id (lower-cased like `ObjectId`), or fails with Scala's message.
    pub fn validated_dataset_id(&self) -> Result<Option<ObjectId>, String> {
        self.dataset_id_opt
            .as_deref()
            .map(|literal| {
                ObjectId::parse(literal).map_err(|_| crate::msg::object_id::invalid(literal))
            })
            .transpose()
    }

    /// `nmlParametersToResult` after the dataset lookup. `base_path` is the
    /// path of the containing zip for NMLs extracted from a zip (Scala
    /// `Some(file.getPath)`), prepended verbatim to volume locations.
    pub fn into_success(
        self,
        dataset: &DatasetRef,
        base_path: Option<&str>,
    ) -> NmlParseSuccessWithoutFile {
        let base = base_path.unwrap_or("");
        let volume_layers = self
            .volumes
            .into_iter()
            .map(|v| {
                let has_editable_mapping = v.edited_mapping_edges_location.as_ref().map(|_| true);
                UploadedVolumeLayer {
                    tracing: VolumeTracing {
                        active_segment_id: None,
                        bounding_box: self.task_bounding_box.unwrap_or_else(empty_bbox),
                        created_timestamp: self.timestamp,
                        dataset_name: dataset.name.clone(),
                        edit_position: self.edit_position,
                        edit_rotation: self.edit_rotation,
                        element_class: ElementClassProto::Uint32 as i32,
                        fallback_layer: v.fallback_layer_name,
                        largest_segment_id: v.largest_segment_id.map(|id| id as u64),
                        version: 0,
                        zoom_level: self.zoom_level,
                        user_bounding_box: None,
                        user_bounding_boxes: self.user_bounding_boxes.clone(),
                        organization_id: Some(dataset.organization_id.clone()),
                        segments: v.segments,
                        mapping_name: v.mapping_name,
                        mapping_is_locked: v.mapping_is_locked,
                        segment_groups: v.segment_groups,
                        has_segment_index: None,
                        edit_position_additional_coordinates: self
                            .edit_position_additional_coordinates
                            .clone(),
                        additional_axes: self.additional_axes.clone(),
                        has_editable_mapping,
                        ..Default::default()
                    },
                    data_zip_location: format!("{base}{}", v.data_zip_path),
                    name: v.name,
                    edited_mapping_edges_location: v
                        .edited_mapping_edges_location
                        .map(|location| format!("{base}{location}")),
                    edited_mapping_base_mapping_name: v.edited_mapping_base_mapping_name,
                }
            })
            .collect();
        let skeleton_tracing = SkeletonTracing {
            dataset_name: dataset.name.clone(),
            trees: self.trees,
            created_timestamp: self.timestamp,
            bounding_box: self.task_bounding_box,
            active_node_id: self.active_node_id,
            edit_position: self.edit_position,
            edit_rotation: self.edit_rotation,
            zoom_level: self.zoom_level,
            version: 0,
            user_bounding_box: None,
            tree_groups: self.tree_groups,
            user_bounding_boxes: self.user_bounding_boxes,
            organization_id: Some(dataset.organization_id.clone()),
            edit_position_additional_coordinates: self.edit_position_additional_coordinates,
            additional_axes: self.additional_axes,
            ..Default::default()
        };
        NmlParseSuccessWithoutFile {
            skeleton_tracing,
            volume_layers,
            dataset_id: dataset.id.clone(),
            description: self.description,
            wk_url: self.wk_url,
        }
    }
}

fn empty_bbox() -> BoundingBoxProto {
    BoundingBoxProto {
        top_left: Vec3IntProto { x: 0, y: 0, z: 0 },
        width: 0,
        height: 0,
        depth: 0,
    }
}

// ---------------------------------------------------------------------------
// Failure modelling (Box Failure chain vs. thrown exception)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
struct BoxFailure {
    msg: String,
    chain: Option<Box<BoxFailure>>,
}

impl BoxFailure {
    /// `Formatter.formatFailureChain` (no exceptions, no stack traces).
    fn format(&self) -> String {
        match &self.chain {
            Some(inner) => format!("{} <~ {}", self.msg, inner.format()),
            None => self.msg.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
enum Fail {
    /// A Box `Failure` (chained with `?~>`).
    Box(BoxFailure),
    /// A JVM exception (`e.toString`), caught by the top-level `try`.
    Exception(String),
}

type PResult<T> = Result<T, Fail>;

fn fail(msg: impl Into<String>) -> Fail {
    Fail::Box(BoxFailure {
        msg: msg.into(),
        chain: None,
    })
}

trait ChainExt {
    /// Scala `?~>` on a failed box.
    fn chain_msg(self, msg: impl FnOnce() -> String) -> Self;
}

impl<T> ChainExt for PResult<T> {
    fn chain_msg(self, msg: impl FnOnce() -> String) -> Self {
        self.map_err(|err| match err {
            Fail::Box(inner) => Fail::Box(BoxFailure {
                msg: msg(),
                chain: Some(Box::new(inner)),
            }),
            exception => exception,
        })
    }
}

/// `Box.combined(seq.map(f))`: every element is evaluated (so a later thrown
/// exception wins over an earlier failure), then the first failure is returned.
fn combined<'a, T>(
    items: impl IntoIterator<Item = &'a XmlElement>,
    mut f: impl FnMut(&'a XmlElement) -> PResult<T>,
) -> PResult<Vec<T>> {
    let mut out = Vec::new();
    let mut first_failure = None;
    for item in items {
        match f(item) {
            Ok(value) => out.push(value),
            Err(Fail::Exception(e)) => return Err(Fail::Exception(e)),
            Err(failure) => {
                if first_failure.is_none() {
                    first_failure = Some(failure);
                }
            }
        }
    }
    match first_failure {
        Some(failure) => Err(failure),
        None => Ok(out),
    }
}

// ---------------------------------------------------------------------------
// Java/Scala number and boolean conversions
// ---------------------------------------------------------------------------

/// `String.toIntOpt` (`Integer.parseInt`, ASCII digits only).
fn to_int(s: &str) -> Option<i32> {
    java_integer_literal(s)?.parse().ok()
}

/// `String.toLongOpt` (`Long.parseLong`).
fn to_long(s: &str) -> Option<i64> {
    java_integer_literal(s)?.parse().ok()
}

fn java_integer_literal(s: &str) -> Option<&str> {
    let digits = s.strip_prefix(['+', '-']).unwrap_or(s);
    (!digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit())).then_some(s)
}

/// Java's `NumberFormatException.toString` for radix 10.
fn number_format_exception(s: &str) -> Fail {
    Fail::Exception(format!(
        "java.lang.NumberFormatException: For input string: \"{s}\""
    ))
}

/// `String.toInt` (throws).
fn to_int_or_throw(s: &str) -> PResult<i32> {
    to_int(s).ok_or_else(|| number_format_exception(s))
}

/// `String.toLong` (throws).
fn to_long_or_throw(s: &str) -> PResult<i64> {
    to_long(s).ok_or_else(|| number_format_exception(s))
}

/// Normalises a Java `Double.parseDouble`/`Float.parseFloat` literal into one
/// Rust accepts: trims chars <= ' ', drops an `f`/`d` suffix, and rejects Rust
/// spellings Java does not accept (`inf`, `nan`, ...). Hex floats are rejected.
fn java_float_literal(s: &str) -> Option<Cow<'_, str>> {
    let trimmed = s.trim_matches(|c: char| c <= ' ');
    let unsigned = trimmed.strip_prefix(['+', '-']).unwrap_or(trimmed);
    if unsigned == "NaN" {
        return Some(Cow::Borrowed("NaN"));
    }
    if unsigned == "Infinity" {
        return Some(Cow::Owned(trimmed.replace("Infinity", "inf")));
    }
    let body = trimmed
        .strip_suffix(['f', 'F', 'd', 'D'])
        .unwrap_or(trimmed);
    let body_unsigned = body.strip_prefix(['+', '-']).unwrap_or(body);
    if body_unsigned.is_empty()
        || !body_unsigned
            .bytes()
            .all(|b| b.is_ascii_digit() || matches!(b, b'.' | b'e' | b'E' | b'+' | b'-'))
        || !body_unsigned
            .bytes()
            .next()
            .is_some_and(|b| b.is_ascii_digit() || b == b'.')
    {
        return None;
    }
    Some(Cow::Borrowed(body))
}

/// `String.toDoubleOpt`.
fn to_double(s: &str) -> Option<f64> {
    java_float_literal(s)?.parse().ok()
}

/// `String.toFloatOpt`.
fn to_float(s: &str) -> Option<f32> {
    java_float_literal(s)?.parse().ok()
}

/// `String.toBooleanOpt` (case-insensitive `true`/`false`).
fn to_bool(s: &str) -> Option<bool> {
    if s.eq_ignore_ascii_case("true") {
        Some(true)
    } else if s.eq_ignore_ascii_case("false") {
        Some(false)
    } else {
        None
    }
}

/// `math.round(Float): Int` (ties towards positive infinity, NaN → 0, saturating).
fn java_round_float(value: f32) -> i32 {
    let value = f64::from(value);
    if value.is_nan() {
        return 0;
    }
    (value + 0.5).floor() as i32
}

/// `scala.xml.Utility.escape`, applied by `Text.toString` when Scala reads an
/// attribute via `attribute.value.toString` (additional coordinates and
/// string-list metadata values).
fn scala_xml_escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '&' => out.push_str("&amp;"),
            '"' => out.push_str("&quot;"),
            c if c >= ' ' || matches!(c, '\n' | '\r' | '\t') => out.push(c),
            _ => {}
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Minimal DOM built with quick-xml (scala.xml.XML.load equivalent)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
struct XmlAttribute {
    /// Local part of the qualified name (scala.xml `attribute.key`).
    key: String,
    /// Whether the name had a prefix (`PrefixedAttribute`); prefixed
    /// attributes are invisible to `node.attribute(key)`.
    prefixed: bool,
    value: String,
}

#[derive(Debug, Clone, PartialEq)]
struct XmlElement {
    /// Local part of the qualified name (scala.xml `label`).
    label: String,
    attributes: Vec<XmlAttribute>,
    children: Vec<XmlElement>,
}

impl XmlElement {
    /// `getSingleAttributeOpt`.
    fn attr_opt(&self, key: &str) -> Option<&str> {
        self.attributes
            .iter()
            .find(|a| !a.prefixed && a.key == key)
            .map(|a| a.value.as_str())
    }

    /// `getSingleAttribute` (missing → "").
    fn attr(&self, key: &str) -> &str {
        self.attr_opt(key).unwrap_or("")
    }

    /// `node \ label`.
    fn children_named<'a>(&'a self, label: &'a str) -> impl Iterator<Item = &'a XmlElement> + 'a {
        self.children.iter().filter(move |c| c.label == label)
    }

    /// `(node \ label).headOption`.
    fn first_child(&self, label: &str) -> Option<&XmlElement> {
        self.children.iter().find(|c| c.label == label)
    }

    /// `node \ a \ b`.
    fn grandchildren<'a>(
        &'a self,
        a: &'a str,
        b: &'a str,
    ) -> impl Iterator<Item = &'a XmlElement> + 'a {
        self.children_named(a)
            .flat_map(move |c| c.children_named(b))
    }
}

enum XmlLoad {
    Document(XmlElement),
    /// "Premature end of file": no root element at all.
    Empty,
    Error {
        line: usize,
        column: usize,
        message: String,
    },
}

fn line_and_column(text: &str, offset: usize) -> (usize, usize) {
    let offset = offset.min(text.len());
    let mut boundary = offset;
    while !text.is_char_boundary(boundary) {
        boundary -= 1;
    }
    let before = &text[..boundary];
    let line = before.matches('\n').count() + 1;
    let column = before.rsplit('\n').next().map_or(0, |l| l.chars().count()) + 1;
    (line, column)
}

fn load_xml(bytes: &[u8]) -> XmlLoad {
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    let text = match std::str::from_utf8(bytes) {
        Ok(text) => text,
        Err(err) => {
            let (line, column) = line_and_column(
                std::str::from_utf8(&bytes[..err.valid_up_to()]).unwrap_or(""),
                err.valid_up_to(),
            );
            return XmlLoad::Error {
                line,
                column,
                message: "Invalid byte 1 of 1-byte UTF-8 sequence.".to_owned(),
            };
        }
    };
    let error_at = |offset: u64, message: String| {
        let (line, column) = line_and_column(text, usize::try_from(offset).unwrap_or(usize::MAX));
        XmlLoad::Error {
            line,
            column,
            message,
        }
    };
    let mut reader = Reader::from_str(text);
    let mut stack: Vec<XmlElement> = Vec::new();
    let mut root: Option<XmlElement> = None;
    loop {
        let position = reader.buffer_position();
        let event = match reader.read_event() {
            Ok(event) => event,
            Err(err) => return error_at(reader.error_position(), err.to_string()),
        };
        let outside_message = || {
            if root.is_some() {
                "Content is not allowed in trailing section.".to_owned()
            } else {
                "Content is not allowed in prolog.".to_owned()
            }
        };
        match event {
            Event::Start(_) | Event::Empty(_) if stack.is_empty() && root.is_some() => {
                return error_at(
                    position,
                    "The markup in the document following the root element must be well-formed."
                        .to_owned(),
                );
            }
            Event::Start(start) => match element_from_start(&start) {
                Ok(element) => stack.push(element),
                Err(message) => return error_at(position, message),
            },
            Event::Empty(start) => match element_from_start(&start) {
                Ok(element) => match stack.last_mut() {
                    Some(parent) => parent.children.push(element),
                    None => root = Some(element),
                },
                Err(message) => return error_at(position, message),
            },
            Event::End(_) => {
                // check_end_names (default) guarantees a matching start tag.
                if let Some(element) = stack.pop() {
                    match stack.last_mut() {
                        Some(parent) => parent.children.push(element),
                        None => root = Some(element),
                    }
                }
            }
            Event::Text(t) => {
                if stack.is_empty() && !t.chars().all(|c| matches!(c, ' ' | '\t' | '\n' | '\r')) {
                    return error_at(position, outside_message());
                }
            }
            Event::CData(_) => {
                if stack.is_empty() {
                    return error_at(position, outside_message());
                }
            }
            Event::GeneralRef(reference) => {
                if stack.is_empty() {
                    return error_at(position, outside_message());
                }
                if reference.is_char_ref() {
                    if let Err(err) = reference.resolve_char_ref() {
                        return error_at(position, err.to_string());
                    }
                } else {
                    let name: &str = &reference;
                    if !matches!(name, "lt" | "gt" | "amp" | "apos" | "quot") {
                        return error_at(
                            position,
                            format!("The entity \"{name}\" was referenced, but not declared."),
                        );
                    }
                }
            }
            Event::DocType(_) => {
                return error_at(
                    position,
                    "DOCTYPE is disallowed when the feature \"http://apache.org/xml/features/disallow-doctype-decl\" set to true."
                        .to_owned(),
                );
            }
            Event::Decl(_) | Event::PI(_) | Event::Comment(_) => {}
            Event::Eof => {
                if !stack.is_empty() {
                    return error_at(
                        position,
                        "XML document structures must start and end within the same entity."
                            .to_owned(),
                    );
                }
                return match root {
                    Some(root) => XmlLoad::Document(root),
                    None => XmlLoad::Empty,
                };
            }
        }
    }
}

/// scala-xml `FactoryAdapter` splits names at the first colon.
fn split_qname(qname: &str) -> (bool, &str) {
    match qname.find(':') {
        Some(index) => (true, &qname[index + 1..]),
        None => (false, qname),
    }
}

fn element_from_start(start: &BytesStart<'_>) -> Result<XmlElement, String> {
    let qname = start.name().as_ref().to_owned();
    let (_, label) = split_qname(&qname);
    let mut attributes = Vec::new();
    for attribute in start.attributes() {
        let attribute = attribute.map_err(|err| err.to_string())?;
        let attribute_qname = attribute.key.as_ref().to_owned();
        if attribute.value.contains('<') {
            return Err(format!(
                "The value of attribute \"{attribute_qname}\" associated with an element type \"{qname}\" must not contain the '<' character."
            ));
        }
        let value = attribute
            .normalized_value(XmlVersion::Implicit1_0)
            .map_err(|err| err.to_string())?
            .into_owned();
        // FactoryAdapter turns every attribute starting with "xmlns" into a namespace binding.
        if attribute_qname.starts_with("xmlns") {
            continue;
        }
        let (prefixed, key) = split_qname(&attribute_qname);
        attributes.push(XmlAttribute {
            key: key.to_owned(),
            prefixed,
            value,
        });
    }
    Ok(XmlElement {
        label: label.to_owned(),
        attributes,
        children: Vec::new(),
    })
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/// Parses an NML document (Scala `getParametersFromNML`). `name` is only used
/// in error messages.
pub fn parse_nml(
    name: &str,
    bytes: &[u8],
    params: &SharedParsingParameters,
    context: &NmlParseContext,
) -> NmlParseOutcome {
    let root = match load_xml(bytes) {
        XmlLoad::Document(root) => root,
        XmlLoad::Empty => return NmlParseOutcome::Empty,
        XmlLoad::Error {
            line,
            column,
            message,
        } => {
            return NmlParseOutcome::Failure(format!(
                "Failed to parse NML '{name}'. Error in Line {line} (column {column}): {message}"
            ));
        }
    };
    match parameters_from_document(&root, params, context) {
        Ok(parsed) => NmlParseOutcome::Parsed(Box::new(parsed)),
        Err(Fail::Box(failure)) => NmlParseOutcome::Failure(failure.format()),
        Err(Fail::Exception(exception)) => {
            NmlParseOutcome::Failure(format!("Failed to parse NML '{name}': {exception}"))
        }
    }
}

/// Converts an outcome into the per-file result once the dataset is known
/// (Scala `AnnotationUploadService.extractFromNml`). `lookup` receives the
/// validated dataset id, the dataset name and the organization id and must
/// reproduce `DatasetDAO.findOneByIdOrNameAndOrganization`, returning the
/// formatted failure chain on error.
pub fn finish_parse_result(
    file_name: &str,
    outcome: NmlParseOutcome,
    base_path: Option<&str>,
    lookup: impl FnOnce(Option<&ObjectId>, &str, &str) -> Result<DatasetRef, String>,
) -> NmlParseResult {
    let parsed = match outcome {
        NmlParseOutcome::Parsed(parsed) => parsed,
        NmlParseOutcome::Failure(error) => {
            return NmlParseResult::Failure {
                file_name: file_name.to_owned(),
                error,
            };
        }
        NmlParseOutcome::Empty => {
            return NmlParseResult::Empty {
                file_name: file_name.to_owned(),
            };
        }
    };
    let dataset = parsed.validated_dataset_id().and_then(|dataset_id| {
        lookup(
            dataset_id.as_ref(),
            &parsed.dataset_name,
            &parsed.organization_id,
        )
    });
    match dataset {
        Ok(dataset) => NmlParseResult::Success {
            file_name: file_name.to_owned(),
            success: Box::new(parsed.into_success(&dataset, base_path)),
        },
        Err(error) => NmlParseResult::Failure {
            file_name: file_name.to_owned(),
            error,
        },
    }
}

fn parameters_from_document(
    root: &XmlElement,
    params: &SharedParsingParameters,
    context: &NmlParseContext,
) -> PResult<NmlParsedParameters> {
    let parameters = root
        .first_child("parameters")
        .ok_or_else(|| fail(MSG_PARAMETERS_NOT_FOUND))?;
    let timestamp = parameters
        .first_child("time")
        .and_then(|n| to_long(n.attr("ms")))
        .unwrap_or(0);
    let comments = parse_comments(root)?;
    let branch_points = parse_branch_points(root, timestamp)?;
    let branch_point_map = group_by_node(&branch_points, |b| b.node_id);
    let comment_map = group_by_node(&comments, |c| c.node_id);
    let trees = combined(root.children_named("thing"), |tree| {
        parse_tree(tree, &branch_point_map, &comment_map, context.now_millis)
    })
    .chain_msg(|| msg_invalid_elements("tree"))?;
    let tree_groups = combined(root.grandchildren("groups", "group"), parse_tree_group)
        .chain_msg(|| msg_invalid_elements("tree group"))?;
    let volumes = root
        .children_named("volume")
        .map(parse_volume)
        .collect::<PResult<Vec<_>>>()?;
    let mut seen_volume_names = HashSet::new();
    if !volumes.iter().all(|v| seen_volume_names.insert(&v.name)) {
        return Err(fail(MSG_DUPLICATE_VOLUME_LAYER_NAMES));
    }
    let (trees, tree_groups) = split_multicomponent_trees(trees, tree_groups)?;
    validate_trees(&trees, &tree_groups, &branch_points, &comments)?;
    let additional_axes = parse_additional_axes(parameters)?;
    let experiment = parameters.first_child("experiment");
    let dataset_name = experiment.map_or("", |e| e.attr("name")).to_owned();
    let dataset_id_opt = match &params.overwriting_dataset_id {
        Some(id) => Some(id.clone()),
        None => experiment
            .and_then(|e| e.attr_opt("datasetId"))
            .map(str::to_owned),
    };
    let organization_id = experiment
        .and_then(|e| e.attr_opt("organization"))
        .unwrap_or(&params.user_organization_id)
        .to_owned();
    let description = experiment.map_or("", |e| e.attr("description")).to_owned();
    let wk_url = experiment.map(|e| e.attr("wkUrl").to_owned());
    let active_node_id = parameters
        .first_child("activeNode")
        .and_then(|n| to_int(n.attr("id")));
    let (edit_position, edit_position_additional_coordinates) =
        match parameters.first_child("editPosition") {
            Some(node) => {
                let xyz = parse_vec3_int(node);
                let additional_coordinates = parse_additional_coordinate_values(node)?;
                xyz.map(|xyz| (xyz, additional_coordinates))
            }
            None => None,
        }
        .unwrap_or_else(|| {
            (
                params
                    .fallback_edit_position
                    .unwrap_or(Vec3IntProto { x: 0, y: 0, z: 0 }),
                Vec::new(),
            )
        });
    let edit_rotation = parameters
        .first_child("editRotation")
        .and_then(|n| parse_rotation(n, "xRot", "yRot", "zRot"))
        .or(params.fallback_edit_rotation)
        .unwrap_or(Vec3DoubleProto {
            x: 0.0,
            y: 0.0,
            z: 0.0,
        });
    let zoom_level = parameters
        .first_child("zoomLevel")
        .and_then(|n| to_double(n.attr("zoom")))
        .or(params.fallback_zoom_level)
        .unwrap_or(DEFAULT_ZOOM_LEVEL);
    let task_bounding_box = if params.is_task_upload {
        parameters
            .first_child("taskBoundingBox")
            .and_then(parse_bounding_box)
    } else {
        None
    };
    let mut user_bounding_boxes =
        parse_user_bounding_boxes(parameters.children_named("userBoundingBox").collect());
    if !params.is_task_upload
        && let Some(bounding_box) = parameters
            .first_child("taskBoundingBox")
            .and_then(parse_bounding_box)
    {
        let id = user_bounding_boxes
            .iter()
            .map(|b| b.id)
            .max()
            .map_or(0, |max| max.wrapping_add(1));
        user_bounding_boxes.push(NamedBoundingBoxProto {
            id,
            name: Some(TASK_BOUNDING_BOX_NAME.to_owned()),
            is_visible: None,
            color: Some(context.task_bounding_box_color),
            bounding_box,
        });
    }
    Ok(NmlParsedParameters {
        dataset_id_opt,
        dataset_name,
        organization_id,
        description,
        wk_url,
        volumes,
        edit_position,
        edit_position_additional_coordinates,
        edit_rotation,
        additional_axes,
        task_bounding_box,
        timestamp,
        zoom_level,
        user_bounding_boxes,
        trees,
        active_node_id,
        tree_groups,
    })
}

/// `buildBranchPointMap` / `buildCommentMap`: entries are prepended, so each
/// node's list is in reverse document order.
fn group_by_node<T: Clone>(items: &[T], key: impl Fn(&T) -> i32) -> HashMap<i32, Vec<T>> {
    let mut map: HashMap<i32, Vec<T>> = HashMap::new();
    for item in items.iter().rev() {
        map.entry(key(item)).or_default().push(item.clone());
    }
    map
}

fn parse_comments(root: &XmlElement) -> PResult<Vec<Comment>> {
    combined(root.grandchildren("comments", "comment"), |node| {
        let node_id_text = node.attr("node");
        let node_id = to_int(node_id_text)
            .ok_or_else(|| fail(msg_invalid_node_id_in_comment(node_id_text)))?;
        Ok(Comment {
            node_id,
            content: node.attr("content").to_owned(),
        })
    })
    .chain_msg(|| msg_invalid_elements("comment"))
}

fn parse_branch_points(root: &XmlElement, default_timestamp: i64) -> PResult<Vec<BranchPoint>> {
    let mut index: i64 = 0;
    combined(root.grandchildren("branchpoints", "branchpoint"), |node| {
        let current = index;
        index += 1;
        let id_text = node.attr("id");
        let node_id =
            to_int(id_text).ok_or_else(|| fail(msg_invalid_node_id(" branchpoint", id_text)))?;
        let created_timestamp =
            to_long(node.attr("time")).unwrap_or_else(|| default_timestamp.wrapping_sub(current));
        Ok(BranchPoint {
            node_id,
            created_timestamp,
        })
    })
    .chain_msg(|| msg_invalid_elements("branchpoint"))
}

fn parse_color_opt(node: &XmlElement) -> Option<ColorProto> {
    Some(ColorProto {
        r: f64::from(to_float(node.attr("color.r"))?),
        g: f64::from(to_float(node.attr("color.g"))?),
        b: f64::from(to_float(node.attr("color.b"))?),
        a: f64::from(to_float(node.attr("color.a"))?),
    })
}

/// `parseVisibility`: explicit attribute, else derived from the colour alpha.
fn parse_visibility(node: &XmlElement, color: Option<&ColorProto>) -> Option<bool> {
    to_bool(node.attr("isVisible")).or_else(|| color.map(|c| c.a.is_nan() || c.a.abs() > 1e-10))
}

/// `parseVec3Int`: integer, else float rounded with `math.round`.
fn parse_vec3_int(node: &XmlElement) -> Option<Vec3IntProto> {
    let component = |key: &str| {
        let text = node.attr(key);
        to_int(text).or_else(|| to_float(text).map(java_round_float))
    };
    Some(Vec3IntProto {
        x: component("x")?,
        y: component("y")?,
        z: component("z")?,
    })
}

fn parse_rotation(node: &XmlElement, x: &str, y: &str, z: &str) -> Option<Vec3DoubleProto> {
    Some(Vec3DoubleProto {
        x: to_double(node.attr(x))?,
        y: to_double(node.attr(y))?,
        z: to_double(node.attr(z))?,
    })
}

/// Attributes named `additionalCoordinate-<one word char>` (all attributes,
/// including prefixed ones, in document order). Non-integer values throw.
fn parse_additional_coordinate_values(
    node: &XmlElement,
) -> PResult<Vec<AdditionalCoordinateProto>> {
    let mut coordinates = Vec::new();
    for attribute in &node.attributes {
        let Some(axis) = attribute.key.strip_prefix("additionalCoordinate-") else {
            continue;
        };
        let mut chars = axis.chars();
        let is_single_word_char = matches!(
            (chars.next(), chars.next()),
            (Some(c), None) if c.is_ascii_alphanumeric() || c == '_'
        );
        if !is_single_word_char {
            continue;
        }
        let value = to_int_or_throw(&scala_xml_escape(&attribute.value))?;
        coordinates.push(AdditionalCoordinateProto {
            name: axis.to_owned(),
            value,
        });
    }
    Ok(coordinates)
}

fn parse_metadata<'a>(entries: impl Iterator<Item = &'a XmlElement>) -> Vec<MetadataEntryProto> {
    entries
        .map(|node| MetadataEntryProto {
            key: node.attr("key").to_owned(),
            string_value: node.attr_opt("stringValue").map(str::to_owned),
            bool_value: node.attr_opt("boolValue").and_then(to_bool),
            number_value: node.attr_opt("numberValue").and_then(to_double),
            string_list_value: parse_string_list_value(node),
        })
        .collect()
}

/// Attributes `stringListValue-<digits>`, sorted (stably) by index.
fn parse_string_list_value(node: &XmlElement) -> Vec<String> {
    let mut values: Vec<(i32, String)> = node
        .attributes
        .iter()
        .filter_map(|attribute| {
            let index = attribute.key.strip_prefix("stringListValue-")?;
            if index.is_empty() || !index.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            Some((to_int(index)?, scala_xml_escape(&attribute.value)))
        })
        .collect();
    values.sort_by_key(|(index, _)| *index);
    values.into_iter().map(|(_, value)| value).collect()
}

fn parse_tree(
    tree: &XmlElement,
    branch_points: &HashMap<i32, Vec<BranchPoint>>,
    comments: &HashMap<i32, Vec<Comment>>,
    now_millis: i64,
) -> PResult<Tree> {
    let id_text = tree.attr("id");
    let tree_id = to_int(id_text).ok_or_else(|| fail(msg_invalid_tree_id(id_text)))?;
    let color = parse_color_opt(tree);
    let name = tree.attr("name").to_owned();
    let tree_type = tree.attr_opt("type").and_then(|t| match t {
        "DEFAULT" => Some(0),
        "AGGLOMERATE" => Some(1),
        _ => None,
    });
    let group_id = to_int(tree.attr("groupId"));
    let is_visible = parse_visibility(tree, color.as_ref());
    let nodes = combined(tree.grandchildren("nodes", "node"), parse_node)
        .chain_msg(|| msg_invalid_tree_elements("nodes", tree_id))?;
    let edges = combined(tree.grandchildren("edges", "edge"), parse_edge)
        .chain_msg(|| msg_invalid_tree_elements("edges", tree_id))?;
    let tree_branch_points = nodes
        .iter()
        .flat_map(|n| branch_points.get(&n.id).into_iter().flatten().cloned())
        .collect();
    let tree_comments = nodes
        .iter()
        .flat_map(|n| comments.get(&n.id).into_iter().flatten().cloned())
        .collect();
    let metadata = parse_metadata(tree.grandchildren("metadata", "metadataEntry"));
    let created_timestamp = nodes
        .iter()
        .map(|n| n.created_timestamp)
        .min()
        .unwrap_or(now_millis);
    Ok(Tree {
        tree_id,
        nodes,
        edges,
        color,
        branch_points: tree_branch_points,
        comments: tree_comments,
        name,
        created_timestamp,
        group_id,
        is_visible,
        r#type: tree_type,
        metadata,
        ..Default::default()
    })
}

fn parse_edge(edge: &XmlElement) -> PResult<Edge> {
    let source_text = edge.attr("source");
    let target_text = edge.attr("target");
    let invalid = || fail(msg_invalid_edge(source_text, target_text));
    Ok(Edge {
        source: to_int(source_text).ok_or_else(invalid)?,
        target: to_int(target_text).ok_or_else(invalid)?,
    })
}

fn parse_node(node: &XmlElement) -> PResult<Node> {
    let id_text = node.attr("id");
    let id = to_int(id_text).ok_or_else(|| fail(msg_invalid_node_id("", id_text)))?;
    let radius = to_float(node.attr("radius")).unwrap_or(DEFAULT_NODE_RADIUS);
    let additional_coordinates = parse_additional_coordinate_values(node)?;
    let position =
        parse_vec3_int(node).ok_or_else(|| fail(msg_invalid_node_attribute("position", id)))?;
    Ok(Node {
        id,
        position,
        rotation: parse_rotation(node, "rotX", "rotY", "rotZ").unwrap_or(Vec3DoubleProto {
            x: 0.0,
            y: 0.0,
            z: 0.0,
        }),
        radius,
        viewport: to_int(node.attr("inVp")).unwrap_or(0),
        mag: to_int(node.attr("inMag")).unwrap_or(0),
        bit_depth: to_int(node.attr("bitDepth")).unwrap_or(0),
        interpolation: to_bool(node.attr("interpolation")).unwrap_or(false),
        created_timestamp: to_long(node.attr("time")).unwrap_or(0),
        additional_coordinates,
    })
}

fn parse_tree_group(node: &XmlElement) -> PResult<TreeGroup> {
    let id_text = node.attr("id");
    let group_id = to_int(id_text).ok_or_else(|| fail(msg_invalid_tree_group_id(id_text)))?;
    let children = combined(node.children_named("group"), parse_tree_group)?;
    Ok(TreeGroup {
        name: node.attr("name").to_owned(),
        group_id,
        children,
        is_expanded: Some(to_bool(node.attr("isExpanded")).unwrap_or(true)),
    })
}

fn parse_segment_group(node: &XmlElement) -> PResult<SegmentGroup> {
    let id_text = node.attr("id");
    let group_id = to_int(id_text).ok_or_else(|| fail(msg_invalid_segment_group_id(id_text)))?;
    let children = combined(node.children_named("group"), parse_segment_group)?;
    Ok(SegmentGroup {
        name: node.attr("name").to_owned(),
        group_id,
        children,
        is_expanded: None,
    })
}

fn parse_volume(node: &XmlElement) -> PResult<NmlVolumeTag> {
    let segments = node
        .grandchildren("segments", "segment")
        .map(parse_segment)
        .collect::<PResult<Vec<_>>>()?;
    // Invalid segment groups are silently dropped (`.getOrElse(Seq())`).
    let segment_groups =
        combined(node.grandchildren("groups", "group"), parse_segment_group).unwrap_or_default();
    let opt = |key: &str| node.attr_opt(key).map(str::to_owned);
    Ok(NmlVolumeTag {
        data_zip_path: node.attr("location").to_owned(),
        fallback_layer_name: opt("fallbackLayer"),
        mapping_name: opt("mappingName"),
        mapping_is_locked: node.attr_opt("mappingIsLocked").and_then(to_bool),
        name: opt("name"),
        segments,
        largest_segment_id: node.attr_opt("largestSegmentId").and_then(to_long),
        segment_groups,
        edited_mapping_edges_location: opt("editedMappingEdgesLocation"),
        edited_mapping_base_mapping_name: opt("editedMappingBaseMappingName"),
    })
}

fn parse_segment(node: &XmlElement) -> PResult<Segment> {
    let anchor_position = match (
        node.attr_opt("anchorPositionX"),
        node.attr_opt("anchorPositionY"),
        node.attr_opt("anchorPositionZ"),
    ) {
        (Some(x), Some(y), Some(z)) => Some(Vec3IntProto {
            x: to_int_or_throw(x)?,
            y: to_int_or_throw(y)?,
            z: to_int_or_throw(z)?,
        }),
        _ => None,
    };
    let anchor_position_additional_coordinates = parse_additional_coordinate_values(node)?;
    let metadata = parse_metadata(node.grandchildren("metadata", "metadataEntry"));
    let color = parse_color_opt(node);
    let is_visible = parse_visibility(node, color.as_ref());
    let segment_id = to_long_or_throw(node.attr("id"))? as u64;
    Ok(Segment {
        segment_id,
        anchor_position,
        name: node.attr_opt("name").map(str::to_owned),
        creation_time: node.attr_opt("created").and_then(to_long),
        color,
        group_id: to_int(node.attr("groupId")),
        anchor_position_additional_coordinates,
        metadata,
        is_visible,
    })
}

fn parse_bounding_box(node: &XmlElement) -> Option<BoundingBoxProto> {
    Some(BoundingBoxProto {
        top_left: Vec3IntProto {
            x: to_int(node.attr("topLeftX"))?,
            y: to_int(node.attr("topLeftY"))?,
            z: to_int(node.attr("topLeftZ"))?,
        },
        width: to_int(node.attr("width"))?,
        height: to_int(node.attr("height"))?,
        depth: to_int(node.attr("depth"))?,
    })
}

/// `parseBoundingBoxes`: a single box without `id` is the legacy format (id 0);
/// otherwise boxes with invalid ids or coordinates are silently skipped.
fn parse_user_bounding_boxes(nodes: Vec<&XmlElement>) -> Vec<NamedBoundingBoxProto> {
    if let [single] = nodes.as_slice()
        && single.attr("id").is_empty()
    {
        return parse_bounding_box(single)
            .map(|bounding_box| NamedBoundingBoxProto {
                id: 0,
                name: None,
                is_visible: None,
                color: None,
                bounding_box,
            })
            .into_iter()
            .collect();
    }
    nodes
        .into_iter()
        .filter_map(|node| {
            let id = to_int(node.attr("id"))?;
            let name = node.attr("name");
            let is_visible = to_bool(node.attr("isVisible"));
            let color = parse_color_opt(node);
            let bounding_box = parse_bounding_box(node)?;
            Some(NamedBoundingBoxProto {
                id,
                name: (!name.is_empty()).then(|| name.to_owned()),
                is_visible,
                color,
                bounding_box,
            })
        })
        .collect()
}

fn parse_additional_axes(parameters: &XmlElement) -> PResult<Vec<AdditionalAxisProto>> {
    let Some(container) = parameters.first_child("additionalAxes") else {
        return Ok(Vec::new());
    };
    let axes: Vec<AdditionalAxisProto> = container
        .children
        .iter()
        .filter_map(|axis| {
            Some(AdditionalAxisProto {
                name: axis.attr_opt("name")?.to_owned(),
                index: to_int(axis.attr_opt("index")?)?,
                bounds: Vec2IntProto {
                    x: to_int(axis.attr_opt("start")?)?,
                    y: to_int(axis.attr_opt("end")?)?,
                },
            })
        })
        .collect();
    let mut names = HashSet::new();
    if axes.iter().all(|axis| names.insert(axis.name.as_str())) {
        Ok(axes)
    } else {
        Err(fail(MSG_ADDITIONAL_COORDINATES_NOT_UNIQUE))
    }
}

// ---------------------------------------------------------------------------
// MultiComponentTreeSplitter
// ---------------------------------------------------------------------------

/// `GroupUtils.getAllTreeGroupIds`: breadth-first, ids prepended (so the
/// result is the reversed BFS order).
fn all_tree_group_ids(groups: &[TreeGroup]) -> Vec<i32> {
    let mut queue: std::collections::VecDeque<&TreeGroup> = groups.iter().collect();
    let mut ids = Vec::new();
    while let Some(group) = queue.pop_front() {
        ids.push(group.group_id);
        queue.extend(group.children.iter());
    }
    ids.reverse();
    ids
}

fn add_tree_group_as_child(
    groups: &[TreeGroup],
    parent_id: i32,
    new_group: &TreeGroup,
) -> Vec<TreeGroup> {
    groups
        .iter()
        .map(|group| {
            if group.group_id == parent_id {
                let mut group = group.clone();
                group.children.insert(0, new_group.clone());
                group
            } else if group.children.is_empty() {
                group.clone()
            } else {
                TreeGroup {
                    children: add_tree_group_as_child(&group.children, parent_id, new_group),
                    ..group.clone()
                }
            }
        })
        .collect()
}

/// Connected components in JGraphT `ConnectivityInspector` order (by first
/// vertex in insertion order). Throws JGraphT's exceptions for edges to
/// unknown vertices and self loops (`Multigraph` forbids loops).
fn connected_components(tree: &Tree) -> PResult<Vec<HashSet<i32>>> {
    let mut vertices: Vec<i32> = Vec::new();
    let mut index_of: HashMap<i32, usize> = HashMap::new();
    for node in &tree.nodes {
        if let std::collections::hash_map::Entry::Vacant(entry) = index_of.entry(node.id) {
            entry.insert(vertices.len());
            vertices.push(node.id);
        }
    }
    let mut parent: Vec<usize> = (0..vertices.len()).collect();
    fn find(parent: &mut [usize], mut i: usize) -> usize {
        while parent[i] != i {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        i
    }
    for edge in &tree.edges {
        let no_such_vertex = |v: i32| {
            Fail::Exception(format!(
                "java.lang.IllegalArgumentException: no such vertex in graph: {v}"
            ))
        };
        let source = *index_of
            .get(&edge.source)
            .ok_or_else(|| no_such_vertex(edge.source))?;
        let target = *index_of
            .get(&edge.target)
            .ok_or_else(|| no_such_vertex(edge.target))?;
        if source == target {
            return Err(Fail::Exception(
                "java.lang.IllegalArgumentException: loops not allowed".to_owned(),
            ));
        }
        let (a, b) = (find(&mut parent, source), find(&mut parent, target));
        if a != b {
            parent[a.max(b)] = a.min(b);
        }
    }
    let mut components: Vec<HashSet<i32>> = Vec::new();
    let mut component_of_root: HashMap<usize, usize> = HashMap::new();
    for (i, vertex) in vertices.iter().enumerate() {
        let root = find(&mut parent, i);
        let index = *component_of_root.entry(root).or_insert_with(|| {
            components.push(HashSet::new());
            components.len() - 1
        });
        components[index].insert(*vertex);
    }
    Ok(components)
}

fn split_multicomponent_trees(
    trees: Vec<Tree>,
    tree_groups: Vec<TreeGroup>,
) -> PResult<(Vec<Tree>, Vec<TreeGroup>)> {
    let mut largest_tree_id = trees.iter().map(|t| t.tree_id).max().unwrap_or(0);
    let mut largest_group_id = all_tree_group_ids(&tree_groups)
        .into_iter()
        .max()
        .unwrap_or(0);
    let mut groups = tree_groups;
    let mut result = Vec::new();
    for tree in trees {
        let components = connected_components(&tree)?;
        if components.len() <= 1 {
            result.push(tree);
            continue;
        }
        largest_group_id = largest_group_id.wrapping_add(1);
        let new_group = TreeGroup {
            name: tree.name.clone(),
            group_id: largest_group_id,
            children: Vec::new(),
            is_expanded: None,
        };
        match tree.group_id {
            Some(parent_id) => groups = add_tree_group_as_child(&groups, parent_id, &new_group),
            None => groups.insert(0, new_group),
        }
        for (index, component) in components.iter().enumerate() {
            largest_tree_id = largest_tree_id.wrapping_add(1);
            result.push(Tree {
                tree_id: largest_tree_id,
                nodes: tree
                    .nodes
                    .iter()
                    .filter(|n| component.contains(&n.id))
                    .cloned()
                    .collect(),
                edges: tree
                    .edges
                    .iter()
                    .filter(|e| component.contains(&e.source) && component.contains(&e.target))
                    .cloned()
                    .collect(),
                color: tree.color,
                branch_points: tree
                    .branch_points
                    .iter()
                    .filter(|b| component.contains(&b.node_id))
                    .cloned()
                    .collect(),
                comments: tree
                    .comments
                    .iter()
                    .filter(|c| component.contains(&c.node_id))
                    .cloned()
                    .collect(),
                name: format!("{}_{index}", tree.name),
                created_timestamp: tree.created_timestamp,
                group_id: Some(largest_group_id),
                is_visible: tree.is_visible,
                ..Default::default()
            });
        }
    }
    Ok((result, groups))
}

// ---------------------------------------------------------------------------
// TreeValidator
// ---------------------------------------------------------------------------

/// `seq.diff(seq.distinct)`: every occurrence after the first, in order.
fn later_duplicates(values: &[i32]) -> Vec<i32> {
    let mut seen = HashSet::new();
    values
        .iter()
        .copied()
        .filter(|v| !seen.insert(*v))
        .collect()
}

/// `seq.distinct`, preserving first-occurrence order.
fn distinct(values: impl IntoIterator<Item = i32>) -> Vec<i32> {
    let mut seen = HashSet::new();
    values.into_iter().filter(|v| seen.insert(*v)).collect()
}

fn join(values: &[i32]) -> String {
    values
        .iter()
        .map(i32::to_string)
        .collect::<Vec<_>>()
        .join(", ")
}

/// ScalaPB case-class `toString` of an `Edge`.
fn edge_to_string(edge: &Edge) -> String {
    format!(
        "Edge({},{},UnknownFieldSet(Map()))",
        edge.source, edge.target
    )
}

fn join_edges(edges: &[&Edge]) -> String {
    edges
        .iter()
        .map(|e| edge_to_string(e))
        .collect::<Vec<_>>()
        .join(", ")
}

fn validate_trees(
    trees: &[Tree],
    tree_groups: &[TreeGroup],
    branch_points: &[BranchPoint],
    comments: &[Comment],
) -> PResult<()> {
    let tree_ids: Vec<i32> = trees.iter().map(|t| t.tree_id).collect();
    let duplicates = later_duplicates(&tree_ids);
    if !duplicates.is_empty() {
        return Err(fail(format!("Duplicate treeIds: {}", join(&duplicates))));
    }
    let node_ids: Vec<i32> = trees
        .iter()
        .flat_map(|t| t.nodes.iter().map(|n| n.id))
        .collect();
    let duplicates = later_duplicates(&node_ids);
    if !duplicates.is_empty() {
        return Err(fail(format!("Duplicate nodeIds: {}", join(&duplicates))));
    }
    for tree in trees {
        let mut seen = HashSet::new();
        let duplicates: Vec<&Edge> = tree
            .edges
            .iter()
            .filter(|e| {
                if seen.contains(&(e.source, e.target)) || seen.contains(&(e.target, e.source)) {
                    true
                } else {
                    seen.insert((e.source, e.target));
                    false
                }
            })
            .collect();
        if !duplicates.is_empty() {
            return Err(fail(format!(
                "Duplicate edges in tree {}: {}",
                tree.tree_id,
                join_edges(&duplicates)
            )));
        }
    }
    for tree in trees {
        let nodes_in_tree: HashSet<i32> = tree.nodes.iter().map(|n| n.id).collect();
        let missing: Vec<i32> = distinct(tree.edges.iter().flat_map(|e| [e.source, e.target]))
            .into_iter()
            .filter(|id| !nodes_in_tree.contains(id))
            .collect();
        if !missing.is_empty() {
            return Err(fail(format!(
                "Some edges refer to non-existent nodes. treeId: {}, nodeIds: {}",
                tree.tree_id,
                join(&missing)
            )));
        }
    }
    for tree in trees {
        let loops: Vec<&Edge> = tree.edges.iter().filter(|e| e.source == e.target).collect();
        if !loops.is_empty() {
            return Err(fail(format!(
                "Some edges have the same source and target. treeId: {}, edges: {}",
                tree.tree_id,
                join_edges(&loops)
            )));
        }
    }
    for tree in trees {
        // Edges are known to reference existing nodes and no loops here.
        let count = connected_components(tree).map_or(0, |c| c.len());
        if count > 1 {
            return Err(fail(format!(
                "Tree {} is not fully connected, but consists of {count} components.",
                tree.tree_id
            )));
        }
    }
    let group_ids = all_tree_group_ids(tree_groups);
    let duplicates = later_duplicates(&group_ids);
    if !duplicates.is_empty() {
        return Err(fail(format!(
            "Duplicate treeGroupIds: {}",
            join(&duplicates)
        )));
    }
    let existing_groups: HashSet<i32> = group_ids.into_iter().collect();
    let missing: Vec<i32> = distinct(trees.iter().filter_map(|t| t.group_id))
        .into_iter()
        .filter(|id| !existing_groups.contains(id))
        .collect();
    if !missing.is_empty() {
        return Err(fail(format!(
            "Some treeGroups used in trees don't exist. treeGroups: {}",
            join(&missing)
        )));
    }
    let all_nodes: HashSet<i32> = node_ids.into_iter().collect();
    for (name, used) in [
        (
            "branchPoints",
            distinct(branch_points.iter().map(|b| b.node_id)),
        ),
        ("comments", distinct(comments.iter().map(|c| c.node_id))),
    ] {
        let missing: Vec<i32> = used
            .into_iter()
            .filter(|id| !all_nodes.contains(id))
            .collect();
        if !missing.is_empty() {
            return Err(fail(format!(
                "Some {name} refer to non-existent nodes. {name}: {}",
                join(&missing)
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod annotation_parser_tests;
