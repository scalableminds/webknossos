package models

import play.api.libs.json.Json
import play.api.libs.json.Writes

case class Color( r: Float, g: Float, b: Float)

object Color {
  implicit object ColorWrites extends Writes[Color] {
    def writes(c: Color) = Json.arr(c.r, c.g, c.b)
  }
}