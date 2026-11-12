package com.scalableminds.webknossos.tracingstore.annotation

import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{JsonAutoFormat, TristateOptionJsonHelper}
import com.scalableminds.webknossos.datastore.AnnotationBookmark.AnnotationBookmarkProto
import com.scalableminds.webknossos.tracingstore.annotation.BookmarkThumbnailViewport.BookmarkThumbnailViewport
import com.scalableminds.webknossos.datastore.models.AdditionalCoordinate
import com.scalableminds.webknossos.datastore.models.annotation.AnnotationLayer
import com.scalableminds.webknossos.datastore.models.annotation.AnnotationLayerType.AnnotationLayerType
import com.scalableminds.webknossos.datastore.models.datasource.AdditionalAxis
import com.scalableminds.webknossos.tracingstore.tracings.MetadataEntry
import com.scalableminds.webknossos.tracingstore.tracings.volume.MagRestrictions
import play.api.libs.json.Json.WithDefaultValues
import play.api.libs.json.{Json, OFormat}

import java.util.Base64

case class AnnotationLayerParameters(
    typ: AnnotationLayerType,
    fallbackLayerName: Option[String],
    autoFallbackLayer: Boolean = false,
    mappingName: Option[String] = None,
    magRestrictions: Option[MagRestrictions],
    name: Option[String],
    additionalAxes: Option[Seq[AdditionalAxis]]
) {
  def getNameWithDefault: String = name.getOrElse(AnnotationLayer.defaultNameForType(typ))
}
object AnnotationLayerParameters {
  implicit val jsonFormat: OFormat[AnnotationLayerParameters] =
    Json.using[WithDefaultValues].format[AnnotationLayerParameters]
}

trait AnnotationUpdateAction extends UpdateAction

trait BookmarkUpdateAction extends AnnotationUpdateAction {
  def id: Int
}

// Changes an existing bookmark. Ignored if the bookmark does not exist (anymore), see TSAnnotationService.updateBookmark.
trait ApplyableBookmarkUpdateAction extends BookmarkUpdateAction {
  def applyOn(bookmark: AnnotationBookmarkProto): AnnotationBookmarkProto
}

// The thumbnails are stored in their own column family when the update is saved and are stripped from the stored
// update action. thumbnailVersion is set by the frontend: to the version of the update group if the action carries
// thumbnails, to the version of thumbnails stored earlier to reference them (e.g. when undoing), or to None if the
// bookmark has no thumbnails. The backend validates it, see thumbnailVersionError and AnnotationTransactionService.
trait BookmarkThumbnailUpdateAction extends BookmarkUpdateAction {
  def largeThumbnailDataBase64: Option[String]
  def smallThumbnailDataBase64: Option[String]
  def thumbnailVersion: Option[Long]

  def hasThumbnails: Boolean = largeThumbnailDataBase64.isDefined || smallThumbnailDataBase64.isDefined

  // The version of earlier stored thumbnails this action references, if any.
  def referencedThumbnailVersion: Option[Long] = if (hasThumbnails) None else thumbnailVersion

  // Checks that do not need to look up stored thumbnails.
  def thumbnailVersionError(saveVersion: Long): Option[String] =
    if (hasThumbnails && !thumbnailVersion.contains(saveVersion))
      Some(s"Bookmark $id carries thumbnails, so its thumbnailVersion must be $saveVersion, got $thumbnailVersion")
    else if (referencedThumbnailVersion.exists(_ >= saveVersion))
      Some(s"Bookmark $id references thumbnails of version $thumbnailVersion, which is not older than $saveVersion")
    else None

  def withoutThumbnails: BookmarkThumbnailUpdateAction

  def thumbnails: Seq[(BookmarkThumbnailSize.Value, Array[Byte])] =
    Seq(
      BookmarkThumbnailSize.large -> largeThumbnailDataBase64,
      BookmarkThumbnailSize.small -> smallThumbnailDataBase64
    ).collect { case (size, Some(base64)) => size -> Base64.getDecoder.decode(base64) }
}

