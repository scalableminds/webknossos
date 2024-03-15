package com.scalableminds.util.geometry

import play.api.libs.json.Json.{fromJson, toJson}
import play.api.libs.json.{JsArray, JsError, JsPath, JsResult, JsSuccess, JsValue, JsonValidationError, Reads, Writes};

case class Vec3Float(x: Float, y: Float, z: Float) {
  def scale(s: Float): Vec3Float = Vec3Float(x * s, y * s, z * s)

  def *(s: Float): Vec3Float = scale(s)

  def *(s: Double): Vec3Float = scale(s.toFloat)

  def *(that: Vec3Float): Vec3Float = Vec3Float(x * that.x, y * that.y, z * that.z)

  def +(that: Vec3Float): Vec3Float = Vec3Float(x + that.x, y + that.y, z + that.z)

  def -(that: Vec3Float): Vec3Float = Vec3Float(x - that.x, y - that.y, z - that.z)

  def toList: List[Float] = List(x, y, z)

  def normalize: Vec3Float = {
    val length = Math.sqrt(x * x + y * y + z * z)
    scale(1 / length.toFloat)
  }
}

object Vec3Float {
  implicit object Vec3FloatReads extends Reads[Vec3Float] {
    def reads(json: JsValue): JsResult[Vec3Float] = json match {
      case JsArray(ts) if ts.size == 3 =>
        val c = ts.map(fromJson[Float](_)).flatMap(_.asOpt)
        if (c.size != 3)
          JsError(Seq(JsPath() -> Seq(JsonValidationError("validate.error.array.invalidContent"))))
        else
          JsSuccess(Vec3Float(c(0), c(1), c(2)))
      case _ =>
        JsError(Seq(JsPath() -> Seq(JsonValidationError("validate.error.expected.vec3FloatArray"))))
    }
  }

  implicit object Vec3FloatWrites extends Writes[Vec3Float] {
    def writes(v: Vec3Float): JsArray = {
      val l = List(v.x, v.y, v.z)
      JsArray(l.map(toJson(_)))
    }
  }

  def crossProduct(a: Vec3Float, b: Vec3Float): Vec3Float =
    Vec3Float(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
}
