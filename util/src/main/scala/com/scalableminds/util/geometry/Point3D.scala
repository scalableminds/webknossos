package com.scalableminds.util.geometry

import play.api.libs.json.Json._
import play.api.libs.json._

trait GenericPosition {
  def x: Int
  def y: Int
  def z: Int
}

case class Point3D(x: Int, y: Int, z: Int) {
  def scale(f: (Int, Int) => Int) =
    Point3D(f(x, 0), f(y, 1), f(z, 2))

  def scale(s: Int): Point3D =
    Point3D(x * s, y * s, z * s)

  def scale(s: Float): Point3D =
    Point3D((x * s).toInt, (y * s).toInt, (z * s).toInt)

  def <=(o: Point3D): Boolean =
    x <= o.x && y <= o.y && z <= o.z

  def hasGreaterCoordinateAs(other: Point3D) =
    x > other.x || y > other.y || z > other.z

  def isIsotropic: Boolean =
    x == y && y == z

  override def toString = "(%d, %d, %d)".format(x, y, z)

  def toList = List(x, y, z)

  def move(dx: Int, dy: Int, dz: Int) =
    Point3D(x + dx, y + dy, z + dz)

  def dx(d: Int) =
    Point3D(x + d, y, z)

  def dy(d: Int) =
    Point3D(x, y + d, z)

  def dz(d: Int) =
    Point3D(x, y, z + d)

  def move(o: Point3D): Point3D =
    move(o.x, o.y, o.z)

  def negate = Point3D(-x, -y, -z)

  def to(bottomRight: Point3D) =
    range(bottomRight, _ to _)

  def until(bottomRight: Point3D) =
    range(bottomRight, _ until _)

  def maxDim = Math.max(Math.max(x, y), z)

  private def range(other: Point3D, func: (Int, Int) => Range) =
    for {
      x <- func(x, other.x)
      y <- func(y, other.y)
      z <- func(z, other.z)
    } yield {
      Point3D(x, y, z)
    }
}

object Point3D {
  val formRx = "\\s*([0-9]+),\\s*([0-9]+),\\s*([0-9]+)\\s*".r
  def toForm(p: Point3D) = Some("%d, %d, %d".format(p.x, p.y, p.z))

  def apply(t: (Int, Int, Int)): Point3D =
    Point3D(t._1, t._2, t._3)

  def fromForm(s: String) =
    s match {
      case formRx(x, y, z) =>
        Point3D(Integer.parseInt(x), Integer.parseInt(y), Integer.parseInt(z))
      case _ =>
        null
    }

  def fromArray[T <% Int](array: Array[T]) =
    if (array.size >= 3)
      Some(Point3D(array(0), array(1), array(2)))
    else
      None

  def fromList(l: List[Int]) =
    fromArray(l.toArray)

  implicit object Point3DReads extends Reads[Point3D] {
    def reads(json: JsValue) = json match {
      case JsArray(ts) if ts.size == 3 =>
        val c = ts.map(fromJson[Int](_)).flatMap(_.asOpt)
        if (c.size != 3)
          JsError(Seq(JsPath() -> Seq(JsonValidationError("validate.error.array.invalidContent"))))
        else
          JsSuccess(Point3D(c(0), c(1), c(2)))
      case _ =>
        JsError(Seq(JsPath() -> Seq(JsonValidationError("validate.error.expected.point3DArray"))))
    }
  }

  implicit object Point3DWrites extends Writes[Point3D] {
    def writes(v: Point3D) = {
      val l = List(v.x, v.y, v.z)
      JsArray(l.map(toJson(_)))
    }
  }
}
