package com.scalableminds.util.image

import com.scalableminds.util.tools.ExtendedTypes._
import play.api.libs.json.Json._
import play.api.libs.json.{Format, JsValue, _}

case class Color(r: Double, g: Double, b: Double, a: Double) {
  def toHtml = "#%02x%02x%02x".format((r * 255).toInt, (g * 255).toInt, (b * 255).toInt)
}

object Color {
  lazy val RED = Color(1, 0, 0, 1)

  def jet(value: Float) = {
    val fourValue = value / 64.0
    Color(
      math.min(fourValue - 1.5, -fourValue + 4.5).clamp(0, 1),
      math.min(fourValue - 0.5, -fourValue + 3.5).clamp(0, 1),
      math.min(fourValue + 0.5, -fourValue + 2.5).clamp(0, 1),
      1
    )
  }

  implicit object ColorFormat extends Format[Color] {

    def writes(c: Color) = if (c.a == 1) Json.arr(c.r, c.g, c.b) else Json.arr(c.r, c.g, c.b, c.a)

    def reads(json: JsValue) = json match {
      case JsArray(ts) =>
        val c = ts.map(fromJson[Float](_)).flatMap(_.asOpt)
        if (c.size != ts.size)
          JsError(Seq(JsPath() -> Seq(JsonValidationError("validate.error.array.invalidContent"))))
        else
          c.size match {
            case 3 => JsSuccess(Color(c(0), c(1), c(2), 1))
            case 4 => JsSuccess(Color(c(0), c(1), c(2), c(3)))
            case _ => JsError(Seq(JsPath() -> Seq(JsonValidationError("validate.error.array.invalidContent"))))
          }
      case _ =>
        JsError(Seq(JsPath() -> Seq(JsonValidationError("validate.error.expected.point3DArray"))))
    }
  }

}
