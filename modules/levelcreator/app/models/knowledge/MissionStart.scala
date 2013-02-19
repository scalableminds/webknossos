package models.knowledge

import brainflight.tools.geometry._
import play.api.libs.functional.syntax._
import play.api.libs.json._

case class MissionStart(
  position: Point3D,
  direction: Vector3D,
  startId: Int,
  centerOfMass: Point3D)

object MissionStart {
  implicit val MissionStartFormat: Format[MissionStart] = (
    (__ \ "position").format[Point3D] and
    (__ \ "direction").format[Vector3D] and
    (__ \ "id").format[Int] and
    (__ \ "center").format[Point3D])(MissionStart.apply, unlift(MissionStart.unapply))
}