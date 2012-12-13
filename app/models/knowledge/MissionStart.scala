package models.knowledge

import brainflight.tools.geometry._
import play.api.libs.json.JsValue
import play.api.libs.json.Reads

case class MissionStart(
  position: Point3D,
  direction: Vector3D,
  startId: Int,
  centerOfMass: Point3D)

object MissionStart {
  implicit object MissionStartReads extends Reads[MissionStart] {
    val POSITION = "position"
    val DIRECTION = "direction"
    val ID = "id"
    val CENTER = "center"

    def reads(js: JsValue) =
      MissionStart(
        (js \ POSITION).as[Point3D],
        (js \ DIRECTION).as[Vector3D],
        (js \ ID).as[Int],
        (js \ CENTER).as[Point3D])
  }
}