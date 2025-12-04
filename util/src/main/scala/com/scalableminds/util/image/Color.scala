package com.scalableminds.util.image

import com.scalableminds.util.tools.ExtendedTypes._
import com.scalableminds.util.tools.Box.tryo
import play.api.libs.json.Json._
import play.api.libs.json.{Format, JsValue, _}

case class Color(r: Double, g: Double, b: Double, a: Double) {
  def toHtml: String = "#%02x%02x%02x".format((r * 255).toInt, (g * 255).toInt, (b * 255).toInt)
  def toArrayOfInts: Array[Int] = Array((r * 255).toInt, (g * 255).toInt, (b * 255).toInt)
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

  def fromHTML(htmlCode: String): Option[Color] =
    tryo({
      val code = if (!htmlCode.startsWith("#")) s"#$htmlCode" else htmlCode
      val r = Integer.valueOf(code.substring(1, 3), 16) / 255d
      val g = Integer.valueOf(code.substring(3, 5), 16) / 255d
      val b = Integer.valueOf(code.substring(5, 7), 16) / 255d
      Color(r, g, b, 0)
    }).toOption

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
        JsError(Seq(JsPath() -> Seq(JsonValidationError("validate.error.expected.vec3IntArray"))))
    }
  }

}
