package com.scalableminds.webknossos.tracingstore.annotation

import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.Annotation.AnnotationProto
import com.scalableminds.webknossos.datastore.AnnotationBookmark.{
  AnnotationBookmarkProto,
  BookmarkLayerStateProto,
  BookmarkMeshProto
}
import com.scalableminds.webknossos.tracingstore.tracings.{
  FossilDBPutBuffer,
  KeyValueStoreConversions,
  TemporaryTracingService,
  TracingDataStore
}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

object BookmarkThumbnailSize extends ExtendedEnumeration {
  type BookmarkThumbnailSize = Value
  val large, small = Value
}

// How the ids of one source annotation map into a merged annotation.
case class BookmarkMergeRemapping(
    existingNodeIds: Set[Int],
    nodeIdMap: Int => Int,
    tracingIdMap: Map[String, String], // all annotation layers of the source annotation
    segmentIdMapsByTracingId: Map[String, Map[Long, Long]],
    editableMappingIdMap: Map[String, String] // only editable mappings that exist in the merged annotation
) {
  // References to things that no longer exist in the merged annotation are dropped.
  def apply(bookmark: AnnotationBookmarkProto, newId: Int): AnnotationBookmarkProto = {
    val state = bookmark.state
    val remappedLayers = state.layers.map(remapLayer)
    // Several volume layers of one source annotation end up in the same merged layer.
    val layers = remappedLayers.map(_.layerName).distinct.map { layerName =>
      val sameNameLayers = remappedLayers.filter(_.layerName == layerName)
      sameNameLayers.head.withMeshes(sameNameLayers.flatMap(_.meshes).distinctBy(_.segmentId))
    }
    bookmark
      .withId(newId)
      .withState(
        state.copy(
          activeNodeId = state.activeNodeId.filter(existingNodeIds.contains).map(nodeIdMap),
          nativelyRenderedLayerName = state.nativelyRenderedLayerName.map(remapLayerName),
          layers = layers
        )
      )
  }

  private def remapLayerName(layerName: String): String = tracingIdMap.getOrElse(layerName, layerName)

  // Editable mappings are named after their volume tracingId. None if such a mapping no longer exists.
  private def remapMappingName(mappingName: String): Option[String] =
    editableMappingIdMap.get(mappingName).orElse(Option.when(!tracingIdMap.contains(mappingName))(mappingName))

  private def remapLayer(layer: BookmarkLayerStateProto): BookmarkLayerStateProto = {
    val segmentIdMap = segmentIdMapsByTracingId.getOrElse(layer.layerName, Map.empty)
    def remapMesh(mesh: BookmarkMeshProto): Option[BookmarkMeshProto] = {
      val meshWithNewSegmentId = mesh.withSegmentId(segmentIdMap.getOrElse(mesh.segmentId, mesh.segmentId))
      mesh.mappingName match {
        case Some(mappingName) => remapMappingName(mappingName).map(meshWithNewSegmentId.withMappingName)
        case None              => Some(meshWithNewSegmentId)
      }
    }
    layer.copy(
      layerName = remapLayerName(layer.layerName),
      mapping = layer.mapping.flatMap(mapping => remapMappingName(mapping.mappingName).map(mapping.withMappingName)),
      meshes = layer.meshes.flatMap(remapMesh)
    )
  }
}

