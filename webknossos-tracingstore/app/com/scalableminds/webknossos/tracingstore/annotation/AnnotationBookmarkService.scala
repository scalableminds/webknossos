package com.scalableminds.webknossos.tracingstore.annotation

import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.Annotation.AnnotationProto
import com.scalableminds.webknossos.datastore.AnnotationBookmark.{
  AnnotationBookmarkProto,
  AnnotationBookmarkStateProto,
  BookmarkLayerStateProto,
  BookmarkMeshProto,
  UploadedAnnotationBookmarkProto
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

// How the tracing references of bookmarks (annotation layer names, editable mapping names and segment ids) map
// into another annotation. References to editable mappings that do not exist there are dropped.
case class BookmarkTracingRemapping(
    tracingIdMap: Map[String, String], // all annotation layers of the source annotation
    segmentIdMapsByTracingId: Map[String, Map[Long, Long]],
    editableMappingIdMap: Map[String, String] // only editable mappings that exist in the target annotation
) {
  def apply(state: AnnotationBookmarkStateProto): AnnotationBookmarkStateProto =
    state.copy(
      nativelyRenderedLayerName = state.nativelyRenderedLayerName.map(remapLayerName),
      layers = state.layers.map(remapLayer)
    )

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

object BookmarkTracingRemapping {
  // A duplicated annotation has new tracingIds, and each editable mapping is duplicated with its volume layer.
  def forDuplicate(tracingIdMap: Map[String, String]): BookmarkTracingRemapping =
    BookmarkTracingRemapping(tracingIdMap, segmentIdMapsByTracingId = Map.empty, editableMappingIdMap = tracingIdMap)
}

// How the ids of one source annotation map into a merged annotation.
case class BookmarkMergeRemapping(
    existingNodeIds: Set[Int],
    nodeIdMap: Int => Int,
    tracingIdMap: Map[String, String], // all annotation layers of the source annotation
    segmentIdMapsByTracingId: Map[String, Map[Long, Long]],
    editableMappingIdMap: Map[String, String] // only editable mappings that exist in the merged annotation
) {
  private val tracingRemapping =
    BookmarkTracingRemapping(tracingIdMap, segmentIdMapsByTracingId, editableMappingIdMap)

  // References to things that no longer exist in the merged annotation are dropped.
  def apply(bookmark: AnnotationBookmarkProto, newId: Int): AnnotationBookmarkProto = {
    val state = tracingRemapping(bookmark.state)
    // Several volume layers of one source annotation end up in the same merged layer.
    val layers = state.layers.map(_.layerName).distinct.map { layerName =>
      val sameNameLayers = state.layers.filter(_.layerName == layerName)
      sameNameLayers.head.withMeshes(sameNameLayers.flatMap(_.meshes).distinctBy(_.segmentId))
    }
    bookmark
      .withId(newId)
      .withState(
        state.copy(
          activeNodeId = state.activeNodeId.filter(existingNodeIds.contains).map(nodeIdMap),
          layers = layers
        )
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

  // Returns the thumbnail stored at exactly the version (the bookmark's thumbnailVersion). Thumbnails stored at other
  // versions belong to other thumbnails of the bookmark, or to an earlier bookmark with the same id (e.g. before a
  // revert), or the bookmark has no thumbnail of this size. Temporary annotations have no versions.
  def findThumbnail(
      annotationId: ObjectId,
      bookmarkId: Int,
      size: BookmarkThumbnailSize.Value,
      version: Long
  )(implicit ec: ExecutionContext): Fox[Array[Byte]] =
    for {
      isTemporaryAnnotation <- temporaryTracingService.isTemporaryAnnotation(annotationId)
      thumbnail <-
        if (isTemporaryAnnotation)
          temporaryTracingService.getBookmarkThumbnail(thumbnailKey(annotationId, bookmarkId, size))
        else
          for {
            keyValuePair <- tracingDataStore.annotationBookmarkThumbnails
              .get[Array[Byte]](thumbnailKey(annotationId, bookmarkId, size), Some(version), mayBeEmpty = Some(true))(
                wrapInBox
              )
            _ <- Fox.fromBool(keyValuePair.version == version)
          } yield keyValuePair.value
    } yield thumbnail

  // Whether a thumbnail of any size is stored at exactly the version.
  def thumbnailsExist(annotationId: ObjectId, bookmarkId: Int, version: Long)(implicit
      ec: ExecutionContext
  ): Fox[Boolean] =
    for {
      thumbnailBoxes <- Fox.serialCombined(BookmarkThumbnailSize.values.toList)(size =>
        findThumbnail(annotationId, bookmarkId, size, version).shiftBox
      )
    } yield thumbnailBoxes.exists(_.isDefined)

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

  // Copies the thumbnails the bookmark shows (at its thumbnailVersion) and stores them at version.
  // Returns whether there were any.
  private def copyThumbnails(
      annotationId: ObjectId,
      bookmark: AnnotationBookmarkProto,
      newAnnotationId: ObjectId,
      newBookmarkId: Int,
      version: Long,
      toTemporaryStore: Boolean
  )(implicit ec: ExecutionContext): Fox[Boolean] =
    bookmark.thumbnailVersion match {
      case None                   => Fox.successful(false)
      case Some(thumbnailVersion) =>
        for {
          copied <- Fox.serialCombined(BookmarkThumbnailSize.values.toList) { size =>
            for {
              thumbnailBox <- findThumbnail(annotationId, bookmark.id, size, thumbnailVersion).shiftBox
              _ <- Fox.runOptional(thumbnailBox.toOption)(
                saveThumbnail(newAnnotationId, newBookmarkId, size, version, _, toTemporaryStore)
              )
            } yield thumbnailBox.isDefined
          }
        } yield copied.contains(true)
    }

  // Uploaded bookmarks are stored at version 0, like the AnnotationProto of an uploaded annotation.
  // Their thumbnails are stored at their thumbnailVersion, which is only set if there are thumbnails.
  def saveUploadedBookmarks(annotationId: ObjectId, uploadedBookmarks: Seq[UploadedAnnotationBookmarkProto])(implicit
      ec: ExecutionContext
  ): Fox[Unit] =
    for {
      _ <- saveBookmarks(annotationId, version = 0L, uploadedBookmarks.map(_.bookmark))
      _ <- Fox.serialCombined(uploadedBookmarks.toList) { uploaded =>
        val bookmark = uploaded.bookmark
        val thumbnails = Seq(
          BookmarkThumbnailSize.small -> uploaded.smallThumbnail,
          BookmarkThumbnailSize.large -> uploaded.largeThumbnail
        ).collect { case (size, Some(thumbnail)) => (size, thumbnail) }
        Fox.runOptional(bookmark.thumbnailVersion)(thumbnailVersion =>
          Fox.serialCombined(thumbnails.toList) { case (size, thumbnail) =>
            saveThumbnail(annotationId, bookmark.id, size, thumbnailVersion, thumbnail.toByteArray)
          }
        )
      }
    } yield ()

  // The duplicated bookmarks keep their thumbnailVersion, so their thumbnails are stored at it, too.
  def duplicateThumbnails(annotationId: ObjectId, newAnnotationId: ObjectId, bookmarks: Seq[AnnotationBookmarkProto])(
      implicit ec: ExecutionContext
  ): Fox[Unit] =
    for {
      _ <- Fox.serialCombined(bookmarks.toList)(bookmark =>
        Fox.runOptional(bookmark.thumbnailVersion)(thumbnailVersion =>
          copyThumbnails(
            annotationId,
            bookmark,
            newAnnotationId,
            bookmark.id,
            thumbnailVersion,
            toTemporaryStore = false
          )
        )
      )
    } yield ()

  // The merged bookmarks get dense new ids, in the order of the source annotations, and count as created
  // (with their thumbnails) at the first version of the merged annotation. Returns the new ids.
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
      mergedBookmarks <- Fox.serialCombined(sourceBookmarksWithNewIds) {
        case ((annotationId, bookmark, remapping), newId) =>
          for {
            hasThumbnails <- copyThumbnails(
              annotationId,
              bookmark,
              newAnnotationId,
              newId,
              newVersion,
              toTemporaryStore
            )
          } yield remapping(bookmark, newId)
            .withCreatedAtVersion(newVersion)
            .copy(
              thumbnailVersion = Option.when(hasThumbnails)(newVersion),
              thumbnailViewport = bookmark.thumbnailViewport.filter(_ => hasThumbnails)
            )
      }
      _ <- saveBookmarks(newAnnotationId, newVersion, mergedBookmarks, toTemporaryStore)
    } yield mergedBookmarks.map(_.id)
}
