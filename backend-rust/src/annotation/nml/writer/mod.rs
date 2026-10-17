//! NML document rendering, a byte-compatible port of `NmlWriter.scala`.
//!
//! Scala writes through txw2's `IndentingXMLStreamWriter` on top of Woodstox
//! (the StAX implementation on the classpath). That combination determines the
//! exact bytes reproduced here:
//!
//! * no XML declaration, two-space indentation, `\n` line breaks, no trailing
//!   newline after `</things>`;
//! * elements without children are self-closing (`<node .../>`, no space);
//! * the "volume data omitted" comment is written right after the `<volume ...>`
//!   start tag on the same line (the indenter does not handle comments);
//! * attribute escaping: `&` `<` `"` become entities, `\t` `\n` `\r` become
//!   `&#x9;` `&#xa;` `&#xd;`, U+FFFE/U+FFFF become `&#xfffe;`/`&#xffff;`,
//!   `>` and `'` stay literal, other control characters below U+0020 make
//!   Woodstox throw (here: [`NmlWriteError`]);
//! * numbers use Java's `toString`: `Double.toString`/`Float.toString` (JDK 19+
//!   shortest form, e.g. `1.0`, `0.1`, `1.0E7`, `9.0E-4`), `Long`s for proto
//!   `uint64` fields are signed (values above `i64::MAX` print negative).
//!
//! Callers fetch the tracings and the annotation proto from the tracing store
//! and pass them unmodified; per-user state (`renderUserState` in
//! `AnnotationUserStateUtils.scala`) is applied here while rendering.

use std::collections::HashMap;
use std::fmt;

use crate::proto::datastore::{
    AdditionalCoordinateProto, AnnotationUserStateProto, BoundingBoxProto, ColorProto,
    MetadataEntryProto, NamedBoundingBoxProto, Segment, SegmentGroup, SkeletonTracing,
    SkeletonUserStateProto, Tree, TreeGroup, Vec3DoubleProto, Vec3IntProto, VolumeTracing,
    VolumeUserStateProto,
};

/// Value of the `writer` meta tag. Kept identical to Scala so downstream
/// tooling sees no difference.
pub const NML_WRITER_NAME: &str = "NmlWriter.scala";

/// Comment Scala inserts into `<volume>` when `skipVolumeData` is set.
const VOLUME_DATA_OMITTED_COMMENT: &str =
    "Note that volume data was omitted when downloading this annotation.";

/// `VolumeDataZipFormat` (`wkw` is the download default, compound downloads
/// always use `wkw`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum VolumeDataZipFormat {
    #[default]
    Wkw,
    Zarr3,
}

impl VolumeDataZipFormat {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Wkw => "wkw",
            Self::Zarr3 => "zarr3",
        }
    }

    /// `VolumeDataZipFormat.fromString` (exact, case-sensitive match).
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "wkw" => Some(Self::Wkw),
            "zarr3" => Some(Self::Zarr3),
            _ => None,
        }
    }
}

/// Dataset `VoxelSize`: factor plus `LengthUnit` name (e.g. `nanometer`).
#[derive(Clone, Debug, PartialEq)]
pub struct NmlVoxelSize {
    pub factor: [f64; 3],
    pub unit: String,
}

/// The tracing of one fetched annotation layer (`FetchedAnnotationLayer.tracing`).
#[derive(Clone, Copy, Debug)]
pub enum NmlLayerTracing<'a> {
    Skeleton(&'a SkeletonTracing),
    Volume(&'a VolumeTracing),
}

/// One `FetchedAnnotationLayer`, as passed to `NmlWriter.toNmlStream`.
#[derive(Clone, Copy, Debug)]
pub struct NmlLayer<'a> {
    pub tracing_id: &'a str,
    /// Annotation layer name; part of the volume zip names.
    pub name: &'a str,
    pub tracing: NmlLayerTracing<'a>,
    /// `editedMappingEdgesOpt.isDefined`: the edited-mapping edges zip was
    /// fetched (volume layer with editable mapping and volume data not skipped).
    pub has_edited_mapping_edges: bool,
    /// `baseMappingNameOpt` from the tracingstore mapping info RPC.
    pub base_mapping_name: Option<&'a str>,
}

/// The parts of the `Annotation` row the writer reads.
#[derive(Clone, Copy, Debug)]
pub struct NmlAnnotation<'a> {
    pub id: &'a str,
    /// Always written as the `description` attribute (also when empty).
    pub description: &'a str,
    /// `annotation._task.isDefined`: enables `taskBoundingBox` for volume-only
    /// parameter sources.
    pub has_task: bool,
}