case class AddBookmarkAnnotationAction(
    id: Int,
    created: Long,
    name: Option[String],
    description: Option[String],
    state: AnnotationBookmarkState,
    largeThumbnailDataBase64: Option[String],
    smallThumbnailDataBase64: Option[String],
    metadata: Option[Seq[MetadataEntry]] = None,
    createdAtVersion: Long, // set by the frontend to the version of the update group
    thumbnailVersion: Option[Long] = None, // see BookmarkThumbnailUpdateAction
    thumbnailViewport: Option[BookmarkThumbnailViewport] = None, // the viewport the thumbnails show, if known
    actionTimestamp: Option[Long] = None,
    actionAuthorId: Option[ObjectId] = None,
    info: Option[String] = None
) extends BookmarkThumbnailUpdateAction derives JsonAutoFormat {
  def toProto: AnnotationBookmarkProto =
    AnnotationBookmarkProto(
      id = id,
      created = created,
      name = name,
      description = description,
      state = state.toProto,
      createdAtVersion = createdAtVersion,
      metadata = MetadataEntry.toProtoMultiple(MetadataEntry.deduplicate(metadata)),
      thumbnailVersion = thumbnailVersion,
      thumbnailViewport = thumbnailViewport.map(BookmarkThumbnailViewport.toProto)
    )

  override def thumbnailVersionError(saveVersion: Long): Option[String] =
    if (createdAtVersion != saveVersion)
      Some(s"Bookmark $id must have createdAtVersion $saveVersion, got $createdAtVersion")
    else super.thumbnailVersionError(saveVersion)

  override def withoutThumbnails: AddBookmarkAnnotationAction =
    this.copy(largeThumbnailDataBase64 = None, smallThumbnailDataBase64 = None)

  override def withTimestamp(timestamp: Long): UpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def withInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withAuthorId(authorId: Option[ObjectId]): UpdateAction = this.copy(actionAuthorId = authorId)
}

case class UpdateBookmarkAnnotationAction(
    id: Int,
    name: Option[Option[String]], // tristate: outer None = untouched, Some(None) = clear, Some(Some(x)) = set to x.
    description: Option[
      Option[String]
    ], // tristate: outer None = untouched, Some(None) = clear, Some(Some(x)) = set to x.
    actionTimestamp: Option[Long] = None,
    actionAuthorId: Option[ObjectId] = None,
    info: Option[String] = None
) extends ApplyableBookmarkUpdateAction {
  def applyOn(bookmark: AnnotationBookmarkProto): AnnotationBookmarkProto =
    bookmark.copy(name = name.getOrElse(bookmark.name), description = description.getOrElse(bookmark.description))
  override def withTimestamp(timestamp: Long): UpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def withInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withAuthorId(authorId: Option[ObjectId]): UpdateAction = this.copy(actionAuthorId = authorId)
}

object UpdateBookmarkAnnotationAction extends TristateOptionJsonHelper {
  implicit val jsonFormat: OFormat[UpdateBookmarkAnnotationAction] =
    Json.configured(using tristateOptionParsing).format[UpdateBookmarkAnnotationAction]
}

// Replaces the view of a bookmark. Its thumbnails are replaced separately.
case class UpdateBookmarkStateAnnotationAction(
    id: Int,
    state: AnnotationBookmarkState,
    actionTimestamp: Option[Long] = None,
    actionAuthorId: Option[ObjectId] = None,
    info: Option[String] = None
) extends ApplyableBookmarkUpdateAction derives JsonAutoFormat {
  def applyOn(bookmark: AnnotationBookmarkProto): AnnotationBookmarkProto =
    bookmark.withState(state.toProto)

  override def withTimestamp(timestamp: Long): UpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def withInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withAuthorId(authorId: Option[ObjectId]): UpdateAction = this.copy(actionAuthorId = authorId)
}

// Replaces the thumbnails of a bookmark, e.g. with another viewport of its view.
case class UpdateBookmarkThumbnailAnnotationAction(
    id: Int,
    largeThumbnailDataBase64: Option[String],
    smallThumbnailDataBase64: Option[String],
    thumbnailVersion: Option[Long] = None, // see BookmarkThumbnailUpdateAction
    thumbnailViewport: Option[BookmarkThumbnailViewport] = None, // the viewport the thumbnails show, if known
    actionTimestamp: Option[Long] = None,
    actionAuthorId: Option[ObjectId] = None,
    info: Option[String] = None
) extends BookmarkThumbnailUpdateAction
    with ApplyableBookmarkUpdateAction derives JsonAutoFormat {
  def applyOn(bookmark: AnnotationBookmarkProto): AnnotationBookmarkProto =
    bookmark.copy(
      thumbnailVersion = thumbnailVersion,
      thumbnailViewport = thumbnailViewport.map(BookmarkThumbnailViewport.toProto)
    )

  override def withoutThumbnails: UpdateBookmarkThumbnailAnnotationAction =
    this.copy(largeThumbnailDataBase64 = None, smallThumbnailDataBase64 = None)

  override def withTimestamp(timestamp: Long): UpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def withInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withAuthorId(authorId: Option[ObjectId]): UpdateAction = this.copy(actionAuthorId = authorId)
}

case class UpdateMetadataOfBookmarkAnnotationAction(
    id: Int,
    upsertEntriesByKey: Seq[MetadataEntry],
    removeEntriesByKey: Seq[String],
    actionTimestamp: Option[Long] = None,
    actionAuthorId: Option[ObjectId] = None,
    info: Option[String] = None
) extends ApplyableBookmarkUpdateAction derives JsonAutoFormat {
  def applyOn(bookmark: AnnotationBookmarkProto): AnnotationBookmarkProto =
    bookmark.withMetadata(MetadataEntry.upsertAndRemove(bookmark.metadata, upsertEntriesByKey, removeEntriesByKey))
  override def withTimestamp(timestamp: Long): UpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def withInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withAuthorId(authorId: Option[ObjectId]): UpdateAction = this.copy(actionAuthorId = authorId)
}

