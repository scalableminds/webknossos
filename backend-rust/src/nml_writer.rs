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

pub use crate::java_format::{java_double, java_float};

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
mod tests {
    //! Golden outputs derived from `NmlWriter.scala`. The serializer layer
    //! (indentation, self-closing tags, comment placement, escaping) and the
    //! number formatting were cross-checked against the runtime classpath
    //! (Woodstox 7.2.2 + txw2 4.0.9 `IndentingXMLStreamWriter`, JDK 25
    //! `Double.toString`/`Float.toString`); see `checkpoints/nml-writer.md`.

    use super::*;
    use crate::proto::datastore::{
        AdditionalAxisProto, BranchPoint, Comment, Edge, Id32WithBool, Id64WithBool, Node,
        Vec2IntProto,
    };

    fn v3(x: i32, y: i32, z: i32) -> Vec3IntProto {
        Vec3IntProto { x, y, z }
    }

    fn d3(x: f64, y: f64, z: f64) -> Vec3DoubleProto {
        Vec3DoubleProto { x, y, z }
    }

    fn bbox(top_left: Vec3IntProto, width: i32, height: i32, depth: i32) -> BoundingBoxProto {
        BoundingBoxProto {
            top_left,
            width,
            height,
            depth,
        }
    }

    fn color(r: f64, g: f64, b: f64, a: f64) -> ColorProto {
        ColorProto { r, g, b, a }
    }

    fn coord(name: &str, value: i32) -> AdditionalCoordinateProto {
        AdditionalCoordinateProto {
            name: name.to_owned(),
            value,
        }
    }

    fn id32(id: i32, value: bool) -> Id32WithBool {
        Id32WithBool { id, value }
    }

    fn metadata_string(key: &str, value: &str) -> MetadataEntryProto {
        MetadataEntryProto {
            key: key.to_owned(),
            string_value: Some(value.to_owned()),
            ..Default::default()
        }
    }

