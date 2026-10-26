package com.scalableminds.webknossos.tracingstore.annotation

import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.AnnotationBookmark.AnnotationBookmarkProto
import com.scalableminds.webknossos.tracingstore.tracings.{
  FossilDBPutBuffer,
  KeyValueStoreConversions,
  TracingDataStore
}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

object BookmarkThumbnailSize extends ExtendedEnumeration {
  type BookmarkThumbnailSize = Value
  val large, small = Value
}

// Bookmarks are stored outside of the AnnotationProto, which only holds their ids. Like skeleton tree bodies,
// a bookmark is only written in the versions where it changed. Thumbnails never change and are stored separately.
class AnnotationBookmarkService @Inject() (tracingDataStore: TracingDataStore) extends KeyValueStoreConversions {

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
        keyValuePairBoxes <- tracingDataStore.annotationBookmarks.getMultipleKeysByList[AnnotationBookmarkProto](
          bookmarkIds.map(bookmarkKey(annotationId, _)),
          Some(version)
        )(fromProtoBytes[AnnotationBookmarkProto])
        bookmarks <- Fox.serialCombined(keyValuePairBoxes)(_.toFox.map(_.value))
      } yield bookmarks

  def saveBookmarks(annotationId: ObjectId, version: Long, bookmarks: Iterable[AnnotationBookmarkProto])(implicit
      ec: ExecutionContext
  ): Fox[Unit] = {
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
    tracingDataStore.annotationBookmarkThumbnails
      .get[Array[Byte]](thumbnailKey(annotationId, bookmarkId, size), mayBeEmpty = Some(true))(wrapInBox)
      .map(_.value)

  def saveThumbnail(
      annotationId: ObjectId,
      bookmarkId: Int,
      size: BookmarkThumbnailSize.Value,
      version: Long,
      thumbnail: Array[Byte]
  ): Fox[Unit] =
    tracingDataStore.annotationBookmarkThumbnails.put(thumbnailKey(annotationId, bookmarkId, size), version, thumbnail)

  def duplicateThumbnails(annotationId: ObjectId, newAnnotationId: ObjectId, bookmarkIds: Seq[Int], version: Long)(
      implicit ec: ExecutionContext
  ): Fox[Unit] =
    for {
      _ <- Fox.serialCombined(bookmarkIds.flatMap(id => BookmarkThumbnailSize.values.toList.map(id -> _))) {
        case (bookmarkId, size) =>
          for {
            thumbnailBox <- findThumbnail(annotationId, bookmarkId, size).shiftBox
            _ <- Fox.runOptional(thumbnailBox.toOption)(saveThumbnail(newAnnotationId, bookmarkId, size, version, _))
          } yield ()
      }
    } yield ()
}
