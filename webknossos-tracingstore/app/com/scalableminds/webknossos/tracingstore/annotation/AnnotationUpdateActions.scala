package com.scalableminds.webknossos.tracingstore.annotation

import com.scalableminds.webknossos.datastore.models.annotation.AnnotationLayerType.AnnotationLayerType
import play.api.libs.json.{Json, OFormat}

trait AnnotationUpdateAction extends UpdateAction

case class AddLayerAnnotationUpdateAction(layerName: String,
                                          tracingId: String,
                                          `type`: AnnotationLayerType,
                                          actionTimestamp: Option[Long] = None,
                                          actionAuthorId: Option[String] = None,
                                          info: Option[String] = None)
    extends AnnotationUpdateAction {
  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[String]): UpdateAction =
    this.copy(actionAuthorId = authorId)
}

case class DeleteLayerAnnotationUpdateAction(tracingId: String,
                                             layerName: String, // Just stored for nicer-looking history
                                             `type`: AnnotationLayerType, // Just stored for nicer-looking history
                                             actionTimestamp: Option[Long] = None,
                                             actionAuthorId: Option[String] = None,
                                             info: Option[String] = None)
    extends AnnotationUpdateAction {
  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[String]): UpdateAction =
    this.copy(actionAuthorId = authorId)
}

case class UpdateLayerMetadataAnnotationUpdateAction(tracingId: String,
                                                     layerName: String, // Just stored for nicer-looking history
                                                     actionTimestamp: Option[Long] = None,
                                                     actionAuthorId: Option[String] = None,
                                                     info: Option[String] = None)
    extends AnnotationUpdateAction {
  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[String]): UpdateAction =
    this.copy(actionAuthorId = authorId)
}

case class UpdateMetadataAnnotationUpdateAction(name: Option[String],
                                                description: Option[String],
                                                actionTimestamp: Option[Long] = None,
                                                actionAuthorId: Option[String] = None,
                                                info: Option[String] = None)
    extends AnnotationUpdateAction {
  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[String]): UpdateAction =
    this.copy(actionAuthorId = authorId)
}

case class RevertToVersionUpdateAction(sourceVersion: Long,
                                       actionTimestamp: Option[Long] = None,
                                       actionAuthorId: Option[String] = None,
                                       info: Option[String] = None)
    extends AnnotationUpdateAction {
  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[String]): UpdateAction =
    this.copy(actionAuthorId = authorId)
}

object AddLayerAnnotationUpdateAction {
  implicit val jsonFormat: OFormat[AddLayerAnnotationUpdateAction] = Json.format[AddLayerAnnotationUpdateAction]
}
object DeleteLayerAnnotationUpdateAction {
  implicit val jsonFormat: OFormat[DeleteLayerAnnotationUpdateAction] = Json.format[DeleteLayerAnnotationUpdateAction]
}
object UpdateLayerMetadataAnnotationUpdateAction {
  implicit val jsonFormat: OFormat[UpdateLayerMetadataAnnotationUpdateAction] =
    Json.format[UpdateLayerMetadataAnnotationUpdateAction]
}
object UpdateMetadataAnnotationUpdateAction {
  implicit val jsonFormat: OFormat[UpdateMetadataAnnotationUpdateAction] =
    Json.format[UpdateMetadataAnnotationUpdateAction]
}
object RevertToVersionUpdateAction {
  implicit val jsonFormat: OFormat[RevertToVersionUpdateAction] =
    Json.format[RevertToVersionUpdateAction]
}
