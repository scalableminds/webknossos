package com.scalableminds.util.geometry

import play.api.libs.json.{Json, OFormat};

case class Vec3Float(x: Float, y: Float, z: Float) {
  def scale(s: Float): Vec3Float = Vec3Float(x * s, y * s, z * s)

  def *(s: Float): Vec3Float = scale(s)
  def *(that: Vec3Float): Vec3Float = Vec3Float(x * that.x, y * that.y, z * that.z)
  def +(that: Vec3Float): Vec3Float = Vec3Float(x + that.x, y + that.y, z + that.y)

  def toList: List[Float] = List(x, y, z)
  def matmul(that: Array[Array[Float]]): Option[Vec3Float] = {
    val l: Array[Float] = this.toList.toArray ++ Array[Float](1.0.toFloat)
    val result: Array[Array[Float]] = that.map(xs => xs.zip(l).map{case (x,y) => x * y})

    if (that.length < 3 || that(0).length < 3)
      None
    else
      Some(Vec3Float(result(0).sum, result(1).sum, result(2).sum))
  }
}

object Vec3Float {
  implicit val jsonFormat: OFormat[Vec3Float] = Json.format[Vec3Float]
}
