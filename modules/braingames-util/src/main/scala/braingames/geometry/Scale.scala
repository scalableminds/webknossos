package braingames.geometry

import play.api.libs.json.Json
import play.api.libs.json.Writes

case class Scale(x: Float, y: Float, z: Float)

object Scale{
  implicit object ScaleWrites extends Writes[Scale]{
    def writes(s: Scale) = Json.arr(s.x, s.y, s.z)
  }
}