/// All inputs of `NmlWriter.toNmlStream`, minus the stream name.
#[derive(Clone, Debug)]
pub struct NmlWriteInput<'a> {
    /// Layers in Scala order (the explorational download passes skeleton
    /// layers first, then volume layers). Volume indices count only volumes.
    pub layers: Vec<NmlLayer<'a>>,
    /// `AnnotationProto.userStates`; compound downloads pass an empty list.
    pub annotation_user_states: &'a [AnnotationUserStateProto],
    /// `requestingUser.map(_._id)`; `None` for compound downloads.
    pub requesting_user_id: Option<&'a str>,
    pub annotation_owner_id: &'a str,
    /// Owner's `MultiUser.fullName` for the `username` meta tag.
    pub annotation_owner_name: &'a str,
    pub annotation: Option<NmlAnnotation<'a>>,
    /// Id of the fetched task (`taskOpt`) for the `taskId` meta tag.
    pub task_id: Option<&'a str>,
    pub voxel_size: Option<&'a NmlVoxelSize>,
    /// Overrides every volume `location` (compound downloads pass
    /// `<name>_data.zip`); only allowed with at most one volume layer.
    pub volume_filename: Option<&'a str>,
    pub organization_id: &'a str,
    /// `conf.Http.uri`.
    pub wk_url: &'a str,
    pub dataset_name: &'a str,
    pub dataset_id: &'a str,
    pub skip_volume_data: bool,
    pub volume_data_zip_format: VolumeDataZipFormat,
    /// `webknossos.BuildInfo.commitHash` for the `writerGitCommit` meta tag.
    pub writer_git_commit: &'a str,
    /// `Instant.now.epochMillis` for the `timestamp` meta tag.
    pub timestamp_millis: i64,
}

/// Failures Scala reports (as Fox failures or Woodstox exceptions).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NmlWriteError {
    MultipleSkeletons,
    VolumeNameForMultiple,
    NoLayers,
    /// Woodstox refuses control characters other than tab/LF/CR.
    InvalidCharacter(char),
}

impl fmt::Display for NmlWriteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MultipleSkeletons => {
                f.write_str("Cannot download annotation with multiple skeleton layers.")
            }
            Self::VolumeNameForMultiple => {
                f.write_str("Cannot download multiple volume layers if volume name is passed.")
            }
            Self::NoLayers => f.write_str("Cannot download annotation that has no layers."),
            Self::InvalidCharacter('\0') => f.write_str("Invalid null character in text to output"),
            Self::InvalidCharacter(c) => write!(
                f,
                "Invalid white space character (0x{:x}) in text to output",
                u32::from(*c)
            ),
        }
    }
}

impl std::error::Error for NmlWriteError {}

/// `FetchedAnnotationLayer.volumeDataZipName`: zip entry for volume data.
pub fn volume_data_zip_name(layer_name: &str, index: usize, is_single: bool) -> String {
    let index_label = if is_single {
        String::new()
    } else {
        format!("_{index}")
    };
    format!("data{index_label}_{layer_name}.zip")
}

/// `FetchedAnnotationLayer.editedMappingEdgesZipName`.
pub fn edited_mapping_edges_zip_name(layer_name: &str, index: usize, is_single: bool) -> String {
    let index_label = if is_single {
        String::new()
    } else {
        format!("_{index}")
    };
    format!("editedMappingEdges{index_label}_{layer_name}.zip")
}

