package models

import play.api.libs.json.Json
import play.api.libs.json.Writes
import play.api.libs.json.JsValue
import play.api.libs.json.Format

import brainflight.tools.ExtendedTypes._

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
    def reads(js: JsValue) = {
      js.as[List[Float]] match{
        case r :: g :: b :: a :: Nil =>
          Color(r, g, b, a)
        case _ =>
          throw new RuntimeException("Color expected.")
      }
      
    }
  }
}