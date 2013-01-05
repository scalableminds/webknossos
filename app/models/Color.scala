package models

import play.api.libs.json.Json._
import play.api.libs.json._
import play.api.libs.json.Writes
import play.api.libs.json.JsValue
import play.api.libs.json.Format
import play.api.data.validation.ValidationError

import braingames.util.ExtendedTypes.ExtendedDouble

case class Color( r: Double, g: Double, b: Double, a: Double){
  def toHtml = "#%02x%02x%02x".format((r*255).toInt, (g*255).toInt, (b*255).toInt)
}

object Color {
  def jet(value: Float) = {
    val fourValue = value / 64.0
    Color(
      math.min(fourValue - 1.5, -fourValue + 4.5).clamp(0,1),
      math.min(fourValue - 0.5, -fourValue + 3.5).clamp(0,1),
      math.min(fourValue + 0.5, -fourValue + 2.5).clamp(0,1),
      1
    )
  }
  implicit object ColorFormat extends Format[Color] {
    def writes(c: Color) = Json.arr(c.r, c.g, c.b, c.a)
    // TODO: Rewrite to use new json features of play
    // http://mandubian.com/2012/09/08/unveiling-play-2-dot-1-json-api-part1-jspath-reads-combinators/
    def reads(json: JsValue) = json match {
      case JsArray(ts) if ts.size == 3 =>
        val c = ts.map(fromJson[Float](_)).flatMap(_.asOpt)
        if(c.size != 4)
          JsError(Seq(JsPath() -> Seq(ValidationError("validate.error.array.invalidContent"))))
        else
          JsSuccess(Color(c(0), c(1), c(2), c(3)))
      case _ =>
        JsError(Seq(JsPath() -> Seq(ValidationError("validate.error.expected.point3DArray"))))
    }
  }
}