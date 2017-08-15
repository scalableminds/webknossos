package com.scalableminds.braingames.datastore.tracings.volume

import java.util.Base64

import com.scalableminds.braingames.datastore.tracings.{UpdateAction, UpdateActionGroup}
import com.scalableminds.util.geometry.Point3D
import play.api.libs.json._

case class UpdateBucketVolumeAction(position: Point3D, bucketSize: Int, zoomStep: Int, base64Data: String) extends VolumeUpdateAction {

  lazy val data: Array[Byte] = Base64.getDecoder().decode(base64Data)

  //def applyTo(tracing: VolumeTracing): VolumeTracing = {
  //  tracing
  //}
}

object UpdateBucketVolumeAction {
  implicit val updateBucketVolumeActionFormat = Json.format[UpdateBucketVolumeAction]
}

case class UpdateTracingVolumeAction(something: Int) extends VolumeUpdateAction {
  //def applyOn(tracing: VolumeTracing): VolumeTracing = {
  //  tracing
  //}
}

object UpdateTracingVolumeAction {
  implicit val updateTracingVolumeActionFormat = Json.format[UpdateTracingVolumeAction]
}

trait VolumeUpdateAction extends UpdateAction[VolumeTracing]

object VolumeUpdateAction {

  implicit object volumeUpdateActionReads extends Reads[VolumeUpdateAction] {
    override def reads(json: JsValue): JsResult[VolumeUpdateAction] = {
      (json \ "name").validate[String].flatMap {
        case "updateBucket" => (json \ "value").validate[UpdateBucketVolumeAction]
        case "updateTracing" => (json \ "value").validate[UpdateTracingVolumeAction]
        case unknownAction: String => JsError(s"Invalid update action s'$unknownAction'")
      }
    }
  }
}

case class VolumeUpdateActionGroup(version: Long, timestamp: Long, actions: List[VolumeUpdateAction]) extends UpdateActionGroup[VolumeTracing]

object VolumeUpdateActionGroup {
  implicit val volumeUpdateActionGroupReads = Json.reads[VolumeUpdateActionGroup]
}