    fn base_input<'a>(layers: Vec<NmlLayer<'a>>) -> NmlWriteInput<'a> {
        NmlWriteInput {
            layers,
            annotation_user_states: &[],
            requesting_user_id: None,
            annotation_owner_id: "owner",
            annotation_owner_name: "",
            annotation: None,
            task_id: None,
            voxel_size: None,
            volume_filename: None,
            organization_id: "org",
            wk_url: "http://x",
            dataset_name: "ds",
            dataset_id: "d",
            skip_volume_data: false,
            volume_data_zip_format: VolumeDataZipFormat::Wkw,
            writer_git_commit: "",
            timestamp_millis: 0,
        }
    }

    fn skeleton_layer<'a>(tracing_id: &'a str, s: &'a SkeletonTracing) -> NmlLayer<'a> {
        NmlLayer {
            tracing_id,
            name: "Skeleton",
            tracing: NmlLayerTracing::Skeleton(s),
            has_edited_mapping_edges: false,
            base_mapping_name: None,
        }
    }

    fn volume_layer<'a>(tracing_id: &'a str, name: &'a str, v: &'a VolumeTracing) -> NmlLayer<'a> {
        NmlLayer {
            tracing_id,
            name,
            tracing: NmlLayerTracing::Volume(v),
            has_edited_mapping_edges: false,
            base_mapping_name: None,
        }
    }

    fn minimal_skeleton() -> SkeletonTracing {
        SkeletonTracing {
            created_timestamp: 7,
            zoom_level: 1.0,
            ..Default::default()
        }
    }

    fn minimal_volume() -> VolumeTracing {
        VolumeTracing {
            created_timestamp: 8,
            zoom_level: 1.0,
            ..Default::default()
        }
    }

    // -----------------------------------------------------------------------
    // Skeleton-only download with task, user states and every tree feature

    const GOLDEN_SKELETON: &str = r#"<things>
  <meta name="writer" content="NmlWriter.scala"/>
  <meta name="writerGitCommit" content="abc123"/>
  <meta name="timestamp" content="1700000000000"/>
  <meta name="annotationId" content="66f0a1b2c3d4e5f6a7b8c9d0"/>
  <meta name="username" content="Ada Lovelace"/>
  <meta name="taskId" content="66f0a1b2c3d4e5f6a7b8c9d1"/>
  <parameters>
    <experiment name="ds" organization="org" datasetId="66f0a1b2c3d4e5f6a7b8c9d2" description="Ada's tracing" wkUrl="http://localhost:9000"/>
    <scale x="11.24" y="11.24" z="28.0" unit="nanometer"/>
    <offset x="0" y="0" z="0"/>
    <time ms="1690000000000"/>
    <editPosition x="1" y="2" z="3" additionalCoordinate-t="3"/>
    <editRotation xRot="90.0" yRot="-0.0" zRot="1.0E-4"/>
    <zoomLevel zoom="2.0"/>
    <activeNode id="7"/>
    <userBoundingBox id="1" name="Box &lt;1>" isVisible="false" color.r="1.0" color.g="0.0" color.b="0.0" color.a="1.0" topLeftX="0" topLeftY="0" topLeftZ="0" width="10" height="20" depth="30"/>
    <userBoundingBox id="2" color.r="" color.g="" color.b="" color.a="" topLeftX="5" topLeftY="6" topLeftZ="7" width="1" height="1" depth="1"/>
    <userBoundingBox id="0" color.r="" color.g="" color.b="" color.a="" topLeftX="1" topLeftY="1" topLeftZ="1" width="2" height="2" depth="2"/>
    <taskBoundingBox topLeftX="0" topLeftY="0" topLeftZ="0" width="100" height="100" depth="100"/>
    <additionalAxes>
      <additionalAxis name="t" index="3" start="0" end="10"/>
    </additionalAxes>
  </parameters>
  <thing id="1" color.r="0.5" color.g="0.25" color.b="1.0" color.a="1.0" name="Axon" isVisible="false" groupId="10" type="AGGLOMERATE">
    <nodes>
      <node id="1" radius="120.0" x="1" y="2" z="3" rotX="0.0" rotY="0.0" rotZ="0.0" inVp="0" inMag="1" bitDepth="8" interpolation="false" time="1000" additionalCoordinate-t="3"/>
      <node id="3" radius="1.5" x="4" y="5" z="6" rotX="0.5" rotY="0.001" rotZ="1.0E7" inVp="1" inMag="2" bitDepth="4" interpolation="true" time="2000"/>
    </nodes>
    <edges>
      <edge source="1" target="3"/>
    </edges>
    <metadata>
      <metadataEntry key="k1" stringValue="v"/>
      <metadataEntry key="k2" boolValue="true"/>
      <metadataEntry key="k3" numberValue="1.0E7"/>
      <metadataEntry key="k4" stringListValue-0="a" stringListValue-1="b"/>
    </metadata>
  </thing>
  <thing id="2" color.r="" color.g="" color.b="" color.a="" name="Empty" isVisible="false" type="DEFAULT">
    <nodes/>
    <edges/>
  </thing>
  <branchpoints>
    <branchpoint id="3" time="300"/>
    <branchpoint id="9" time="200"/>
    <branchpoint id="1" time="100"/>
  </branchpoints>
  <comments>
    <comment node="1" content="soma &amp; &lt;dendrite>"/>
  </comments>
  <groups>
    <group name="G10" id="10" isExpanded="false">
      <group name="G11" id="11" isExpanded="true"/>
    </group>
    <group name="G12" id="12" isExpanded="false"/>
  </groups>
