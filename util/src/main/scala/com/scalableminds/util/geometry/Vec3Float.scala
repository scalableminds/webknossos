package com.scalableminds.util.geometry

import play.api.libs.json.{Json, OFormat};

case class Vec3Float(x: Float, y: Float, z: Float) {
  def scale(s: Float): Vec3Float = Vec3Float(x * s, y * s, z * s)

  def *(s: Float): Vec3Float = scale(s)
  def *(s: Double): Vec3Float = scale(s.toFloat)
  def *(that: Vec3Float): Vec3Float = Vec3Float(x * that.x, y * that.y, z * that.z)
  def +(that: Vec3Float): Vec3Float = Vec3Float(x + that.x, y + that.y, z + that.y)

  def toList: List[Float] = List(x, y, z)
}

object Vec3Float {
  implicit val jsonFormat: OFormat[Vec3Float] = Json.format[Vec3Float]
}
