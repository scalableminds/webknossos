package com.scalableminds.braingames.datastore.tracings.volume

import java.util.Base64

import com.scalableminds.util.geometry.Point3D
import play.api.libs.json._

case class UpdateBucketVolumeAction(position: Point3D, bucketSize: Int, zoomStep: Int, base64Data: String) extends VolumeUpdateAction {
  def data: Array[Byte] = Base64.getDecoder().decode(base64Data)

  def applyOn(tracing: VolumeTracing): VolumeTracing = {
    tracing
  }
}

object UpdateBucketVolumeAction {
  implicit val updateBucketVolumeActionFormat = Json.format[UpdateBucketVolumeAction]
}

case class UpdateTracingVolumeAction() extends VolumeUpdateAction {

  def applyOn(tracing: VolumeTracing): VolumeTracing = {
    tracing
  }
}

object UpdateTracingVolumeAction {
  implicit val updateTracingVolumeActionFormat = Json.format[UpdateTracingVolumeAction]
}

trait VolumeUpdateAction {
  def applyOn(tracing: VolumeTracing): VolumeTracing
}

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
