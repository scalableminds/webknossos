package models

import play.api.libs.json.Json
import play.api.libs.json.Writes
import play.api.libs.json.JsValue
import play.api.libs.json.Format

case class Color( r: Float, g: Float, b: Float, a: Float){
  def toHTML = "#%x%x%x".format((r*255).toInt, (g*255).toInt, (b*255).toInt)
}

object Color {
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