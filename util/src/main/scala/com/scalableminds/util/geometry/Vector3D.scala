/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.geometry

import com.scalableminds.util.tools.Math._
import play.api.data.validation.ValidationError
import play.api.libs.json.Json._
import play.api.libs.json._

import scala.math._

/**
 * Vector in 3D space
 */
case class Vector3D(x: Double = 0, y: Double = 0, z: Double = 0) {

  def normalize = {
    val length = sqrt(square(x) + square(y) + square(z))
    if (length != 0)
      Vector3D(x / length, y / length, z / length)
    else
      this
  }

  def neg = Vector3D(-x, -y, -z)

  def -(o: Vector3D): Vector3D = {
    new Vector3D(x - o.x, y - o.y, z - o.z)
  }

  def +(o: Vector3D): Vector3D = {
    new Vector3D(x + o.x, y + o.y, z + o.z)
  }

  def x(o: Vector3D): Vector3D = {
    new Vector3D(
      y * o.z - z * o.y,
      z * o.x - x * o.z,
      x * o.y - y * o.x)
  }

  def *(o: Double) = Vector3D(x * o, y * o, z * o)

  def *:(o: Double) = this.*(o)

  /**
   * Transforms this vector using a transformation matrix
   */
  def transformAffine(matrix: Array[Float]): Vector3D = {
    // see rotation matrix and helmert-transformation for more details
    val nx = matrix(0) * x + matrix(4) * y + matrix(8) * z + matrix(12)
    val ny = matrix(1) * x + matrix(5) * y + matrix(9) * z + matrix(13)
    val nz = matrix(2) * x + matrix(6) * y + matrix(10) * z + matrix(14)
    Vector3D(nx, ny, nz)
  }

  def rotate(matrix: List[Float]): Vector3D = {
    // see rotation matrix and helmert-transformation for more details
    val nx = matrix(0) * x + matrix(4) * y + matrix(8) * z
    val ny = matrix(1) * x + matrix(5) * y + matrix(9) * z
    val nz = matrix(2) * x + matrix(6) * y + matrix(10) * z
    Vector3D(nx, ny, nz)
  }

  def toVector3I = Vector3I(x.round.toInt, y.round.toInt, z.round.toInt)

  def toPoint3D = Point3D(x.toInt, y.toInt, z.toInt)

  def °(o: Vector3D) = x * o.x + y * o.y + z * o.z

  def °(o: Tuple3[Double, Double, Double]) = x * o._1 + y * o._2 + z * o._3

  def toTuple = (x, y, z)

  def toList = List(x, y, z)

  override def toString = s"($x, $y, $z)"
}

object Vector3D {
  def apply(p: Point3D): Vector3D =
    Vector3D(p.x, p.y, p.z)

  def apply(p: (Double, Double, Double)): Vector3D =
    Vector3D(p._1, p._2, p._3)

  def apply(from: Point3D, to: Point3D): Vector3D =
    Vector3D(to) - Vector3D(from)

  def fromArray[T <% Double](array: Array[T]) =
    if (array.size >= 3)
      Some(Vector3D(array(0), array(1), array(2)))
    else
      None

  def fromList(l: List[Double]) = {
    fromArray(l.toArray)
  }

  implicit object Vector3DReads extends Format[Vector3D] {
    def reads(json: JsValue) = json match {
      case JsArray(ts) if ts.size == 3 =>
        ts.toList.map(fromJson[Double](_)) match {
          case JsSuccess(a, _) :: JsSuccess(b, _) :: JsSuccess(c, _) :: _ =>
            JsSuccess(Vector3D(a, b, c))
          case x =>
            JsError("Invalid array content: " + x)
        }
      case _ =>
        JsError(Seq(JsPath() -> Seq(ValidationError("validate.error.listExpected"))))
    }

    def writes(v: Vector3D) =
      Json.toJson(List(v.x, v.y, v.z))
  }
}
