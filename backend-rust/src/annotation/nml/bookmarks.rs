//! Annotation bookmarks in NMLs (`app/models/annotation/nml/NmlAnnotationBookmarks.scala`).
//!
//! A bookmark state refers to layers by name: dataset layers by their name, annotation layers by
//! their tracingId. Editable mappings are named after the tracingId of their volume layer.
//! TracingIds are not stable across download and upload, so the NML refers to annotation layers
//! by their NML name instead (`volumeLayer="…"`).

use std::collections::BTreeMap;

use crate::proto::datastore::AnnotationBookmarkProto;
use crate::proto::datastore::annotation_bookmark_proto::ThumbnailViewportProto;

/// `BookmarkThumbnailSize` (ExtendedEnumeration `large, small`; the declaration order is the
/// order of `values` and of the ids the writer sorts by).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum BookmarkThumbnailSize {
    Large,
    Small,
}

impl BookmarkThumbnailSize {
    pub const VALUES: [Self; 2] = [Self::Large, Self::Small];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Large => "large",
            Self::Small => "small",
        }
    }

    /// `ExtendedEnumeration.fromString` (exact match).
    pub fn from_name(name: &str) -> Option<Self> {
        Self::VALUES.into_iter().find(|size| size.as_str() == name)
    }
}

/// A reference to an annotation layer in an NML (`NmlAnnotationLayerRef`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NmlAnnotationLayerRef {
    Volume(String),
    Skeleton,
}

// Between parsing and upload (and before writing), references to annotation layers are encoded
// into the layer and mapping name fields of the bookmark proto. XML attribute values cannot
// contain the NUL character, so the encoded references cannot collide with the names of dataset
// layers or mappings.
const VOLUME_PREFIX: &str = "\u{0}volume:";
const SKELETON_ENCODED: &str = "\u{0}skeleton";

impl NmlAnnotationLayerRef {
    pub fn encode(&self) -> String {
        match self {
            Self::Volume(name) => format!("{VOLUME_PREFIX}{name}"),
            Self::Skeleton => SKELETON_ENCODED.to_owned(),
        }
    }

    pub fn decode(layer_or_mapping_name: &str) -> Option<Self> {
        if let Some(name) = layer_or_mapping_name.strip_prefix(VOLUME_PREFIX) {
            Some(Self::Volume(name.to_owned()))
        } else if layer_or_mapping_name == SKELETON_ENCODED {
            Some(Self::Skeleton)
        } else {
            None
        }
    }
}

/// `NmlAnnotationBookmarks.rewriteLayerReferences`: applies the functions to all layer and
/// mapping names of the bookmark state. References mapped to `None` are dropped, together with
/// what depends on them (e.g. the settings of a dropped layer, or a mesh of a dropped mapping).
pub fn rewrite_layer_references(
    mut bookmark: AnnotationBookmarkProto,
    layer_name: impl Fn(&str) -> Option<String>,
    mapping_name: impl Fn(&str) -> Option<String>,
) -> AnnotationBookmarkProto {
    let state = &mut bookmark.state;
    state.layers = std::mem::take(&mut state.layers)
        .into_iter()
        .filter_map(|mut layer| {
            layer.layer_name = layer_name(&layer.layer_name)?;
            layer.mapping = layer.mapping.and_then(|mut mapping| {
                mapping.mapping_name = mapping_name(&mapping.mapping_name)?;
                Some(mapping)
            });
            layer.meshes = std::mem::take(&mut layer.meshes)
                .into_iter()
                .filter_map(|mut mesh| {
                    if let Some(mesh_mapping_name) = &mesh.mapping_name {
                        mesh.mapping_name = Some(mapping_name(mesh_mapping_name)?);
                    }
                    Some(mesh)
                })
                .collect();
            Some(layer)
        })
        .collect();
    state.natively_rendered_layer_name = state
        .natively_rendered_layer_name
        .as_deref()
        .and_then(&layer_name);
    bookmark
}

const THUMBNAIL_VIEWPORT_NAMES: [(ThumbnailViewportProto, &str); 5] = [
    (ThumbnailViewportProto::Xy, "xy"),
    (ThumbnailViewportProto::Yz, "yz"),
    (ThumbnailViewportProto::Xz, "xz"),
    (ThumbnailViewportProto::Td, "3d"),
    (ThumbnailViewportProto::Flight, "flight"),
];

/// `thumbnailViewportToString`. Values ScalaPB would not recognize are never written (prost
/// keeps them as raw integers).
pub fn thumbnail_viewport_to_string(viewport: i32) -> Option<&'static str> {
    THUMBNAIL_VIEWPORT_NAMES
        .iter()
        .find(|(proto, _)| *proto as i32 == viewport)
        .map(|(_, name)| *name)
}

/// `thumbnailViewportFromString`.
pub fn thumbnail_viewport_from_string(name: &str) -> Option<ThumbnailViewportProto> {
    THUMBNAIL_VIEWPORT_NAMES
        .iter()
        .find(|(_, viewport_name)| *viewport_name == name)
        .map(|(proto, _)| *proto)
}

/// `thumbnailLocation`: path of the thumbnail in the downloaded zip.
pub fn thumbnail_location(bookmark_id: i32, size: BookmarkThumbnailSize) -> String {
    format!("bookmark_thumbnails/{bookmark_id}_{}.jpg", size.as_str())
}

/// `isJpeg`: JPEG files start with the SOI marker FF D8, followed by the first marker segment
/// (FF xx).
pub fn is_jpeg(bytes: &[u8]) -> bool {
    bytes.len() >= 3 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff
}

/// `NmlAnnotationBookmarkToWrite`: a bookmark to be written to an NML, with the thumbnails that
/// go next to it in the zip.
#[derive(Debug, Clone, PartialEq)]
pub struct NmlAnnotationBookmarkToWrite {
    pub bookmark: AnnotationBookmarkProto,
    pub thumbnails: BTreeMap<BookmarkThumbnailSize, Vec<u8>>,
}

/// `NmlParsedAnnotationBookmark`: a bookmark parsed from an NML. Its references to annotation
/// layers are encoded (see [`NmlAnnotationLayerRef`]), and its `createdAtVersion` and
/// `thumbnailSavedAtVersion` are not set yet. The thumbnail locations are paths of other files in
/// the uploaded zip.
#[derive(Debug, Clone, PartialEq)]
pub struct NmlParsedAnnotationBookmark {
    pub bookmark: AnnotationBookmarkProto,
    pub thumbnail_locations: BTreeMap<BookmarkThumbnailSize, String>,
}

#[cfg(test)]
mod annotation_bookmarks_tests;
