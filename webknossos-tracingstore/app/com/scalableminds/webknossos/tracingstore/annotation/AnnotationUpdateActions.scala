package com.scalableminds.webknossos.tracingstore.annotation

import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{JsonAutoFormat, TristateOptionJsonHelper}
import com.scalableminds.webknossos.datastore.Annotation.AnnotationBookmarkProto
import com.scalableminds.webknossos.datastore.models.AdditionalCoordinate
import com.scalableminds.webknossos.datastore.models.annotation.AnnotationLayer
import com.scalableminds.webknossos.datastore.models.annotation.AnnotationLayerType.AnnotationLayerType
import com.scalableminds.webknossos.datastore.models.datasource.AdditionalAxis
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

case class AddBookmarkAnnotationAction(
    id: Int,
    created: Long,
    name: Option[String],
    description: Option[String],
    state: AnnotationBookmarkState,
    largeThumbnailDataBase64: Option[String],
    smallThumbnailDataBase64: Option[String],
    actionTimestamp: Option[Long] = None,
    actionAuthorId: Option[ObjectId] = None,
    info: Option[String] = None
) extends BookmarkUpdateAction derives JsonAutoFormat {
  def toProto: AnnotationBookmarkProto =
    AnnotationBookmarkProto(id = id, created = created, name = name, description = description, state = state.toProto)

  def thumbnails: Seq[(BookmarkThumbnailSize.Value, Array[Byte])] =
    Seq(
      BookmarkThumbnailSize.large -> largeThumbnailDataBase64,
      BookmarkThumbnailSize.small -> smallThumbnailDataBase64
    ).collect { case (size, Some(base64)) => size -> Base64.getDecoder.decode(base64) }

  // The thumbnails are stored in their own column family when the update is saved.
  def withoutThumbnails: AddBookmarkAnnotationAction =
    this.copy(largeThumbnailDataBase64 = None, smallThumbnailDataBase64 = None)

  override def addTimestamp(timestamp: Long): UpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[ObjectId]): UpdateAction = this.copy(actionAuthorId = authorId)
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
  override def addTimestamp(timestamp: Long): UpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[ObjectId]): UpdateAction = this.copy(actionAuthorId = authorId)
}

object UpdateBookmarkAnnotationAction extends TristateOptionJsonHelper {
  implicit val jsonFormat: OFormat[UpdateBookmarkAnnotationAction] =
    Json.configured(using tristateOptionParsing).format[UpdateBookmarkAnnotationAction]
}

case class DeleteBookmarkAnnotationAction(
    id: Int,
    actionTimestamp: Option[Long] = None,
    actionAuthorId: Option[ObjectId] = None,
    info: Option[String] = None
) extends BookmarkUpdateAction derives JsonAutoFormat {
  override def addTimestamp(timestamp: Long): UpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[ObjectId]): UpdateAction = this.copy(actionAuthorId = authorId)
}

case class AddLayerAnnotationAction(
    layerParameters: AnnotationLayerParameters,
    tracingId: Option[String] = None, // filled in by backend eagerly on save
    actionTimestamp: Option[Long] = None,
    actionAuthorId: Option[ObjectId] = None,
    info: Option[String] = None
) extends AnnotationUpdateAction
    with ApplyImmediatelyUpdateAction derives JsonAutoFormat {
  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[ObjectId]): UpdateAction =
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
  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[ObjectId]): UpdateAction =
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
  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[ObjectId]): UpdateAction =
    this.copy(actionAuthorId = authorId)
}

case class UpdateMetadataAnnotationAction(
    description: Option[String], // None means do not change description. Empty string means set to empty
    actionTimestamp: Option[Long] = None,
    actionAuthorId: Option[ObjectId] = None,
    info: Option[String] = None
) extends AnnotationUpdateAction
    with ApplyImmediatelyUpdateAction derives JsonAutoFormat {
  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[ObjectId]): UpdateAction =
    this.copy(actionAuthorId = authorId)
}

case class RevertToVersionAnnotationAction(
    sourceVersion: Long,
    actionTimestamp: Option[Long] = None,
    actionAuthorId: Option[ObjectId] = None,
    info: Option[String] = None
) extends AnnotationUpdateAction
    with ApplyImmediatelyUpdateAction derives JsonAutoFormat {
  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[ObjectId]): UpdateAction =
    this.copy(actionAuthorId = authorId)
}

// Used only in tasks by admin to undo the work done of the annotator
case class ResetToBaseAnnotationAction(
    actionTimestamp: Option[Long] = None,
    actionAuthorId: Option[ObjectId] = None,
    info: Option[String] = None
) extends AnnotationUpdateAction
    with ApplyImmediatelyUpdateAction derives JsonAutoFormat {
  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[ObjectId]): UpdateAction =
    this.copy(actionAuthorId = authorId)
}

case class UpdateTdCameraAnnotationAction(
    actionTimestamp: Option[Long] = None,
    actionAuthorId: Option[ObjectId] = None,
    info: Option[String] = None
) extends AnnotationUpdateAction derives JsonAutoFormat {

  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[ObjectId]): UpdateAction =
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

  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[ObjectId]): UpdateAction =
    this.copy(actionAuthorId = authorId)
  override def isViewOnlyChange: Boolean = true
}