case class DeleteBookmarkAnnotationAction(
    id: Int,
    actionTimestamp: Option[Long] = None,
    actionAuthorId: Option[ObjectId] = None,
    info: Option[String] = None
) extends BookmarkUpdateAction derives JsonAutoFormat {
  override def withTimestamp(timestamp: Long): UpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def withInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withAuthorId(authorId: Option[ObjectId]): UpdateAction = this.copy(actionAuthorId = authorId)
}

case class AddLayerAnnotationAction(
    layerParameters: AnnotationLayerParameters,
    tracingId: Option[String] = None, // filled in by backend eagerly on save
    actionTimestamp: Option[Long] = None,
    actionAuthorId: Option[ObjectId] = None,
    info: Option[String] = None
) extends AnnotationUpdateAction
    with ApplyImmediatelyUpdateAction derives JsonAutoFormat {
  override def withTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def withInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withAuthorId(authorId: Option[ObjectId]): UpdateAction =
    this.copy(actionAuthorId = authorId)
}

case class DeleteLayerAnnotationAction(
    tracingId: String,
    layerName: String, // Just stored for nicer-looking history
    typ: AnnotationLayerType, // Just stored for nicer-looking history
    actionTimestamp: Option[Long] = None,
    actionAuthorId: Option[ObjectId] = None,
    info: Option[String] = None
) extends AnnotationUpdateAction
    with ApplyImmediatelyUpdateAction derives JsonAutoFormat {
  override def withTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def withInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withAuthorId(authorId: Option[ObjectId]): UpdateAction =
    this.copy(actionAuthorId = authorId)
}

case class UpdateLayerMetadataAnnotationAction(
    tracingId: String,
    layerName: String,
    actionTimestamp: Option[Long] = None,
    actionAuthorId: Option[ObjectId] = None,
    info: Option[String] = None
) extends AnnotationUpdateAction
    with ApplyImmediatelyUpdateAction derives JsonAutoFormat {
  override def withTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def withInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withAuthorId(authorId: Option[ObjectId]): UpdateAction =
    this.copy(actionAuthorId = authorId)
}

case class UpdateMetadataAnnotationAction(
    description: Option[String], // None means do not change description. Empty string means set to empty
    actionTimestamp: Option[Long] = None,
    actionAuthorId: Option[ObjectId] = None,
    info: Option[String] = None
) extends AnnotationUpdateAction
    with ApplyImmediatelyUpdateAction derives JsonAutoFormat {
  override def withTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def withInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withAuthorId(authorId: Option[ObjectId]): UpdateAction =
    this.copy(actionAuthorId = authorId)
}

case class RevertToVersionAnnotationAction(
    sourceVersion: Long,
    actionTimestamp: Option[Long] = None,
    actionAuthorId: Option[ObjectId] = None,
    info: Option[String] = None
) extends AnnotationUpdateAction
    with ApplyImmediatelyUpdateAction derives JsonAutoFormat {
  override def withTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def withInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withAuthorId(authorId: Option[ObjectId]): UpdateAction =
    this.copy(actionAuthorId = authorId)
}

// Used only in tasks by admin to undo the work done of the annotator
case class ResetToBaseAnnotationAction(
    actionTimestamp: Option[Long] = None,
    actionAuthorId: Option[ObjectId] = None,
    info: Option[String] = None
) extends AnnotationUpdateAction
    with ApplyImmediatelyUpdateAction derives JsonAutoFormat {
  override def withTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def withInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withAuthorId(authorId: Option[ObjectId]): UpdateAction =
    this.copy(actionAuthorId = authorId)
}

case class UpdateTdCameraAnnotationAction(
    actionTimestamp: Option[Long] = None,
    actionAuthorId: Option[ObjectId] = None,
    info: Option[String] = None
) extends AnnotationUpdateAction derives JsonAutoFormat {

  override def withTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def withInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withAuthorId(authorId: Option[ObjectId]): UpdateAction =
    this.copy(actionAuthorId = authorId)

  override def isViewOnlyChange: Boolean = true
}

case class UpdateCameraAnnotationAction(
    editPosition: Vec3Int,
    editRotation: Vec3Double,
    zoomLevel: Double,
    editPositionAdditionalCoordinates: Option[Seq[AdditionalCoordinate]] = None,
    actionTimestamp: Option[Long] = None,
    actionAuthorId: Option[ObjectId] = None,
    info: Option[String] = None
) extends AnnotationUpdateAction
    with UserStateUpdateAction derives JsonAutoFormat {

  override def withTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def withInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def withAuthorId(authorId: Option[ObjectId]): UpdateAction =
    this.copy(actionAuthorId = authorId)
  override def isViewOnlyChange: Boolean = true
}
