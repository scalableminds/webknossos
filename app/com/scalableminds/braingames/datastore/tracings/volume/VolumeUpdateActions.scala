package com.scalableminds.braingames.datastore.tracings.volume

import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.tools.Fox
import play.api.libs.json._

case class LabelVolumeAction(position: Point3D, cubeSize: Int, zoomStep: Int, data: Array[Byte]) extends VolumeUpdateAction {
  val name: String = "labelVolume"
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
