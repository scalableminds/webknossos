package models.annotation.nml

import com.scalableminds.webknossos.datastore.AnnotationBookmark.AnnotationBookmarkProto
import com.scalableminds.webknossos.tracingstore.annotation.BookmarkThumbnailSize

// A bookmark state refers to layers by name: dataset layers by their name, annotation layers by their tracingId.
// Editable mappings are named after the tracingId of their volume layer. TracingIds are not stable across download
// and upload, so the NML refers to annotation layers by their NML name instead (volumeLayer="…").
sealed trait NmlAnnotationLayerRef
case class NmlVolumeLayerRef(name: String) extends NmlAnnotationLayerRef
case object NmlSkeletonLayerRef extends NmlAnnotationLayerRef

object NmlAnnotationLayerRef {
  // Between parsing and upload (and before writing), references to annotation layers are encoded into the layer and
  // mapping name fields of the bookmark proto. XML attribute values cannot contain the NUL character, so the encoded
  // references cannot collide with the names of dataset layers or mappings.
  private val prefix = "\u0000"
  private val volumePrefix = s"${prefix}volume:"
  private val skeletonEncoded = s"${prefix}skeleton"

  def encode(ref: NmlAnnotationLayerRef): String = ref match {
    case NmlVolumeLayerRef(name) => volumePrefix + name
    case NmlSkeletonLayerRef     => skeletonEncoded
  }

  def decode(layerOrMappingName: String): Option[NmlAnnotationLayerRef] =
    if (layerOrMappingName.startsWith(volumePrefix)) Some(NmlVolumeLayerRef(layerOrMappingName.drop(volumePrefix.length)))
    else if (layerOrMappingName == skeletonEncoded) Some(NmlSkeletonLayerRef)
    else None
}

object NmlBookmarks {
  // Applies the functions to all layer and mapping names of the bookmark state. References mapped to None are dropped,
  // together with what depends on them (e.g. the settings of a dropped layer, or a mesh of a dropped mapping).
  def rewriteLayerReferences(
      bookmark: AnnotationBookmarkProto,
      layerName: String => Option[String],
      mappingName: String => Option[String]
  ): AnnotationBookmarkProto = {
    val state = bookmark.state
    val layers = state.layers.flatMap { layer =>
      layerName(layer.layerName).map { newLayerName =>
        layer.copy(
          layerName = newLayerName,
          mapping = layer.mapping.flatMap(mapping => mappingName(mapping.mappingName).map(mapping.withMappingName)),
          meshes = layer.meshes.flatMap(mesh =>
            mesh.mappingName match {
              case Some(meshMappingName) => mappingName(meshMappingName).map(mesh.withMappingName)
              case None                  => Some(mesh)
            }
          )
        )
      }
    }
    bookmark.withState(
      state.copy(nativelyRenderedLayerName = state.nativelyRenderedLayerName.flatMap(layerName), layers = layers)
    )
  }

  def thumbnailLocation(bookmarkId: Int, size: BookmarkThumbnailSize.Value): String =
    s"bookmark_thumbnails/${bookmarkId}_$size.webp"

  // WebP files start with "RIFF", four bytes of file size, and "WEBP".
  def isWebp(bytes: Array[Byte]): Boolean =
    bytes.length >= 12 &&
      new String(bytes.slice(0, 4), "US-ASCII") == "RIFF" &&
      new String(bytes.slice(8, 12), "US-ASCII") == "WEBP"
}

// A bookmark to be written to an NML, with the thumbnails that go next to it in the zip.
case class NmlBookmarkToWrite(
    bookmark: AnnotationBookmarkProto,
    thumbnails: Map[BookmarkThumbnailSize.Value, Array[Byte]]
)

// A bookmark parsed from an NML. Its references to annotation layers are encoded (see NmlAnnotationLayerRef), and its
// createdAtVersion and thumbnailVersion are not set yet. The thumbnail locations are paths of other files in the
// uploaded zip.
case class NmlParsedBookmark(
    bookmark: AnnotationBookmarkProto,
    thumbnailLocations: Map[BookmarkThumbnailSize.Value, String]
)
