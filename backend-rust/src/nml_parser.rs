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
/// `Msg.ObjectId.invalid`, produced when the NML's `datasetId` (or the
/// overwriting dataset id) is not a 24-hex-character ObjectId.
pub fn msg_invalid_object_id(literal: &str) -> String {
    format!("The supplied resource id “{literal}” is not a valid ObjectId.")
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
    pub id: String,
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
    pub dataset_id: String,
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
    pub fn validated_dataset_id(&self) -> Result<Option<String>, String> {
        match &self.dataset_id_opt {
            None => Ok(None),
            Some(literal) => {
                if literal.len() == 24 && literal.bytes().all(|b| b.is_ascii_hexdigit()) {
                    Ok(Some(literal.to_ascii_lowercase()))
                } else {
                    Err(msg_invalid_object_id(literal))
                }
            }
        }
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
    lookup: impl FnOnce(Option<&str>, &str, &str) -> Result<DatasetRef, String>,
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
            dataset_id.as_deref(),
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
mod tests {
    use super::*;

    const COLOR: ColorProto = ColorProto {
        r: 0.25,
        g: 0.5,
        b: 0.75,
        a: 1.0,
    };

    fn params() -> SharedParsingParameters {
        SharedParsingParameters {
            user_organization_id: "userOrg".to_owned(),
            ..Default::default()
        }
    }

    fn context() -> NmlParseContext {
        NmlParseContext {
            now_millis: 4242,
            task_bounding_box_color: COLOR,
        }
    }

    fn parse_with(xml: &str, params: &SharedParsingParameters) -> NmlParseOutcome {
        parse_nml("test.nml", xml.as_bytes(), params, &context())
    }

    fn parsed_with(xml: &str, params: &SharedParsingParameters) -> NmlParsedParameters {
        match parse_with(xml, params) {
            NmlParseOutcome::Parsed(parsed) => *parsed,
            other => panic!("expected success, got {other:?}"),
        }
    }

    fn parsed(xml: &str) -> NmlParsedParameters {
        parsed_with(xml, &params())
    }

    fn failure(xml: &str) -> String {
        match parse_with(xml, &params()) {
            NmlParseOutcome::Failure(message) => message,
            other => panic!("expected failure, got {other:?}"),
        }
    }

    /// Minimal NML around `body` (trees, branchpoints, comments, groups, volumes).
    fn nml(body: &str) -> String {
        format!(r#"<things><parameters><experiment name="ds"/></parameters>{body}</things>"#)
    }

    fn tree(id: &str, nodes: &[i32], edges: &[(i32, i32)], extra: &str) -> String {
        let nodes: String = nodes
            .iter()
            .map(|n| format!(r#"<node id="{n}" x="1" y="2" z="3"/>"#))
            .collect();
        let edges: String = edges
            .iter()
            .map(|(s, t)| format!(r#"<edge source="{s}" target="{t}"/>"#))
            .collect();
        format!(
            r#"<thing id="{id}" name="t{id}" {extra}><nodes>{nodes}</nodes><edges>{edges}</edges></thing>"#
        )
    }

    const FULL: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<things>
  <meta name="writer" content="NmlWriter.scala"/>
  <parameters>
    <experiment name="my_dataset" datasetId="5F0000000000000000000ABC" organization="sample_org"
                description="A &amp; B" wkUrl="https://wk.example"/>
    <scale x="11.24" y="11.24" z="28.0" unit="nanometer"/>
    <offset x="0" y="0" z="0"/>
    <time ms="1600000000000"/>
    <activeNode id="7"/>
    <editPosition x="10" y="20.6" z="30" additionalCoordinate-t="4"/>
    <editRotation xRot="1.5" yRot="2" zRot="3"/>
    <zoomLevel zoom="1.25"/>
    <userBoundingBox id="3" name="box" isVisible="false" color.r="1" color.g="0" color.b="0" color.a="1"
                     topLeftX="1" topLeftY="2" topLeftZ="3" width="4" height="5" depth="6"/>
    <userBoundingBox id="1" name="" topLeftX="0" topLeftY="0" topLeftZ="0" width="1" height="1" depth="1"/>
    <taskBoundingBox topLeftX="7" topLeftY="8" topLeftZ="9" width="10" height="11" depth="12"/>
    <additionalAxes>
      <additionalAxis name="t" index="0" start="0" end="10"/>
      <additionalAxis name="c" index="1" start="0" end="3"/>
    </additionalAxes>
  </parameters>
  <thing id="2" color.r="0.1" color.g="0.2" color.b="0.3" color.a="0" name="axon" groupId="5" type="AGGLOMERATE">
    <nodes>
      <node id="7" radius="2.5" x="1.5" y="2" z="3" rotX="0.5" rotY="0" rotZ="1" inVp="2" inMag="1"
            bitDepth="8" interpolation="TRUE" time="300" additionalCoordinate-t="2"/>
      <node id="8" x="4" y="5" z="6" time="200"/>
    </nodes>
    <edges><edge source="7" target="8"/></edges>
    <metadata>
      <metadataEntry key="s" stringValue="hello"/>
      <metadataEntry key="b" boolValue="true"/>
      <metadataEntry key="n" numberValue="1.5"/>
      <metadataEntry key="l" stringListValue-10="z" stringListValue-2="a&amp;b"/>
    </metadata>
  </thing>
  <thing id="4" name="empty"/>
  <branchpoints>
    <branchpoint id="7" time="123"/>
    <branchpoint id="8"/>
  </branchpoints>
  <comments>
    <comment node="7" content="first"/>
    <comment node="7" content="second"/>
  </comments>
  <groups>
    <group id="5" name="outer"><group id="6" name="inner" isExpanded="false"/></group>
  </groups>
  <volume id="0" location="data_Volume.zip" fallbackLayer="segmentation" name="Volume" largestSegmentId="99"
          mappingName="agglo" mappingIsLocked="true" editedMappingEdgesLocation="edges.zip"
          editedMappingBaseMappingName="base">
    <segments>
      <segment id="12" name="seg" anchorPositionX="1" anchorPositionY="2" anchorPositionZ="3" created="55"
               color.r="1" color.g="1" color.b="1" color.a="1" groupId="1" additionalCoordinate-t="1">
        <metadata><metadataEntry key="k" numberValue="2"/></metadata>
      </segment>
      <segment id="13" anchorPositionX="1"/>
    </segments>
    <groups><group id="1" name="sg"><group id="2" name="child"/></group></groups>
  </volume>
</things>"#;

    #[test]
    fn parses_full_document() {
        let p = parsed(FULL);
        assert_eq!(p.dataset_name, "my_dataset");
        assert_eq!(
            p.dataset_id_opt.as_deref(),
            Some("5F0000000000000000000ABC")
        );
        assert_eq!(p.organization_id, "sample_org");
        assert_eq!(p.description, "A & B");
        assert_eq!(p.wk_url.as_deref(), Some("https://wk.example"));
        assert_eq!(p.timestamp, 1_600_000_000_000);
        assert_eq!(p.active_node_id, Some(7));
        assert_eq!(
            p.edit_position,
            Vec3IntProto {
                x: 10,
                y: 21,
                z: 30
            }
        );
        assert_eq!(
            p.edit_position_additional_coordinates,
            vec![AdditionalCoordinateProto {
                name: "t".to_owned(),
                value: 4
            }]
        );
        assert_eq!(
            p.edit_rotation,
            Vec3DoubleProto {
                x: 1.5,
                y: 2.0,
                z: 3.0
            }
        );
        assert_eq!(p.zoom_level, 1.25);
        assert_eq!(p.additional_axes.len(), 2);
        assert_eq!(p.additional_axes[1].name, "c");
        assert_eq!(p.additional_axes[1].bounds, Vec2IntProto { x: 0, y: 3 });
        // Not a task upload: task bounding box becomes a user bounding box.
        assert_eq!(p.task_bounding_box, None);
        assert_eq!(p.user_bounding_boxes.len(), 3);
        let first = &p.user_bounding_boxes[0];
        assert_eq!(
            (first.id, first.name.as_deref(), first.is_visible),
            (3, Some("box"), Some(false))
        );
        assert_eq!(first.color.map(|c| c.r), Some(1.0));
        assert_eq!(
            first.bounding_box.top_left,
            Vec3IntProto { x: 1, y: 2, z: 3 }
        );
        assert_eq!(p.user_bounding_boxes[1].name, None);
        let task = &p.user_bounding_boxes[2];
        assert_eq!(task.id, 4);
        assert_eq!(task.name.as_deref(), Some("task bounding box"));
        assert_eq!(task.color, Some(COLOR));
        assert_eq!(task.bounding_box.depth, 12);

        assert_eq!(p.trees.len(), 2);
        let axon = &p.trees[0];
        assert_eq!(axon.tree_id, 2);
        assert_eq!(axon.name, "axon");
        assert_eq!(axon.group_id, Some(5));
        assert_eq!(axon.r#type, Some(1));
        assert_eq!(axon.color.map(|c| c.r), Some(f64::from(0.1f32)));
        // No isVisible attribute: derived from alpha 0.
        assert_eq!(axon.is_visible, Some(false));
        assert_eq!(axon.created_timestamp, 200);
        let node = &axon.nodes[0];
        assert_eq!(node.position, Vec3IntProto { x: 2, y: 2, z: 3 });
        assert_eq!(
            node.rotation,
            Vec3DoubleProto {
                x: 0.5,
                y: 0.0,
                z: 1.0
            }
        );
        assert_eq!(
            (
                node.radius,
                node.viewport,
                node.mag,
                node.bit_depth,
                node.interpolation
            ),
            (2.5, 2, 1, 8, true)
        );
        assert_eq!(node.created_timestamp, 300);
        assert_eq!(node.additional_coordinates[0].value, 2);
        let defaults = &axon.nodes[1];
        assert_eq!(
            (
                defaults.radius,
                defaults.viewport,
                defaults.mag,
                defaults.interpolation
            ),
            (1.0, 0, 0, false)
        );
        assert_eq!(
            axon.edges,
            vec![Edge {
                source: 7,
                target: 8
            }]
        );
        assert_eq!(
            axon.branch_points,
            vec![
                BranchPoint {
                    node_id: 7,
                    created_timestamp: 123
                },
                // No time: document timestamp minus the branchpoint index.
                BranchPoint {
                    node_id: 8,
                    created_timestamp: 1_600_000_000_000 - 1
                },
            ]
        );
        // Comments of one node are in reverse document order (Scala map prepends).
        let contents: Vec<&str> = axon.comments.iter().map(|c| c.content.as_str()).collect();
        assert_eq!(contents, ["second", "first"]);
        assert_eq!(axon.metadata.len(), 4);
        assert_eq!(axon.metadata[0].string_value.as_deref(), Some("hello"));
        assert_eq!(axon.metadata[1].bool_value, Some(true));
        assert_eq!(axon.metadata[2].number_value, Some(1.5));
        // Sorted by index; Scala re-escapes attribute text (Text.toString).
        assert_eq!(axon.metadata[3].string_list_value, ["a&amp;b", "z"]);
        let empty = &p.trees[1];
        assert_eq!(empty.created_timestamp, 4242);
        assert_eq!(
            (empty.color, empty.is_visible, empty.group_id),
            (None, None, None)
        );

        assert_eq!(p.tree_groups.len(), 1);
        assert_eq!(p.tree_groups[0].is_expanded, Some(true));
        assert_eq!(p.tree_groups[0].children[0].is_expanded, Some(false));

        assert_eq!(p.volumes.len(), 1);
        let volume = &p.volumes[0];
        assert_eq!(volume.data_zip_path, "data_Volume.zip");
        assert_eq!(volume.fallback_layer_name.as_deref(), Some("segmentation"));
        assert_eq!(volume.largest_segment_id, Some(99));
        assert_eq!(volume.mapping_is_locked, Some(true));
        assert_eq!(volume.segment_groups[0].children[0].name, "child");
        let segment = &volume.segments[0];
        assert_eq!(segment.segment_id, 12);
        assert_eq!(
            segment.anchor_position,
            Some(Vec3IntProto { x: 1, y: 2, z: 3 })
        );
        assert_eq!(
            (segment.creation_time, segment.group_id, segment.is_visible),
            (Some(55), Some(1), Some(true))
        );
        assert_eq!(segment.metadata[0].number_value, Some(2.0));
        assert_eq!(segment.anchor_position_additional_coordinates.len(), 1);
        // Incomplete anchor position is ignored.
        assert_eq!(volume.segments[1].anchor_position, None);
    }

    #[test]
    fn into_success_builds_tracings() {
        let p = parsed(FULL);
        let dataset = DatasetRef {
            id: "5f0000000000000000000abc".to_owned(),
            name: "renamed".to_owned(),
            organization_id: "sample_org".to_owned(),
        };
        assert_eq!(
            p.validated_dataset_id(),
            Ok(Some("5f0000000000000000000abc".to_owned()))
        );
        let success = p.into_success(&dataset, Some("/tmp/upload.zip"));
        let skeleton = &success.skeleton_tracing;
        assert_eq!(skeleton.dataset_name, "renamed");
        assert_eq!(skeleton.organization_id.as_deref(), Some("sample_org"));
        assert_eq!(skeleton.created_timestamp, 1_600_000_000_000);
        assert_eq!(skeleton.version, 0);
        assert_eq!(skeleton.bounding_box, None);
        assert_eq!(skeleton.trees.len(), 2);
        assert_eq!(skeleton.user_bounding_boxes.len(), 3);
        assert_eq!(success.dataset_id, "5f0000000000000000000abc");
        assert_eq!(success.description, "A & B");
        let layer = &success.volume_layers[0];
        assert_eq!(layer.data_zip_location, "/tmp/upload.zipdata_Volume.zip");
        assert_eq!(
            layer.edited_mapping_edges_location.as_deref(),
            Some("/tmp/upload.zipedges.zip")
        );
        assert_eq!(layer.name.as_deref(), Some("Volume"));
        let volume = &layer.tracing;
        assert_eq!(volume.element_class, ElementClassProto::Uint32 as i32);
        assert_eq!(volume.bounding_box, empty_bbox());
        assert_eq!(volume.has_editable_mapping, Some(true));
        assert_eq!(volume.has_segment_index, None);
        assert_eq!(volume.largest_segment_id, Some(99));
        assert_eq!(volume.mapping_name.as_deref(), Some("agglo"));
        assert_eq!(
            volume.edit_position,
            Vec3IntProto {
                x: 10,
                y: 21,
                z: 30
            }
        );
        assert_eq!(volume.additional_axes.len(), 2);
    }

    #[test]
    fn task_upload_keeps_task_bounding_box_and_uses_fallbacks() {
        let xml = r#"<things><parameters>
            <taskBoundingBox topLeftX="1" topLeftY="2" topLeftZ="3" width="4" height="5" depth="6"/>
            <editPosition x="a" y="1" z="1"/>
            </parameters></things>"#;
        let params = SharedParsingParameters {
            is_task_upload: true,
            overwriting_dataset_id: Some("abc".to_owned()),
            fallback_edit_position: Some(Vec3IntProto { x: 5, y: 6, z: 7 }),
            fallback_edit_rotation: Some(Vec3DoubleProto {
                x: 1.0,
                y: 0.0,
                z: 0.0,
            }),
            fallback_zoom_level: Some(3.0),
            ..params()
        };
        let p = parsed_with(xml, &params);
        assert_eq!(p.task_bounding_box.map(|b| b.width), Some(4));
        assert!(p.user_bounding_boxes.is_empty());
        assert_eq!(p.edit_position, Vec3IntProto { x: 5, y: 6, z: 7 });
        assert_eq!(p.edit_rotation.x, 1.0);
        assert_eq!(p.zoom_level, 3.0);
        assert_eq!(p.dataset_id_opt.as_deref(), Some("abc"));
        assert_eq!(p.organization_id, "userOrg");
        assert_eq!((p.dataset_name.as_str(), p.wk_url.clone()), ("", None));
        assert_eq!(
            p.validated_dataset_id(),
            Err("The supplied resource id “abc” is not a valid ObjectId.".to_owned())
        );
        let success = p.into_success(
            &DatasetRef {
                id: "x".to_owned(),
                name: "d".to_owned(),
                organization_id: "o".to_owned(),
            },
            None,
        );
        assert_eq!(
            success.skeleton_tracing.bounding_box.map(|b| b.depth),
            Some(6)
        );
    }

    #[test]
    fn legacy_and_default_parameters() {
        // Single user bounding box without id; experiment without wkUrl/description.
        let p = parsed(
            r#"<things><parameters><experiment name="old"/>
            <userBoundingBox topLeftX="1" topLeftY="1" topLeftZ="1" width="2" height="2" depth="2"/>
            </parameters></things>"#,
        );
        assert_eq!(p.user_bounding_boxes.len(), 1);
        assert_eq!(p.user_bounding_boxes[0].id, 0);
        assert_eq!(p.user_bounding_boxes[0].name, None);
        assert_eq!(p.wk_url.as_deref(), Some(""));
        assert_eq!(p.description, "");
        assert_eq!(p.timestamp, 0);
        assert_eq!(p.edit_position, Vec3IntProto { x: 0, y: 0, z: 0 });
        assert_eq!(p.zoom_level, DEFAULT_ZOOM_LEVEL);
        assert!(p.trees.is_empty() && p.volumes.is_empty());

        // Invalid user bounding boxes are skipped silently; task box id continues after max.
        let p = parsed(
            r#"<things><parameters>
            <userBoundingBox id="x" topLeftX="1" topLeftY="1" topLeftZ="1" width="2" height="2" depth="2"/>
            <userBoundingBox id="2" topLeftX="1" topLeftY="1" topLeftZ="1" width="2" height="2"/>
            <taskBoundingBox topLeftX="1" topLeftY="1" topLeftZ="1" width="2" height="2" depth="2"/>
            </parameters></things>"#,
        );
        assert_eq!(p.user_bounding_boxes.len(), 1);
        assert_eq!(p.user_bounding_boxes[0].id, 0);

        // Prefixed elements match by local name; xmlns attributes are ignored.
        let p = parsed(
            r#"<a:things xmlns:a="urn:x"><a:parameters><a:time ms="5"/></a:parameters></a:things>"#,
        );
        assert_eq!(p.timestamp, 5);
    }

    #[test]
    fn explicit_visibility_and_invalid_segment_groups() {
        let p = parsed(&nml(
            r#"<thing id="1" isVisible="TRUE" color.r="0" color.g="0" color.b="0" color.a="0"/>
            <volume location="v.zip" name="a"><groups><group id="x"/></groups></volume>"#,
        ));
        assert_eq!(p.trees[0].is_visible, Some(true));
        assert!(p.volumes[0].segment_groups.is_empty());
    }

    #[test]
    fn empty_documents_are_empty() {
        for xml in [
            "",
            "  \n ",
            "<?xml version=\"1.0\"?>",
            "<!-- only a comment -->",
        ] {
            assert_eq!(
                parse_with(xml, &params()),
                NmlParseOutcome::Empty,
                "{xml:?}"
            );
        }
        assert_eq!(
            parse_nml("x", b"\xEF\xBB\xBF", &params(), &context()),
            NmlParseOutcome::Empty
        );
    }

    #[test]
    fn malformed_xml_fails_with_location() {
        let message = failure("<things>\n<parameters></things>");
        assert!(
            message.starts_with("Failed to parse NML 'test.nml'. Error in Line 2"),
            "{message}"
        );
        let message = failure("<!DOCTYPE x><things/>");
        assert!(message.contains("DOCTYPE is disallowed"), "{message}");
        let message = failure("<things a=\"&foo;\"/>");
        assert!(
            message.starts_with("Failed to parse NML 'test.nml'. Error in Line 1"),
            "{message}"
        );
        let message = failure("<things><x>&foo;</x></things>");
        assert!(
            message.contains("The entity \"foo\" was referenced, but not declared."),
            "{message}"
        );
        let message = failure("garbage<things/>");
        assert!(
            message.ends_with("Content is not allowed in prolog."),
            "{message}"
        );
        let message = failure("<things/><other/>");
        assert!(message.contains("following the root element"), "{message}");
        let message = failure("<things><parameters>");
        assert!(
            message.contains("must start and end within the same entity"),
            "{message}"
        );
        let message = failure("<things a=\"1\" a=\"2\"/>");
        assert!(
            message.starts_with("Failed to parse NML 'test.nml'. Error in Line 1"),
            "{message}"
        );
        let message = parse_nml("bad", b"<things>\xFF</things>", &params(), &context());
        assert!(matches!(message, NmlParseOutcome::Failure(m) if m.contains("UTF-8")));
    }

    #[test]
    fn element_validation_messages() {
        let cases: Vec<(String, &str)> = vec![
            ("<things/>".to_owned(), "No parameters section found."),
            (
                nml(r#"<comments><comment node="x" content="c"/></comments>"#),
                "Invalid comment elements. <~ Invalid node id “x” in comment.",
            ),
            (
                nml(r#"<branchpoints><branchpoint id="1"/><branchpoint id=""/></branchpoints>"#),
                "Invalid branchpoint elements. <~ Invalid branchpoint node id “”.",
            ),
            (
                nml(r#"<thing id="1"/><thing id="x"/><thing id="y"/>"#),
                "Invalid tree elements. <~ Invalid tree id “x”.",
            ),
            (
                nml(r#"<thing id="1"><nodes><node id="q" x="1" y="1" z="1"/></nodes></thing>"#),
                "Invalid tree elements. <~ Invalid nodes in tree 1. <~ Invalid node id “q”.",
            ),
            (
                nml(r#"<thing id="1"><nodes><node id="3" x="1" y="1"/></nodes></thing>"#),
                "Invalid tree elements. <~ Invalid nodes in tree 1. <~ Invalid node position for node id 3.",
            ),
            (
                nml(r#"<thing id="1"><edges><edge source="a" target="2"/></edges></thing>"#),
                "Invalid tree elements. <~ Invalid edges in tree 1. <~ Invalid edge “a-2”.",
            ),
            (
                nml(r#"<groups><group id="1"><group id="z"/></group></groups>"#),
                "Invalid tree group elements. <~ Invalid tree group id “z”.",
            ),
            (
                nml(r#"<volume location="a.zip"/><volume location="b.zip"/>"#),
                MSG_DUPLICATE_VOLUME_LAYER_NAMES,
            ),
            (
                r#"<things><parameters><additionalAxes><a name="t" index="0" start="0" end="1"/><b name="t" index="1" start="0" end="1"/></additionalAxes></parameters></things>"#
                    .to_owned(),
                MSG_ADDITIONAL_COORDINATES_NOT_UNIQUE,
            ),
        ];
        for (xml, expected) in cases {
            assert_eq!(failure(&xml), expected, "{xml}");
        }
    }

    #[test]
    fn tree_validator_messages() {
        let cases: Vec<(String, &str)> = vec![
            (
                nml(&format!(
                    "{}{}",
                    tree("1", &[1], &[], ""),
                    tree("1", &[2], &[], "")
                )),
                "Duplicate treeIds: 1",
            ),
            (
                nml(&format!(
                    "{}{}",
                    tree("1", &[1], &[], ""),
                    tree("2", &[1], &[], "")
                )),
                "Duplicate nodeIds: 1",
            ),
            (
                nml(&tree("1", &[1, 2], &[(1, 2), (2, 1)], "")),
                "Duplicate edges in tree 1: Edge(2,1,UnknownFieldSet(Map()))",
            ),
            (
                nml(&format!(
                    "{}<groups><group id=\"3\"/><group id=\"3\"/></groups>",
                    tree("1", &[1], &[], "")
                )),
                "Duplicate treeGroupIds: 3",
            ),
            (
                nml(&tree("1", &[1], &[], "groupId=\"9999\"")),
                "Some treeGroups used in trees don't exist. treeGroups: 9999",
            ),
            (
                nml(&format!(
                    "{}<branchpoints><branchpoint id=\"99\"/></branchpoints>",
                    tree("1", &[1], &[], "")
                )),
                "Some branchPoints refer to non-existent nodes. branchPoints: 99",
            ),
            (
                nml(&format!(
                    "{}<comments><comment node=\"98\"/><comment node=\"1\"/></comments>",
                    tree("1", &[1], &[], "")
                )),
                "Some comments refer to non-existent nodes. comments: 98",
            ),
            // The multi-component splitter (JGraphT) throws before the validator runs.
            (
                nml(&tree("1", &[1], &[(1, 99)], "")),
                "Failed to parse NML 'test.nml': java.lang.IllegalArgumentException: no such vertex in graph: 99",
            ),
            (
                nml(&tree("1", &[1, 2], &[(1, 2), (2, 2)], "")),
                "Failed to parse NML 'test.nml': java.lang.IllegalArgumentException: loops not allowed",
            ),
        ];
        for (xml, expected) in cases {
            assert_eq!(failure(&xml), expected, "{xml}");
        }
    }

    #[test]
    fn number_format_exceptions_and_precedence() {
        assert_eq!(
            failure(&nml(
                r#"<thing id="1"><nodes><node id="1" x="1" y="1" z="1" additionalCoordinate-t="1.5"/></nodes></thing>"#
            )),
            "Failed to parse NML 'test.nml': java.lang.NumberFormatException: For input string: \"1.5\""
        );
        assert_eq!(
            failure(&nml(
                r#"<volume><segments><segment id="abc"/></segments></volume>"#
            )),
            "Failed to parse NML 'test.nml': java.lang.NumberFormatException: For input string: \"abc\""
        );
        assert_eq!(
            failure(&nml(
                r#"<volume><segments><segment anchorPositionX="1" anchorPositionY="" anchorPositionZ="1"/></segments></volume>"#
            )),
            "Failed to parse NML 'test.nml': java.lang.NumberFormatException: For input string: \"\""
        );
        // Box.combined evaluates every tree, so a later exception wins over an earlier failure.
        assert_eq!(
            failure(&nml(
                r#"<thing id="x"/><thing id="2"><nodes><node id="1" x="1" y="1" z="1" additionalCoordinate-t="q"/></nodes></thing>"#
            )),
            "Failed to parse NML 'test.nml': java.lang.NumberFormatException: For input string: \"q\""
        );
        // Additional coordinates of the edit position are parsed eagerly.
        assert!(
            failure(r#"<things><parameters><editPosition additionalCoordinate-t="x"/></parameters></things>"#)
                .contains("NumberFormatException")
        );
        // Attributes with longer axis names are not additional coordinates.
        let p = parsed(
            r#"<things><parameters><editPosition x="1" y="2" z="3" additionalCoordinate-tt="x"/></parameters></things>"#,
        );
        assert!(p.edit_position_additional_coordinates.is_empty());
    }

    #[test]
    fn splits_multi_component_trees() {
        let xml = nml(&format!(
            "{}{}<groups><group id=\"4\" name=\"g\"/></groups><comments><comment node=\"3\" content=\"c\"/></comments>",
            tree("2", &[1, 2, 3], &[(1, 2)], "type=\"AGGLOMERATE\""),
            tree("7", &[10, 11], &[], "groupId=\"4\""),
        ));
        let p = parsed(&xml);
        let summary: Vec<(i32, &str, Option<i32>, usize)> = p
            .trees
            .iter()
            .map(|t| (t.tree_id, t.name.as_str(), t.group_id, t.nodes.len()))
            .collect();
        assert_eq!(
            summary,
            [
                (8, "t2_0", Some(5), 2),
                (9, "t2_1", Some(5), 1),
                (10, "t7_0", Some(6), 1),
                (11, "t7_1", Some(6), 1),
            ]
        );
        // Split trees lose their type; comments follow their component.
        assert_eq!(p.trees[0].r#type, None);
        assert_eq!(p.trees[1].comments.len(), 1);
        assert_eq!(p.trees[0].edges.len(), 1);
        // Tree without a group: new top-level group prepended; with a group: nested child.
        assert_eq!(p.tree_groups.len(), 2);
        assert_eq!(
            (p.tree_groups[0].group_id, p.tree_groups[0].name.as_str()),
            (5, "t2")
        );
        assert_eq!(p.tree_groups[0].is_expanded, None);
        assert_eq!(p.tree_groups[1].children[0].group_id, 6);
    }

    #[test]
    fn finish_parse_result_mirrors_upload_service() {
        let outcome = parse_with(FULL, &params());
        let result = finish_parse_result("a.nml", outcome, None, |id, name, organization| {
            assert_eq!(
                (id, name, organization),
                (Some("5f0000000000000000000abc"), "my_dataset", "sample_org")
            );
            Ok(DatasetRef {
                id: id.unwrap_or_default().to_owned(),
                name: name.to_owned(),
                organization_id: organization.to_owned(),
            })
        });
        assert!(result.succeeded());
        assert_eq!(result.description(), Some("A & B"));
        assert_eq!(result.clone().with_name("z.zip").file_name(), "z.zip");
        assert!(result.to_success().is_ok());

        let failed = finish_parse_result(
            "b.nml",
            parse_with("<things/>", &params()),
            None,
            |_, _, _| unreachable!(),
        );
        assert_eq!(
            failed.to_success().unwrap_err(),
            "Couldn’t parse file: b.nml. No parameters section found."
        );
        let lookup_failed = finish_parse_result(
            "c.nml",
            parse_with(&nml(""), &params()),
            None,
            |_, name, _| {
                Err(format!(
                    "Dataset with name “{name}” could not be found or accessed."
                ))
            },
        );
        assert_eq!(
            lookup_failed,
            NmlParseResult::Failure {
                file_name: "c.nml".to_owned(),
                error: "Dataset with name “ds” could not be found or accessed.".to_owned()
            }
        );
        let empty = finish_parse_result(
            "d.nml",
            NmlParseOutcome::Empty,
            None,
            |_, _, _| unreachable!(),
        );
        assert_eq!(
            empty.to_success().unwrap_err(),
            "Couldn’t parse file: d.nml"
        );
        assert!(!empty.succeeded());
    }

    #[test]
    fn java_conversions() {
        assert_eq!(to_int("+5"), Some(5));
        assert_eq!(to_int(" 5"), None);
        assert_eq!(to_int("2147483648"), None);
        assert_eq!(to_long("-9"), Some(-9));
        assert_eq!(to_float(" 1.5f "), Some(1.5));
        assert_eq!(to_double("1e3d"), Some(1000.0));
        assert_eq!(to_double("-Infinity"), Some(f64::NEG_INFINITY));
        assert!(to_double("NaN").is_some_and(f64::is_nan));
        assert_eq!(to_double("inf"), None);
        assert_eq!(to_double("nan"), None);
        assert_eq!(to_double(".5"), Some(0.5));
        assert_eq!(to_double("e5"), None);
        assert_eq!(to_bool("TrUe"), Some(true));
        assert_eq!(to_bool("yes"), None);
        assert_eq!(java_round_float(-1.5), -1);
        assert_eq!(java_round_float(2.5), 3);
        assert_eq!(java_round_float(f32::NAN), 0);
        assert_eq!(java_round_float(1e20), i32::MAX);
        assert_eq!(file_name_without_extension("a.NML"), "a");
        assert_eq!(file_name_without_extension("a.zip"), "a");
        assert_eq!(file_name_without_extension("a.txt"), "a.txt");
        assert_eq!(file_name_without_extension("é"), "é");
        assert_eq!(scala_xml_escape("a<\"&>\u{1}b"), "a&lt;&quot;&amp;&gt;b");
        let color = random_color();
        assert!((0.0..1.0).contains(&color.r) && color.a == 1.0);
    }
}
