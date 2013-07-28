package braingames.geometry

import play.api.libs.json._
import play.api.libs.functional.syntax._

case class Scale(x: Float, y: Float, z: Float){
  override def toString() = {
    s"($x, $y, $z)"
  }
}

object Scale{
  val scaleReads =
    __.read[List[Float]].filter(_.size >= 3).map{ l =>
      Scale(l(0), l(1), l(2))
    }

  val scaleWrites: Writes[Scale] =
    Writes{s: Scale => JsArray(List(JsNumber(s.x), JsNumber(s.y), JsNumber(s.z)))}

  implicit val scaleFormat = Format.apply(scaleReads, scaleWrites)

  def default = Scale(12, 12, 24)
}