// Bookmarks are stored outside of the AnnotationProto, which only holds their ids. Like skeleton tree bodies,
// a bookmark is only written in the versions where it changed. Thumbnails never change and are stored separately.
// Temporary annotations (e.g. compound annotations) keep both in the temporary store, without versions.
class AnnotationBookmarkService @Inject() (
    tracingDataStore: TracingDataStore,
    temporaryTracingService: TemporaryTracingService
) extends KeyValueStoreConversions {

  private def bookmarkKey(annotationId: ObjectId, bookmarkId: Int): String = s"$annotationId/$bookmarkId"

  def findBookmark(annotationId: ObjectId, bookmarkId: Int, version: Long): Fox[AnnotationBookmarkProto] =
    tracingDataStore.annotationBookmarks
      .get[AnnotationBookmarkProto](bookmarkKey(annotationId, bookmarkId), Some(version))(
        fromProtoBytes[AnnotationBookmarkProto]
      )
      .map(_.value)

  def findBookmarks(annotationId: ObjectId, bookmarkIds: Seq[Int], version: Long)(implicit
      ec: ExecutionContext
  ): Fox[Seq[AnnotationBookmarkProto]] =
    if (bookmarkIds.isEmpty) Fox.successful(Seq.empty)
    else
      for {
        isTemporaryAnnotation <- temporaryTracingService.isTemporaryAnnotation(annotationId)
        bookmarkKeys = bookmarkIds.map(bookmarkKey(annotationId, _))
        bookmarks <-
          if (isTemporaryAnnotation)
            Fox.serialCombined(temporaryTracingService.getBookmarks(bookmarkKeys))(_.toFox)
          else
            for {
              keyValuePairBoxes <- tracingDataStore.annotationBookmarks
                .getMultipleKeysByList[AnnotationBookmarkProto](bookmarkKeys, Some(version))(
                  fromProtoBytes[AnnotationBookmarkProto]
                )
              bookmarks <- Fox.serialCombined(keyValuePairBoxes)(_.toFox.map(_.value))
            } yield bookmarks
      } yield bookmarks

  def saveBookmarks(
      annotationId: ObjectId,
      version: Long,
      bookmarks: Iterable[AnnotationBookmarkProto],
      toTemporaryStore: Boolean = false
  )(implicit ec: ExecutionContext): Fox[Unit] =
    if (toTemporaryStore)
      temporaryTracingService.saveBookmarks(
        bookmarks.toSeq.map(bookmark => (bookmarkKey(annotationId, bookmark.id), bookmark))
      )
    else {
      val putBuffer = new FossilDBPutBuffer(tracingDataStore.annotationBookmarks, Some(version))
      for {
        _ <- Fox.serialCombined(bookmarks.toList)(bookmark =>
          putBuffer.put(bookmarkKey(annotationId, bookmark.id), bookmark.toByteArray)
        )
        _ <- putBuffer.flush()
      } yield ()
    }

  private def thumbnailKey(annotationId: ObjectId, bookmarkId: Int, size: BookmarkThumbnailSize.Value): String =
    s"${bookmarkKey(annotationId, bookmarkId)}/$size"

  def findThumbnail(annotationId: ObjectId, bookmarkId: Int, size: BookmarkThumbnailSize.Value): Fox[Array[Byte]] =
    for {
      isTemporaryAnnotation <- temporaryTracingService.isTemporaryAnnotation(annotationId)
      thumbnail <-
        if (isTemporaryAnnotation)
          temporaryTracingService.getBookmarkThumbnail(thumbnailKey(annotationId, bookmarkId, size))
        else
          tracingDataStore.annotationBookmarkThumbnails
            .get[Array[Byte]](thumbnailKey(annotationId, bookmarkId, size), mayBeEmpty = Some(true))(wrapInBox)
            .map(_.value)
    } yield thumbnail

  def saveThumbnail(
      annotationId: ObjectId,
      bookmarkId: Int,
      size: BookmarkThumbnailSize.Value,
      version: Long,
      thumbnail: Array[Byte],
      toTemporaryStore: Boolean = false
  ): Fox[Unit] =
    if (toTemporaryStore)
      temporaryTracingService.saveBookmarkThumbnail(thumbnailKey(annotationId, bookmarkId, size), thumbnail)
    else
      tracingDataStore.annotationBookmarkThumbnails.put(
        thumbnailKey(annotationId, bookmarkId, size),
        version,
        thumbnail
      )

  private def copyThumbnails(
      annotationId: ObjectId,
      bookmarkId: Int,
      newAnnotationId: ObjectId,
      newBookmarkId: Int,
      version: Long,
      toTemporaryStore: Boolean
  )(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      _ <- Fox.serialCombined(BookmarkThumbnailSize.values.toList) { size =>
        for {
          thumbnailBox <- findThumbnail(annotationId, bookmarkId, size).shiftBox
          _ <- Fox.runOptional(thumbnailBox.toOption)(
            saveThumbnail(newAnnotationId, newBookmarkId, size, version, _, toTemporaryStore)
          )
        } yield ()
      }
    } yield ()

  def duplicateThumbnails(annotationId: ObjectId, newAnnotationId: ObjectId, bookmarkIds: Seq[Int], version: Long)(
      implicit ec: ExecutionContext
  ): Fox[Unit] =
    for {
      _ <- Fox.serialCombined(bookmarkIds.toList)(bookmarkId =>
        copyThumbnails(annotationId, bookmarkId, newAnnotationId, bookmarkId, version, toTemporaryStore = false)
      )
    } yield ()

  // The merged bookmarks get dense new ids, in the order of the source annotations, and count as created
  // at the first version of the merged annotation. Returns the new ids.
  def mergeBookmarks(
      sources: Seq[(ObjectId, AnnotationProto, BookmarkMergeRemapping)],
      newAnnotationId: ObjectId,
      newVersion: Long,
      toTemporaryStore: Boolean
  )(implicit ec: ExecutionContext): Fox[Seq[Int]] =
    for {
      sourceBookmarksNested <- Fox.serialCombined(sources.toList) { case (annotationId, annotation, remapping) =>
        findBookmarks(annotationId, annotation.bookmarkIds.sorted, annotation.version).map(
          _.map(bookmark => (annotationId, bookmark, remapping))
        )
      }
      sourceBookmarksWithNewIds = sourceBookmarksNested.flatten.zipWithIndex.map { case (sourceBookmark, index) =>
        (sourceBookmark, index + 1)
      }
      mergedBookmarks = sourceBookmarksWithNewIds.map { case ((_, bookmark, remapping), newId) =>
        remapping(bookmark, newId).withCreatedAtVersion(newVersion)
      }
      _ <- saveBookmarks(newAnnotationId, newVersion, mergedBookmarks, toTemporaryStore)
      _ <- Fox.serialCombined(sourceBookmarksWithNewIds) { case ((annotationId, bookmark, _), newId) =>
        copyThumbnails(annotationId, bookmark.id, newAnnotationId, newId, newVersion, toTemporaryStore)
      }
    } yield mergedBookmarks.map(_.id)
}
