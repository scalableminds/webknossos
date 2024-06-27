package com.scalableminds.util.geometry

import com.scalableminds.util.tools.Math._
import play.api.libs.json.Json._
import play.api.libs.json._

import scala.math._

case class Vec3Double(x: Double, y: Double, z: Double) {

  def normalize: Vec3Double = {
    val length = sqrt(square(x) + square(y) + square(z))
    if (length != 0)
      Vec3Double(x / length, y / length, z / length)
    else
      this
  }

  def -(o: Vec3Double): Vec3Double =
    new Vec3Double(x - o.x, y - o.y, z - o.z)

  def +(o: Vec3Double): Vec3Double =
    new Vec3Double(x + o.x, y + o.y, z + o.z)

  def x(o: Vec3Double): Vec3Double =
    new Vec3Double(y * o.z - z * o.y, z * o.x - x * o.z, x * o.y - y * o.x)

  def *(o: Double): Vec3Double = Vec3Double(x * o, y * o, z * o)

  def *:(o: Double): Vec3Double = this.*(o)

  // Element-wise multiplication
  def *(o: Vec3Double): Vec3Double = Vec3Double(x * o.x, y * o.y, z * o.z)

  // Element-wise division
  def /(o: Vec3Double): Vec3Double = Vec3Double(x / o.x, y / o.y, z / o.z)

  /**
    * Transforms this vector using a transformation matrix
    */
  def transformAffine(matrix: Array[Float]): Vec3Double = {
    // see rotation matrix and helmert-transformation for more details
    val nx = matrix(0) * x + matrix(4) * y + matrix(8) * z + matrix(12)
    val ny = matrix(1) * x + matrix(5) * y + matrix(9) * z + matrix(13)
    val nz = matrix(2) * x + matrix(6) * y + matrix(10) * z + matrix(14)
    Vec3Double(nx, ny, nz)
  }

  def rotate(matrix: List[Float]): Vec3Double = {
    // see rotation matrix and helmert-transformation for more details
    val nx = matrix(0) * x + matrix(4) * y + matrix(8) * z
    val ny = matrix(1) * x + matrix(5) * y + matrix(9) * z
    val nz = matrix(2) * x + matrix(6) * y + matrix(10) * z
    Vec3Double(nx, ny, nz)
  }

  def maxDim: Double = Math.max(Math.max(x, y), z)

  def toVec3Int: Vec3Int = Vec3Int(x.toInt, y.toInt, z.toInt)

  def round: Vec3Double = Vec3Double(x.round.toDouble, y.round.toDouble, z.round.toDouble)

  def °(o: Vec3Double): Double = x * o.x + y * o.y + z * o.z

  def °(o: Tuple3[Double, Double, Double]): Double = x * o._1 + y * o._2 + z * o._3

  def toTuple: (Double, Double, Double) = (x, y, z)

  def toList: List[Double] = List(x, y, z)

  def isStrictlyPositive: Boolean = x > 0 && y > 0 && z > 0

  override def toString = s"($x, $y, $z)"

  def toUriLiteral: String = s"$x,$y,$z"
}

object Vec3Double {
  def apply(p: Vec3Int): Vec3Double =
    Vec3Double(p.x, p.y, p.z)

  def apply(p: (Double, Double, Double)): Vec3Double =
    Vec3Double(p._1, p._2, p._3)

  def apply(from: Vec3Int, to: Vec3Int): Vec3Double =
    Vec3Double(to) - Vec3Double(from)

  def fromArray(array: Array[Double]): Option[Vec3Double] =
    if (array.length >= 3)
      Some(Vec3Double(array(0), array(1), array(2)))
    else
      None

  def fromList(l: List[Double]): Option[Vec3Double] =
    fromArray(l.toArray)

  def fromUriLiteral(s: String): Option[Vec3Double] =
    try {
      fromArray(s.trim.split(",").map(java.lang.Double.parseDouble))
    } catch {
      case _: NumberFormatException => None
    }

  def ones: Vec3Double = Vec3Double(1.0, 1.0, 1.0)

  def zeros: Vec3Double = Vec3Double(0.0, 0.0, 0.0)

  implicit object Vec3DoubleReads extends Format[Vec3Double] {
    def reads(json: JsValue): JsResult[Vec3Double] = json match {
      case JsArray(ts) if ts.size == 3 =>
        ts.toList.map(fromJson[Double](_)) match {
          case JsSuccess(a, _) :: JsSuccess(b, _) :: JsSuccess(c, _) :: _ =>
            JsSuccess(Vec3Double(a, b, c))
          case x =>
            JsError("Invalid array content: " + x)
        }
      case _ =>
        JsError(Seq(JsPath() -> Seq(JsonValidationError("validate.error.listExpected"))))
    }

    def writes(v: Vec3Double): JsValue =
      Json.toJson(List(v.x, v.y, v.z))
  }
}
