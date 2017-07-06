package com.scalableminds.braingames.datastore.tracings.volume

import java.util.Base64

import com.scalableminds.util.geometry.Point3D
import play.api.libs.json._

case class LabelVolumeAction(position: Point3D, cubeSize: Int, zoomStep: Int, base64Data: String) extends VolumeUpdateAction {

  val name: String = "labelVolume"

  def data: Array[Byte] = Base64.getDecoder().decode(base64Data)
}

object LabelVolumeAction {
  implicit val labelVolumeActionFormat = Json.format[LabelVolumeAction]
}

trait VolumeUpdateAction {
  def name: String
}

object VolumeUpdateAction {

  implicit object volumeTracingUpdateActionFormat extends Format[VolumeUpdateAction] {
    override def reads(json: JsValue): JsResult[VolumeUpdateAction] = {
      (json \ "action").validate[String].flatMap {
        case "labelVolume" => (json \ "value").validate[LabelVolumeAction]
        case unknownAction: String => JsError(s"Invalid update action s'$unknownAction'")
      }
    }

    override def writes(action: VolumeUpdateAction): JsValue = {
      val value = action match {
        case a: LabelVolumeAction => LabelVolumeAction.labelVolumeActionFormat.writes(a)
      }
      Json.obj("action" -> action.name, "value" -> value)
    }
  }
}