/// Renders the complete NML document (UTF-8, no XML declaration).
pub fn write_nml(input: &NmlWriteInput<'_>) -> Result<String, NmlWriteError> {
    let mut w = XmlWriter::default();
    w.start("things");
    write_meta(&mut w, input)?;

    let skeletons: Vec<(&NmlLayer<'_>, &SkeletonTracing)> = input
        .layers
        .iter()
        .filter_map(|l| match l.tracing {
            NmlLayerTracing::Skeleton(s) => Some((l, s)),
            NmlLayerTracing::Volume(_) => None,
        })
        .collect();
    let volumes: Vec<(&NmlLayer<'_>, &VolumeTracing)> = input
        .layers
        .iter()
        .filter_map(|l| match l.tracing {
            NmlLayerTracing::Volume(v) => Some((l, v)),
            NmlLayerTracing::Skeleton(_) => None,
        })
        .collect();
    if skeletons.len() > 1 {
        return Err(NmlWriteError::MultipleSkeletons);
    }
    if input.volume_filename.is_some() && volumes.len() > 1 {
        return Err(NmlWriteError::VolumeNameForMultiple);
    }

    let user_state = UserStateContext::new(input);
    write_parameters(&mut w, input, &user_state, &skeletons, &volumes)?;
    for (_, skeleton) in &skeletons {
        write_skeleton_things(&mut w, skeleton, &user_state)?;
    }
    let is_single = volumes.len() == 1;
    for (index, (layer, volume)) in volumes.iter().enumerate() {
        write_volume(&mut w, input, &user_state, layer, volume, index, is_single)?;
    }
    w.end();
    Ok(w.finish())
}

// ---------------------------------------------------------------------------
// User state (AnnotationUserStateUtils.renderUserState)

struct UserStateContext<'a> {
    annotation_state: Option<&'a AnnotationUserStateProto>,
    requesting_user_id: Option<&'a str>,
    owner_id: &'a str,
}

impl<'a> UserStateContext<'a> {
    fn new(input: &NmlWriteInput<'a>) -> Self {
        let wanted = input
            .requesting_user_id
            .unwrap_or(input.annotation_owner_id);
        let states = input.annotation_user_states;
        let annotation_state = states.iter().find(|s| s.user_id == wanted).or_else(|| {
            states
                .iter()
                .find(|s| s.user_id == input.annotation_owner_id)
        });
        Self {
            annotation_state,
            requesting_user_id: input.requesting_user_id,
            owner_id: input.annotation_owner_id,
        }
    }

    fn skeleton(&self, s: &'a SkeletonTracing) -> SkeletonView {
        let requesting = self
            .requesting_user_id
            .and_then(|u| s.user_states.iter().find(|st| st.user_id == u));
        let owner = s.user_states.iter().find(|st| st.user_id == self.owner_id);
        let map32 = |st: Option<&SkeletonUserStateProto>,
                     f: fn(&SkeletonUserStateProto) -> &[crate::proto::datastore::Id32WithBool]| {
            st.map(|st| f(st).iter().map(|e| (e.id, e.value)).collect())
                .unwrap_or_default()
        };
        SkeletonView {
            active_node_id: requesting
                .and_then(|st| st.active_node_id)
                .or_else(|| owner.and_then(|st| st.active_node_id))
                .or(s.active_node_id),
            tree_visibility: [
                map32(requesting, |st| &st.tree_visibilities),
                map32(owner, |st| &st.tree_visibilities),
            ],
            bbox_visibility: [
                map32(requesting, |st| &st.bounding_box_visibilities),
                map32(owner, |st| &st.bounding_box_visibilities),
            ],
            group_expanded: [
                map32(requesting, |st| &st.tree_group_expanded_states),
                map32(owner, |st| &st.tree_group_expanded_states),
            ],
        }
    }

    fn volume(&self, v: &'a VolumeTracing) -> VolumeView {
        let requesting = self
            .requesting_user_id
            .and_then(|u| v.user_states.iter().find(|st| st.user_id == u));
        let owner = v.user_states.iter().find(|st| st.user_id == self.owner_id);
        let bbox = |st: Option<&VolumeUserStateProto>| -> HashMap<i32, bool> {
            st.map(|st| {
                st.bounding_box_visibilities
                    .iter()
                    .map(|e| (e.id, e.value))
                    .collect()
            })
            .unwrap_or_default()
        };
        let segments = |st: Option<&VolumeUserStateProto>| -> HashMap<u64, bool> {
            st.map(|st| {
                st.segment_visibilities
                    .iter()
                    .map(|e| (e.id, e.value))
                    .collect()
            })
            .unwrap_or_default()
        };
        VolumeView {
            bbox_visibility: [bbox(requesting), bbox(owner)],
            segment_visibility: [segments(requesting), segments(owner)],
        }
    }

    fn edit_position(&self, own: &'a Vec3IntProto) -> &'a Vec3IntProto {
        self.annotation_state.map_or(own, |s| &s.edit_position)
    }

    fn edit_rotation(&self, own: &'a Vec3DoubleProto) -> &'a Vec3DoubleProto {
        self.annotation_state.map_or(own, |s| &s.edit_rotation)
    }

    fn zoom_level(&self, own: f64) -> f64 {
        self.annotation_state.map_or(own, |s| s.zoom_level)
    }

    fn edit_position_additional_coordinates(
        &self,
        own: &'a [AdditionalCoordinateProto],
    ) -> &'a [AdditionalCoordinateProto] {
        self.annotation_state
            .map_or(own, |s| &s.edit_position_additional_coordinates)
    }
}

/// Requesting user's map first, then owner's map, then the stored value.
fn overlay<K: std::hash::Hash + Eq>(
    maps: &[HashMap<K, bool>; 2],
    key: &K,
    fallback: Option<bool>,
) -> Option<bool> {
    maps[0]
        .get(key)
        .or_else(|| maps[1].get(key))
        .copied()
        .or(fallback)
}

struct SkeletonView {
    active_node_id: Option<i32>,
    tree_visibility: [HashMap<i32, bool>; 2],
    bbox_visibility: [HashMap<i32, bool>; 2],
    group_expanded: [HashMap<i32, bool>; 2],
}

struct VolumeView {
    bbox_visibility: [HashMap<i32, bool>; 2],
    segment_visibility: [HashMap<u64, bool>; 2],
}

// ---------------------------------------------------------------------------
// Sections

fn write_meta(w: &mut XmlWriter, input: &NmlWriteInput<'_>) -> Result<(), NmlWriteError> {
    fn meta(w: &mut XmlWriter, name: &str, content: &str) -> Result<(), NmlWriteError> {
        w.start("meta");
        w.attr("name", name)?;
        w.attr("content", content)?;
        w.end();
        Ok(())
    }
    meta(w, "writer", NML_WRITER_NAME)?;
    meta(w, "writerGitCommit", input.writer_git_commit)?;
    meta(w, "timestamp", &input.timestamp_millis.to_string())?;
    if let Some(annotation) = &input.annotation {
        meta(w, "annotationId", annotation.id)?;
    }
    meta(w, "username", input.annotation_owner_name)?;
    if let Some(task_id) = input.task_id {
        meta(w, "taskId", task_id)?;
    }
    Ok(())
}

/// Layer whose tracing supplies `<parameters>`: skeleton with the smallest
/// tracing id, else the volume with the smallest tracing id (first on ties,
/// like `minBy`).
fn parameter_source<'a>(
    skeletons: &[(&NmlLayer<'a>, &'a SkeletonTracing)],
    volumes: &[(&NmlLayer<'a>, &'a VolumeTracing)],
) -> Option<NmlLayerTracing<'a>> {
    fn min_by_id<'b, T: Copy>(items: &[(&NmlLayer<'b>, T)]) -> Option<T> {
        let mut best: Option<(&str, T)> = None;
        for (layer, tracing) in items {
            if best.is_none_or(|(id, _)| layer.tracing_id < id) {
                best = Some((layer.tracing_id, *tracing));
            }
        }
        best.map(|(_, t)| t)
    }
    min_by_id(skeletons)
        .map(NmlLayerTracing::Skeleton)
        .or_else(|| min_by_id(volumes).map(NmlLayerTracing::Volume))
}