</things>"#;

    fn rich_skeleton() -> SkeletonTracing {
        let node = |id: i32, position: Vec3IntProto| Node {
            id,
            position,
            rotation: d3(0.0, 0.0, 0.0),
            radius: 120.0,
            viewport: 0,
            mag: 1,
            bit_depth: 8,
            interpolation: false,
            created_timestamp: 1000,
            additional_coordinates: vec![coord("t", 3)],
        };
        let axon = Tree {
            tree_id: 1,
            name: "Axon".to_owned(),
            color: Some(color(0.5, 0.25, 1.0, 1.0)),
            is_visible: Some(true),
            group_id: Some(10),
            r#type: Some(1),
            nodes: vec![
                Node {
                    position: v3(4, 5, 6),
                    rotation: d3(0.5, 0.001, 1e7),
                    radius: 1.5,
                    viewport: 1,
                    mag: 2,
                    bit_depth: 4,
                    interpolation: true,
                    created_timestamp: 2000,
                    additional_coordinates: vec![],
                    ..node(3, v3(0, 0, 0))
                },
                node(1, v3(1, 2, 3)),
                // Duplicate id: Scala's seenIds keeps only the first after sorting.
                node(3, v3(99, 99, 99)),
            ],
            edges: vec![Edge {
                source: 1,
                target: 3,
            }],
            branch_points: vec![
                BranchPoint {
                    node_id: 1,
                    created_timestamp: 100,
                },
                BranchPoint {
                    node_id: 3,
                    created_timestamp: 300,
                },
            ],
            comments: vec![Comment {
                node_id: 1,
                content: "soma & <dendrite>".to_owned(),
            }],
            metadata: vec![
                metadata_string("k1", "v"),
                MetadataEntryProto {
                    key: "k2".to_owned(),
                    bool_value: Some(true),
                    ..Default::default()
                },
                MetadataEntryProto {
                    key: "k3".to_owned(),
                    number_value: Some(1e7),
                    ..Default::default()
                },
                MetadataEntryProto {
                    key: "k4".to_owned(),
                    string_list_value: vec!["a".to_owned(), "b".to_owned()],
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let empty = Tree {
            tree_id: 2,
            name: "Empty".to_owned(),
            r#type: Some(0),
            branch_points: vec![BranchPoint {
                node_id: 9,
                created_timestamp: 200,
            }],
            ..Default::default()
        };
        SkeletonTracing {
            trees: vec![axon, empty],
            created_timestamp: 1_690_000_000_000,
            bounding_box: Some(bbox(v3(0, 0, 0), 100, 100, 100)),
            active_node_id: Some(5),
            edit_position: v3(9, 9, 9),
            edit_rotation: d3(1.0, 1.0, 1.0),
            zoom_level: 9.0,
            user_bounding_box: Some(bbox(v3(1, 1, 1), 2, 2, 2)),
            tree_groups: vec![
                TreeGroup {
                    name: "G10".to_owned(),
                    group_id: 10,
                    is_expanded: None,
                    children: vec![TreeGroup {
                        name: "G11".to_owned(),
                        group_id: 11,
                        is_expanded: None,
                        children: vec![],
                    }],
                },
                TreeGroup {
                    name: "G12".to_owned(),
                    group_id: 12,
                    is_expanded: Some(false),
                    children: vec![],
                },
            ],
            user_bounding_boxes: vec![
                NamedBoundingBoxProto {
                    id: 1,
                    name: Some("Box <1>".to_owned()),
                    is_visible: Some(true),
                    color: Some(color(1.0, 0.0, 0.0, 1.0)),
                    bounding_box: bbox(v3(0, 0, 0), 10, 20, 30),
                },
                NamedBoundingBoxProto {
                    id: 2,
                    name: None,
                    is_visible: None,
                    color: None,
                    bounding_box: bbox(v3(5, 6, 7), 1, 1, 1),
                },
            ],
            additional_axes: vec![AdditionalAxisProto {
                name: "t".to_owned(),
                index: 3,
                bounds: Vec2IntProto { x: 0, y: 10 },
            }],
            user_states: vec![
                SkeletonUserStateProto {
                    user_id: "viewer".to_owned(),
                    active_node_id: Some(7),
                    tree_group_expanded_states: vec![id32(10, false)],
                    bounding_box_visibilities: vec![id32(1, false)],
                    tree_visibilities: vec![id32(2, false)],
                },
                SkeletonUserStateProto {
                    user_id: "owner".to_owned(),
                    active_node_id: Some(8),
                    // Nested groups are not rewritten by renderUserState.
                    tree_group_expanded_states: vec![id32(11, false)],
                    bounding_box_visibilities: vec![],
                    tree_visibilities: vec![id32(1, false), id32(2, true)],
                },
            ],
            ..Default::default()
        }
    }

    #[test]
    fn skeleton_document_matches_golden() {
        let skeleton = rich_skeleton();
        // The viewer has no annotation user state: the owner's one applies.
        let annotation_states = vec![AnnotationUserStateProto {
            user_id: "owner".to_owned(),
            edit_position: v3(1, 2, 3),
            edit_rotation: d3(90.0, -0.0, 1e-4),
            zoom_level: 2.0,
            edit_position_additional_coordinates: vec![coord("t", 3)],
        }];
        let voxel_size = NmlVoxelSize {
            factor: [11.24, 11.24, 28.0],
            unit: "nanometer".to_owned(),
        };
        let input = NmlWriteInput {
            annotation_user_states: &annotation_states,
            requesting_user_id: Some("viewer"),
            annotation_owner_name: "Ada Lovelace",
            annotation: Some(NmlAnnotation {
                id: "66f0a1b2c3d4e5f6a7b8c9d0",
                description: "Ada's tracing",
                has_task: true,
            }),
            task_id: Some("66f0a1b2c3d4e5f6a7b8c9d1"),
            voxel_size: Some(&voxel_size),
            wk_url: "http://localhost:9000",
            dataset_id: "66f0a1b2c3d4e5f6a7b8c9d2",
            writer_git_commit: "abc123",
            timestamp_millis: 1_700_000_000_000,
            ..base_input(vec![skeleton_layer("skeleton-id", &skeleton)])
        };
        assert_eq!(write_nml(&input).unwrap(), GOLDEN_SKELETON);
    }

    // -----------------------------------------------------------------------
    // Volume-only task download with two layers (editable mapping + data)

    const GOLDEN_VOLUMES: &str = r#"<things>
  <meta name="writer" content="NmlWriter.scala"/>
  <meta name="writerGitCommit" content="abc123"/>
  <meta name="timestamp" content="42"/>
  <meta name="annotationId" content="a1"/>
  <meta name="username" content="Owner"/>
  <meta name="taskId" content="t1"/>
  <parameters>
    <experiment name="ds" organization="org" datasetId="d1" description="" wkUrl="https://wk.example"/>
    <scale x="4.0" y="4.0" z="40.0" unit="nanometer"/>
    <offset x="0" y="0" z="0"/>
    <time ms="5"/>
    <editPosition x="10" y="20" z="30"/>
    <editRotation xRot="0.0" yRot="0.0" zRot="0.0"/>
    <zoomLevel zoom="0.5"/>
    <userBoundingBox id="3" name="" isVisible="false" color.r="0.1" color.g="0.2" color.b="0.3" color.a="1.0" topLeftX="0" topLeftY="0" topLeftZ="0" width="8" height="8" depth="8"/>
    <taskBoundingBox topLeftX="0" topLeftY="0" topLeftZ="0" width="64" height="64" depth="64"/>
  </parameters>
  <volume id="0" name="Volume" editedMappingEdgesLocation="editedMappingEdges_0_Volume.zip" editedMappingBaseMappingName="agglomerate_view_70">
    <segments/>
    <groups/>
  </volume>
  <volume id="1" name="Seg Ids" location="data_1_Seg Ids.zip" format="zarr3" fallbackLayer="segmentation" largestSegmentId="-1" mappingName="agglomerate_view_5" mappingIsLocked="true">
    <segments>
      <segment id="5" name="Nucleus" isVisible="false" created="1234" anchorPositionX="1" anchorPositionY="2" anchorPositionZ="3" additionalCoordinate-t="1" color.r="1.0" color.g="0.0" color.b="0.0" color.a="1.0" groupId="1">
        <metadata>
          <metadataEntry key="k" numberValue="-0.5"/>
        </metadata>
      </segment>
      <segment id="-9223372036854775808" isVisible="true"/>
    </segments>
    <groups>
      <group name="SG" id="1">
        <group name="SG2" id="2"/>
      </group>
    </groups>
  </volume>
</things>"#;

    #[test]
    fn volume_document_matches_golden() {
        let editable = VolumeTracing {
            created_timestamp: 6,
            edit_position: v3(7, 7, 7),
            mapping_name: Some("editable-id".to_owned()),
            has_editable_mapping: Some(true),
            mapping_is_locked: Some(true),
            ..minimal_volume()
        };
        let data = VolumeTracing {
            created_timestamp: 5,
            edit_position: v3(10, 20, 30),
            zoom_level: 0.5,
            bounding_box: bbox(v3(0, 0, 0), 64, 64, 64),
            fallback_layer: Some("segmentation".to_owned()),
            largest_segment_id: Some(u64::MAX),
            mapping_name: Some("agglomerate_view_5".to_owned()),
            mapping_is_locked: Some(true),
            user_bounding_boxes: vec![NamedBoundingBoxProto {
                id: 3,
                name: Some(String::new()),
                is_visible: Some(true),
                color: Some(color(0.1, 0.2, 0.3, 1.0)),
                bounding_box: bbox(v3(0, 0, 0), 8, 8, 8),
            }],
            segments: vec![
                Segment {
                    segment_id: 5,
                    anchor_position: Some(v3(1, 2, 3)),
                    name: Some("Nucleus".to_owned()),
                    creation_time: Some(1234),
                    color: Some(color(1.0, 0.0, 0.0, 1.0)),
                    group_id: Some(1),
                    anchor_position_additional_coordinates: vec![coord("t", 1)],
                    metadata: vec![MetadataEntryProto {
                        key: "k".to_owned(),
                        number_value: Some(-0.5),
                        ..Default::default()
                    }],
                    is_visible: None,
                },
                Segment {
                    segment_id: 1 << 63,
                    // Additional coordinates are only written with an anchor.
                    anchor_position_additional_coordinates: vec![coord("t", 9)],
                    is_visible: Some(false),
                    ..Default::default()
                },
            ],
            segment_groups: vec![SegmentGroup {
                name: "SG".to_owned(),
                group_id: 1,
                is_expanded: Some(false),
                children: vec![SegmentGroup {
                    name: "SG2".to_owned(),
                    group_id: 2,
                    is_expanded: None,
                    children: vec![],
                }],
            }],
            user_states: vec![VolumeUserStateProto {
                user_id: "owner".to_owned(),
                bounding_box_visibilities: vec![id32(3, false)],
                segment_visibilities: vec![
                    Id64WithBool {
                        id: 5,
                        value: false,
                    },
                    Id64WithBool {
                        id: 1 << 63,
                        value: true,
                    },
                ],
                ..Default::default()
            }],
            ..minimal_volume()
        };
        let voxel_size = NmlVoxelSize {
            factor: [4.0, 4.0, 40.0],
            unit: "nanometer".to_owned(),
        };
        let mut editable_layer = volume_layer("t-2", "Volume", &editable);
        editable_layer.has_edited_mapping_edges = true;
        editable_layer.base_mapping_name = Some("agglomerate_view_70");
        let input = NmlWriteInput {
            annotation_owner_name: "Owner",
            annotation: Some(NmlAnnotation {
                id: "a1",
                description: "",
                has_task: true,
            }),
            task_id: Some("t1"),
            voxel_size: Some(&voxel_size),
            wk_url: "https://wk.example",
            dataset_id: "d1",
            volume_data_zip_format: VolumeDataZipFormat::Zarr3,
            writer_git_commit: "abc123",
            timestamp_millis: 42,
            // Parameters come from the smallest tracing id ("t-1").
            ..base_input(vec![editable_layer, volume_layer("t-1", "Seg Ids", &data)])
        };
        assert_eq!(write_nml(&input).unwrap(), GOLDEN_VOLUMES);
    }

    // -----------------------------------------------------------------------
    // Compound-style hybrid: no annotation, no voxel size, fixed volume name

    const GOLDEN_HYBRID_COMPOUND: &str = r#"<things>
  <meta name="writer" content="NmlWriter.scala"/>
  <meta name="writerGitCommit" content=""/>
  <meta name="timestamp" content="0"/>
  <meta name="username" content=""/>
  <parameters>
    <experiment name="ds" organization="org" datasetId="d" wkUrl="http://x"/>
    <scale x="-1" y="-1" z="-1"/>
    <offset x="0" y="0" z="0"/>
    <time ms="7"/>
    <editPosition x="0" y="0" z="0"/>
    <editRotation xRot="0.0" yRot="0.0" zRot="0.0"/>
    <zoomLevel zoom="1.0"/>
  </parameters>
  <branchpoints/>
  <comments/>
  <groups/>
  <volume id="0" name="Volume" location="compound_data.zip" format="wkw">
    <segments/>
    <groups/>
  </volume>
</things>"#;

    #[test]
    fn hybrid_compound_document_matches_golden() {
        let skeleton = minimal_skeleton();
        // Without an annotation the volume task bounding box is never written,
        // and the skeleton wins the parameter precedence over a smaller id.
        let volume = VolumeTracing {
            bounding_box: bbox(v3(0, 0, 0), 1, 1, 1),
            ..minimal_volume()
        };
        let input = NmlWriteInput {
            volume_filename: Some("compound_data.zip"),
            ..base_input(vec![
                volume_layer("a", "Volume", &volume),
                skeleton_layer("b", &skeleton),
            ])
        };
        assert_eq!(write_nml(&input).unwrap(), GOLDEN_HYBRID_COMPOUND);
    }

    const GOLDEN_SKIPPED_VOLUME: &str = r#"<things>
  <meta name="writer" content="NmlWriter.scala"/>
  <meta name="writerGitCommit" content=""/>
  <meta name="timestamp" content="0"/>
  <meta name="annotationId" content="a"/>
  <meta name="username" content=""/>
  <parameters>
    <experiment name="ds" organization="org" datasetId="d" description="" wkUrl="http://x"/>
    <scale x="-1" y="-1" z="-1"/>
    <offset x="0" y="0" z="0"/>
    <time ms="8"/>
    <editPosition x="0" y="0" z="0"/>
    <editRotation xRot="0.0" yRot="0.0" zRot="0.0"/>
    <zoomLevel zoom="1.0"/>
  </parameters>
  <volume id="0" name="Volume" largestSegmentId="0" mappingName="m"><!--Note that volume data was omitted when downloading this annotation.-->
    <segments/>
    <groups/>
  </volume>
</things>"#;

    #[test]
    fn skipped_volume_data_writes_comment_and_no_location() {
        let volume = VolumeTracing {
            largest_segment_id: Some(0),
            mapping_name: Some("m".to_owned()),
            mapping_is_locked: Some(false),
            ..minimal_volume()
        };
        let input = NmlWriteInput {
            annotation: Some(NmlAnnotation {
                id: "a",
                description: "",
                has_task: false,
            }),
            skip_volume_data: true,
            ..base_input(vec![volume_layer("v", "Volume", &volume)])
        };
        assert_eq!(write_nml(&input).unwrap(), GOLDEN_SKIPPED_VOLUME);
    }

    #[test]
    fn single_volume_location_has_no_index() {
        let volume = minimal_volume();
        let input = base_input(vec![volume_layer("v", "Volume", &volume)]);
        let nml = write_nml(&input).unwrap();
        assert!(
            nml.contains(
                r#"<volume id="0" name="Volume" location="data_Volume.zip" format="wkw">"#
            )
        );
    }

    // -----------------------------------------------------------------------
    // User state precedence

    #[test]
    fn requesting_user_annotation_state_wins_over_owner() {
        let skeleton = SkeletonTracing {
            active_node_id: Some(5),
            user_states: vec![SkeletonUserStateProto {
                user_id: "owner".to_owned(),
                active_node_id: None,
                ..Default::default()
            }],
            ..minimal_skeleton()
        };
        let states = vec![
            AnnotationUserStateProto {
                user_id: "owner".to_owned(),
                edit_position: v3(1, 1, 1),
                zoom_level: 3.0,
                ..Default::default()
            },
            AnnotationUserStateProto {
                user_id: "viewer".to_owned(),
                edit_position: v3(2, 2, 2),
                zoom_level: 4.0,
                ..Default::default()
            },
        ];
        let mut input = NmlWriteInput {
            annotation_user_states: &states,
            requesting_user_id: Some("viewer"),
            ..base_input(vec![skeleton_layer("s", &skeleton)])
        };
        let nml = write_nml(&input).unwrap();
        assert!(nml.contains(r#"<editPosition x="2" y="2" z="2"/>"#));
        assert!(nml.contains(r#"<zoomLevel zoom="4.0"/>"#));
        // Neither user state has an active node: the stored one is used.
        assert!(nml.contains(r#"<activeNode id="5"/>"#));

        // Compound downloads pass no requesting user: the owner's state applies.
        input.requesting_user_id = None;
        let nml = write_nml(&input).unwrap();
        assert!(nml.contains(r#"<editPosition x="1" y="1" z="1"/>"#));
        assert!(nml.contains(r#"<zoomLevel zoom="3.0"/>"#));
    }

    // -----------------------------------------------------------------------
    // Errors

    #[test]
    fn rejects_scala_failure_cases() {
        let skeleton = minimal_skeleton();
        let volume = minimal_volume();
        let two_skeletons = base_input(vec![
            skeleton_layer("a", &skeleton),
            skeleton_layer("b", &skeleton),
        ]);
        assert_eq!(
            write_nml(&two_skeletons),
            Err(NmlWriteError::MultipleSkeletons)
        );
        let named_volumes = NmlWriteInput {
            volume_filename: Some("x.zip"),
            ..base_input(vec![
                volume_layer("a", "A", &volume),
                volume_layer("b", "B", &volume),
            ])
        };
        assert_eq!(
            write_nml(&named_volumes),
            Err(NmlWriteError::VolumeNameForMultiple)
        );
        assert_eq!(write_nml(&base_input(vec![])), Err(NmlWriteError::NoLayers));
        assert_eq!(
            NmlWriteError::NoLayers.to_string(),
            "Cannot download annotation that has no layers."
        );
    }

    #[test]
    fn control_characters_fail_like_woodstox() {
        let skeleton = minimal_skeleton();
        let input = NmlWriteInput {
            dataset_name: "a\u{1}b",
            ..base_input(vec![skeleton_layer("s", &skeleton)])
        };
        let error = write_nml(&input).unwrap_err();
        assert_eq!(error, NmlWriteError::InvalidCharacter('\u{1}'));
        assert_eq!(
            error.to_string(),
            "Invalid white space character (0x1) in text to output"
        );
        assert_eq!(
            NmlWriteError::InvalidCharacter('\0').to_string(),
            "Invalid null character in text to output"
        );
    }

    // -----------------------------------------------------------------------
    // Serializer primitives (outputs verified with Woodstox 7.2.2 + txw2 4.0.9)

    #[test]
    fn attribute_escaping_matches_woodstox() {
        let mut w = XmlWriter::default();
        w.start("a");
        w.attr(
            "x",
            "a&b<c>d\"e'f\tg\nh\ri\u{7f}j\u{85}k\u{2028}l\u{e9}m]]>n\u{fffd}\u{fffe}\u{ffff}\u{1f600}",
        )
        .unwrap();
        w.end();
        assert_eq!(
            w.finish(),
            "<a x=\"a&amp;b&lt;c>d&quot;e'f&#x9;g&#xa;h&#xd;i\u{7f}j\u{85}k\u{2028}l\u{e9}m]]>n\u{fffd}&#xfffe;&#xffff;\u{1f600}\"/>"
        );
    }

    #[test]
    fn comment_without_children_closes_inline() {
        let mut w = XmlWriter::default();
        w.start("things");
        w.start("volume");
        w.attr("id", "1").unwrap();
        w.comment("Note");
        w.end();
        w.start("branchpoints");
        w.end();
        w.end();
        assert_eq!(
            w.finish(),
            "<things>\n  <volume id=\"1\"><!--Note--></volume>\n  <branchpoints/>\n</things>"
        );
    }

    #[test]
    fn zip_entry_names() {
        assert_eq!(volume_data_zip_name("Volume", 0, true), "data_Volume.zip");
        assert_eq!(
            volume_data_zip_name("Seg Ids", 2, false),
            "data_2_Seg Ids.zip"
        );
        assert_eq!(
            edited_mapping_edges_zip_name("Volume", 0, true),
            "editedMappingEdges_Volume.zip"
        );
        assert_eq!(
            edited_mapping_edges_zip_name("V", 1, false),
            "editedMappingEdges_1_V.zip"
        );
        assert_eq!(
            VolumeDataZipFormat::parse("zarr3"),
            Some(VolumeDataZipFormat::Zarr3)
        );
        assert_eq!(VolumeDataZipFormat::parse("WKW"), None);
        assert_eq!(VolumeDataZipFormat::default().as_str(), "wkw");
    }

    // -----------------------------------------------------------------------
    // Java number formatting (expected values printed by JDK 25)

    #[test]
    fn java_double_matches_jdk() {
        let cases: &[(u64, &str)] = &[
            (0x0000000000000000, "0.0"),
            (0x8000000000000000, "-0.0"),
            (0x7ff8000000000000, "NaN"),
            (0x7ff0000000000000, "Infinity"),
            (0xfff0000000000000, "-Infinity"),
            (0x3ff0000000000000, "1.0"),
            (0x4059000000000000, "100.0"),
            (0x3fb999999999999a, "0.1"),
            (0x3fd3333333333333, "0.3"),
            (0x40267ae147ae147b, "11.24"),
            (0x416312cfe0000000, "9999999.0"),
            (0x416312d000000000, "1.0E7"),
            (0x3f50624dd2f1a9fc, "0.001"),
            (0x3f50624dd2f1a9fd, "0.0010000000000000002"),
            (0x3f505e1c15097c81, "9.99E-4"),
            (0x3eb0c6f7a0b5ed8d, "1.0E-6"),
            (0x41cdcd6500000000, "1.0E9"),
            (0x419d6f3454000000, "1.23456789E8"),
            (0x43b0000000000000, "1.152921504606847E18"),
            (0x44b52d02c7e14af6, "1.0E23"),
            (0x44fe6f5e3bf0a0ea, "2.2996059738193315E24"),
            (0x7fefffffffffffff, "1.7976931348623157E308"),
            (0x0010000000000000, "2.2250738585072014E-308"),
            // Subnormals: Java considers 2-digit decimals when 1 digit suffices.
            (0x0000000000000001, "4.9E-324"),
            (0x0000000000000003, "1.5E-323"),
            (0x0000000000000004, "2.0E-323"),
            (0xbcf8458ba596ec65, "-5.3893916199999995E-15"),
            // Exact ties between two shortest candidates: even digit wins.
            (0xc31441f233f63165, "-1.4255020109691772E15"),
            (0x42ed77659b24d624, "2.5918914384043312E14"),
        ];
        for (bits, expected) in cases {
            assert_eq!(java_double(f64::from_bits(*bits)), *expected, "{bits:#x}");
        }
    }

    #[test]
    fn java_float_matches_jdk() {
        let cases: &[(u32, &str)] = &[
            (0x00000000, "0.0"),
            (0x80000000, "-0.0"),
            (0x7fc00000, "NaN"),
            (0xff800000, "-Infinity"),
            (0x42f00000, "120.0"),
            (0x3fc00000, "1.5"),
            (0x3dcccccd, "0.1"),
            (0x3a83126f, "0.001"),
            (0x3a7ba882, "9.6E-4"),
            (0x4b800000, "1.6777216E7"),
            (0x4b800001, "1.6777218E7"),
            (0x7f7fffff, "3.4028235E38"),
            (0x00000001, "1.4E-45"),
            // Ties: even digit wins.
            (0xc8bf0f24, "-391289.12"),
            (0x45d85c40, "6923.5312"),
        ];
        for (bits, expected) in cases {
            assert_eq!(java_float(f32::from_bits(*bits)), *expected, "{bits:#x}");
        }
    }

    #[test]
    fn uint64_fields_print_as_signed_long() {
        assert_eq!(java_long_from_u64(0), "0");
        assert_eq!(java_long_from_u64(i64::MAX as u64), "9223372036854775807");
        assert_eq!(java_long_from_u64(u64::MAX), "-1");
    }
}
