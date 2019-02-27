package com.scalableminds.util.geometry

import play.api.libs.json._

case class Scale(x: Float, y: Float, z: Float) {

  def isValid: Boolean =
    x > 0 && y > 0 && z > 0

  override def toString() =
    s"($x, $y, $z)"

  def toVector: Vector3D = Vector3D(x, y, z)
}

object Scale {
  val comp = "\\s*([0-9]+(?:\\.[0-9]+)?)"
  val formRx = s"$comp,$comp,$comp\\s*".r

  val scaleReads =
    (__.read[List[Float]]).filter(_.size >= 3).map { l =>
      Scale(l(0), l(1), l(2))
    }

  val scaleWrites: Writes[Scale] =
    Writes { s: Scale =>
      JsArray(List(JsNumber(s.x), JsNumber(s.y), JsNumber(s.z)))
    }

  implicit val scaleFormat = Format(scaleReads, scaleWrites)

  def default = Scale(0, 0, 0)

  def toForm(s: Scale) = Some(s"${s.x}, ${s.y}, ${s.z}")

  def fromForm(s: String) =
    s match {
      case formRx(x, y, z) =>
        Scale(java.lang.Float.parseFloat(x), java.lang.Float.parseFloat(y), java.lang.Float.parseFloat(z))
      case _ =>
        null
    }

  def fromArray[T <% Float](array: Array[T]) =
    if (array.size >= 3)
      Some(Scale(array(0), array(1), array(2)))
    else
      None

  def fromList(l: List[Float]) =
    fromArray(l.toArray)

}