fn write_parameters(
    w: &mut XmlWriter,
    input: &NmlWriteInput<'_>,
    user_state: &UserStateContext<'_>,
    skeletons: &[(&NmlLayer<'_>, &SkeletonTracing)],
    volumes: &[(&NmlLayer<'_>, &VolumeTracing)],
) -> Result<(), NmlWriteError> {
    let source = parameter_source(skeletons, volumes).ok_or(NmlWriteError::NoLayers)?;

    struct Params<'p> {
        created: i64,
        edit_position: &'p Vec3IntProto,
        edit_rotation: &'p Vec3DoubleProto,
        zoom_level: f64,
        active_node_id: Option<i32>,
        user_bounding_boxes: Vec<(&'p NamedBoundingBoxProto, Option<bool>)>,
        legacy_user_bounding_box: Option<&'p BoundingBoxProto>,
        task_bounding_box: Option<&'p BoundingBoxProto>,
        additional_axes: &'p [crate::proto::datastore::AdditionalAxisProto],
        additional_coordinates: &'p [AdditionalCoordinateProto],
    }

    let params = match source {
        NmlLayerTracing::Skeleton(s) => {
            let view = user_state.skeleton(s);
            Params {
                created: s.created_timestamp,
                edit_position: user_state.edit_position(&s.edit_position),
                edit_rotation: user_state.edit_rotation(&s.edit_rotation),
                zoom_level: user_state.zoom_level(s.zoom_level),
                active_node_id: view.active_node_id,
                user_bounding_boxes: s
                    .user_bounding_boxes
                    .iter()
                    .map(|b| (b, overlay(&view.bbox_visibility, &b.id, b.is_visible)))
                    .collect(),
                legacy_user_bounding_box: s.user_bounding_box.as_ref(),
                task_bounding_box: s.bounding_box.as_ref(),
                additional_axes: &s.additional_axes,
                additional_coordinates: user_state
                    .edit_position_additional_coordinates(&s.edit_position_additional_coordinates),
            }
        }
        NmlLayerTracing::Volume(v) => {
            let view = user_state.volume(v);
            Params {
                created: v.created_timestamp,
                edit_position: user_state.edit_position(&v.edit_position),
                edit_rotation: user_state.edit_rotation(&v.edit_rotation),
                zoom_level: user_state.zoom_level(v.zoom_level),
                active_node_id: None,
                user_bounding_boxes: v
                    .user_bounding_boxes
                    .iter()
                    .map(|b| (b, overlay(&view.bbox_visibility, &b.id, b.is_visible)))
                    .collect(),
                legacy_user_bounding_box: v.user_bounding_box.as_ref(),
                task_bounding_box: input
                    .annotation
                    .as_ref()
                    .filter(|a| a.has_task)
                    .map(|_| &v.bounding_box),
                additional_axes: &v.additional_axes,
                additional_coordinates: user_state
                    .edit_position_additional_coordinates(&v.edit_position_additional_coordinates),
            }
        }
    };

    w.start("parameters");

    w.start("experiment");
    w.attr("name", input.dataset_name)?;
    w.attr("organization", input.organization_id)?;
    w.attr("datasetId", input.dataset_id)?;
    if let Some(annotation) = &input.annotation {
        w.attr("description", annotation.description)?;
    }
    w.attr("wkUrl", input.wk_url)?;
    w.end();

    w.start("scale");
    // Scala: `voxelSize.map(_.factor.x).getOrElse(-1).toString` boxes the
    // default as Integer, so a missing voxel size renders "-1", not "-1.0".
    for (index, axis) in ["x", "y", "z"].into_iter().enumerate() {
        let value = input
            .voxel_size
            .map_or_else(|| "-1".to_owned(), |v| java_double(v.factor[index]));
        w.attr(axis, &value)?;
    }
    if let Some(voxel_size) = input.voxel_size {
        w.attr("unit", &voxel_size.unit)?;
    }
    w.end();

    w.start("offset");
    w.attr("x", "0")?;
    w.attr("y", "0")?;
    w.attr("z", "0")?;
    w.end();

    w.start("time");
    w.attr("ms", &params.created.to_string())?;
    w.end();

    w.start("editPosition");
    w.attr("x", &params.edit_position.x.to_string())?;
    w.attr("y", &params.edit_position.y.to_string())?;
    w.attr("z", &params.edit_position.z.to_string())?;
    write_additional_coordinates(w, params.additional_coordinates)?;
    w.end();

    w.start("editRotation");
    w.attr("xRot", &java_double(params.edit_rotation.x))?;
    w.attr("yRot", &java_double(params.edit_rotation.y))?;
    w.attr("zRot", &java_double(params.edit_rotation.z))?;
    w.end();

    w.start("zoomLevel");
    w.attr("zoom", &java_double(params.zoom_level))?;
    w.end();

    if let Some(node_id) = params.active_node_id {
        w.start("activeNode");
        w.attr("id", &node_id.to_string())?;
        w.end();
    }

    for (b, is_visible) in &params.user_bounding_boxes {
        write_user_bounding_box(
            w,
            b.id,
            b.name.as_deref(),
            *is_visible,
            b.color.as_ref(),
            &b.bounding_box,
        )?;
    }
    // `userBoundingBox.map(NamedBoundingBoxProto(0, None, None, None, _))`
    if let Some(b) = params.legacy_user_bounding_box {
        write_user_bounding_box(w, 0, None, None, None, b)?;
    }

    if let Some(b) = params.task_bounding_box {
        w.start("taskBoundingBox");
        write_bounding_box(w, b)?;
        w.end();
    }

    if !params.additional_axes.is_empty() {
        w.start("additionalAxes");
        for axis in params.additional_axes {
            w.start("additionalAxis");
            w.attr("name", &axis.name)?;
            w.attr("index", &axis.index.to_string())?;
            w.attr("start", &axis.bounds.x.to_string())?;
            w.attr("end", &axis.bounds.y.to_string())?;
            w.end();
        }
        w.end();
    }

    w.end();
    Ok(())
}

fn write_user_bounding_box(
    w: &mut XmlWriter,
    id: i32,
    name: Option<&str>,
    is_visible: Option<bool>,
    color: Option<&ColorProto>,
    bounding_box: &BoundingBoxProto,
) -> Result<(), NmlWriteError> {
    w.start("userBoundingBox");
    w.attr("id", &id.to_string())?;
    if let Some(name) = name {
        w.attr("name", name)?;
    }
    if let Some(is_visible) = is_visible {
        w.attr("isVisible", bool_str(is_visible))?;
    }
    write_color(w, color)?;
    write_bounding_box(w, bounding_box)?;
    w.end();
    Ok(())
}

fn write_skeleton_things(
    w: &mut XmlWriter,
    s: &SkeletonTracing,
    user_state: &UserStateContext<'_>,
) -> Result<(), NmlWriteError> {
    let view = user_state.skeleton(s);
    for tree in &s.trees {
        let is_visible = overlay(&view.tree_visibility, &tree.tree_id, tree.is_visible);
        write_tree(w, tree, is_visible)?;
    }

    // `trees.flatMap(_.branchPoints).sortBy(-_.createdTimestamp)` (stable).
    let mut branch_points: Vec<_> = s.trees.iter().flat_map(|t| &t.branch_points).collect();
    branch_points.sort_by_key(|b| b.created_timestamp.wrapping_neg());
    w.start("branchpoints");
    for b in branch_points {
        w.start("branchpoint");
        w.attr("id", &b.node_id.to_string())?;
        w.attr("time", &b.created_timestamp.to_string())?;
        w.end();
    }
    w.end();

    w.start("comments");
    for c in s.trees.iter().flat_map(|t| &t.comments) {
        w.start("comment");
        w.attr("node", &c.node_id.to_string())?;
        w.attr("content", &c.content)?;
        w.end();
    }
    w.end();

    w.start("groups");
    write_tree_groups(w, &s.tree_groups, &view)?;
    w.end();
    Ok(())
}

fn write_tree(w: &mut XmlWriter, t: &Tree, is_visible: Option<bool>) -> Result<(), NmlWriteError> {
    w.start("thing");
    w.attr("id", &t.tree_id.to_string())?;
    write_color(w, t.color.as_ref())?;
    w.attr("name", &t.name)?;
    if let Some(is_visible) = is_visible {
        w.attr("isVisible", bool_str(is_visible))?;
    }
    if let Some(group_id) = t.group_id {
        w.attr("groupId", &group_id.to_string())?;
    }
    if let Some(tree_type) = t.r#type {
        w.attr("type", &tree_type_name(tree_type))?;
    }

    // `nodes.sortBy(_.id)` (stable), then drop later duplicates of an id.
    let mut nodes: Vec<_> = t.nodes.iter().collect();
    nodes.sort_by_key(|n| n.id);
    nodes.dedup_by_key(|n| n.id);
    w.start("nodes");
    for n in nodes {
        w.start("node");
        w.attr("id", &n.id.to_string())?;
        w.attr("radius", &java_float(n.radius))?;
        w.attr("x", &n.position.x.to_string())?;
        w.attr("y", &n.position.y.to_string())?;
        w.attr("z", &n.position.z.to_string())?;
        w.attr("rotX", &java_double(n.rotation.x))?;
        w.attr("rotY", &java_double(n.rotation.y))?;
        w.attr("rotZ", &java_double(n.rotation.z))?;
        w.attr("inVp", &n.viewport.to_string())?;
        w.attr("inMag", &n.mag.to_string())?;
        w.attr("bitDepth", &n.bit_depth.to_string())?;
        w.attr("interpolation", bool_str(n.interpolation))?;
        w.attr("time", &n.created_timestamp.to_string())?;
        write_additional_coordinates(w, &n.additional_coordinates)?;
        w.end();
    }
    w.end();

    w.start("edges");
    for e in &t.edges {
        w.start("edge");
        w.attr("source", &e.source.to_string())?;
        w.attr("target", &e.target.to_string())?;
        w.end();
    }
    w.end();

    write_metadata(w, &t.metadata)?;
    w.end();
    Ok(())
}

/// ScalaPB enum `toString`: the proto value name, `Unrecognized(n)` otherwise.
fn tree_type_name(value: i32) -> String {
    match value {
        0 => "DEFAULT".to_owned(),
        1 => "AGGLOMERATE".to_owned(),
        other => format!("Unrecognized({other})"),
    }
}

fn write_tree_groups(
    w: &mut XmlWriter,
    groups: &[TreeGroup],
    view: &SkeletonView,
) -> Result<(), NmlWriteError> {
    for g in groups {
        w.start("group");
        w.attr("name", &g.name)?;
        w.attr("id", &g.group_id.to_string())?;
        // renderUserState only rewrites top-level groups (treeGroups.map),
        // nested children keep their stored isExpanded.
        let expanded = overlay(&view.group_expanded, &g.group_id, g.is_expanded).unwrap_or(true);
        w.attr("isExpanded", bool_str(expanded))?;
        write_tree_group_children(w, &g.children)?;
        w.end();
    }
    Ok(())
}

fn write_tree_group_children(w: &mut XmlWriter, groups: &[TreeGroup]) -> Result<(), NmlWriteError> {
    for g in groups {
        w.start("group");
        w.attr("name", &g.name)?;
        w.attr("id", &g.group_id.to_string())?;
        w.attr("isExpanded", bool_str(g.is_expanded.unwrap_or(true)))?;
        write_tree_group_children(w, &g.children)?;
        w.end();
    }
    Ok(())
}

fn write_volume(
    w: &mut XmlWriter,
    input: &NmlWriteInput<'_>,
    user_state: &UserStateContext<'_>,
    layer: &NmlLayer<'_>,
    v: &VolumeTracing,
    index: usize,
    is_single: bool,
) -> Result<(), NmlWriteError> {
    w.start("volume");
    w.attr("id", &index.to_string())?;
    w.attr("name", layer.name)?;
    if !input.skip_volume_data && !layer.has_edited_mapping_edges {
        let location = input.volume_filename.map_or_else(
            || volume_data_zip_name(layer.name, index, is_single),
            str::to_owned,
        );
        w.attr("location", &location)?;
        w.attr("format", input.volume_data_zip_format.as_str())?;
    }
    if let Some(fallback_layer) = &v.fallback_layer {
        w.attr("fallbackLayer", fallback_layer)?;
    }
    if let Some(largest) = v.largest_segment_id {
        w.attr("largestSegmentId", &java_long_from_u64(largest))?;
    }
    if !v.has_editable_mapping.unwrap_or(false) {
        if let Some(mapping_name) = &v.mapping_name {
            w.attr("mappingName", mapping_name)?;
        }
        if v.mapping_is_locked.unwrap_or(false) {
            w.attr("mappingIsLocked", "true")?;
        }
    }
    if layer.has_edited_mapping_edges {
        w.attr(
            "editedMappingEdgesLocation",
            &edited_mapping_edges_zip_name(layer.name, index, is_single),
        )?;
    }
    if let Some(base_mapping_name) = layer.base_mapping_name {
        w.attr("editedMappingBaseMappingName", base_mapping_name)?;
    }
    if input.skip_volume_data {
        w.comment(VOLUME_DATA_OMITTED_COMMENT);
    }

    let view = user_state.volume(v);
    w.start("segments");
    for s in &v.segments {
        let is_visible = overlay(&view.segment_visibility, &s.segment_id, s.is_visible);
        write_segment(w, s, is_visible)?;
    }
    w.end();

    w.start("groups");
    write_segment_groups(w, &v.segment_groups)?;
    w.end();

    w.end();
    Ok(())
}

fn write_segment(
    w: &mut XmlWriter,
    s: &Segment,
    is_visible: Option<bool>,
) -> Result<(), NmlWriteError> {
    w.start("segment");
    w.attr("id", &java_long_from_u64(s.segment_id))?;
    if let Some(name) = &s.name {
        w.attr("name", name)?;
    }
    if let Some(is_visible) = is_visible {
        w.attr("isVisible", bool_str(is_visible))?;
    }
    if let Some(created) = s.creation_time {
        w.attr("created", &created.to_string())?;
    }
    if let Some(anchor) = &s.anchor_position {
        w.attr("anchorPositionX", &anchor.x.to_string())?;
        w.attr("anchorPositionY", &anchor.y.to_string())?;
        w.attr("anchorPositionZ", &anchor.z.to_string())?;
        write_additional_coordinates(w, &s.anchor_position_additional_coordinates)?;
    }
    if let Some(color) = &s.color {
        write_color(w, Some(color))?;
    }
    if let Some(group_id) = s.group_id {
        w.attr("groupId", &group_id.to_string())?;
    }
    write_metadata(w, &s.metadata)?;
    w.end();
    Ok(())
}

fn write_segment_groups(w: &mut XmlWriter, groups: &[SegmentGroup]) -> Result<(), NmlWriteError> {
    for g in groups {
        w.start("group");
        w.attr("name", &g.name)?;
        w.attr("id", &g.group_id.to_string())?;
        write_segment_groups(w, &g.children)?;
        w.end();
    }
    Ok(())
}

fn write_metadata(w: &mut XmlWriter, entries: &[MetadataEntryProto]) -> Result<(), NmlWriteError> {
    if entries.is_empty() {
        return Ok(());
    }
    w.start("metadata");
    for p in entries {
        w.start("metadataEntry");
        w.attr("key", &p.key)?;
        if let Some(v) = &p.string_value {
            w.attr("stringValue", v)?;
        }
        if let Some(v) = p.bool_value {
            w.attr("boolValue", bool_str(v))?;
        }
        if let Some(v) = p.number_value {
            w.attr("numberValue", &java_double(v))?;
        }
        for (index, v) in p.string_list_value.iter().enumerate() {
            w.attr(&format!("stringListValue-{index}"), v)?;
        }
        w.end();
    }
    w.end();
    Ok(())
}

fn write_bounding_box(w: &mut XmlWriter, b: &BoundingBoxProto) -> Result<(), NmlWriteError> {
    w.attr("topLeftX", &b.top_left.x.to_string())?;
    w.attr("topLeftY", &b.top_left.y.to_string())?;
    w.attr("topLeftZ", &b.top_left.z.to_string())?;
    w.attr("width", &b.width.to_string())?;
    w.attr("height", &b.height.to_string())?;
    w.attr("depth", &b.depth.to_string())?;
    Ok(())
}

/// Always writes all four attributes; empty strings when the color is unset.
fn write_color(w: &mut XmlWriter, color: Option<&ColorProto>) -> Result<(), NmlWriteError> {
    let component =
        |f: fn(&ColorProto) -> f64| color.map(|c| java_double(f(c))).unwrap_or_default();
    w.attr("color.r", &component(|c| c.r))?;
    w.attr("color.g", &component(|c| c.g))?;
    w.attr("color.b", &component(|c| c.b))?;
    w.attr("color.a", &component(|c| c.a))?;
    Ok(())
}

fn write_additional_coordinates(
    w: &mut XmlWriter,
    coordinates: &[AdditionalCoordinateProto],
) -> Result<(), NmlWriteError> {
    for c in coordinates {
        w.attr(
            &format!("additionalCoordinate-{}", c.name),
            &c.value.to_string(),
        )?;
    }
    Ok(())
}

fn bool_str(value: bool) -> &'static str {
    if value { "true" } else { "false" }
}

/// ScalaPB maps proto `uint64` to a signed `Long`.
fn java_long_from_u64(value: u64) -> String {
    (value as i64).to_string()
}

pub use webknossos_common::java_format::{java_double, java_float};

// ---------------------------------------------------------------------------
// Minimal port of txw2 IndentingXMLStreamWriter over Woodstox

#[derive(Clone, Copy, PartialEq, Eq)]
enum IndentState {
    SeenNothing,
    SeenElement,
}

struct XmlWriter {
    out: String,
    depth: usize,
    state: IndentState,
    stack: Vec<IndentState>,
    /// Element names, for closing tags.
    names: Vec<&'static str>,
    /// Start tag still open (Woodstox writes `/>` if it ends right away).
    start_open: bool,
}

impl Default for XmlWriter {
    fn default() -> Self {
        Self {
            out: String::new(),
            depth: 0,
            state: IndentState::SeenNothing,
            stack: Vec::new(),
            names: Vec::new(),
            start_open: false,
        }
    }
}

impl XmlWriter {
    fn close_start_tag(&mut self) {
        if self.start_open {
            self.out.push('>');
            self.start_open = false;
        }
    }

    fn indent(&mut self) {
        for _ in 0..self.depth {
            self.out.push_str("  ");
        }
    }

    fn start(&mut self, name: &'static str) {
        self.stack.push(IndentState::SeenElement);
        self.state = IndentState::SeenNothing;
        if self.depth > 0 {
            self.close_start_tag();
            self.out.push('\n');
        }
        self.indent();
        self.out.push('<');
        self.out.push_str(name);
        self.names.push(name);
        self.start_open = true;
        self.depth += 1;
    }

    fn attr(&mut self, name: &str, value: &str) -> Result<(), NmlWriteError> {
        debug_assert!(self.start_open, "attribute outside a start tag");
        self.out.push(' ');
        self.out.push_str(name);
        self.out.push_str("=\"");
        for c in value.chars() {
            match c {
                '&' => self.out.push_str("&amp;"),
                '<' => self.out.push_str("&lt;"),
                '"' => self.out.push_str("&quot;"),
                '\t' => self.out.push_str("&#x9;"),
                '\n' => self.out.push_str("&#xa;"),
                '\r' => self.out.push_str("&#xd;"),
                // Not legal XML characters; Woodstox writes them as entities.
                '\u{fffe}' => self.out.push_str("&#xfffe;"),
                '\u{ffff}' => self.out.push_str("&#xffff;"),
                c if u32::from(c) < 0x20 => return Err(NmlWriteError::InvalidCharacter(c)),
                c => self.out.push(c),
            }
        }
        self.out.push('"');
        Ok(())
    }

    fn comment(&mut self, text: &str) {
        self.close_start_tag();
        self.out.push_str("<!--");
        self.out.push_str(text);
        self.out.push_str("-->");
    }

    fn end(&mut self) {
        self.depth -= 1;
        if self.state == IndentState::SeenElement {
            self.close_start_tag();
            self.out.push('\n');
            self.indent();
        }
        let name = self.names.pop().unwrap_or_default();
        if self.start_open {
            self.out.push_str("/>");
            self.start_open = false;
        } else {
            self.out.push_str("</");
            self.out.push_str(name);
            self.out.push('>');
        }
        self.state = self.stack.pop().unwrap_or(IndentState::SeenNothing);
    }

    fn finish(self) -> String {
        self.out
    }
}

#[cfg(test)]
mod tests;
