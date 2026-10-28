package com.scalableminds.webknossos.tracingstore.annotation

import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{JsonAutoFormat, TristateOptionJsonHelper}
import com.scalableminds.webknossos.datastore.AnnotationBookmark.AnnotationBookmarkProto
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

// The thumbnails are stored in their own column family when the update is saved
// and are stripped from the stored update action. Without thumbnails, an explicit
// thumbnailVersion points to thumbnails stored earlier (e.g. when undoing in the frontend).
trait BookmarkThumbnailUpdateAction extends BookmarkUpdateAction {
  def largeThumbnailDataBase64: Option[String]
  def smallThumbnailDataBase64: Option[String]
  def thumbnailVersion: Option[Long]

  def hasThumbnails: Boolean = largeThumbnailDataBase64.isDefined || smallThumbnailDataBase64.isDefined

  // The version whose thumbnails the bookmark shows after this action was saved at saveVersion.
  def resultingThumbnailVersion(saveVersion: Long): Long =
    if (hasThumbnails) saveVersion else thumbnailVersion.getOrElse(saveVersion)

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
    createdAtVersion: Option[Long] = None, // set by the backend when the update is saved
    thumbnailVersion: Option[Long] = None, // see BookmarkThumbnailUpdateAction
    actionTimestamp: Option[Long] = None,
    actionAuthorId: Option[ObjectId] = None,
    info: Option[String] = None
) extends BookmarkThumbnailUpdateAction derives JsonAutoFormat {
  def toProto(fallbackVersion: Long): AnnotationBookmarkProto =
    AnnotationBookmarkProto(
      id = id,
      created = created,
      name = name,
      description = description,
      state = state.toProto,
      createdAtVersion = createdAtVersion.getOrElse(fallbackVersion),
      metadata = MetadataEntry.toProtoMultiple(MetadataEntry.deduplicate(metadata)),
      thumbnailVersion = thumbnailVersion.getOrElse(fallbackVersion)
    )

  def withoutThumbnails: AddBookmarkAnnotationAction =
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
) extends BookmarkUpdateAction {
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
) extends BookmarkUpdateAction derives JsonAutoFormat {
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
    actionTimestamp: Option[Long] = None,
    actionAuthorId: Option[ObjectId] = None,
    info: Option[String] = None
) extends BookmarkThumbnailUpdateAction derives JsonAutoFormat {
  def applyOn(fallbackThumbnailVersion: Long)(bookmark: AnnotationBookmarkProto): AnnotationBookmarkProto =
    bookmark.withThumbnailVersion(thumbnailVersion.getOrElse(fallbackThumbnailVersion))

  def withoutThumbnails: UpdateBookmarkThumbnailAnnotationAction =
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
) extends BookmarkUpdateAction derives JsonAutoFormat {
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
