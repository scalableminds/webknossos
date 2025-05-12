package com.scalableminds.webknossos.tracingstore.annotation

import com.scalableminds.webknossos.datastore.models.AdditionalCoordinate
import com.scalableminds.webknossos.datastore.models.annotation.AnnotationLayer
import com.scalableminds.webknossos.datastore.models.annotation.AnnotationLayerType.AnnotationLayerType
import com.scalableminds.webknossos.datastore.models.datasource.AdditionalAxis
import com.scalableminds.webknossos.tracingstore.tracings.volume.MagRestrictions
import play.api.libs.json.Json.WithDefaultValues
import play.api.libs.json.{Json, OFormat}

case class AnnotationLayerParameters(typ: AnnotationLayerType,
                                     fallbackLayerName: Option[String],
                                     autoFallbackLayer: Boolean = false,
                                     mappingName: Option[String] = None,
                                     magRestrictions: Option[MagRestrictions],
                                     name: Option[String],
                                     additionalAxes: Option[Seq[AdditionalAxis]]) {
  def getNameWithDefault: String = name.getOrElse(AnnotationLayer.defaultNameForType(typ))
}
object AnnotationLayerParameters {
  implicit val jsonFormat: OFormat[AnnotationLayerParameters] =
    Json.using[WithDefaultValues].format[AnnotationLayerParameters]
}

trait AnnotationUpdateAction extends UpdateAction

case class AddLayerAnnotationAction(layerParameters: AnnotationLayerParameters,
                                    tracingId: Option[String] = None, // filled in by backend eagerly on save
                                    actionTimestamp: Option[Long] = None,
                                    actionAuthorId: Option[String] = None,
                                    info: Option[String] = None)
    extends AnnotationUpdateAction
    with ApplyImmediatelyUpdateAction {
  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[String]): UpdateAction =
    this.copy(actionAuthorId = authorId)
}

case class DeleteLayerAnnotationAction(tracingId: String,
                                       layerName: String, // Just stored for nicer-looking history
                                       typ: AnnotationLayerType, // Just stored for nicer-looking history
                                       actionTimestamp: Option[Long] = None,
                                       actionAuthorId: Option[String] = None,
                                       info: Option[String] = None)
    extends AnnotationUpdateAction
    with ApplyImmediatelyUpdateAction {
  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[String]): UpdateAction =
    this.copy(actionAuthorId = authorId)
}

case class UpdateLayerMetadataAnnotationAction(tracingId: String,
                                               layerName: String,
                                               actionTimestamp: Option[Long] = None,
                                               actionAuthorId: Option[String] = None,
                                               info: Option[String] = None)
    extends AnnotationUpdateAction
    with ApplyImmediatelyUpdateAction {
  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[String]): UpdateAction =
    this.copy(actionAuthorId = authorId)
}

case class UpdateMetadataAnnotationAction(
    description: Option[String], // None means do not change description. Empty string means set to empty
    actionTimestamp: Option[Long] = None,
    actionAuthorId: Option[String] = None,
    info: Option[String] = None)
    extends AnnotationUpdateAction
    with ApplyImmediatelyUpdateAction {
  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[String]): UpdateAction =
    this.copy(actionAuthorId = authorId)
}

case class RevertToVersionAnnotationAction(sourceVersion: Long,
                                           actionTimestamp: Option[Long] = None,
                                           actionAuthorId: Option[String] = None,
                                           info: Option[String] = None)
    extends AnnotationUpdateAction
    with ApplyImmediatelyUpdateAction {
  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[String]): UpdateAction =
    this.copy(actionAuthorId = authorId)
}

// Used only in tasks by admin to undo the work done of the annotator
case class ResetToBaseAnnotationAction(actionTimestamp: Option[Long] = None,
                                       actionAuthorId: Option[String] = None,
                                       info: Option[String] = None)
    extends AnnotationUpdateAction
    with ApplyImmediatelyUpdateAction {
  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[String]): UpdateAction =
    this.copy(actionAuthorId = authorId)
}

case class UpdateTdCameraAnnotationAction(actionTimestamp: Option[Long] = None,
                                          actionAuthorId: Option[String] = None,
                                          info: Option[String] = None)
    extends AnnotationUpdateAction {

  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[String]): UpdateAction =
    this.copy(actionAuthorId = authorId)

  override def isViewOnlyChange: Boolean = true
}

case class UpdateCameraAnnotationAction(editPosition: com.scalableminds.util.geometry.Vec3Int,
                                        editRotation: com.scalableminds.util.geometry.Vec3Double,
                                        zoomLevel: Double,
                                        editPositionAdditionalCoordinates: Option[Seq[AdditionalCoordinate]] = None,
                                        actionTimestamp: Option[Long] = None,
                                        actionAuthorId: Option[String] = None,
                                        info: Option[String] = None)
    extends AnnotationUpdateAction
    with UserStateUpdateAction {

  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[String]): UpdateAction =
    this.copy(actionAuthorId = authorId)
  override def isViewOnlyChange: Boolean = true
}

object AddLayerAnnotationAction {
  implicit val jsonFormat: OFormat[AddLayerAnnotationAction] = Json.format[AddLayerAnnotationAction]
}
object DeleteLayerAnnotationAction {
  implicit val jsonFormat: OFormat[DeleteLayerAnnotationAction] = Json.format[DeleteLayerAnnotationAction]
}
object UpdateLayerMetadataAnnotationAction {
  implicit val jsonFormat: OFormat[UpdateLayerMetadataAnnotationAction] =
    Json.format[UpdateLayerMetadataAnnotationAction]
}
object UpdateMetadataAnnotationAction {
  implicit val jsonFormat: OFormat[UpdateMetadataAnnotationAction] =
    Json.format[UpdateMetadataAnnotationAction]
}
object RevertToVersionAnnotationAction {
  implicit val jsonFormat: OFormat[RevertToVersionAnnotationAction] =
    Json.format[RevertToVersionAnnotationAction]
}
object ResetToBaseAnnotationAction {
  implicit val jsonFormat: OFormat[ResetToBaseAnnotationAction] =
    Json.format[ResetToBaseAnnotationAction]
}
object UpdateTdCameraAnnotationAction {
  implicit val jsonFormat: OFormat[UpdateTdCameraAnnotationAction] = Json.format[UpdateTdCameraAnnotationAction]
}
object UpdateCameraAnnotationAction {
  implicit val jsonFormat: OFormat[UpdateCameraAnnotationAction] = Json.format[UpdateCameraAnnotationAction]
}
