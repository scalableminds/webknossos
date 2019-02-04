package com.scalableminds.webknossos.tracingstore.tracings.volume

import java.util.Base64

import com.scalableminds.webknossos.tracingstore.tracings.UpdateAction.VolumeUpdateAction
import com.scalableminds.util.geometry.{Point3D, Vector3D}
import com.scalableminds.webknossos.tracingstore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.tracingstore.tracings.UpdateAction
import play.api.libs.json._

case class UpdateBucketVolumeAction(position: Point3D, cubeSize: Int, zoomStep: Int, base64Data: String, actionTimestamp: Option[Long] = None, info: Option[String] = None) extends VolumeUpdateAction {
  lazy val data: Array[Byte] = Base64.getDecoder().decode(base64Data)

  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))

  override def transformToCompact = CompactVolumeUpdateAction("updateBucket", actionTimestamp, Json.obj())
}

object UpdateBucketVolumeAction {
  implicit val updateBucketVolumeActionFormat = Json.format[UpdateBucketVolumeAction]
}

case class UpdateTracingVolumeAction(
                                      activeSegmentId: Long,
                                      editPosition: Point3D,
                                      editRotation: Vector3D,
                                      largestSegmentId: Long,
                                      zoomLevel: Double,
                                      userBoundingBox: Option[com.scalableminds.util.geometry.BoundingBox],
                                      actionTimestamp: Option[Long] = None,
                                      info: Option[String] = None
                                    ) extends VolumeUpdateAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))

  override def transformToCompact = CompactVolumeUpdateAction("updateTracing", actionTimestamp, Json.obj())
}

object UpdateTracingVolumeAction {
  implicit val updateTracingVolumeActionFormat = Json.format[UpdateTracingVolumeAction]
}

case class RevertToVersionVolumeAction(sourceVersion: Long, actionTimestamp: Option[Long] = None, info: Option[String] = None) extends VolumeUpdateAction {
  override def addTimestamp(timestamp: Long): VolumeUpdateAction = this.copy(actionTimestamp = Some(timestamp))

  override def transformToCompact = CompactVolumeUpdateAction("revertToVersion", actionTimestamp, Json.obj("sourceVersion" -> sourceVersion))
}

object RevertToVersionVolumeAction {
  implicit val revertToVersionVolumeActionFormat = Json.format[RevertToVersionVolumeAction]
}

case class CompactVolumeUpdateAction(name: String, actionTimestamp: Option[Long], value: JsObject) extends VolumeUpdateAction

object CompactVolumeUpdateAction {
  implicit object compactVolumeUpdateActionFormat extends Format[CompactVolumeUpdateAction] {
    override def reads(json: JsValue): JsResult[CompactVolumeUpdateAction] = {
      for {
        name <- (json \ "name").validate[String]
        actionTimestamp <- (json \ "value" \ "actionTimestamp").validateOpt[Long]
        value <- (json \ "value").validate[JsObject].map(_ - "actionTimestamp")
      } yield CompactVolumeUpdateAction(name, actionTimestamp, value)
    }

    override def writes(o: CompactVolumeUpdateAction): JsValue = {
      Json.obj("name" -> o.name, "value" -> (Json.obj("actionTimestamp" -> o.actionTimestamp) ++ o.value))
    }
  }
}

object VolumeUpdateAction {

  implicit object volumeUpdateActionFormat extends Format[VolumeUpdateAction] {
    override def reads(json: JsValue): JsResult[VolumeUpdateAction] = {
      (json \ "name").validate[String].flatMap {
        case "updateBucket" => (json \ "value").validate[UpdateBucketVolumeAction]
        case "updateTracing" => (json \ "value").validate[UpdateTracingVolumeAction]
        case "revertToVersion" => (json \ "value").validate[RevertToVersionVolumeAction]
        case unknownAction: String => JsError(s"Invalid update action s'$unknownAction'")
      }
    }

    override def writes(o: VolumeUpdateAction): JsValue = o match {
      case s: UpdateBucketVolumeAction => Json.obj("name" -> "updateBucket", "value" -> Json.toJson(s)(UpdateBucketVolumeAction.updateBucketVolumeActionFormat))
      case s: UpdateTracingVolumeAction => Json.obj("name" -> "updateTracing", "value" -> Json.toJson(s)(UpdateTracingVolumeAction.updateTracingVolumeActionFormat))
      case s: RevertToVersionVolumeAction => Json.obj("name" -> "revertToVersion", "value" -> Json.toJson(s)(RevertToVersionVolumeAction.revertToVersionVolumeActionFormat))
      case s: CompactVolumeUpdateAction => Json.toJson(s)(CompactVolumeUpdateAction.compactVolumeUpdateActionFormat)
    }
  }

}
