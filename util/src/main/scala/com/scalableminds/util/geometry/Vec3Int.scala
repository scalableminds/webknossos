package com.scalableminds.util.geometry

import com.scalableminds.util.tools.ExtendedTypes.ExtendedString
import play.api.libs.json.Json._
import play.api.libs.json._

case class Vec3Int(x: Int, y: Int, z: Int) {
  def scale(s: Int): Vec3Int =
    Vec3Int(x * s, y * s, z * s)

  def scale(s: Float): Vec3Int =
    Vec3Int((x * s).toInt, (y * s).toInt, (z * s).toInt)

  def <=(other: Vec3Int): Boolean =
    x <= other.x && y <= other.y && z <= other.z

  def isIsotropic: Boolean =
    x == y && y == z

  override def toString: String = s"($x, $y, $z)"

  def toMagLiteral(allowScalar: Boolean = false): String =
    if (allowScalar && isIsotropic) s"$x" else s"$x-$y-$z"

  def toList = List(x, y, z)

  def move(dx: Int, dy: Int, dz: Int) =
    Vec3Int(x + dx, y + dy, z + dz)

  def move(other: Vec3Int): Vec3Int =
    move(other.x, other.y, other.z)

  def negate = Vec3Int(-x, -y, -z)

  def to(bottomRight: Vec3Int) =
    range(bottomRight, _ to _)

  def until(bottomRight: Vec3Int) =
    range(bottomRight, _ until _)

  def maxDim: Int = Math.max(Math.max(x, y), z)

  private def range(other: Vec3Int, func: (Int, Int) => Range) =
    for {
      x <- func(x, other.x)
      y <- func(y, other.y)
      z <- func(z, other.z)
    } yield Vec3Int(x, y, z)

  def product: Int = x * y * z
}

object Vec3Int {
  private val magLiteralRegex = """(\d+)-(\d+)-(\d+)""".r

  def fromMagLiteral(s: String, allowScalar: Boolean = false): Option[Vec3Int] =
    s.toIntOpt match {
      case Some(scalar) if allowScalar => Some(Vec3Int.full(scalar))
      case _ =>
        s match {
          case magLiteralRegex(x, y, z) =>
            Some(Vec3Int(Integer.parseInt(x), Integer.parseInt(y), Integer.parseInt(z)))
          case _ =>
            None
        }
    }

  def fromArray[T <% Int](array: Array[T]) =
    if (array.size >= 3)
      Some(Vec3Int(array(0), array(1), array(2)))
    else
      None

  def fromList(l: List[Int]) =
    fromArray(l.toArray)

  def full(i: Int): Vec3Int = Vec3Int(i, i, i)

  implicit object Vec3IntReads extends Reads[Vec3Int] {
    def reads(json: JsValue): JsResult[Vec3Int] = json match {
      case JsArray(ts) if ts.size == 3 =>
        val c = ts.map(fromJson[Int](_)).flatMap(_.asOpt)
        if (c.size != 3)
          JsError(Seq(JsPath() -> Seq(JsonValidationError("validate.error.array.invalidContent"))))
        else
          JsSuccess(Vec3Int(c(0), c(1), c(2)))
      case _ =>
        JsError(Seq(JsPath() -> Seq(JsonValidationError("validate.error.expected.vec3IntArray"))))
    }
  }

  implicit object Vec3IntWrites extends Writes[Vec3Int] {
    def writes(v: Vec3Int): JsArray = {
      val l = List(v.x, v.y, v.z)
      JsArray(l.map(toJson(_)))
    }
  }
}
