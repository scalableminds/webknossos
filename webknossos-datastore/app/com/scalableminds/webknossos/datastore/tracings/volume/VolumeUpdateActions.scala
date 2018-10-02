package com.scalableminds.webknossos.datastore.tracings.volume

import java.util.Base64

import com.scalableminds.webknossos.datastore.tracings.UpdateAction.VolumeUpdateAction
import com.scalableminds.util.geometry.{Point3D, Vector3D}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.tracings.UpdateAction
import play.api.libs.json._

case class UpdateBucketVolumeAction(position: Point3D, cubeSize: Int, zoomStep: Int, base64Data: String, actionTimestamp: Option[Long] = None) extends VolumeUpdateAction {
  lazy val data: Array[Byte] = Base64.getDecoder().decode(base64Data)
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
                                      actionTimestamp: Option[Long] = None
                                    ) extends VolumeUpdateAction

object UpdateTracingVolumeAction {
  implicit val updateTracingVolumeActionFormat = Json.format[UpdateTracingVolumeAction]
}

case class RevertToVersionVolumeAction(sourceVersion: Long, actionTimestamp: Option[Long] = None) extends VolumeUpdateAction

object RevertToVersionVolumeAction {
  implicit val revertToVersionVolumeAction = Json.format[RevertToVersionVolumeAction]
}

object VolumeUpdateAction {

  implicit object volumeUpdateActionFormat extends Format[UpdateAction[VolumeTracing]] {
    override def reads(json: JsValue): JsResult[VolumeUpdateAction] = {
      (json \ "name").validate[String].flatMap {
        case "updateBucket" => (json \ "value").validate[UpdateBucketVolumeAction]
        case "updateTracing" => (json \ "value").validate[UpdateTracingVolumeAction]
        case "revertToVersion" => (json \ "value").validate[RevertToVersionVolumeAction]
        case unknownAction: String => JsError(s"Invalid update action s'$unknownAction'")
      }
    }

    override def writes(o: UpdateAction[VolumeTracing]): JsValue = o match {
      case s: UpdateBucketVolumeAction => Json.obj("name" -> "updateBucket", "value" -> Json.toJson(s)(UpdateBucketVolumeAction.updateBucketVolumeActionFormat))
      case s: UpdateTracingVolumeAction => Json.obj("name" -> "updateTracing", "value" -> Json.toJson(s)(UpdateTracingVolumeAction.updateTracingVolumeActionFormat))
      case s: RevertToVersionVolumeAction => Json.obj("name" -> "revertToVersion", "value" -> Json.toJson(s)(RevertToVersionVolumeAction.revertToVersionVolumeAction))
    }
  }

}
