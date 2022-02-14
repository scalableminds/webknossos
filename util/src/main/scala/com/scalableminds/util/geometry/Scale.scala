package com.scalableminds.util.geometry

import play.api.libs.json._

case class Scale(x: Float, y: Float, z: Float) {

  def isValid: Boolean =
    x > 0 && y > 0 && z > 0

  override def toString =
    s"($x, $y, $z)"

  def toVector: Vec3Double = Vec3Double(x, y, z)
}

object Scale {
  private val comp = "\\s*([0-9]+(?:\\.[0-9]+)?)"
  private val formRx = s"$comp,$comp,$comp\\s*".r

  val scaleReads: Reads[Scale] =
    (__.read[List[Float]]).filter(_.size >= 3).map { l =>
      Scale(l(0), l(1), l(2))
    }

  val scaleWrites: Writes[Scale] =
    Writes { s: Scale =>
      JsArray(List(JsNumber(s.x), JsNumber(s.y), JsNumber(s.z)))
    }

  implicit val scaleFormat: Format[Scale] = Format(scaleReads, scaleWrites)

  def default: Scale = Scale(0, 0, 0)

  def fromList(l: List[Float]): Option[Scale] =
    if (l.length >= 3)
      Some(Scale(l(0), l(1), l(2)))
    else
      None

}
